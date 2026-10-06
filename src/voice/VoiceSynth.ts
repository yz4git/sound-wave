import type { PitchClass } from '../core/music';
import type { VocalEvent, VocalStyle } from '../compose/VocalGenerator';
import { consonantForSyllable } from '../compose/JapanesePhoneme';
import type { VocalPhraseControl } from '../compose/VocalPhraseModel';
import { VocalWorkletBridge, vocalEventToWorklet, type VocalWorkletStatus } from '../compose/VocalWorkletBridge';
import type { VoiceCharacterPreset } from '../compose/VoiceCharacter';
import { WavCapture } from '../compose/SongExport';
import {
  japaneseF0LayersForUnit,
  resolveVoiceIntonation,
  type VoiceIntonation,
  type VoicePunctuationKind,
  type VoiceResolvedIntonation,
  type VoiceScript,
  type VoiceSpeechEvent,
  type VoiceSpeechEventKind,
  type VoiceUnit,
} from './VoiceScript';
import {
  voiceExpressionControl,
  voiceExpressionForUnit,
  type VoiceExpressionSettings,
} from './VoiceExpression';
import {
  voiceIdentityConditioningFor,
  type VoiceIdentityConditioning,
} from './VoiceConditioning';
import type { VoiceIdentityImprint } from './VoiceImprint';

export type VoiceRenderQuality = 'fast' | 'hq';

export interface VoiceSynthSettings {
  quality?: VoiceRenderQuality;
  style: VocalStyle;
  character: VoiceCharacterPreset;
  tone: number;
  /** -1 = shorter/brighter tract, +1 = longer/deeper tract. */
  tractLength?: number;
  /** Optional local spectral imprint extracted from an authorized reference clip. */
  identityImprint?: VoiceIdentityImprint | null;
  rate: number;
  pitch: number;
  energy: number;
  intonation: VoiceIntonation;
  expression?: VoiceExpressionSettings;
}

export interface VoiceProsodyEdits {
  pitchOffsets?: readonly number[];
  energyScales?: readonly number[];
  durationScales?: readonly number[];
  localExpressions?: readonly (VoiceExpressionSettings | null)[];
  phrasePitchOffsets?: readonly number[];
  phraseRateScales?: readonly number[];
  phraseEnergyScales?: readonly number[];
  phraseEmphasisScales?: readonly number[];
  pauseOverrides?: readonly (number | null)[];
}

type VoiceProsodyInput = VoiceProsodyEdits | readonly number[];

export interface VoiceTimedUnit {
  unit: VoiceUnit;
  start: number;
  duration: number;
  pitchMidi: number;
  energyScale: number;
  manualPitchOffset: number;
  manualEnergyScale: number;
  manualDurationScale: number;
  phrasePitchOffset: number;
  phraseRateScale: number;
  phraseEnergyScale: number;
  phraseEmphasis: number;
  /** Slow Japanese phrase/baseline F0 component in semitones. */
  phraseF0Offset: number;
  /** Lexical/inferred accent-phrase F0 component in semitones. */
  accentF0Offset: number;
  expression: VoiceExpressionSettings;
}

export interface VoiceTimedSpeechEvent {
  event: VoiceSpeechEvent;
  start: number;
  duration: number;
  gapAfter: number;
}

export interface VoiceSpeechControlFrame {
  unitIndex: number;
  f0Midi: number;
  energy: number;
  duration: number;
  articulation: SpeechArticulatoryState;
  timbre: SpeechTimbreProfile;
  harmonicNoise: SpeechHarmonicNoiseProfile;
}

export function voiceSpeechControlFrameFor(
  unit: VoiceUnit,
  unitIndex: number,
  f0Midi: number,
  energy: number,
  duration: number,
  settings: VoiceSynthSettings,
  expression: VoiceExpressionSettings,
): VoiceSpeechControlFrame {
  return {
    unitIndex,
    f0Midi,
    energy,
    duration,
    articulation: speechArticulatoryStateFor(unit),
    timbre: speechTimbreProfileFor(settings.character, settings.tone, expression),
    harmonicNoise: speechHarmonicNoiseProfileFor(unit),
  };
}

export type VoiceSynthesisChunkKind = 'sentence' | 'long-fragment';

export interface VoiceSynthesisChunk {
  index: number;
  sentenceIndex: number;
  startUnit: number;
  endUnit: number;
  start: number;
  end: number;
  duration: number;
  gapAfter: number;
  kind: VoiceSynthesisChunkKind;
  /** True when this chunk is a processing split inside the same sentence. */
  continuationFromPrevious: boolean;
}

export interface VoicePlaybackPlan {
  duration: number;
  units: VoiceTimedUnit[];
  events: VoiceTimedSpeechEvent[];
  strategy: SpeechUtteranceStrategy;
  chunks: VoiceSynthesisChunk[];
}

export interface SpeechEventProfile {
  duration: number;
  gapAfter: number;
  pitchSemitones: number;
  velocityScale: number;
  pulseCount: number;
}

export function speechEventProfileFor(
  kind: VoiceSpeechEventKind,
  strength: number,
): SpeechEventProfile {
  const amount = clamp(strength, 0, 1.2);
  if (kind === 'laugh') {
    return {
      duration: 0.2 + amount * 0.07,
      gapAfter: 0.025 + amount * 0.015,
      pitchSemitones: 2.1 + amount * 1,
      velocityScale: 0.15 + amount * 0.12,
      pulseCount: 2,
    };
  }
  if (kind === 'sigh') {
    return {
      duration: 0.34 + amount * 0.16,
      gapAfter: 0.028 + amount * 0.025,
      pitchSemitones: -3 - amount * 1.1,
      velocityScale: 0.085 + amount * 0.065,
      pulseCount: 1,
    };
  }
  if (kind === 'inhale') {
    return {
      duration: 0.09 + amount * 0.07,
      gapAfter: 0.025 + amount * 0.018,
      pitchSemitones: -2,
      velocityScale: 0.09 + amount * 0.06,
      pulseCount: 1,
    };
  }
  if (kind === 'restart') {
    return {
      duration: 0,
      gapAfter: 0.17 + amount * 0.03,
      pitchSemitones: 0,
      velocityScale: 0,
      pulseCount: 0,
    };
  }
  return {
    duration: 0,
    gapAfter: 0.24 + amount * 0.05,
    pitchSemitones: 0,
    velocityScale: 0,
    pulseCount: 0,
  };
}

export interface SpeechEventTransition {
  pitchSemitones: number;
  rateScale: number;
  energyScale: number;
}

export function speechEventTransitionFor(
  events: readonly VoiceSpeechEvent[],
): SpeechEventTransition {
  let pitchSemitones = 0;
  let rateScale = 1;
  let energyScale = 1;
  for (const event of events) {
    if (event.kind === 'restart') {
      pitchSemitones += 0.14 * event.strength;
      rateScale *= 0.965;
      energyScale *= 1 + 0.045 * event.strength;
    } else if (event.kind === 'rethink') {
      pitchSemitones -= 0.08 * event.strength;
      rateScale *= 0.92;
      energyScale *= 1 - 0.06 * event.strength;
    } else if (event.kind === 'inhale') {
      rateScale *= 0.985;
      energyScale *= 1.015;
    } else if (event.kind === 'sigh') {
      pitchSemitones -= 0.04 * event.strength;
      rateScale *= 0.97;
      energyScale *= 0.96;
    } else if (event.kind === 'laugh') {
      pitchSemitones += 0.04 * event.strength;
      energyScale *= 1.02;
    }
  }
  return {
    pitchSemitones: clamp(pitchSemitones, -0.25, 0.25),
    rateScale: clamp(rateScale, 0.86, 1.06),
    energyScale: clamp(energyScale, 0.84, 1.12),
  };
}

export interface SpeechSourceProfile {
  sourceMix: number;
  sourceTilt: number;
  coarticulation: number;
  pulseNoise: number;
  geminateClosureSeconds: number;
  formantCarry: number;
  vowelTransitionScale: number;
  cvOverlap: number;
  glottalDriftCents: number;
  glottalJitterCents: number;
  openQuotientMotion: number;
}

export function speechSourceProfileFor(expression: VoiceExpressionSettings): SpeechSourceProfile {
  const neutral: SpeechSourceProfile = {
    sourceMix: 0.9,
    sourceTilt: 0.52,
    coarticulation: 0.82,
    pulseNoise: 0.055,
    geminateClosureSeconds: 0.052,
    formantCarry: 0.9,
    vowelTransitionScale: 1.16,
    cvOverlap: 0.66,
    glottalDriftCents: 0.72,
    glottalJitterCents: 0.82,
    openQuotientMotion: 0.012,
  };
  const target: SpeechSourceProfile = expression.preset === 'whisper'
    ? {
        sourceMix: 0.8,
        sourceTilt: 0.7,
        coarticulation: 0.82,
        pulseNoise: 0.18,
        geminateClosureSeconds: 0.052,
        formantCarry: 0.92,
        vowelTransitionScale: 1.2,
        cvOverlap: 0.72,
        glottalDriftCents: 0.58,
        glottalJitterCents: 0.72,
        openQuotientMotion: 0.014,
      }
    : expression.preset === 'excited'
      ? {
          sourceMix: 0.86,
          sourceTilt: 0.42,
          coarticulation: 0.72,
          pulseNoise: 0.045,
          geminateClosureSeconds: 0.05,
          formantCarry: 0.86,
          vowelTransitionScale: 1.08,
          cvOverlap: 0.58,
          glottalDriftCents: 0.82,
          glottalJitterCents: 0.92,
          openQuotientMotion: 0.01,
        }
      : expression.preset === 'calm'
        ? {
            sourceMix: 0.94,
            sourceTilt: 0.62,
            coarticulation: 0.88,
            pulseNoise: 0.07,
            geminateClosureSeconds: 0.054,
            formantCarry: 0.94,
            vowelTransitionScale: 1.25,
            cvOverlap: 0.74,
            glottalDriftCents: 0.52,
            glottalJitterCents: 0.64,
            openQuotientMotion: 0.015,
          }
        : expression.preset === 'serious'
          ? {
              sourceMix: 0.92,
              sourceTilt: 0.47,
              coarticulation: 0.78,
              pulseNoise: 0.04,
              geminateClosureSeconds: 0.052,
              formantCarry: 0.88,
              vowelTransitionScale: 1.12,
              cvOverlap: 0.62,
              glottalDriftCents: 0.64,
              glottalJitterCents: 0.76,
              openQuotientMotion: 0.01,
            }
          : expression.preset === 'narration'
            ? {
                sourceMix: 0.93,
                sourceTilt: 0.54,
                coarticulation: 0.84,
                pulseNoise: 0.055,
                geminateClosureSeconds: 0.053,
                formantCarry: 0.92,
                vowelTransitionScale: 1.2,
                cvOverlap: 0.7,
                glottalDriftCents: 0.56,
                glottalJitterCents: 0.68,
                openQuotientMotion: 0.013,
              }
            : neutral;

  if (expression.preset === 'neutral') return neutral;
  const amount = clamp(expression.intensity, 0, 1.35);
  const lerp = (a: number, b: number): number => a + (b - a) * amount;
  return {
    sourceMix: clamp(lerp(neutral.sourceMix, target.sourceMix), 0.72, 0.98),
    sourceTilt: clamp(lerp(neutral.sourceTilt, target.sourceTilt), 0.38, 0.84),
    coarticulation: clamp(lerp(neutral.coarticulation, target.coarticulation), 0.62, 0.94),
    pulseNoise: clamp(lerp(neutral.pulseNoise, target.pulseNoise), 0.025, 0.22),
    geminateClosureSeconds: clamp(
      lerp(neutral.geminateClosureSeconds, target.geminateClosureSeconds),
      0.048,
      0.058,
    ),
    formantCarry: clamp(lerp(neutral.formantCarry, target.formantCarry), 0.82, 0.96),
    vowelTransitionScale: clamp(
      lerp(neutral.vowelTransitionScale, target.vowelTransitionScale),
      0.9,
      1.35,
    ),
    cvOverlap: clamp(lerp(neutral.cvOverlap, target.cvOverlap), 0.45, 0.82),
    glottalDriftCents: clamp(
      lerp(neutral.glottalDriftCents, target.glottalDriftCents),
      0.4,
      1.1,
    ),
    glottalJitterCents: clamp(
      lerp(neutral.glottalJitterCents, target.glottalJitterCents),
      0.45,
      1.15,
    ),
    openQuotientMotion: clamp(
      lerp(neutral.openQuotientMotion, target.openQuotientMotion),
      0.006,
      0.02,
    ),
  };
}

export interface SpeechArticulatoryState {
  jawOpen: number;
  tongueFront: number;
  tongueHeight: number;
  lipRound: number;
  velumOpen: number;
  larynxHeight: number;
}

export interface SpeechArticulatoryFilter {
  formantScale: readonly [number, number, number, number, number];
  bandwidthScale: number;
  nasalMixAdd: number;
  noiseScale: number;
  bodyScale: number;
  dampingScale: number;
}

