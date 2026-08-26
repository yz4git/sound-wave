import type { ArrangementBar } from './GenreArrangement';
import type { GenreStyleProfile } from './GenreStyle';
import type { VocalEvent, VocalStyle } from './VocalGenerator';
import { phonemeTimingFor, type JapanesePhonemeTiming } from './JapanesePhoneme';
import { karaokeSingingControlFor, type KaraokeSingingControl } from './KaraokeSinging';
import { VOCAL_STYLE_MODELS, formantsFor, onsetFormantFrequency } from './VocalModel';
import { neutralPhraseControl, type VocalPhraseControl } from './VocalPhraseModel';
import { producerTuningFor, type ProducerTuningControl } from './ProducerTuning';
import { vocalResonanceControlFor, type VocalResonanceControl } from './VocalResonance';
import {
  sourceFilterCouplingFor,
  type VocalSourceFilterCouplingControl,
} from './VocalSourceFilterCoupling';
import {
  spectralEnvelopeControlFor,
  type VocalSpectralEnvelopeControl,
} from './VocalSpectralEnvelope';
import {
  scoreAlignedExpressionFor,
  type ScoreAlignedExpressionControl,
} from './ScoreAlignedExpression';
import {
  DEFAULT_VOICE_CHARACTER,
  voiceCharacterFor,
  type VoiceCharacterControl,
  type VoiceCharacterSettings,
} from './VoiceCharacter';
import { activeVocalEnsembleFor } from './VocalEnsemble';
import { vocalDirectorControlFor, type VocalDirectorControl } from './VocalDirector';

export type VocalWorkletStatus = 'idle' | 'loading' | 'ready' | 'unavailable';

