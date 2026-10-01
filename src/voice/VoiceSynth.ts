import type { PitchClass } from '../core/music';
import type { VocalEvent, VocalStyle } from '../compose/VocalGenerator';
import { consonantForSyllable } from '../compose/JapanesePhoneme';
import type { VocalPhraseControl } from '../compose/VocalPhraseModel';
import { VocalWorkletBridge, vocalEventToWorklet, type VocalWorkletStatus } from '../compose/VocalWorkletBridge';
import type { VoiceCharacterPreset } from '../compose/VoiceCharacter';
import { WavCapture } from '../compose/SongExport';
import {
  prosodyOffsetForUnit,
  resolveVoiceIntonation,
  type VoiceIntonation,
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

export interface VoiceSynthSettings {
  style: VocalStyle;
  character: VoiceCharacterPreset;
  tone: number;
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
  expression: VoiceExpressionSettings;
}

export interface VoiceTimedSpeechEvent {
  event: VoiceSpeechEvent;
  start: number;
  duration: number;
  gapAfter: number;
}

export interface VoicePlaybackPlan {
  duration: number;
  units: VoiceTimedUnit[];
  events: VoiceTimedSpeechEvent[];
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
    ? 1 + 0.12 * intensity
    : expression.preset === 'serious'
      ? 1 + 0.06 * intensity
      : expression.preset === 'whisper'
        ? 0.9
        : expression.preset === 'calm'
          ? 0.94
          : 1;
  const consonant = unit.syllable.toLowerCase();
  const fricative = /^(s|sh|z|j|ts|ch|f|h)/.test(consonant);

  const airy = expression.preset === 'whisper' ? 1.45 : expression.preset === 'calm' ? 0.82 : 1;
  return {
    upperFormantGain: [
      1,
      1.1,
      1.42 * brightPreset,
      1.6 * brightPreset,
      1.48 * brightPreset,
    ],
    presenceGainScale: 1.48 * brightPreset,
    presenceGainAdd: expression.preset === 'whisper'
      ? 0.046
      : expression.preset === 'calm'
        ? 0.052
        : 0.074 * brightPreset,
    presenceFrequencyScale: expression.preset === 'calm' ? 1.015 : 1.07,
    radiationGainDbAdd: expression.preset === 'whisper' ? 1.35 : 2.25 * brightPreset,
    consonantNoiseScale: fricative ? 1.58 * brightPreset : 1.16,
    fricationScale: fricative ? 1.2 : 1.045,
    harmonicPresence: clamp(0.15 * brightPreset, 0.09, 0.21),
    airPresence: clamp((fricative ? 0.12 : 0.012) * airy * brightPreset, 0.008, 0.155),
    fricativeGain: clamp((fricative ? 1.78 : 1.12) * brightPreset, 1, 1.96),
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
            creak: 0.3,
            breath: 0.065,
            pitchSemitones: -0.1,
            durationScale: 1.08,
            energyScale: 0.93,
            releaseScale: 1.12,
            fallCents: 7,
          }
        : intonation === 'flat'
          ? {
              creak: 0.14,
              breath: 0.065,
              pitchSemitones: -0.02,
              durationScale: 1.03,
              energyScale: 0.97,
              releaseScale: 1.06,
              fallCents: 2,
            }
          : {
              creak: 0.24,
              breath: 0.08,
              pitchSemitones: -0.04,
              durationScale: 1.06,
              energyScale: 0.95,
              releaseScale: 1.1,
              fallCents: 5,
            };

  const delta = expression.preset === 'serious'
    ? {
        creak: 0.12,
        breath: -0.035,
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
  private readonly worklet = new VocalWorkletBridge();
  private readonly wavCapture = new WavCapture();

  get status(): VocalWorkletStatus {
    return this.worklet.status;
  }

  get currentTime(): number {
    return this.context?.currentTime ?? 0;
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
      const offset = prosodyOffsetForUnit(unit, index, script.units.length, resolvedIntonation)
        * expressionControl.pitchRangeScale;
      const manualPitchOffset = clamp(edits.pitchOffsets?.[index] ?? 0, -3.5, 3.5);
      const manualEnergyScale = clamp(edits.energyScales?.[index] ?? 1, 0.45, 1.55);
      const manualDurationScale = clamp(edits.durationScales?.[index] ?? 1, 0.6, 1.65);
      const phrasePitchOffset = clamp(edits.phrasePitchOffsets?.[index] ?? 0, -3, 3);
      const phraseRateScale = clamp(edits.phraseRateScales?.[index] ?? 1, 0.72, 1.35);
      const phraseEnergyScale = clamp(edits.phraseEnergyScales?.[index] ?? 1, 0.65, 1.45);
      const phraseEmphasis = clamp(edits.phraseEmphasisScales?.[index] ?? 0, 0, 1.5);
      const contextDelivery = speechContextDeliveryFor(unit, expression);
      const effectiveRate = settings.rate
        * phraseRateScale
        * unit.autoRateScale
        * contextDelivery.rateScale
        * eventTransition.rateScale;
      const emphasisProfile = speechEmphasisProfileFor(
        unit,
        script.units[index + 1],
        phraseEmphasis,
      );
      const finality = speechFinalityProfileFor(expression, resolvedIntonation);
      const attitude = speechAttitudeProfileFor(unit);
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
          + manualPitchOffset,
        40,
        82,
      );
      const duration = clamp(
        japaneseUnitDurationSeconds(unit, effectiveRate)
          * expressionUnit.durationScale
          * emphasisProfile.durationScale
          * finalDurationScale
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
        expression,
      });

      const pauseOverride = edits.pauseOverrides?.[index];
      const pause = pauseOverride === null || pauseOverride === undefined
        ? japaneseBoundaryPauseSeconds(unit, effectiveRate)
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

    return { duration: cursor + 0.08, units, events };
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
    const startAt = this.context.currentTime + 0.055;
    const takeIndex = this.takeIndex++;
    let previousPitchMidi: number | null = null;

    plan.units.forEach((timed, index) => {
      const unit = timed.unit;
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
      const speechTimbre = speechTimbreProfileFor(
        settings.character,
        settings.tone,
        timed.expression,
      );
      const articulatoryState = speechArticulatoryStateFor(unit);
      const articulatoryFilter = speechArticulatoryFilterFor(articulatoryState);
      const harmonicNoise = speechHarmonicNoiseProfileFor(unit);
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
      const variation = speechTakeVariationFor(index, takeIndex);
      const performancePitchMidi = timed.pitchMidi + variation.pitchCents / 100;
      const previousUnit = plan.units[index - 1]?.unit;
      const pitchTransitionScale = speechPitchTransitionScaleFor(unit, previousUnit);
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
          tone: clamp(settings.tone + expressionControl.toneOffset, -1, 1),
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
          workletEvent.style.breathLevel * expressionControl.breathScale
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
          * (unit.phraseEnd ? finality.releaseScale * attitude.releaseScale : 0.88),
        speechSourceMix: speechSource.sourceMix,
        speechSourceTilt: clamp(speechSource.sourceTilt * emphasisProfile.sourceTiltScale, 0.28, 0.82),
        speechCoarticulation: speechSource.coarticulation,
        speechPulseNoise: speechSource.pulseNoise,
        speechPresenceBoost: speechPresence.harmonicPresence,
        speechAirPresence: speechPresence.airPresence,
        speechFricativeGain: speechPresence.fricativeGain,
        speechFormantCarry: speechSource.formantCarry,
        speechVowelTransitionScale: speechSource.vowelTransitionScale,
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
        speechPitchTransitionScale: pitchTransitionScale,
        speechFinalCreak: unit.phraseEnd ? finality.creak : 0,
        speechFinalBreath: unit.phraseEnd
          ? finality.breath
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
        const tractScale = articulatoryFilter.formantScale[bandIndex] ?? 1;
        return {
          ...band,
          startHz: band.startHz * tractScale,
          targetHz: band.targetHz * tractScale,
          nextHz: band.nextHz === null ? null : band.nextHz * tractScale,
          bandwidth: band.bandwidth * articulatoryFilter.bandwidthScale,
          gain: band.gain
            * (speechPresence.upperFormantGain[bandIndex] ?? 1)
            * bodyScale,
        };
      });
      workletEvent.style = {
        ...workletEvent.style,
        presenceFrequency: clamp(
          workletEvent.style.presenceFrequency * speechPresence.presenceFrequencyScale,
          1800,
          4600,
        ),
        presenceGain: clamp(
          workletEvent.style.presenceGain * speechPresence.presenceGainScale
            + speechPresence.presenceGainAdd,
          0,
          0.18,
        ),
        radiationGainDb: workletEvent.style.radiationGainDb + speechPresence.radiationGainDbAdd,
      };
      workletEvent.phoneme = {
        ...workletEvent.phoneme,
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

    const eventExpression = settings.expression ?? { preset: 'neutral', intensity: 1 };
    const eventExpressionControl = voiceExpressionControl(eventExpression);
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
            tone: clamp(settings.tone + eventExpressionControl.toneOffset, -1, 1),
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