export function speechArticulatoryStateFor(unit: VoiceUnit): SpeechArticulatoryState {
  const vowelBase: Record<VoiceUnit['vowel'], SpeechArticulatoryState> = {
    a: {
      jawOpen: 0.9,
      tongueFront: 0.48,
      tongueHeight: 0.18,
      lipRound: 0.06,
      velumOpen: 0,
      larynxHeight: 0.5,
    },
    e: {
      jawOpen: 0.5,
      tongueFront: 0.82,
      tongueHeight: 0.6,
      lipRound: 0.04,
      velumOpen: 0,
      larynxHeight: 0.52,
    },
    i: {
      jawOpen: 0.26,
      tongueFront: 0.94,
      tongueHeight: 0.92,
      lipRound: 0.02,
      velumOpen: 0,
      larynxHeight: 0.54,
    },
    o: {
      jawOpen: 0.56,
      tongueFront: 0.28,
      tongueHeight: 0.5,
      lipRound: 0.68,
      velumOpen: 0,
      larynxHeight: 0.47,
    },
    u: {
      jawOpen: 0.32,
      tongueFront: 0.36,
      tongueHeight: 0.84,
      lipRound: 0.22,
      velumOpen: 0,
      larynxHeight: 0.48,
    },
  };
  const base = { ...vowelBase[unit.vowel] };
  const consonant = consonantForSyllable(unit.syllable);

  if (consonant === 'n' || consonant === 'm' || consonant === 'N') {
    base.velumOpen = consonant === 'N' ? 0.88 : consonant === 'm' ? 0.72 : 0.66;
    base.larynxHeight -= 0.035;
  } else if (
    consonant === 's'
    || consonant === 'sh'
    || consonant === 'z'
    || consonant === 'j'
    || consonant === 'ts'
    || consonant === 'ch'
  ) {
    base.tongueFront = clamp(base.tongueFront + 0.06, 0, 1);
    base.tongueHeight = clamp(base.tongueHeight + 0.04, 0, 1);
    base.larynxHeight = clamp(base.larynxHeight + 0.025, 0, 1);
  } else if (consonant === 'w') {
    base.lipRound = clamp(base.lipRound + 0.18, 0, 1);
  } else if (consonant === 'r') {
    base.tongueFront = clamp(base.tongueFront + 0.035, 0, 1);
    base.tongueHeight = clamp(base.tongueHeight + 0.025, 0, 1);
  }

  return base;
}

export function speechArticulatoryTransitionScalesFor(
  unit: VoiceUnit,
  nextUnit: VoiceUnit | null,
  bandIndex: number,
): { current: number; next: number } {
  const currentFilter = speechArticulatoryFilterFor(speechArticulatoryStateFor(unit));
  const current = currentFilter.formantScale[bandIndex] ?? 1;
  if (!nextUnit) return { current, next: current };

  const nextFilter = speechArticulatoryFilterFor(speechArticulatoryStateFor(nextUnit));
  return {
    current,
    next: nextFilter.formantScale[bandIndex] ?? current,
  };
}

export function speechArticulatoryFilterFor(
  state: SpeechArticulatoryState,
): SpeechArticulatoryFilter {
  const jaw = clamp(state.jawOpen, 0, 1);
  const front = clamp(state.tongueFront, 0, 1);
  const high = clamp(state.tongueHeight, 0, 1);
  const round = clamp(state.lipRound, 0, 1);
  const velum = clamp(state.velumOpen, 0, 1);
  const larynx = clamp(state.larynxHeight, 0, 1);

  return {
    formantScale: [
      clamp(1 + (jaw - 0.5) * 0.09 - (high - 0.5) * 0.085, 0.88, 1.13),
      clamp(1 + (front - 0.5) * 0.16 - round * 0.085, 0.83, 1.17),
      clamp(1 + (front - 0.5) * 0.045 - round * 0.05 + (larynx - 0.5) * 0.03, 0.9, 1.1),
      clamp(1 + (larynx - 0.5) * 0.045 - round * 0.025, 0.93, 1.08),
      clamp(1 + (larynx - 0.5) * 0.055, 0.94, 1.08),
    ],
    bandwidthScale: clamp(1 + velum * 0.18 + jaw * 0.025, 0.98, 1.2),
    nasalMixAdd: velum * 0.34,
    noiseScale: clamp(1 + (1 - high) * 0.035 + velum * 0.025, 0.96, 1.08),
    bodyScale: clamp(1 + jaw * 0.05 - round * 0.025, 0.96, 1.06),
    dampingScale: clamp(1 + round * 0.09 - jaw * 0.035, 0.94, 1.1),
  };
}

export interface SpeechConsonantLocusProfile {
  transitionScale: number;
  bandwidthScale: readonly [number, number, number, number, number];
}

export function speechConsonantLocusProfileFor(
  unit: VoiceUnit,
): SpeechConsonantLocusProfile {
  const consonant = consonantForSyllable(unit.syllable);
  const neutral: SpeechConsonantLocusProfile = {
    transitionScale: 1,
    bandwidthScale: [1, 1, 1, 1, 1],
  };

  // Stops move quickly from a compact locus into the vowel. Coronal stops have
  // slightly broader upper transitions; bilabials keep the upper tract softer.
  if (consonant === 'k' || consonant === 'g') {
    return {
      transitionScale: 0.86,
      bandwidthScale: [1.04, 1.08, 1.12, 1.08, 1.04],
    };
  }
  if (consonant === 't' || consonant === 'd') {
    return {
      transitionScale: 0.8,
      bandwidthScale: [1.02, 1.1, 1.16, 1.12, 1.06],
    };
  }
  if (consonant === 'p' || consonant === 'b') {
    return {
      transitionScale: 0.78,
      bandwidthScale: [1.02, 1.04, 1.05, 1.03, 1.02],
    };
  }

  // Affricates/fricatives retain their place cue a little longer while the
  // periodic vowel source enters underneath the noise.
  if (consonant === 'ch' || consonant === 'ts') {
    return {
      transitionScale: 1.12,
      bandwidthScale: [1.04, 1.1, 1.18, 1.2, 1.14],
    };
  }
  if (consonant === 'sh' || consonant === 'j') {
    return {
      transitionScale: 1.16,
      bandwidthScale: [1.02, 1.08, 1.16, 1.18, 1.12],
    };
  }
  if (consonant === 's' || consonant === 'z') {
    return {
      transitionScale: 1.08,
      bandwidthScale: [1.02, 1.06, 1.14, 1.2, 1.16],
    };
  }
  if (consonant === 'f' || consonant === 'h' || consonant === 'v') {
    return {
      transitionScale: 1.04,
      bandwidthScale: [1.03, 1.06, 1.1, 1.1, 1.08],
    };
  }

  // Glides and Japanese /r/ are defined mainly by moving resonances, so keep
  // the locus audible longer but with relatively narrow, smooth bands.
  if (consonant === 'y') {
    return {
      transitionScale: 1.3,
      bandwidthScale: [0.96, 0.94, 0.96, 0.98, 1],
    };
  }
  if (consonant === 'w') {
    return {
      transitionScale: 1.28,
      bandwidthScale: [0.97, 0.93, 0.96, 0.98, 1],
    };
  }
  if (consonant === 'r' || consonant === 'l') {
    return {
      transitionScale: 1.18,
      bandwidthScale: [0.98, 0.96, 0.94, 0.98, 1],
    };
  }

  if (consonant === 'm' || consonant === 'n' || consonant === 'N') {
    return {
      transitionScale: 1.2,
      bandwidthScale: [1.12, 1.14, 1.08, 1.04, 1.02],
    };
  }

  return neutral;
}

export interface SpeechConsonantTransientProfile {
  burstGain: number;
  burstSharpness: number;
  closureVoicingRise: number;
  nasalOnsetBoost: number;
  nasalReleaseScale: number;
}

export function speechConsonantTransientProfileFor(
  unit: VoiceUnit,
): SpeechConsonantTransientProfile {
  const consonant = consonantForSyllable(unit.syllable);
  const base: SpeechConsonantTransientProfile = {
    burstGain: 1,
    burstSharpness: 1,
    closureVoicingRise: 0,
    nasalOnsetBoost: 0,
    nasalReleaseScale: 1,
  };

  if (consonant === 'k') return { ...base, burstGain: 1.12, burstSharpness: 1.32 };
  if (consonant === 't') return { ...base, burstGain: 1.2, burstSharpness: 1.5 };
  if (consonant === 'p') return { ...base, burstGain: 1.06, burstSharpness: 1.18 };
  if (consonant === 'g') {
    return { ...base, burstGain: 1.02, burstSharpness: 1.2, closureVoicingRise: 0.52 };
  }
  if (consonant === 'd') {
    return { ...base, burstGain: 1.08, burstSharpness: 1.38, closureVoicingRise: 0.62 };
  }
  if (consonant === 'b') {
    return { ...base, burstGain: 0.96, burstSharpness: 1.08, closureVoicingRise: 0.68 };
  }
  if (consonant === 'ch' || consonant === 'ts') {
    return { ...base, burstGain: 1.08, burstSharpness: 1.26 };
  }
  if (consonant === 'n') {
    return { ...base, nasalOnsetBoost: 0.2, nasalReleaseScale: 1.18 };
  }
  if (consonant === 'm') {
    return { ...base, nasalOnsetBoost: 0.24, nasalReleaseScale: 1.24 };
  }
  if (consonant === 'N') {
    return { ...base, nasalOnsetBoost: 0.3, nasalReleaseScale: 1.45 };
  }
  return base;
}

export interface SpeechPhonationMicrostructureProfile {
  cycleVariation: number;
  subharmonicMix: number;
  sourceTractCoupling: number;
}

export function speechPhonationMicrostructureFor(
  unit: VoiceUnit,
  quality: VoiceRenderQuality | undefined,
  expression: VoiceExpressionSettings,
): SpeechPhonationMicrostructureProfile {
  if (quality === 'fast') {
    return {
      cycleVariation: 0,
      subharmonicMix: 0,
      sourceTractCoupling: 0,
    };
  }

  const vowel = unit.vowel;
  const intensity = clamp(expression.intensity, 0, 1.35);
  const baseCoupling = vowel === 'a'
    ? 0.055
    : vowel === 'o'
      ? 0.05
      : vowel === 'u'
        ? 0.044
        : vowel === 'e'
          ? 0.036
          : 0.03;

  const breathy = expression.preset === 'whisper'
    ? 0.4
    : expression.preset === 'calm'
      ? 0.12
      : 0;
  const firm = expression.preset === 'serious'
    ? 0.18
    : expression.preset === 'excited'
      ? 0.1
      : 0;

  return {
    cycleVariation: clamp(
      0.0085 + breathy * 0.006 + firm * 0.0025 * intensity,
      0.006,
      0.018,
    ),
    subharmonicMix: clamp(
      0.0035
        + (unit.phraseEnd ? 0.004 : 0)
        + (expression.preset === 'serious' ? 0.0025 * intensity : 0)
        - (expression.preset === 'excited' ? 0.0015 * intensity : 0),
      0,
      0.012,
    ),
    sourceTractCoupling: clamp(
      baseCoupling
        * (1 + firm * 0.28 * intensity)
        * (1 - breathy * 0.22 * intensity),
      0.02,
      0.07,
    ),
  };
}

export interface SpeechVocalTractProfile {
  lengthScale: number;
  frequencyScale: number;
  bandwidthScale: number;
}

export function speechVocalTractProfileFor(
  character: VoiceCharacterPreset,
  tone: number,
  tractLength: number | undefined,
  articulation: SpeechArticulatoryState,
): SpeechVocalTractProfile {
  const baseLength: Record<VoiceCharacterPreset, number> = {
    soft: 1.014,
    natural: 1,
    clear: 0.986,
    airy: 0.994,
    power: 1.026,
  };
  const manual = clamp(tractLength ?? 0, -1, 1);
  const toneAmount = clamp(tone, -1, 1);
  const larynx = clamp(articulation.larynxHeight, 0, 1);
  const lengthScale = clamp(
    (baseLength[character] ?? 1)
      + manual * 0.055
      - toneAmount * 0.014
      + (0.5 - larynx) * 0.026,
    0.92,
    1.08,
  );
  const frequencyScale = clamp(1 / lengthScale, 0.925, 1.087);

  return {
    lengthScale,
    frequencyScale,
    bandwidthScale: clamp(1 + (frequencyScale - 1) * 0.22, 0.975, 1.025),
  };
}

export type VoiceUtteranceKind = 'short' | 'normal' | 'long-single' | 'multi-sentence';
export type VoiceHQSamplingGrid = 'linear' | 'front-loaded';

export interface SpeechUtteranceStrategy {
  kind: VoiceUtteranceKind;
  samplingGrid: VoiceHQSamplingGrid;
  refinementSteps: readonly [number, number, number, number];
  residualScale: number;
  residualSmoothingScale: number;
  closureSmoothingScale: number;
  coarticulationScale: number;
  phonationVariationScale: number;
  finalMicrostructureScale: number;
}