export interface VocalWorkletEvent {
  when: number;
  duration: number;
  targetHz: number;
  glideFromHz: number | null;
  velocity: number;
  syllable: string;
  articulate: boolean;
  phraseStart: boolean;
  phraseEnd: boolean;
  phoneme: JapanesePhonemeTiming;
  karaoke: KaraokeSingingControl;
  resonance: VocalResonanceControl;
  scoreAligned: ScoreAlignedExpressionControl;
  spectral: VocalSpectralEnvelopeControl;
  sourceFilter: VocalSourceFilterCouplingControl;
  producerTuning: ProducerTuningControl;
  voiceCharacter: VoiceCharacterControl;
  vocalDirector: VocalDirectorControl;
  ensemble: {
    label: 'LEAD' | 'DOUBLE' | 'HARMONY' | 'STACKED';
    harmonyTargetHz: number | null;
    harmonyGainScale: number;
  };
  phrase: {
    progressStart: number;
    progressEnd: number;
    energyStart: number;
    energyEnd: number;
    centeringStart: number;
    centeringEnd: number;
    aspirationDepth: number;
    sourceTractCoupling: number;
  };
  formants: {
    startHz: number;
    targetHz: number;
    nextHz: number | null;
    bandwidth: number;
    gain: number;
  }[];
  style: {
    glottalOpenQuotient: number;
    glottalSpeedQuotient: number;
    vibratoRateHz: number;
    vibratoDepthCents: number;
    vibratoDelaySeconds: number;
    intensityModDepth: number;
    jitterCents: number;
    shimmerDepth: number;
    presenceFrequency: number;
    presenceGain: number;
    breathLevel: number;
    attackSeconds: number;
    releaseSeconds: number;
    onsetPitchCents: number;
    radiationFrequency: number;
    radiationGainDb: number;
    doubleDelaySeconds: number;
    doubleLevel: number;
  };
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

function midiToHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

function midiForPitchClass(pitch: number, octave: number): number {
  return 12 * (octave + 1) + pitch;
}

export function vocalEventToWorklet(
  event: VocalEvent,
  style: VocalStyle,
  when: number,
  duration: number,
  phraseControl: VocalPhraseControl = neutralPhraseControl(event),
  producerProfile?: GenreStyleProfile,
  producerState?: ArrangementBar,
  localStep: number = event.step % 16,
  voiceCharacterSettings: VoiceCharacterSettings = DEFAULT_VOICE_CHARACTER,
): VocalWorkletEvent {
  const model = VOCAL_STYLE_MODELS[style];
  const bands = formantsFor(event.vowel, style);
  const nextBands = event.nextVowel === null ? null : formantsFor(event.nextVowel, style);
  const targetHz = midiToHz(midiForPitchClass(event.pitch, event.octave));
  const normalizedDuration = Math.max(0.11, duration);
  const voiceCharacter = voiceCharacterFor(voiceCharacterSettings);
  const vocalDirector = vocalDirectorControlFor(producerProfile);
  const producerTuning = producerTuningFor(
    event,
    phraseControl,
    producerProfile,
    producerState,
    localStep,
    normalizedDuration,
  );
  const ensembleControl = activeVocalEnsembleFor(event);
  const rawPhoneme = phonemeTimingFor(event.syllable);
  const consonantScale = producerTuning.consonantLengthScale;
  const phoneme: JapanesePhonemeTiming = {
    ...rawPhoneme,
    closureSeconds: rawPhoneme.closureSeconds * consonantScale,
    burstSeconds: rawPhoneme.burstSeconds * clamp(consonantScale, 0.88, 1.1),
    fricationSeconds: rawPhoneme.fricationSeconds * consonantScale,
    voicingDelaySeconds: rawPhoneme.voicingDelaySeconds * consonantScale,
    noiseMix: clamp(
      rawPhoneme.noiseMix
        * producerTuning.articulationScale
        * voiceCharacter.articulationScale
        * vocalDirector.articulationScale,
      0,
      1,
    ),
  };
  const baseKaraoke = karaokeSingingControlFor(event, normalizedDuration, phraseControl);
  const karaoke: KaraokeSingingControl = {
    ...baseKaraoke,
    scoopCents: clamp(
      baseKaraoke.scoopCents + producerTuning.scoopCentsAdd + vocalDirector.scoopCentsAdd,
      0,
      14,
    ),
    fallCents: clamp(
      baseKaraoke.fallCents + producerTuning.fallCentsAdd + vocalDirector.fallCentsAdd,
      0,
      12,
    ),
    vibratoGain: clamp(
      baseKaraoke.vibratoGain
        * producerTuning.vibratoScale
        * voiceCharacter.vibratoScale
        * vocalDirector.vibratoScale,
      0,
      1,
    ),
  };
  const baseResonance = vocalResonanceControlFor(event, phraseControl);
  const plannedExpression = scoreAlignedExpressionFor(event, phoneme, normalizedDuration, phraseControl);

  const requestedPreRoll = plannedExpression.consonantPreRollSeconds + producerTuning.timingLeadSeconds;
  const appliedPreRoll = Math.min(requestedPreRoll, Math.max(0, when));
  const scheduledWhen = when - appliedPreRoll;
  const scheduledDuration = normalizedDuration + appliedPreRoll;
  const scoreAligned: ScoreAlignedExpressionControl = {
    ...plannedExpression,
    consonantPreRollSeconds: appliedPreRoll,
  };
  const baseSpectral = spectralEnvelopeControlFor(event, normalizedDuration, phraseControl, scoreAligned);
  const sourceFilter = sourceFilterCouplingFor(event, targetHz, phraseControl, baseSpectral);

  const spectral: VocalSpectralEnvelopeControl = {
    ...baseSpectral,
    frequencySmoothing: clamp(
      baseSpectral.frequencySmoothing * (1 + sourceFilter.filterLoad * 0.08),
      0.08,
      0.2,
    ),
    spectralTiltDepth: clamp(
      baseSpectral.spectralTiltDepth
        * (1 + sourceFilter.sourceTiltDepth * 1.6)
        * voiceCharacter.sourceTiltScale,
      0.005,
      0.026,
    ),
    trajectoryDepth: clamp(
      baseSpectral.trajectoryDepth * (1 + sourceFilter.spectralCouplingDepth * 0.045),
      0.72,
      1.08,
    ),
  };

  const resonance: VocalResonanceControl = {
    ...baseResonance,
    bandwidthMotion: baseResonance.bandwidthMotion
      * scoreAligned.sustainTimbreMotion
      * (1 + sourceFilter.filterLoad * 0.08),
    gainMotion: baseResonance.gainMotion
      * scoreAligned.sustainTimbreMotion
      * (1 - sourceFilter.highPitchCompensation * 0.07),
    vibratoResonanceDepth: baseResonance.vibratoResonanceDepth
      * clamp(scoreAligned.sustainTimbreMotion, 0.8, 1.08)
      * (1 - sourceFilter.highPitchCompensation * 0.08),
  };

  const dynamicSourceTractCoupling = clamp(
    phraseControl.sourceTractCoupling * 0.5 + sourceFilter.tractFeedbackDepth * 0.7,
    0.004,
    0.013,
  );
  const dynamicOpenQuotient = clamp(
    model.glottalOpenQuotient
      + sourceFilter.openQuotientOffset
      + sourceFilter.sourceTiltDepth * 0.08
      + voiceCharacter.openQuotientOffset,
    0.46,
    0.84,
  );
  const dynamicSpeedQuotient = clamp(
    model.glottalSpeedQuotient
      + sourceFilter.speedQuotientOffset
      - sourceFilter.sourceTiltDepth * 0.045
      + voiceCharacter.speedQuotientOffset,
    0.46,
    0.86,
  );
  const dynamicBreathLevel = model.breathLevel
    * scoreAligned.aspirationScale
    * (1 + sourceFilter.aspirationCoupling * 0.18)
    * producerTuning.airScale
    * voiceCharacter.breathScale
    * vocalDirector.airScale;
  const ensembleScale = vocalDirector.ensembleScale;

  return {
    when: scheduledWhen,
    duration: scheduledDuration,
    targetHz,
    glideFromHz: event.glideFromMidi === null ? null : midiToHz(event.glideFromMidi),
    velocity: event.velocity,
    syllable: event.syllable,
    articulate: event.articulate,
    phraseStart: event.phraseStart,
    phraseEnd: event.phraseEnd,
    phoneme,
    karaoke,
    resonance,
    scoreAligned,
    spectral,
    sourceFilter,
    producerTuning,
    voiceCharacter,
    vocalDirector,
    ensemble: {
      label: ensembleControl.label,
      harmonyTargetHz: ensembleControl.harmony === null
        ? null
        : midiToHz(midiForPitchClass(ensembleControl.harmony.event.pitch, ensembleControl.harmony.event.octave)),
      harmonyGainScale: clamp((ensembleControl.harmony?.gainScale ?? 0) * ensembleScale, 0, 0.56),
    },
    phrase: {
      progressStart: phraseControl.progressStart,
      progressEnd: phraseControl.progressEnd,
      energyStart: clamp(
        phraseControl.energyStart
          * scoreAligned.energyStartScale
          * producerTuning.dynamicsStartScale
          * voiceCharacter.dynamicsScale
          * vocalDirector.dynamicsScale,
        0.7,
        1.2,
      ),
      energyEnd: clamp(
        phraseControl.energyEnd
          * scoreAligned.energyEndScale
          * producerTuning.dynamicsEndScale
          * voiceCharacter.dynamicsScale
          * vocalDirector.dynamicsScale,
        0.7,
        1.2,
      ),
      centeringStart: clamp(phraseControl.centeringStart * scoreAligned.centeringScale, 0, 0.22),
      centeringEnd: clamp(phraseControl.centeringEnd * scoreAligned.centeringScale, 0, 0.22),
      aspirationDepth: clamp(
        phraseControl.aspirationDepth
          * scoreAligned.aspirationScale
          * (1 + sourceFilter.aspirationCoupling * 0.1)
          * producerTuning.airScale
          * voiceCharacter.breathScale
          * vocalDirector.airScale,
        0.045,
        0.16,
      ),
      sourceTractCoupling: dynamicSourceTractCoupling,
    },
    formants: bands.map((band, index) => {
      const upperWeight = index / Math.max(1, bands.length - 1);
      const timbreScale = 1 + (scoreAligned.upperFormantScale - 1) * upperWeight;
      const filterLoadScale = 1 - sourceFilter.filterLoad * upperWeight * 0.025;
      const characterGainScale = 1 + (voiceCharacter.upperFormantGainScale - 1) * upperWeight;
      const mouthWeight = index === 0 ? 1 : index === 1 ? 0.3 : 0;
      const mouthFrequencyScale = 1 + (producerTuning.mouthScale - 1) * mouthWeight;
      const targetFrequency = band.frequency * mouthFrequencyScale * voiceCharacter.formantScale;
      const nextFrequency = nextBands?.[index]?.frequency ?? null;
      return {
        startHz: onsetFormantFrequency(event.syllable, index, targetFrequency),
        targetHz: targetFrequency,
        nextHz: nextFrequency === null
          ? null
          : nextFrequency * mouthFrequencyScale * voiceCharacter.formantScale,
        bandwidth: band.bandwidth * (1 + Math.abs(producerTuning.mouthScale - 1) * 0.35),
        gain: band.gain * timbreScale * filterLoadScale * characterGainScale,
      };
    }),
    style: {
      glottalOpenQuotient: dynamicOpenQuotient,
      glottalSpeedQuotient: dynamicSpeedQuotient,
      vibratoRateHz: model.vibratoRateHz,
      vibratoDepthCents: model.vibratoDepthCents,
      vibratoDelaySeconds: model.vibratoDelaySeconds,
      intensityModDepth: model.intensityModDepth,
      jitterCents: model.jitterCents
        * producerTuning.jitterScale
        * voiceCharacter.jitterScale
        * vocalDirector.jitterScale,
      shimmerDepth: model.shimmerDepth,
      presenceFrequency: model.presenceFrequency,
      presenceGain: model.presenceGain,
      breathLevel: dynamicBreathLevel,
      attackSeconds: model.attackSeconds
        * producerTuning.attackTimeScale
        * voiceCharacter.attackScale
        * vocalDirector.attackScale,
      releaseSeconds: model.releaseSeconds * vocalDirector.releaseScale,
      onsetPitchCents: model.onsetPitchCents * scoreAligned.transitionPreservation,
      radiationFrequency: model.radiationFrequency,
      radiationGainDb: model.radiationGainDb,
      doubleDelaySeconds: ensembleControl.doubleLevel > 0
        ? ensembleControl.doubleDelaySeconds
        : model.doubleDelaySeconds,
      doubleLevel: clamp(ensembleControl.doubleLevel * ensembleScale, 0, 0.22),
    },
  };
}

export class VocalWorkletBridge {
  private node: AudioWorkletNode | null = null;
  private harmonyNode: AudioWorkletNode | null = null;
  private harmonyGain: GainNode | null = null;
  private statusValue: VocalWorkletStatus = 'idle';