export function speechUtteranceStrategyFor(
  script: VoiceScript,
  predictedDuration?: number,
): SpeechUtteranceStrategy {
  const units = script.units.length;
  const sentenceBoundaries = script.units.filter((unit) => unit.boundaryAfter === 'sentence').length;
  const longByDuration = (predictedDuration ?? units * 0.165) >= 9.5;
  const longSingle = sentenceBoundaries <= 1 && (units >= 54 || longByDuration);

  if (units <= 8) {
    return {
      kind: 'short',
      samplingGrid: 'linear',
      refinementSteps: [0.25, 0.25, 0.25, 0.25],
      residualScale: 0.9,
      residualSmoothingScale: 0.82,
      closureSmoothingScale: 0.88,
      coarticulationScale: 0.96,
      phonationVariationScale: 0.86,
      finalMicrostructureScale: 0.72,
    };
  }

  if (longSingle) {
    return {
      kind: 'long-single',
      samplingGrid: 'front-loaded',
      refinementSteps: [0.125, 0.125, 0.25, 0.5],
      residualScale: 1.03,
      residualSmoothingScale: 1.22,
      closureSmoothingScale: 1.08,
      coarticulationScale: 1.05,
      phonationVariationScale: 0.9,
      finalMicrostructureScale: 0.88,
    };
  }

  if (sentenceBoundaries > 1) {
    return {
      kind: 'multi-sentence',
      samplingGrid: 'linear',
      refinementSteps: [0.25, 0.25, 0.25, 0.25],
      residualScale: 0.98,
      residualSmoothingScale: 1.06,
      closureSmoothingScale: 1,
      coarticulationScale: 1,
      phonationVariationScale: 0.96,
      finalMicrostructureScale: 0.92,
    };
  }

  return {
    kind: 'normal',
    samplingGrid: 'linear',
    refinementSteps: [0.25, 0.25, 0.25, 0.25],
    residualScale: 1,
    residualSmoothingScale: 1,
    closureSmoothingScale: 1,
    coarticulationScale: 1,
    phonationVariationScale: 1,
    finalMicrostructureScale: 1,
  };
}

interface VoiceChunkUnitRange {
  sentenceIndex: number;
  startUnit: number;
  endUnit: number;
  splitSentence: boolean;
}

function splitLongVoiceRange(
  script: VoiceScript,
  sentenceIndex: number,
  startUnit: number,
  endUnit: number,
  output: VoiceChunkUnitRange[],
): void {
  const length = endUnit - startUnit + 1;
  if (length <= 36) {
    output.push({ sentenceIndex, startUnit, endUnit, splitSentence: false });
    return;
  }

  const middle = (startUnit + endUnit) * 0.5;
  const low = startUnit + 11;
  const high = endUnit - 11;
  let splitAfter = -1;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let index = low; index <= high; index += 1) {
    const unit = script.units[index];
    if (!unit) continue;
    const naturalBoundary = unit.boundaryAfter === 'accent'
      || unit.breathAfter
      || unit.continuationAfter !== 'none'
      || unit.discourseAfter === 'list'
      || unit.discourseAfter === 'subject';
    if (!naturalBoundary) continue;
    const distance = Math.abs(index - middle);
    if (distance < bestDistance) {
      bestDistance = distance;
      splitAfter = index;
    }
  }

  if (splitAfter < startUnit || splitAfter >= endUnit) {
    splitAfter = Math.floor(middle);
  }

  const left: VoiceChunkUnitRange[] = [];
  const right: VoiceChunkUnitRange[] = [];
  splitLongVoiceRange(script, sentenceIndex, startUnit, splitAfter, left);
  splitLongVoiceRange(script, sentenceIndex, splitAfter + 1, endUnit, right);
  for (const range of [...left, ...right]) {
    output.push({ ...range, splitSentence: true });
  }
}

/**
 * Irodori-style long-form routing for the deterministic browser engine.
 * Sentences are processing chunks; oversized sentences are bisected near a
 * natural accent/breath boundary. No audio node or speaker identity is reset.
 */
export function speechSynthesisChunksFor(
  script: VoiceScript,
  timedUnits: readonly VoiceTimedUnit[],
): VoiceSynthesisChunk[] {
  if (script.units.length === 0 || timedUnits.length === 0) return [];

  const ranges: VoiceChunkUnitRange[] = [];
  let sentenceStart = 0;
  let sentenceIndex = 0;
  for (let index = 0; index < script.units.length; index += 1) {
    const isSentenceEnd = script.units[index]!.boundaryAfter === 'sentence'
      || index === script.units.length - 1;
    if (!isSentenceEnd) continue;
    const sentenceRanges: VoiceChunkUnitRange[] = [];
    splitLongVoiceRange(script, sentenceIndex, sentenceStart, index, sentenceRanges);
    ranges.push(...sentenceRanges);
    sentenceStart = index + 1;
    sentenceIndex += 1;
  }

  const chunks = ranges.map((range, index): VoiceSynthesisChunk => {
    const first = timedUnits[range.startUnit]!;
    const last = timedUnits[range.endUnit]!;
    const start = first.start;
    const end = last.start + last.duration;
    const previousUnit = script.units[range.startUnit - 1];
    return {
      index,
      sentenceIndex: range.sentenceIndex,
      startUnit: range.startUnit,
      endUnit: range.endUnit,
      start,
      end,
      duration: Math.max(0, end - start),
      gapAfter: 0,
      kind: range.splitSentence ? 'long-fragment' : 'sentence',
      continuationFromPrevious: range.startUnit > 0
        && previousUnit?.boundaryAfter !== 'sentence',
    };
  });

  for (let index = 0; index < chunks.length - 1; index += 1) {
    const current = chunks[index]!;
    const next = chunks[index + 1]!;
    current.gapAfter = Math.max(0, next.start - current.end);
  }
  return chunks;
}

export interface SpeechChunkContinuityProfile {
  variationScale: number;
  formantCarryScale: number;
  transitionScale: number;
  residualSmoothingScale: number;
  phonationVariationScale: number;
}

export function speechChunkContinuityProfileFor(
  chunk: VoiceSynthesisChunk | undefined,
  unitIndex: number,
  chunkCount: number,
): SpeechChunkContinuityProfile {
  if (!chunk || chunkCount <= 1) {
    return {
      variationScale: 1,
      formantCarryScale: 1,
      transitionScale: 1,
      residualSmoothingScale: 1,
      phonationVariationScale: 1,
    };
  }

  const chunkStart = unitIndex === chunk.startUnit;
  const internalStart = chunkStart && chunk.continuationFromPrevious;
  const sentenceStart = chunkStart && !chunk.continuationFromPrevious && chunk.index > 0;

  return {
    // Keep microvariation, but prevent each processing chunk from sounding like
    // a newly randomized speaker take.
    variationScale: internalStart ? 0.56 : sentenceStart ? 0.66 : 0.86,
    // Internal long-sentence splits retain tract motion; real sentence starts
    // reset articulation more strongly while leaving identity untouched.
    formantCarryScale: internalStart ? 1.055 : sentenceStart ? 0.91 : 1,
    transitionScale: internalStart ? 1.06 : sentenceStart ? 0.95 : 1,
    residualSmoothingScale: internalStart ? 1.1 : 1.045,
    phonationVariationScale: 0.92,
  };
}

export interface SpeechQualityProfile {
  sourceOversample: 1 | 2;
  residualAmount: number;
  residualBody: number;
  residualPresence: number;
  residualAir: number;
  residualSmoothingMs: number;
  closureSmoothingMs: number;
}

export function speechQualityProfileFor(
  quality: VoiceRenderQuality | undefined,
  frame: VoiceSpeechControlFrame,
  strategy?: SpeechUtteranceStrategy,
): SpeechQualityProfile {
  if (quality === 'fast') {
    return {
      sourceOversample: 1,
      residualAmount: 0,
      residualBody: 0,
      residualPresence: 0,
      residualAir: 0,
      residualSmoothingMs: 0,
      closureSmoothingMs: 0,
    };
  }

  const articulatory = frame.articulation;
  const harmonicNoise = frame.harmonicNoise;
  const openJaw = clamp(articulatory.jawOpen, 0, 1);
  const front = clamp(articulatory.tongueFront, 0, 1);
  const high = clamp(articulatory.tongueHeight, 0, 1);
  const round = clamp(articulatory.lipRound, 0, 1);
  const noisy = clamp(harmonicNoise.noiseGain - 0.9, 0, 0.3);
  const timbreBody = clamp(frame.timbre.bodyMix, 0.035, 0.19);
  const timbreBrightness = clamp(frame.timbre.upperFormantGain - 0.9, 0, 0.3);

  const resolvedStrategy = strategy ?? {
    kind: 'normal' as const,
    samplingGrid: 'linear' as const,
    refinementSteps: [0.25, 0.25, 0.25, 0.25] as const,
    residualScale: 1,
    residualSmoothingScale: 1,
    closureSmoothingScale: 1,
    coarticulationScale: 1,
    phonationVariationScale: 1,
    finalMicrostructureScale: 1,
  };
  return {
    sourceOversample: 2,
    residualAmount: 0.145 * resolvedStrategy.residualScale,
    residualBody: clamp(
      (0.038 + openJaw * 0.026 + round * 0.02 + timbreBody * 0.12 - noisy * 0.055)
        * resolvedStrategy.residualScale,
      0.022,
      0.095,
    ),
    residualPresence: clamp(
      (0.038 + front * 0.02 + high * 0.012 + noisy * 0.045 + timbreBrightness * 0.045)
        * resolvedStrategy.residualScale,
      0.035,
      0.095,
    ),
    residualAir: clamp(
      (-0.014 + noisy * 0.16 - round * 0.012 + timbreBrightness * 0.018)
        * resolvedStrategy.residualScale,
      -0.024,
      0.045,
    ),
    residualSmoothingMs: 14 * resolvedStrategy.residualSmoothingScale,
    closureSmoothingMs: 0.42 * resolvedStrategy.closureSmoothingScale,
  };
}

export interface SpeechHarmonicNoiseProfile {
  harmonicGain: number;
  noiseGain: number;
}

export function speechHarmonicNoiseProfileFor(unit: VoiceUnit): SpeechHarmonicNoiseProfile {
  const consonant = consonantForSyllable(unit.syllable);

  if (consonant === 'vowel' || unit.longVowel) {
    return { harmonicGain: 1.035, noiseGain: 0.92 };
  }
  if (
    consonant === 's'
    || consonant === 'sh'
    || consonant === 'ts'
    || consonant === 'ch'
    || consonant === 'h'
    || consonant === 'f'
  ) {
    return { harmonicGain: 0.965, noiseGain: 1.11 };
  }
  if (consonant === 'z' || consonant === 'j' || consonant === 'v') {
    return { harmonicGain: 0.985, noiseGain: 1.065 };
  }
  if (consonant === 'k' || consonant === 't' || consonant === 'p') {
    return { harmonicGain: 0.99, noiseGain: 1.045 };
  }
  if (consonant === 'n' || consonant === 'm' || consonant === 'N') {
    return { harmonicGain: 1.025, noiseGain: 0.9 };
  }
  return { harmonicGain: 1, noiseGain: 1 };
}

export interface SpeechAperiodicityProfile {
  amount: number;
  low: number;
  mid: number;
  presence: number;
  air: number;
  lfBlend: number;
  lfRd: number;
}

export function speechAperiodicityProfileFor(
  unit: VoiceUnit,
  quality: VoiceRenderQuality | undefined,
  expression: VoiceExpressionSettings,
): SpeechAperiodicityProfile {
  if (quality === 'fast') {
    return {
      amount: 0,
      low: 0,
      mid: 0,
      presence: 0,
      air: 0,
      lfBlend: 0,
      lfRd: 1.4,
    };
  }

  const consonant = consonantForSyllable(unit.syllable);
  const sibilant = consonant === 's' || consonant === 'sh' || consonant === 'z' || consonant === 'j';
  const affricate = consonant === 'ts' || consonant === 'ch';
  const breathyFricative = consonant === 'f' || consonant === 'h';
  const stop = consonant === 'k' || consonant === 't' || consonant === 'p'
    || consonant === 'g' || consonant === 'd' || consonant === 'b';

  let amount = 0.022;
  let low = 0.58;
  let mid = 0.46;
  let presence = 0.24;
  let air = 0.12;

  if (sibilant) {
    amount = 0.078;
    low = 0.08;
    mid = 0.28;
    presence = 0.94;
    air = 1;
  } else if (affricate) {
    amount = 0.064;
    low = 0.14;
    mid = 0.48;
    presence = 0.88;
    air = 0.78;
  } else if (breathyFricative) {
    amount = 0.057;
    low = 0.22;
    mid = 0.54;
    presence = 0.62;
    air = 0.84;
  } else if (stop) {
    amount = 0.032;
    low = 0.34;
    mid = 0.58;
    presence = 0.42;
    air = 0.2;
  } else if (consonant === 'n' || consonant === 'm' || consonant === 'N') {
    amount = 0.018;
    low = 0.82;
    mid = 0.38;
    presence = 0.12;
    air = 0.05;
  }

  if (unit.devoiced) {
    amount = Math.max(amount, 0.105);
    low = 0.12;
    mid = 0.42;
    presence = 0.9;
    air = 1;
  }

  const intensity = clamp(expression.intensity, 0, 1.35);
  const expressionScale = expression.preset === 'whisper'
    ? 1.9
    : expression.preset === 'calm'
      ? 0.84
      : expression.preset === 'excited'
        ? 1.08
        : 1;
  amount = clamp(amount * (1 + (expressionScale - 1) * intensity), 0.012, 0.16);

  const lfRd = expression.preset === 'whisper'
    ? 2.15
    : expression.preset === 'calm'
      ? 1.72
      : expression.preset === 'excited'
        ? 1.08
        : expression.preset === 'serious'
          ? 1.2
          : expression.preset === 'narration'
            ? 1.48
            : 1.4;
  const lfBlend = expression.preset === 'whisper'
    ? 0.62
    : expression.preset === 'calm'
      ? 0.88
      : expression.preset === 'excited'
        ? 0.74
        : expression.preset === 'serious'
          ? 0.82
          : 0.84;

  return {
    amount,
    low,
    mid,
    presence,
    air,
    lfBlend,
    lfRd,
  };
}

export interface SpeechTimbreProfile {
  closureAsymmetry: number;
  closureStrength: number;
  bodyMix: number;
  sourceDamping: number;
  formantMotion: number;
  lowerFormantGain: number;
  upperFormantGain: number;
}

export function speechTimbreProfileFor(
  character: VoiceCharacterPreset,
  tone: number,
  expression: VoiceExpressionSettings,
): SpeechTimbreProfile {
  const base: Record<VoiceCharacterPreset, SpeechTimbreProfile> = {
    natural: {
      closureAsymmetry: 0.58,
      closureStrength: 1.03,
      bodyMix: 0.1,
      sourceDamping: 0.14,
      formantMotion: 0.0024,
      lowerFormantGain: 1.06,
      upperFormantGain: 1,
    },
    soft: {
      closureAsymmetry: 0.48,
      closureStrength: 0.9,
      bodyMix: 0.13,
      sourceDamping: 0.22,
      formantMotion: 0.0028,
      lowerFormantGain: 1.1,
      upperFormantGain: 0.94,
    },
    clear: {
      closureAsymmetry: 0.64,
      closureStrength: 1.08,
      bodyMix: 0.07,
      sourceDamping: 0.08,
      formantMotion: 0.002,
      lowerFormantGain: 1,
      upperFormantGain: 1.08,
    },
    airy: {
      closureAsymmetry: 0.44,
      closureStrength: 0.84,
      bodyMix: 0.055,
      sourceDamping: 0.27,
      formantMotion: 0.003,
      lowerFormantGain: 0.97,
      upperFormantGain: 0.95,
    },
    power: {
      closureAsymmetry: 0.72,
      closureStrength: 1.18,
      bodyMix: 0.145,
      sourceDamping: 0.055,
      formantMotion: 0.0018,
      lowerFormantGain: 1.13,
      upperFormantGain: 1.04,
    },
  };
  const selected = base[character] ?? base.natural;
  const toneAmount = clamp(tone, -1, 1);
  const expressionAmount = clamp(expression.intensity, 0, 1.35);
  const airyExpression = expression.preset === 'whisper'
    ? 1
    : expression.preset === 'calm'
      ? 0.35
      : 0;
  const firmExpression = expression.preset === 'serious'
    ? 0.55
    : expression.preset === 'excited'
      ? 0.35
      : 0;

  return {
    closureAsymmetry: clamp(
      selected.closureAsymmetry
        + toneAmount * 0.035
        + firmExpression * expressionAmount * 0.025
        - airyExpression * expressionAmount * 0.045,
      0.34,
      0.8,
    ),
    closureStrength: clamp(
      selected.closureStrength
        * (1 + toneAmount * 0.05)
        * (1 + firmExpression * expressionAmount * 0.045)
        * (1 - airyExpression * expressionAmount * 0.08),
      0.72,
      1.28,
    ),
    bodyMix: clamp(
      selected.bodyMix
        * (1 - toneAmount * 0.13)
        * (1 - airyExpression * expressionAmount * 0.18)
        * (1 + firmExpression * expressionAmount * 0.08),
      0.035,
      0.19,
    ),
    sourceDamping: clamp(
      selected.sourceDamping
        * (1 - toneAmount * 0.18)
        * (1 + airyExpression * expressionAmount * 0.28)
        * (1 - firmExpression * expressionAmount * 0.12),
      0.035,
      0.34,
    ),
    formantMotion: clamp(
      selected.formantMotion
        * (expression.preset === 'calm' ? 1.08 : expression.preset === 'excited' ? 0.92 : 1),
      0.0012,
      0.0036,
    ),
    lowerFormantGain: clamp(
      selected.lowerFormantGain * (1 - toneAmount * 0.035),
      0.92,
      1.18,
    ),
    upperFormantGain: clamp(
      selected.upperFormantGain * (1 + toneAmount * 0.07),
      0.88,
      1.16,
    ),
  };
}

export interface SpeechPresenceProfile {
  upperFormantGain: readonly [number, number, number, number, number];
  presenceGainScale: number;
  presenceGainAdd: number;
  presenceFrequencyScale: number;
  radiationGainDbAdd: number;
  consonantNoiseScale: number;
  fricationScale: number;
  harmonicPresence: number;
  airPresence: number;
  fricativeGain: number;
}

export function speechPresenceProfileFor(
  unit: VoiceUnit,
  expression: VoiceExpressionSettings,
): SpeechPresenceProfile {
  const intensity = clamp(expression.intensity, 0, 1.35);
  const brightPreset = expression.preset === 'excited'
    ? 1 + 0.085 * intensity
    : expression.preset === 'serious'
      ? 1 + 0.045 * intensity
      : expression.preset === 'whisper'
        ? 0.92
        : expression.preset === 'calm'
          ? 0.96
          : 1;
  const consonant = unit.syllable.toLowerCase();
  const sibilant = /^(s|sh|z|j)/.test(consonant);
  const affricate = /^(ts|ch)/.test(consonant);
  const breathyFricative = /^(f|h)/.test(consonant);
  const fricative = sibilant || affricate || breathyFricative;

  const airy = expression.preset === 'whisper' ? 1.42 : expression.preset === 'calm' ? 0.82 : 1;
  const consonantNoiseBase = sibilant ? 1.3 : affricate ? 1.23 : breathyFricative ? 1.14 : 1.08;
  const fricationBase = sibilant ? 1.06 : affricate ? 0.96 : breathyFricative ? 1.08 : 1;
  const airBase = sibilant ? 0.078 : affricate ? 0.052 : breathyFricative ? 0.068 : 0.01;
  const fricativeGainBase = sibilant ? 1.4 : affricate ? 1.32 : breathyFricative ? 1.24 : 1.08;
  return {
    // The earlier profile boosted F3–F5 very aggressively. Keeping the vowel
    // body closer to unity sounds less "radio EQ" and closer to system TTS,
    // while consonant-specific envelopes retain intelligibility.
    upperFormantGain: [
      1.02,
      1.07,
      1.25 * brightPreset,
      1.36 * brightPreset,
      1.24 * brightPreset,
    ],
    presenceGainScale: 1.27 * brightPreset,
    presenceGainAdd: expression.preset === 'whisper'
      ? 0.038
      : expression.preset === 'calm'
        ? 0.041
        : 0.052 * brightPreset,
    presenceFrequencyScale: expression.preset === 'calm' ? 1.008 : 1.035,
    radiationGainDbAdd: expression.preset === 'whisper' ? 0.95 : 1.35 * brightPreset,
    consonantNoiseScale: consonantNoiseBase * brightPreset,
    fricationScale: fricationBase,
    harmonicPresence: clamp(0.112 * brightPreset, 0.075, 0.155),
    airPresence: clamp((fricative ? airBase : 0.01) * airy * brightPreset, 0.006, 0.105),
    fricativeGain: clamp(fricativeGainBase * brightPreset, 1, 1.62),
  };
}

export function geminatePreclosureSeconds(
  rate: number,
  precedingMoraDuration?: number,
): number {
  const normalizedRate = clamp(rate, 0.55, 1.8);
  const reference = precedingMoraDuration
    ?? 0.165 / normalizedRate;
  const targetTotalClosure = clamp(reference * 0.82, 0.095, 0.145);
  return clamp(targetTotalClosure - 0.052, 0.06, 0.098);
}

export function japaneseBoundaryPauseSeconds(unit: VoiceUnit, rate: number): number {
  if (unit.pauseAfter <= 0 && unit.expressivePauseAfter <= 0 && !unit.breathAfter) return 0;
  const normalizedRate = clamp(rate, 0.55, 1.8);
  const exponent = unit.boundaryAfter === 'sentence' ? 0.46 : 0.68;
  const rateScale = 1 / (normalizedRate ** exponent);
  const boundaryScale = unit.boundaryAfter === 'sentence' ? 1.04 : 0.94;
  const boundaryPause = unit.pauseAfter * rateScale * boundaryScale;
  const expressivePause = unit.expressivePauseAfter / (normalizedRate ** 0.42);
  const breathFloor = unit.breathAfter ? 0.115 / (normalizedRate ** 0.24) : 0;
  return clamp(Math.max(boundaryPause, expressivePause, breathFloor), 0.025, 0.52);
}

export function speechBoundaryPauseForStrategy(
  unit: VoiceUnit,
  rate: number,
  strategy: SpeechUtteranceStrategy,
  finalUnit: boolean,
): number {
  const base = japaneseBoundaryPauseSeconds(unit, rate);
  if (
    strategy.kind === 'short'
    && finalUnit
    && unit.boundaryAfter === 'sentence'
    && base > 0
  ) {
    return clamp(base * 0.68, 0.025, 0.28);
  }
  return base;
}

export function speechPitchTransitionScaleFor(
  unit: VoiceUnit,
  previousUnit: VoiceUnit | undefined,
): number {
  if (!previousUnit) return 0.82;
  const lexicalStep = previousUnit.pitchAccent !== 'auto'
    && unit.pitchAccent !== 'auto'
    && previousUnit.pitchAccent !== unit.pitchAccent;
  if (lexicalStep) return 0.72;
  if (unit.continuationBefore !== 'none') return 0.76;
  if (unit.discourseBefore === 'quote' || unit.parenthetical !== previousUnit.parenthetical) return 0.79;
  if (unit.accentStart || unit.phraseStart) return 0.84;
  return 1;
}

export interface SpeechPunctuationProsodyProfile {
  tailPitchSemitones: number;
  durationScale: number;
  energyScale: number;
  breathAdd: number;
  restartPitchSemitones: number;
  restartEnergyScale: number;
  restartRateScale: number;
}

export function speechPunctuationProsodyFor(
  kind: VoicePunctuationKind,
  count = 1,
): SpeechPunctuationProsodyProfile {
  const strength = 1 + Math.min(0.3, Math.max(0, count - 1) * 0.1);
  const neutral: SpeechPunctuationProsodyProfile = {
    tailPitchSemitones: 0,
    durationScale: 1,
    energyScale: 1,
    breathAdd: 0,
    restartPitchSemitones: 0,
    restartEnergyScale: 1,
    restartRateScale: 1,
  };
  if (kind === 'comma') return {
    tailPitchSemitones: 0.08 * strength,
    durationScale: 1.025,
    energyScale: 0.97,
    breathAdd: 0.008,
    restartPitchSemitones: 0.13,
    restartEnergyScale: 1.025,
    restartRateScale: 0.995,
  };
  if (kind === 'semicolon') return {
    tailPitchSemitones: -0.025,
    durationScale: 1.045,
    energyScale: 0.95,
    breathAdd: 0.015,
    restartPitchSemitones: 0.16,
    restartEnergyScale: 1.035,
    restartRateScale: 0.99,
  };
  if (kind === 'period' || kind === 'linebreak') return {
    tailPitchSemitones: -0.12 * strength,
    durationScale: 1.055,
    energyScale: 0.94,
    breathAdd: 0.018,
    restartPitchSemitones: kind === 'linebreak' ? 0.19 : 0.12,
    restartEnergyScale: 1.025,
    restartRateScale: 0.995,
  };
  if (kind === 'question') return {
    tailPitchSemitones: 0.18 * strength,
    durationScale: 1.045,
    energyScale: 0.985,
    breathAdd: 0.006,
    restartPitchSemitones: 0.16,
    restartEnergyScale: 1.035,
    restartRateScale: 0.99,
  };
  if (kind === 'exclamation') return {
    tailPitchSemitones: 0.08 * strength,
    durationScale: 0.965,
    energyScale: 1.07 * Math.min(1.08, strength),
    breathAdd: 0.004,
    restartPitchSemitones: 0.18,
    restartEnergyScale: 1.055,
    restartRateScale: 1.015,
  };
  if (kind === 'ellipsis') return {
    tailPitchSemitones: -0.12 * strength,
    durationScale: 1.1 * Math.min(1.06, strength),
    energyScale: 0.9,
    breathAdd: 0.052 * strength,
    restartPitchSemitones: -0.04,
    restartEnergyScale: 0.93,
    restartRateScale: 0.955,
  };
  if (kind === 'dash') return {
    tailPitchSemitones: 0.02,
    durationScale: 1.025,
    energyScale: 0.955,
    breathAdd: 0.018,
    restartPitchSemitones: 0.2 * strength,
    restartEnergyScale: 1.06,
    restartRateScale: 1.02,
  };
  if (kind === 'middle') return {
    ...neutral,
    durationScale: 1.012,
    energyScale: 0.985,
    restartPitchSemitones: 0.035,
  };
  return neutral;
}