  get status(): VocalWorkletStatus {
    return this.statusValue;
  }

  async initialize(context: AudioContext, destination: AudioNode, moduleUrl: string): Promise<void> {
    if (this.statusValue === 'ready' || this.statusValue === 'loading') return;
    if (!context.audioWorklet || typeof AudioWorkletNode === 'undefined') {
      this.statusValue = 'unavailable';
      return;
    }

    this.statusValue = 'loading';
    try {
      await context.audioWorklet.addModule(moduleUrl);
      const node = new AudioWorkletNode(context, 'sound-wave-vocal-processor', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });
      const harmonyNode = new AudioWorkletNode(context, 'sound-wave-vocal-processor', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });
      const harmonyGain = context.createGain();
      harmonyGain.gain.value = 0.72;
      node.connect(destination);
      harmonyNode.connect(harmonyGain);
      harmonyGain.connect(destination);
      this.node = node;
      this.harmonyNode = harmonyNode;
      this.harmonyGain = harmonyGain;
      this.statusValue = 'ready';
    } catch (error) {
      console.warn('Local vocal AudioWorklet unavailable', error);
      this.node = null;
      this.harmonyNode = null;
      this.harmonyGain = null;
      this.statusValue = 'unavailable';
    }
  }

  schedule(event: VocalWorkletEvent): void {
    if (!this.node || this.statusValue !== 'ready') return;
    this.node.port.postMessage({ type: 'schedule', event });

    const harmonyTargetHz = event.ensemble.harmonyTargetHz;
    if (!this.harmonyNode || harmonyTargetHz === null || event.ensemble.harmonyGainScale <= 0) return;
    const harmonyEvent: VocalWorkletEvent = {
      ...event,
      when: event.when + 0.006,
      targetHz: harmonyTargetHz,
      glideFromHz: null,
      velocity: clamp(event.velocity * event.ensemble.harmonyGainScale, 0.14, 0.62),
      articulate: false,
      phraseStart: false,
      phoneme: {
        ...event.phoneme,
        noiseMix: event.phoneme.noiseMix * 0.72,
        aspirationMix: event.phoneme.aspirationMix * 0.78,
      },
      karaoke: {
        ...event.karaoke,
        scoopCents: event.karaoke.scoopCents * 0.45,
        fallCents: event.karaoke.fallCents * 0.45,
        vibratoGain: event.karaoke.vibratoGain * 0.82,
      },
      style: {
        ...event.style,
        jitterCents: event.style.jitterCents * 0.72,
        breathLevel: event.style.breathLevel * 0.82,
        doubleLevel: 0,
      },
      ensemble: {
        label: 'LEAD',
        harmonyTargetHz: null,
        harmonyGainScale: 0,
      },
    };
    this.harmonyNode.port.postMessage({ type: 'schedule', event: harmonyEvent });
  }

  clear(): void {
    this.node?.port.postMessage({ type: 'clear' });
    this.harmonyNode?.port.postMessage({ type: 'clear' });
  }

  dispose(): void {
    this.node?.port.postMessage({ type: 'clear' });
    this.harmonyNode?.port.postMessage({ type: 'clear' });
    this.node?.disconnect();
    this.harmonyNode?.disconnect();
    this.harmonyGain?.disconnect();
    this.node = null;
    this.harmonyNode = null;
    this.harmonyGain = null;
    this.statusValue = 'idle';
  }
}