export interface SpeechEmphasisProfile {
  pitchSemitones: number;
  durationScale: number;
  energyScale: number;
  attackScale: number;
  articulationScale: number;
  sourceTiltScale: number;
}

export function speechEmphasisProfileFor(
  unit: VoiceUnit,
  nextUnit: VoiceUnit | undefined,
  emphasis: number,
): SpeechEmphasisProfile {
  const amount = clamp(emphasis, 0, 1.5);
  if (amount <= 0) {
    return {
      pitchSemitones: 0,
      durationScale: 1,
      energyScale: 1,
      attackScale: 1,
      articulationScale: 1,
      sourceTiltScale: 1,
    };
  }

  const accentNucleus = unit.pitchAccent === 'high'
    && (unit.accentEnd || nextUnit?.pitchAccent === 'low');
  const lexicalHigh = unit.pitchAccent === 'high';

  const pitchWeight = accentNucleus
    ? 0.34
    : unit.accentStart
      ? 0.24
      : lexicalHigh
        ? 0.14
        : 0.05;
  const durationWeight = accentNucleus
    ? 0.055
    : unit.accentStart
      ? 0.035
      : unit.accentEnd
        ? 0.026
        : 0.012;
  const energyWeight = accentNucleus
    ? 0.18
    : unit.accentStart
      ? 0.14
      : lexicalHigh
        ? 0.09
        : 0.045;
  const articulationWeight = accentNucleus
    ? 0.12
    : unit.accentStart
      ? 0.09
      : lexicalHigh
        ? 0.07
        : 0.045;
  const attackWeight = accentNucleus
    ? 0.13
    : unit.accentStart
      ? 0.1
      : 0.05;
  const tiltWeight = accentNucleus
    ? 0.075
    : unit.accentStart
      ? 0.055
      : 0.03;

  return {
    pitchSemitones: amount * pitchWeight,
    durationScale: 1 + amount * durationWeight,
    energyScale: 1 + amount * energyWeight,
    attackScale: 1 - Math.min(0.2, amount * attackWeight),
    articulationScale: 1 + amount * articulationWeight,
    sourceTiltScale: 1 - Math.min(0.12, amount * tiltWeight),
  };
}

export interface SpeechFinalityProfile {
  creak: number;
  breath: number;
  pitchSemitones: number;
  durationScale: number;
  energyScale: number;
  releaseScale: number;
  fallCents: number;
}

export interface SpeechAttitudeProfile {
  pitchSemitones: number;
  durationScale: number;
  energyScale: number;
  breathAdd: number;
  releaseScale: number;
  fallCentsOffset: number;
}

export function speechAttitudeProfileFor(unit: VoiceUnit): SpeechAttitudeProfile {
  if (!unit.phraseEnd) {
    return {
      pitchSemitones: 0,
      durationScale: 1,
      energyScale: 1,
      breathAdd: 0,
      releaseScale: 1,
      fallCentsOffset: 0,
    };
  }

  if (unit.sentenceAttitude === 'shared') {
    const asking = unit.sentenceTerminal === 'question';
    return {
      pitchSemitones: asking ? 0.15 : 0.08,
      durationScale: asking ? 1.075 : 1.055,
      energyScale: asking ? 0.97 : 0.98,
      breathAdd: asking ? 0.03 : 0.02,
      releaseScale: asking ? 1.085 : 1.05,
      fallCentsOffset: asking ? 0 : -3,
    };
  }
  if (unit.sentenceAttitude === 'assertive') {
    const emphatic = unit.sentenceTerminal === 'exclamation';
    return {
      pitchSemitones: emphatic ? 0.045 : -0.015,
      durationScale: emphatic ? 1.01 : 1.02,
      energyScale: emphatic ? 1.085 : 1.035,
      breathAdd: 0,
      releaseScale: emphatic ? 0.955 : 0.985,
      fallCentsOffset: emphatic ? 2.5 : 1.5,
    };
  }
  if (unit.sentenceAttitude === 'wonder') {
    const trailingHesitation = unit.sentenceHesitation;
    return {
      pitchSemitones: trailingHesitation ? 0.055 : 0.14,
      durationScale: trailingHesitation ? 1.16 : 1.08,
      energyScale: trailingHesitation ? 0.86 : 0.95,
      breathAdd: trailingHesitation ? 0.085 : 0.04,
      releaseScale: trailingHesitation ? 1.18 : 1.09,
      fallCentsOffset: trailingHesitation ? -6 : -5,
    };
  }
  if (unit.sentenceAttitude === 'uncertain') {
    const asking = unit.sentenceTerminal === 'question';
    return {
      pitchSemitones: asking ? 0.085 : 0.045,
      durationScale: asking ? 1.085 : 1.07,
      energyScale: asking ? 0.9 : 0.92,
      breathAdd: asking ? 0.055 : 0.05,
      releaseScale: asking ? 1.12 : 1.1,
      fallCentsOffset: asking ? 0 : -3,
    };
  }
  return {
    pitchSemitones: 0,
    durationScale: 1,
    energyScale: 1,
    breathAdd: 0,
    releaseScale: 1,
    fallCentsOffset: 0,
  };
}

export interface SpeechContextDelivery {
  rateScale: number;
  energyScale: number;
}

export function speechContextDeliveryFor(
  unit: VoiceUnit,
  expression: VoiceExpressionSettings,
): SpeechContextDelivery {
  const progress = unit.phraseCount <= 1
    ? 1
    : unit.phraseIndex / Math.max(1, unit.phraseCount - 1);
  const tail = clamp((progress - 0.55) / 0.45, 0, 1);
  const intensity = clamp(expression.intensity, 0, 1.35);

  let rateScale = 1;
  let energyScale = 1;

  if (unit.sentenceAttitude === 'shared' && unit.sentenceTerminal === 'question') {
    rateScale *= 1 - 0.025 * tail;
    energyScale *= 1 - 0.025 * tail;
  } else if (unit.sentenceAttitude === 'assertive' && unit.sentenceTerminal === 'exclamation') {
    rateScale *= 1 + 0.018 * tail;
    energyScale *= 1 + 0.065 * tail;
  } else if (unit.sentenceAttitude === 'wonder') {
    rateScale *= 1 - (unit.sentenceHesitation ? 0.09 : 0.035) * tail;
    energyScale *= 1 - (unit.sentenceHesitation ? 0.12 : 0.045) * tail;
  } else if (unit.sentenceAttitude === 'uncertain') {
    rateScale *= 1 - 0.035 * tail;
    energyScale *= 1 - 0.065 * tail;
  }

  if (unit.sentenceHesitation) {
    rateScale *= 1 - 0.015 * tail;
    energyScale *= 1 - 0.02 * tail;
  }

  if (expression.preset === 'excited') {
    energyScale *= 1 + 0.025 * tail * intensity;
    if (unit.sentenceTerminal === 'exclamation') rateScale *= 1 + 0.012 * tail * intensity;
  } else if (expression.preset === 'calm' || expression.preset === 'whisper') {
    rateScale *= 1 - 0.012 * tail * intensity;
    energyScale *= 1 - 0.015 * tail * intensity;
  } else if (expression.preset === 'serious' && unit.sentenceAttitude === 'assertive') {
    energyScale *= 1 + 0.02 * tail * intensity;
  }

  return {
    rateScale: clamp(rateScale, 0.9, 1.08),
    energyScale: clamp(energyScale, 0.86, 1.12),
  };
}

export interface SpeechTakeVariation {
  pitchCents: number;
  velocityScale: number;
  attackScale: number;
  timingOffsetSeconds: number;
}

function signedHash(seed: number): number {
  let value = seed | 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  return ((value >>> 0) / 0xffffffff) * 2 - 1;
}

export function speechTakeVariationFor(
  unitIndex: number,
  takeIndex: number,
): SpeechTakeVariation {
  const base = (unitIndex + 1) * 73856093 ^ (takeIndex + 1) * 19349663;
  return {
    pitchCents: signedHash(base ^ 0x51f15e) * 1.6,
    velocityScale: 1 + signedHash(base ^ 0x7f4a7c15) * 0.012,
    attackScale: 1 + signedHash(base ^ 0x2c1b3c6d) * 0.025,
    timingOffsetSeconds: signedHash(base ^ 0x165667b1) * 0.0015,
  };
}

export function speechFinalityProfileFor(
  expression: VoiceExpressionSettings,
  intonation: VoiceResolvedIntonation,
): SpeechFinalityProfile {
  const base: SpeechFinalityProfile = intonation === 'question'
    ? {
        creak: 0.035,
        breath: 0.06,
        pitchSemitones: 0.08,
        durationScale: 1.065,
        energyScale: 1,
        releaseScale: 1.06,
        fallCents: 0,
      }
    : intonation === 'content-question'
      ? {
          creak: 0.05,
          breath: 0.065,
          pitchSemitones: 0.02,
          durationScale: 1.055,
          energyScale: 0.98,
          releaseScale: 1.08,
          fallCents: 0,
        }
      : intonation === 'rise'
      ? {
          creak: 0.06,
          breath: 0.055,
          pitchSemitones: 0.04,
          durationScale: 1.04,
          energyScale: 0.99,
          releaseScale: 1.06,
          fallCents: 0,
        }
      : intonation === 'exclaim'
        ? {
            creak: 0.07,
            breath: 0.055,
            pitchSemitones: 0.08,
            durationScale: 1.01,
            energyScale: 1.06,
            releaseScale: 1,
            fallCents: 1,
          }
        : intonation === 'fall'
        ? {
            creak: 0.2,
            breath: 0.055,
            pitchSemitones: -0.085,
            durationScale: 1.065,
            energyScale: 0.94,
            releaseScale: 1.09,
            fallCents: 5.5,
          }
        : intonation === 'flat'
          ? {
              creak: 0.085,
              breath: 0.05,
              pitchSemitones: -0.015,
              durationScale: 1.025,
              energyScale: 0.975,
              releaseScale: 1.045,
              fallCents: 1.5,
            }
          : {
              creak: 0.145,
              breath: 0.058,
              pitchSemitones: -0.035,
              durationScale: 1.045,
              energyScale: 0.965,
              releaseScale: 1.075,
              fallCents: 3.8,
            };

  const delta = expression.preset === 'serious'
    ? {
        creak: 0.07,
        breath: -0.028,
        pitchSemitones: -0.08,
        durationScale: 0.02,
        energyScale: 0.01,
        releaseScale: -0.02,
        fallCents: 2,
      }
    : expression.preset === 'narration'
      ? {
          creak: 0.07,
          breath: -0.01,
          pitchSemitones: -0.03,
          durationScale: 0.02,
          energyScale: -0.01,
          releaseScale: 0.03,
          fallCents: 1,
        }
      : expression.preset === 'calm'
        ? {
            creak: -0.06,
            breath: 0.02,
            pitchSemitones: -0.04,
            durationScale: 0.04,
            energyScale: -0.04,
            releaseScale: 0.06,
            fallCents: -1,
          }
        : expression.preset === 'excited'
          ? {
              creak: -0.16,
              breath: -0.005,
              pitchSemitones: 0.08,
              durationScale: -0.02,
              energyScale: 0.05,
              releaseScale: -0.03,
              fallCents: -2,
            }
          : expression.preset === 'whisper'
            ? {
                creak: -0.22,
                breath: 0.2,
                pitchSemitones: 0,
                durationScale: 0.03,
                energyScale: -0.07,
                releaseScale: 0.08,
                fallCents: -5,
              }
            : {
                creak: 0,
                breath: 0,
                pitchSemitones: 0,
                durationScale: 0,
                energyScale: 0,
                releaseScale: 0,
                fallCents: 0,
              };

  const amount = expression.preset === 'neutral'
    ? 0
    : clamp(expression.intensity, 0, 1.35);
  const risingEnding = intonation === 'question'
    || intonation === 'content-question'
    || intonation === 'rise';
  const pitchAmount = risingEnding ? amount * 0.5 : amount;

  return {
    creak: risingEnding
      ? clamp(base.creak + delta.creak * amount, 0, 0.07)
      : clamp(base.creak + delta.creak * amount, 0, 0.5),
    breath: clamp(base.breath + delta.breath * amount, 0.02, 0.35),
    pitchSemitones: clamp(
      base.pitchSemitones + delta.pitchSemitones * pitchAmount,
      -0.24,
      0.22,
    ),
    durationScale: clamp(base.durationScale + delta.durationScale * amount, 0.98, 1.16),
    energyScale: clamp(base.energyScale + delta.energyScale * amount, 0.82, 1.08),
    releaseScale: clamp(base.releaseScale + delta.releaseScale * amount, 0.96, 1.22),
    fallCents: risingEnding
      ? 0
      : clamp(base.fallCents + delta.fallCents * amount, 0, 10),
  };
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

function normalizeProsodyEdits(input: VoiceProsodyInput): VoiceProsodyEdits {
  if (Array.isArray(input)) return { pitchOffsets: input as readonly number[] };
  return input as VoiceProsodyEdits;
}

function pitchClassForMidi(midi: number): PitchClass {
  return (((Math.round(midi) % 12) + 12) % 12) as PitchClass;
}

function octaveForMidi(midi: number): number {
  return Math.floor(Math.round(midi) / 12) - 1;
}

function midiToHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

export function japaneseUnitDurationSeconds(unit: VoiceUnit, rate: number): number {
  const consonantHeavy = /^(k|ky|s|sh|t|ch|ts|h|f|p|g|gy|z|j|d|b)/i.test(unit.syllable);
  const nasal = unit.moraicN;
  let base = nasal ? 0.155 : consonantHeavy ? 0.174 : 0.165;

  // A long-vowel continuation is its own mora. Making the continuation about
  // 1.45× a short mora keeps the full V+V: contrast near the robust Japanese
  // perceptual duration ratio while still allowing speech-rate compression.
  if (unit.longVowel) base *= 1.45;
  if (unit.filledPause) base *= 1.12;
  if (unit.hesitationAfter) base *= 1.035;
  if (unit.focusStrength > 0) base *= 1 + unit.focusStrength * 0.012;

  // Tokyo-style high-vowel devoicing is realized with temporal compression,
  // not just a quieter periodic source.
  if (unit.devoiced) base *= unit.pitchAccent === 'high' ? 0.78 : 0.68;

  // Phrase-final lengthening is stronger at a sentence edge than at an
  // internal accent-phrase boundary.
  if (unit.accentEnd && !unit.phraseEnd) base *= 1.045;
  if (unit.continuationAfter !== 'none' && !unit.phraseEnd) base *= 1.035;
  if (unit.phraseEnd) base *= 1.13;

  return clamp(base / clamp(rate, 0.55, 1.8), 0.055, 0.44);
}

function unitEnergyScale(unit: VoiceUnit): number {
  let scale = 1;
  if (unit.accentStart) scale *= 1.02;
  if (unit.accentEnd) scale *= 0.98;
  if (unit.continuationAfter !== 'none') scale *= 0.97;
  if (unit.continuationBefore !== 'none') scale *= 1.025;
  if (unit.quoted) scale *= 1.015;
  if (unit.parenthetical) scale *= 0.92;
  if (unit.filledPause) scale *= 0.86;
  if (unit.hesitationAfter) scale *= 0.96;
  if (unit.focusStrength > 0) scale *= 1 + unit.focusStrength * 0.055;
  if (unit.phraseEnd) scale *= 0.94;
  if (unit.longVowel) scale *= 0.97;
  if (unit.devoiced) scale *= 0.56;
  return scale;
}

function phraseControlFor(unit: VoiceUnit, energy: number): VocalPhraseControl {
  const progressStart = unit.phraseCount <= 1
    ? 0
    : unit.phraseIndex / Math.max(1, unit.phraseCount);
  const progressEnd = unit.phraseCount <= 1
    ? 1
    : (unit.phraseIndex + 1) / Math.max(1, unit.phraseCount);
  const crestStart = 0.9 + Math.sin(progressStart * Math.PI) * 0.075;
  const crestEnd = 0.9 + Math.sin(progressEnd * Math.PI) * 0.075;
  const boundaryRelease = unit.phraseEnd
    ? 0.91
    : unit.continuationAfter !== 'none'
      ? 0.995
      : unit.accentEnd
        ? 0.97
        : 1;

  return {
    phraseIndex: 0,
    phraseStartStep: 0,
    phraseEndStep: unit.phraseCount,
    progressStart,
    progressEnd,
    energyStart: clamp(crestStart * energy, 0.58, 1.32),
    energyEnd: clamp(crestEnd * energy * boundaryRelease, 0.55, 1.32),
    centeringStart: unit.phraseEnd ? 0.025 : 0,
    centeringEnd: unit.phraseEnd
      ? 0.11
      : unit.continuationAfter !== 'none'
        ? 0.025
        : unit.accentEnd
          ? 0.045
          : 0.015,
    aspirationDepth: clamp(0.068 + (1 - energy) * 0.05 + (unit.devoiced ? 0.035 : 0), 0.05, 0.145),
    sourceTractCoupling: unit.devoiced ? 0.0065 : 0.0085,
  };
}

export class VoiceSynth {
  private context: AudioContext | null = null;
  private takeIndex = 0;
  private master: GainNode | null = null;
  private limiter: DynamicsCompressorNode | null = null;
  private identityConditioningKey = '';
  private identityConditioning: VoiceIdentityConditioning | null = null;
  private readonly worklet = new VocalWorkletBridge();
  private readonly wavCapture = new WavCapture();

  get status(): VocalWorkletStatus {
    return this.worklet.status;
  }

  get currentTime(): number {
    return this.context?.currentTime ?? 0;
  }

  private conditioningFor(settings: VoiceSynthSettings): VoiceIdentityConditioning {
    const tone = clamp(settings.tone, -1, 1);
    const tractLength = clamp(settings.tractLength ?? 0, -1, 1);
    const imprint = settings.identityImprint ?? null;
    const imprintKey = imprint
      ? [
          imprint.confidence.toFixed(3),
          ...imprint.formantGain.map((value) => value.toFixed(3)),
          imprint.sourceTiltScale.toFixed(3),
          imprint.presenceFrequencyScale.toFixed(3),
          imprint.presenceGainScale.toFixed(3),
          imprint.breathScale.toFixed(3),
          imprint.radiationGainDb.toFixed(3),
        ].join(':')
      : 'none';
    const key = `${settings.character}:${tone.toFixed(4)}:${tractLength.toFixed(4)}:${imprintKey}`;
    if (this.identityConditioning && key === this.identityConditioningKey) {
      return this.identityConditioning;
    }
    this.identityConditioningKey = key;
    this.identityConditioning = voiceIdentityConditioningFor(
      settings.character,
      tone,
      tractLength,
      imprint,
    );
    return this.identityConditioning;
  }

  async unlock(): Promise<void> {
    if (!this.context) {
      const context = new AudioContext({ latencyHint: 'interactive' });
      const voiceBus = context.createGain();
      const highpass = context.createBiquadFilter();
      const compressor = context.createDynamicsCompressor();
      const master = context.createGain();
      const limiter = context.createDynamicsCompressor();

      voiceBus.gain.value = 0.92;
      highpass.type = 'highpass';
      highpass.frequency.value = 62;
      highpass.Q.value = 0.45;
      compressor.threshold.value = -18;
      compressor.knee.value = 10;
      compressor.ratio.value = 2.1;
      compressor.attack.value = 0.006;
      compressor.release.value = 0.16;
      master.gain.value = 0.84;
      limiter.threshold.value = -2.2;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.002;
      limiter.release.value = 0.075;

      voiceBus.connect(highpass);
      highpass.connect(compressor);
      compressor.connect(master);
      master.connect(limiter);
      limiter.connect(context.destination);

      this.context = context;
      this.master = master;
      this.limiter = limiter;
      const moduleUrl = new URL('vocal-worklet.js', document.baseURI).toString();
      await this.worklet.initialize(context, voiceBus, moduleUrl);
    }
    if (this.context.state !== 'running') await this.context.resume();
  }

  stop(): void {
    this.worklet.clear();
    this.wavCapture.cancel();
  }

  suspend(): void {
    void this.context?.suspend();
  }

  resume(): void {
    void this.context?.resume();
  }

  plan(
    script: VoiceScript,
    settings: VoiceSynthSettings,
    prosodyInput: VoiceProsodyInput = {},
  ): VoicePlaybackPlan {
    const edits = normalizeProsodyEdits(prosodyInput);
    const globalExpression = settings.expression ?? { preset: 'neutral', intensity: 1 };
    const initialUtteranceStrategy = speechUtteranceStrategyFor(script);
    const units: VoiceTimedUnit[] = [];
    const events: VoiceTimedSpeechEvent[] = [];
    const eventsByAfter = new Map<number, VoiceSpeechEvent[]>();
    for (const event of script.events) {
      const bucket = eventsByAfter.get(event.afterUnit) ?? [];
      bucket.push(event);
      eventsByAfter.set(event.afterUnit, bucket);
    }
    let cursor = 0;

    const appendEvents = (afterUnit: number): void => {
      for (const event of eventsByAfter.get(afterUnit) ?? []) {
        const profile = speechEventProfileFor(event.kind, event.strength);
        events.push({
          event,
          start: cursor,
          duration: profile.duration,
          gapAfter: profile.gapAfter,
        });
        cursor += profile.duration + profile.gapAfter;
      }
    };

    appendEvents(-1);

    script.units.forEach((unit, index) => {
      const precedingEvents = eventsByAfter.get(index - 1) ?? [];
      const eventTransition = speechEventTransitionFor(precedingEvents);
      if (unit.breathBefore > 0 && !precedingEvents.some((event) => event.kind === 'inhale')) {
        cursor += unit.breathBefore / (clamp(settings.rate, 0.55, 1.8) ** 0.24);
      }
      if (unit.geminateBefore) {
        const precedingMoraDuration = units[units.length - 1]?.duration;
        cursor += geminatePreclosureSeconds(settings.rate, precedingMoraDuration);
      }

      const expression = edits.localExpressions?.[index] ?? globalExpression;
      const expressionControl = voiceExpressionControl(expression);
      const expressionUnit = voiceExpressionForUnit(unit, index, script.units.length, expression);
      const resolvedIntonation = resolveVoiceIntonation(unit, settings.intonation);
      const f0Layers = japaneseF0LayersForUnit(unit, resolvedIntonation);
      const offset = f0Layers.total * expressionControl.pitchRangeScale;
      const manualPitchOffset = clamp(edits.pitchOffsets?.[index] ?? 0, -3.5, 3.5);
      const manualEnergyScale = clamp(edits.energyScales?.[index] ?? 1, 0.45, 1.55);
      const manualDurationScale = clamp(edits.durationScales?.[index] ?? 1, 0.6, 1.65);
      const phrasePitchOffset = clamp(edits.phrasePitchOffsets?.[index] ?? 0, -3, 3);
      const phraseRateScale = clamp(edits.phraseRateScales?.[index] ?? 1, 0.72, 1.35);
      const phraseEnergyScale = clamp(edits.phraseEnergyScales?.[index] ?? 1, 0.65, 1.45);
      const phraseEmphasis = clamp(edits.phraseEmphasisScales?.[index] ?? 0, 0, 1.5);
      const contextDelivery = speechContextDeliveryFor(unit, expression);
      const previousUnitForPunctuation = script.units[index - 1];
      const previousPunctuation = previousUnitForPunctuation?.boundaryAfter === 'sentence'
        ? speechPunctuationProsodyFor('none', 0)
        : speechPunctuationProsodyFor(
            previousUnitForPunctuation?.punctuationAfter ?? 'none',
            previousUnitForPunctuation?.punctuationCount ?? 0,
          );
      const effectiveRate = settings.rate
        * phraseRateScale
        * unit.autoRateScale
        * contextDelivery.rateScale
        * eventTransition.rateScale
        * (index > 0 ? previousPunctuation.restartRateScale : 1);
      const emphasisProfile = speechEmphasisProfileFor(
        unit,
        script.units[index + 1],
        phraseEmphasis,
      );
      const finality = speechFinalityProfileFor(expression, resolvedIntonation);
      const attitude = speechAttitudeProfileFor(unit);
      const punctuationProsody = speechPunctuationProsodyFor(
        unit.punctuationAfter,
        unit.punctuationCount,
      );
      const finalPitchOffset = unit.phraseEnd
        ? finality.pitchSemitones + attitude.pitchSemitones
        : 0;
      const finalDurationScale = unit.phraseEnd
        ? finality.durationScale * attitude.durationScale
        : 1;
      const finalEnergyScale = unit.phraseEnd
        ? finality.energyScale * attitude.energyScale
        : 1;

      const pitchMidi = clamp(
        settings.pitch
          + offset
          + expressionUnit.pitchOffset
          + phrasePitchOffset
          + emphasisProfile.pitchSemitones
          + eventTransition.pitchSemitones
          + finalPitchOffset
          + punctuationProsody.tailPitchSemitones
          + (index > 0 ? previousPunctuation.restartPitchSemitones : 0)
          + manualPitchOffset,
        40,
        82,
      );
      const duration = clamp(
        japaneseUnitDurationSeconds(unit, effectiveRate)
          * expressionUnit.durationScale
          * emphasisProfile.durationScale
          * finalDurationScale
          * punctuationProsody.durationScale
          * manualDurationScale,
        0.05,
        0.58,
      );
      const energyScale = clamp(
        unitEnergyScale(unit)
          * expressionUnit.energyScale
          * contextDelivery.energyScale
          * eventTransition.energyScale
          * phraseEnergyScale
          * emphasisProfile.energyScale
          * finalEnergyScale
          * punctuationProsody.energyScale
          * (index > 0 ? previousPunctuation.restartEnergyScale : 1)
          * manualEnergyScale,
        0.22,
        1.8,
      );

      units.push({
        unit,
        start: cursor,
        duration,
        pitchMidi,
        energyScale,
        manualPitchOffset,
        manualEnergyScale,
        manualDurationScale,
        phrasePitchOffset,
        phraseRateScale,
        phraseEnergyScale,
        phraseEmphasis,
        phraseF0Offset: f0Layers.phrase * expressionControl.pitchRangeScale,
        accentF0Offset: f0Layers.accent * expressionControl.pitchRangeScale,
        expression,
      });

      const pauseOverride = edits.pauseOverrides?.[index];
      const pause = pauseOverride === null || pauseOverride === undefined
        ? speechBoundaryPauseForStrategy(
            unit,
            effectiveRate,
            initialUtteranceStrategy,
            index === script.units.length - 1,
          )
        : clamp(pauseOverride, 0, 0.36);
      const followingEvents = eventsByAfter.get(index) ?? [];
      const hasRepair = followingEvents.some((event) => (
        event.kind === 'restart' || event.kind === 'rethink'
      ));
      const hasNonverbal = followingEvents.length > 0;
      const mergedPause = hasRepair
        ? Math.min(pause, 0.025)
        : hasNonverbal
          ? Math.min(pause, 0.055)
          : pause;
      cursor += duration + mergedPause;
      appendEvents(index);
    });

    const duration = cursor + 0.08;
    return {
      duration,
      units,
      events,
      strategy: speechUtteranceStrategyFor(script, duration),
      chunks: speechSynthesisChunksFor(script, units),
    };
  }

  async play(
    script: VoiceScript,
    settings: VoiceSynthSettings,
    prosodyInput: VoiceProsodyInput = {},
  ): Promise<VoicePlaybackPlan> {
    await this.unlock();
    if (!this.context) throw new Error('Voice AudioContext unavailable');
    if (this.worklet.status !== 'ready') throw new Error('Voice AudioWorklet unavailable');

    this.worklet.clear();
    const plan = this.plan(script, settings, prosodyInput);
    const identityConditioning = this.conditioningFor(settings);
    const utteranceStrategy = plan.strategy;
    const startAt = this.context.currentTime + 0.055;
    const takeIndex = this.takeIndex++;
    let previousPitchMidi: number | null = null;
    const chunkForUnit: (VoiceSynthesisChunk | undefined)[] = new Array(plan.units.length);
    for (const chunk of plan.chunks) {
      for (let unitIndex = chunk.startUnit; unitIndex <= chunk.endUnit; unitIndex += 1) {
        chunkForUnit[unitIndex] = chunk;
      }
    }

    plan.units.forEach((timed, index) => {
      const unit = timed.unit;
      const chunk = chunkForUnit[index];
      const chunkContinuity = speechChunkContinuityProfileFor(chunk, index, plan.chunks.length);
      const startsNewSentenceChunk = chunk
        && index === chunk.startUnit
        && chunk.index > 0
        && !chunk.continuationFromPrevious;
      if (startsNewSentenceChunk) previousPitchMidi = null;
      const interruptionBefore = script.events.some((event) => (
        event.afterUnit === index - 1
        && (
          event.kind === 'restart'
          || event.kind === 'rethink'
          || event.kind === 'sigh'
          || event.kind === 'inhale'
        )
      ));
      if (interruptionBefore) previousPitchMidi = null;
      const expressionControl = voiceExpressionControl(timed.expression);
      const speechSource = speechSourceProfileFor(timed.expression);
      const speechPresence = speechPresenceProfileFor(unit, timed.expression);
      const consonantTransient = speechConsonantTransientProfileFor(unit);
      const consonantLocus = speechConsonantLocusProfileFor(unit);
      const rawPhonationMicrostructure = speechPhonationMicrostructureFor(
        unit,
        settings.quality,
        timed.expression,
      );
      const phonationMicrostructure = {
        cycleVariation: rawPhonationMicrostructure.cycleVariation
          * utteranceStrategy.phonationVariationScale
          * chunkContinuity.phonationVariationScale,
        subharmonicMix: rawPhonationMicrostructure.subharmonicMix
          * utteranceStrategy.finalMicrostructureScale,
        sourceTractCoupling: rawPhonationMicrostructure.sourceTractCoupling,
      };
      const controlFrame = voiceSpeechControlFrameFor(
        unit,
        index,
        timed.pitchMidi,
        timed.energyScale,
        timed.duration,
        settings,
        timed.expression,
      );
      const speechQuality = speechQualityProfileFor(
        settings.quality,
        controlFrame,
        {
          ...utteranceStrategy,
          residualSmoothingScale: utteranceStrategy.residualSmoothingScale
            * chunkContinuity.residualSmoothingScale,
        },
      );
      const speechTimbre = controlFrame.timbre;
      const articulatoryState = controlFrame.articulation;
      const articulatoryFilter = speechArticulatoryFilterFor(articulatoryState);
      const tract = speechVocalTractProfileFor(
        settings.character,
        settings.tone,
        settings.tractLength,
        articulatoryState,
      );
      const nextUnit = plan.units[index + 1]?.unit ?? null;
      const nextTract = nextUnit
        ? speechVocalTractProfileFor(
            settings.character,
            settings.tone,
            settings.tractLength,
            speechArticulatoryStateFor(nextUnit),
          )
        : tract;
      const harmonicNoise = controlFrame.harmonicNoise;
      const aperiodicity = speechAperiodicityProfileFor(
        unit,
        settings.quality,
        timed.expression,
      );
      const precedingSpeechEvents = script.events.filter((event) => event.afterUnit === index - 1);
      const followsSigh = precedingSpeechEvents.some((event) => event.kind === 'sigh');
      const followsLaugh = precedingSpeechEvents.some((event) => event.kind === 'laugh');
      const emphasis = timed.phraseEmphasis;
      const emphasisProfile = speechEmphasisProfileFor(
        unit,
        plan.units[index + 1]?.unit,
        emphasis,
      );
      const resolvedIntonation = resolveVoiceIntonation(unit, settings.intonation);
      const finality = speechFinalityProfileFor(timed.expression, resolvedIntonation);
      const attitude = speechAttitudeProfileFor(unit);
      const punctuationProsody = speechPunctuationProsodyFor(
        unit.punctuationAfter,
        unit.punctuationCount,
      );
      const rawVariation = speechTakeVariationFor(index, takeIndex);
      const variation = {
        pitchCents: rawVariation.pitchCents * chunkContinuity.variationScale,
        velocityScale: 1 + (rawVariation.velocityScale - 1) * chunkContinuity.variationScale,
        attackScale: 1 + (rawVariation.attackScale - 1) * chunkContinuity.variationScale,
        timingOffsetSeconds: rawVariation.timingOffsetSeconds * chunkContinuity.variationScale,
      };
      const performancePitchMidi = timed.pitchMidi + variation.pitchCents / 100;
      const previousUnit = plan.units[index - 1]?.unit;
      const pitchTransitionScale = speechPitchTransitionScaleFor(unit, previousUnit);
      const continuesDocument = unit.boundaryAfter === 'sentence'
        && chunk !== undefined
        && chunk.index < plan.chunks.length - 1;
      const documentFinalityScale = continuesDocument ? 0.78 : 1;
      const roundedMidi = Math.round(timed.pitchMidi);
      const event: VocalEvent = {
        step: index,
        pitch: pitchClassForMidi(roundedMidi),
        octave: octaveForMidi(roundedMidi),
        durationSteps: 1,
        velocity: clamp(0.72 * settings.energy * timed.energyScale, 0.2, 0.98),
        syllable: unit.syllable,
        vowel: unit.vowel,
        nextVowel: plan.units[index + 1]?.unit.vowel ?? null,
        articulate: !unit.longVowel,
        phraseStart: unit.phraseStart,
        phraseEnd: unit.phraseEnd,
        glideFromMidi: previousPitchMidi === null ? null : Math.round(previousPitchMidi),
      };

      const phrase = phraseControlFor(unit, settings.energy * timed.energyScale);
      const workletEvent = vocalEventToWorklet(
        event,
        settings.style,
        startAt + timed.start + variation.timingOffsetSeconds,
        timed.duration,
        phrase,
        undefined,
        undefined,
        index % 16,
        {
          preset: settings.character,
          // Keep speaker identity fixed; expression remains a relative delivery delta.
          tone: clamp(settings.tone, -1, 1),
        },
      );

      workletEvent.targetHz = midiToHz(performancePitchMidi);
      workletEvent.glideFromHz = previousPitchMidi === null || unit.phraseStart
        ? null
        : midiToHz(previousPitchMidi);

      workletEvent.karaoke = {
        ...workletEvent.karaoke,
        scoopCents: unit.phraseStart ? 1.5 + emphasis * 1.6 : 0,
        fallCents: unit.phraseEnd
          ? clamp(finality.fallCents + attitude.fallCentsOffset, 0, 12)
          : unit.accentEnd
            ? 1
            : 0,
        vibratoGain: 0,
      };

      workletEvent.style = {
        ...workletEvent.style,
        vibratoDepthCents: 0,
        intensityModDepth: Math.min(workletEvent.style.intensityModDepth, 0.006 + emphasis * 0.002),
        jitterCents: Math.min(workletEvent.style.jitterCents, 0.34 + emphasis * 0.06),
        shimmerDepth: Math.min(workletEvent.style.shimmerDepth, 0.004),
        doubleLevel: 0,
        onsetPitchCents: unit.phraseStart ? 1.8 : 0,
        breathLevel: clamp(
          workletEvent.style.breathLevel
            * identityConditioning.breathScale
            * expressionControl.breathScale
            + (unit.breathBefore > 0 ? 0.08 : 0)
            + attitude.breathAdd
            + (followsSigh ? 0.105 : followsLaugh ? 0.025 : 0),
          0,
          1.2,
        ),
        attackSeconds: workletEvent.style.attackSeconds
          * expressionControl.attackScale
          * emphasisProfile.attackScale
          * variation.attackScale
          * (followsSigh ? 1.08 : 1)
          * (unit.geminateBefore ? 0.78 : 1),
        releaseSeconds: workletEvent.style.releaseSeconds
          * (unit.phraseEnd ? finality.releaseScale * attitude.releaseScale : 0.88)
          * (continuesDocument ? 0.95 : 1),
        speechSourceMix: speechSource.sourceMix,
        speechSourceTilt: clamp(
          speechSource.sourceTilt
            * identityConditioning.sourceTiltScale
            * (1 - expressionControl.toneOffset * 0.12)
            * emphasisProfile.sourceTiltScale,
          0.28,
          0.82,
        ),
        speechCoarticulation: speechSource.coarticulation,
        speechPulseNoise: speechSource.pulseNoise,
        speechPresenceBoost: speechPresence.harmonicPresence,
        speechAirPresence: speechPresence.airPresence,
        speechFricativeGain: speechPresence.fricativeGain,
        speechFormantCarry: clamp(
          speechSource.formantCarry
            * utteranceStrategy.coarticulationScale
            * chunkContinuity.formantCarryScale,
          0.82,
          0.975,
        ),
        speechVowelTransitionScale: clamp(
          speechSource.vowelTransitionScale
            * utteranceStrategy.coarticulationScale
            * chunkContinuity.transitionScale
            * consonantLocus.transitionScale,
          0.72,
          1.58,
        ),
        speechCVOverlap: speechSource.cvOverlap,
        speechGlottalDriftCents: speechSource.glottalDriftCents,
        speechGlottalJitterCents: speechSource.glottalJitterCents,
        speechOpenQuotientMotion: speechSource.openQuotientMotion,
        speechClosureAsymmetry: speechTimbre.closureAsymmetry,
        speechClosureStrength: speechTimbre.closureStrength,
        speechBodyMix: speechTimbre.bodyMix,
        speechSourceDamping: speechTimbre.sourceDamping,
        speechFormantMotion: speechTimbre.formantMotion,
        speechHarmonicGain: harmonicNoise.harmonicGain,
        speechNoiseGain: harmonicNoise.noiseGain,
        speechLfBlend: aperiodicity.lfBlend,
        speechLfRd: aperiodicity.lfRd,
        speechAperiodicityAmount: aperiodicity.amount,
        speechAperiodicityLow: aperiodicity.low,
        speechAperiodicityMid: aperiodicity.mid,
        speechAperiodicityPresence: aperiodicity.presence,
        speechAperiodicityAir: aperiodicity.air,
        speechSourceOversample: speechQuality.sourceOversample,
        speechResidualAmount: speechQuality.residualAmount,
        speechResidualBody: speechQuality.residualBody,
        speechResidualPresence: speechQuality.residualPresence,
        speechResidualAir: speechQuality.residualAir,
        speechResidualSmoothingMs: speechQuality.residualSmoothingMs,
        speechClosureSmoothingMs: speechQuality.closureSmoothingMs,
        speechCycleVariation: phonationMicrostructure.cycleVariation,
        speechSubharmonicMix: phonationMicrostructure.subharmonicMix,
        speechSourceTractCoupling: phonationMicrostructure.sourceTractCoupling,
        speechPitchTransitionScale: pitchTransitionScale,
        speechFinalCreak: unit.phraseEnd
          ? finality.creak * documentFinalityScale
          : 0,
        speechFinalBreath: unit.phraseEnd
          ? (finality.breath + punctuationProsody.breathAdd) * documentFinalityScale
          : unit.breathAfter
            ? 0.09
            : unit.hesitationAfter
              ? 0.055
              : 0,
      };

      workletEvent.formants = workletEvent.formants.map((band, bandIndex) => {
        const bodyScale = bandIndex <= 1
          ? speechTimbre.lowerFormantGain
          : speechTimbre.upperFormantGain;
        const transitionScale = speechArticulatoryTransitionScalesFor(
          unit,
          nextUnit,
          bandIndex,
        );
        const tractScale = transitionScale.current * tract.frequencyScale;
        const nextScale = transitionScale.next * nextTract.frequencyScale;
        return {
          ...band,
          startHz: band.startHz * tractScale,
          targetHz: band.targetHz * tractScale,
          nextHz: band.nextHz === null
            ? null
            : band.nextHz * nextScale,
          bandwidth: band.bandwidth
            * articulatoryFilter.bandwidthScale
            * tract.bandwidthScale
            * (consonantLocus.bandwidthScale[bandIndex] ?? 1),
          gain: band.gain
            * (speechPresence.upperFormantGain[bandIndex] ?? 1)
            * (identityConditioning.formantGain[bandIndex] ?? 1)
            * bodyScale,
        };
      });
      workletEvent.style = {
        ...workletEvent.style,
        presenceFrequency: clamp(
          workletEvent.style.presenceFrequency
            * identityConditioning.presenceFrequencyScale
            * (1 + expressionControl.toneOffset * 0.025)
            * speechPresence.presenceFrequencyScale
            * tract.frequencyScale,
          1700,
          4700,
        ),
        presenceGain: clamp(
          workletEvent.style.presenceGain
            * identityConditioning.presenceGainScale
            * speechPresence.presenceGainScale
            + speechPresence.presenceGainAdd
            + expressionControl.toneOffset * 0.008,
          0,
          0.18,
        ),
        radiationGainDb: workletEvent.style.radiationGainDb
          + identityConditioning.radiationGainDb
          + speechPresence.radiationGainDbAdd,
      };
      workletEvent.phoneme = {
        ...workletEvent.phoneme,
        speechBurstGain: consonantTransient.burstGain,
        speechBurstSharpness: consonantTransient.burstSharpness,
        speechClosureVoicingRise: consonantTransient.closureVoicingRise,
        speechNasalOnsetBoost: consonantTransient.nasalOnsetBoost,
        speechNasalReleaseScale: consonantTransient.nasalReleaseScale,
        fricationSeconds: workletEvent.phoneme.fricationSeconds * speechPresence.fricationScale,
        noiseMix: clamp(
          workletEvent.phoneme.noiseMix
            * speechPresence.consonantNoiseScale
            * articulatoryFilter.noiseScale,
          0,
          1,
        ),
        nasalMix: clamp(
          workletEvent.phoneme.nasalMix + articulatoryFilter.nasalMixAdd,
          0,
          0.92,
        ),
      };
      workletEvent.resonance = {
        ...workletEvent.resonance,
        nasalZeroHz: workletEvent.resonance.nasalZeroHz * tract.frequencyScale,
        nasalZeroMix: clamp(
          workletEvent.resonance.nasalZeroMix + articulatoryFilter.nasalMixAdd * 0.42,
          0,
          0.5,
        ),
      };
      workletEvent.style = {
        ...workletEvent.style,
        speechBodyMix: clamp(
          (workletEvent.style.speechBodyMix ?? 0) * articulatoryFilter.bodyScale,
          0,
          0.2,
        ),
        speechSourceDamping: clamp(
          (workletEvent.style.speechSourceDamping ?? 0) * articulatoryFilter.dampingScale,
          0,
          0.4,
        ),
      };

      workletEvent.voiceCharacter = {
        ...workletEvent.voiceCharacter,
        breathScale: clamp(workletEvent.voiceCharacter.breathScale * expressionControl.breathScale, 0.55, 2),
        attackScale: clamp(workletEvent.voiceCharacter.attackScale * expressionControl.attackScale, 0.55, 1.6),
        articulationScale: clamp(
          workletEvent.voiceCharacter.articulationScale
            * expressionControl.articulationScale
            * emphasisProfile.articulationScale,
          0.62,
          1.5,
        ),
        sourceTiltScale: clamp(
          workletEvent.voiceCharacter.sourceTiltScale * expressionControl.sourceTiltScale,
          0.72,
          1.42,
        ),
      };

      if (expressionControl.voicingScale < 0.999) {
        workletEvent.phoneme = {
          ...workletEvent.phoneme,
          voicedMix: workletEvent.phoneme.voicedMix * expressionControl.voicingScale,
          aspirationMix: clamp(
            workletEvent.phoneme.aspirationMix + (1 - expressionControl.voicingScale) * 0.18,
            0,
            1,
          ),
          noiseMix: clamp(
            workletEvent.phoneme.noiseMix + (1 - expressionControl.voicingScale) * 0.09,
            0,
            1,
          ),
        };
      }

      if (unit.geminateBefore) {
        workletEvent.phoneme = {
          ...workletEvent.phoneme,
          closureSeconds: Math.max(
            workletEvent.phoneme.closureSeconds,
            speechSource.geminateClosureSeconds,
          ),
          burstSeconds: workletEvent.phoneme.burstSeconds * 1.08,
          noiseMix: clamp(workletEvent.phoneme.noiseMix * 1.08, 0, 1),
        };
      }

      if (unit.devoiced) {
        workletEvent.phoneme = {
          ...workletEvent.phoneme,
          voicedMix: workletEvent.phoneme.voicedMix * 0.14,
          aspirationMix: Math.max(0.24, workletEvent.phoneme.aspirationMix),
          noiseMix: Math.max(0.11, workletEvent.phoneme.noiseMix),
        };
        workletEvent.formants = workletEvent.formants.map((band) => ({
          ...band,
          gain: band.gain * 0.48,
        }));
        workletEvent.style = {
          ...workletEvent.style,
          breathLevel: workletEvent.style.breathLevel * 1.5,
          glottalOpenQuotient: clamp(workletEvent.style.glottalOpenQuotient + 0.055, 0.46, 0.88),
          intensityModDepth: workletEvent.style.intensityModDepth * 0.45,
        };
        workletEvent.velocity = clamp(workletEvent.velocity * 0.7, 0.16, 0.72);
      }

      if (unit.longVowel) {
        workletEvent.phoneme = {
          ...workletEvent.phoneme,
          closureSeconds: 0,
          burstSeconds: 0,
          fricationSeconds: 0,
          noiseMix: workletEvent.phoneme.noiseMix * 0.32,
          aspirationMix: workletEvent.phoneme.aspirationMix * 0.78,
        };
      }

      workletEvent.ensemble = {
        label: 'LEAD',
        harmonyTargetHz: null,
        harmonyGainScale: 0,
      };
      workletEvent.velocity = clamp(
        workletEvent.velocity * variation.velocityScale,
        0.16,
        0.98,
      );
      this.worklet.schedule(workletEvent);
      previousPitchMidi = performancePitchMidi;
    });

    plan.events.forEach((timedEvent, eventIndex) => {
      const profile = speechEventProfileFor(timedEvent.event.kind, timedEvent.event.strength);
      if (profile.pulseCount <= 0 || timedEvent.duration <= 0) return;

      for (let pulse = 0; pulse < profile.pulseCount; pulse += 1) {
        const pulseSpan = timedEvent.duration / profile.pulseCount;
        const pulseDuration = timedEvent.event.kind === 'laugh'
          ? Math.max(0.065, pulseSpan * 0.72)
          : timedEvent.duration;
        const pulseOffset = timedEvent.event.kind === 'laugh'
          ? pulse * pulseSpan
          : 0;
        const pitchMidi = clamp(
          settings.pitch
            + profile.pitchSemitones
            + (timedEvent.event.kind === 'laugh' ? (pulse === 0 ? 0.35 : -0.2) : 0),
          40,
          82,
        );
        const roundedMidi = Math.round(pitchMidi);
        const nonverbal: VocalEvent = {
          step: 1000 + eventIndex * 4 + pulse,
          pitch: pitchClassForMidi(roundedMidi),
          octave: octaveForMidi(roundedMidi),
          durationSteps: 1,
          velocity: clamp(
            profile.velocityScale * settings.energy,
            0.08,
            timedEvent.event.kind === 'laugh' ? 0.42 : 0.32,
          ),
          syllable: 'ha',
          vowel: 'a',
          nextVowel: null,
          articulate: timedEvent.event.kind === 'laugh',
          phraseStart: true,
          phraseEnd: true,
          glideFromMidi: null,
        };

        const eventWorklet = vocalEventToWorklet(
          nonverbal,
          settings.style,
          startAt + timedEvent.start + pulseOffset,
          pulseDuration,
          undefined,
          undefined,
          undefined,
          nonverbal.step % 16,
          {
            preset: settings.character,
            tone: clamp(settings.tone, -1, 1),
          },
        );
        eventWorklet.targetHz = midiToHz(pitchMidi);
        eventWorklet.ensemble = {
          label: 'LEAD',
          harmonyTargetHz: null,
          harmonyGainScale: 0,
        };
        eventWorklet.karaoke = {
          ...eventWorklet.karaoke,
          scoopCents: timedEvent.event.kind === 'laugh' ? 3.5 : 0,
          fallCents: timedEvent.event.kind === 'sigh' ? 10 : 0,
          vibratoGain: 0,
        };
        eventWorklet.style = {
          ...eventWorklet.style,
          vibratoDepthCents: 0,
          doubleLevel: 0,
          intensityModDepth: timedEvent.event.kind === 'laugh' ? 0.014 : 0.003,
          jitterCents: timedEvent.event.kind === 'laugh' ? 0.9 : 0.25,
          breathLevel: timedEvent.event.kind === 'inhale'
            ? 1
            : timedEvent.event.kind === 'sigh'
              ? 0.64
              : 0.22,
          attackSeconds: timedEvent.event.kind === 'laugh'
            ? eventWorklet.style.attackSeconds * 0.72
            : timedEvent.event.kind === 'sigh'
              ? eventWorklet.style.attackSeconds * 1.15
              : eventWorklet.style.attackSeconds * 0.86,
          releaseSeconds: timedEvent.event.kind === 'sigh'
            ? Math.max(0.16, eventWorklet.style.releaseSeconds * 1.55)
            : eventWorklet.style.releaseSeconds * 0.8,
          speechSourceMix: timedEvent.event.kind === 'inhale'
            ? 0.28
            : timedEvent.event.kind === 'sigh'
              ? 0.44
              : 0.68,
          speechSourceTilt: timedEvent.event.kind === 'inhale'
            ? 0.88
            : timedEvent.event.kind === 'sigh'
              ? 0.82
              : 0.68,
          speechCoarticulation: 0.45,
          speechPulseNoise: timedEvent.event.kind === 'inhale'
            ? 0.28
            : timedEvent.event.kind === 'sigh'
              ? 0.2
              : 0.14,
          speechPitchTransitionScale: 0.62,
          speechFinalCreak: 0,
          speechFinalBreath: timedEvent.event.kind === 'sigh' ? 0.22 : 0.08,
        };

        if (timedEvent.event.kind === 'inhale') {
          eventWorklet.phoneme = {
            ...eventWorklet.phoneme,
            voicedMix: 0.015,
            aspirationMix: 0.96,
            noiseMix: Math.max(0.34, eventWorklet.phoneme.noiseMix),
            closureSeconds: 0,
            burstSeconds: 0,
          };
          eventWorklet.formants = eventWorklet.formants.map((band) => ({
            ...band,
            gain: band.gain * 0.12,
          }));
        } else if (timedEvent.event.kind === 'sigh') {
          eventWorklet.glideFromHz = midiToHz(pitchMidi + 2.8);
          eventWorklet.phoneme = {
            ...eventWorklet.phoneme,
            voicedMix: eventWorklet.phoneme.voicedMix * 0.12,
            aspirationMix: Math.max(0.62, eventWorklet.phoneme.aspirationMix),
            noiseMix: Math.max(0.14, eventWorklet.phoneme.noiseMix),
          };
          eventWorklet.formants = eventWorklet.formants.map((band) => ({
            ...band,
            gain: band.gain * 0.34,
          }));
        } else {
          eventWorklet.phoneme = {
            ...eventWorklet.phoneme,
            voicedMix: eventWorklet.phoneme.voicedMix * 0.5,
            aspirationMix: Math.max(0.28, eventWorklet.phoneme.aspirationMix),
            noiseMix: Math.max(0.12, eventWorklet.phoneme.noiseMix),
          };
          eventWorklet.formants = eventWorklet.formants.map((band) => ({
            ...band,
            gain: band.gain * 0.6,
          }));
        }

        this.worklet.schedule(eventWorklet);
      }
    });

    return plan;
  }

  async renderWav(
    script: VoiceScript,
    settings: VoiceSynthSettings,
    prosodyInput: VoiceProsodyInput = {},
  ): Promise<Blob> {
    await this.unlock();
    if (!this.context || !this.limiter) throw new Error('Voice render unavailable');
    this.stop();
    this.wavCapture.start(this.context, this.limiter);
    const plan = await this.play(script, settings, prosodyInput);
    await new Promise<void>((resolve) => window.setTimeout(resolve, Math.ceil((plan.duration + 0.18) * 1000)));
    return this.wavCapture.finish();
  }
}
