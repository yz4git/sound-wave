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
  vocaloidExpressionFor,
  type VocaloidExpressionControl,
} from './VocaloidExpression';

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
  vocaloid: VocaloidExpressionControl;
  spectral: VocalSpectralEnvelopeControl;
  sourceFilter: VocalSourceFilterCouplingControl;
  producerTuning: ProducerTuningControl;
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
): VocalWorkletEvent {
  const model = VOCAL_STYLE_MODELS[style];
  const bands = formantsFor(event.vowel, style);
  const nextBands = event.nextVowel === null ? null : formantsFor(event.nextVowel, style);
  const targetHz = midiToHz(midiForPitchClass(event.pitch, event.octave));
  const normalizedDuration = Math.max(0.11, duration);
  const producerTuning = producerTuningFor(
    event,
    phraseControl,
    producerProfile,
    producerState,
    localStep,
    normalizedDuration,
  );
  const rawPhoneme = phonemeTimingFor(event.syllable);
  const consonantScale = producerTuning.consonantLengthScale;
  const phoneme: JapanesePhonemeTiming = {
    ...rawPhoneme,
    closureSeconds: rawPhoneme.closureSeconds * consonantScale,
    burstSeconds: rawPhoneme.burstSeconds * clamp(consonantScale, 0.88, 1.1),
    fricationSeconds: rawPhoneme.fricationSeconds * consonantScale,
    voicingDelaySeconds: rawPhoneme.voicingDelaySeconds * consonantScale,
    noiseMix: clamp(rawPhoneme.noiseMix * producerTuning.articulationScale, 0, 1),
  };
  const baseKaraoke = karaokeSingingControlFor(event, normalizedDuration, phraseControl);
  const karaoke: KaraokeSingingControl = {
    ...baseKaraoke,
    scoopCents: clamp(baseKaraoke.scoopCents + producerTuning.scoopCentsAdd, 0, 14),
    fallCents: clamp(baseKaraoke.fallCents + producerTuning.fallCentsAdd, 0, 12),
    vibratoGain: clamp(baseKaraoke.vibratoGain * producerTuning.vibratoScale, 0, 1),
  };
  const baseResonance = vocalResonanceControlFor(event, phraseControl);
  const plannedExpression = vocaloidExpressionFor(event, phoneme, normalizedDuration, phraseControl);

  const requestedPreRoll = plannedExpression.consonantPreRollSeconds
    + producerTuning.timingLeadSeconds;
  const appliedPreRoll = Math.min(requestedPreRoll, Math.max(0, when));
  const scheduledWhen = when - appliedPreRoll;
  const scheduledDuration = normalizedDuration + appliedPreRoll;
  const vocaloid: VocaloidExpressionControl = {
    ...plannedExpression,
    consonantPreRollSeconds: appliedPreRoll,
  };
  const baseSpectral = spectralEnvelopeControlFor(event, normalizedDuration, phraseControl, vocaloid);
  const sourceFilter = sourceFilterCouplingFor(event, targetHz, phraseControl, baseSpectral);

  const spectral: VocalSpectralEnvelopeControl = {
    ...baseSpectral,
    frequencySmoothing: clamp(
      baseSpectral.frequencySmoothing * (1 + sourceFilter.filterLoad * 0.08),
      0.08,
      0.2,
    ),
    spectralTiltDepth: clamp(
      baseSpectral.spectralTiltDepth * (1 + sourceFilter.sourceTiltDepth * 1.6),
      0.006,
      0.024,
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
      * vocaloid.sustainTimbreMotion
      * (1 + sourceFilter.filterLoad * 0.08),
    gainMotion: baseResonance.gainMotion
      * vocaloid.sustainTimbreMotion
      * (1 - sourceFilter.highPitchCompensation * 0.07),
    vibratoResonanceDepth: baseResonance.vibratoResonanceDepth
      * clamp(vocaloid.sustainTimbreMotion, 0.8, 1.08)
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
      + sourceFilter.sourceTiltDepth * 0.08,
    0.48,
    0.82,
  );
  const dynamicSpeedQuotient = clamp(
    model.glottalSpeedQuotient
      + sourceFilter.speedQuotientOffset
      - sourceFilter.sourceTiltDepth * 0.045,
    0.48,
    0.84,
  );
  const dynamicBreathLevel = model.breathLevel
    * vocaloid.aspirationScale
    * (1 + sourceFilter.aspirationCoupling * 0.18)
    * producerTuning.airScale;

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
    vocaloid,
    spectral,
    sourceFilter,
    producerTuning,
    phrase: {
      progressStart: phraseControl.progressStart,
      progressEnd: phraseControl.progressEnd,
      energyStart: clamp(
        phraseControl.energyStart
          * vocaloid.energyStartScale
          * producerTuning.dynamicsStartScale,
        0.72,
        1.18,
      ),
      energyEnd: clamp(
        phraseControl.energyEnd
          * vocaloid.energyEndScale
          * producerTuning.dynamicsEndScale,
        0.72,
        1.18,
      ),
      centeringStart: clamp(phraseControl.centeringStart * vocaloid.centeringScale, 0, 0.22),
      centeringEnd: clamp(phraseControl.centeringEnd * vocaloid.centeringScale, 0, 0.22),
      aspirationDepth: clamp(
        phraseControl.aspirationDepth
          * vocaloid.aspirationScale
          * (1 + sourceFilter.aspirationCoupling * 0.1)
          * producerTuning.airScale,
        0.05,
        0.15,
      ),
      sourceTractCoupling: dynamicSourceTractCoupling,
    },
    formants: bands.map((band, index) => {
      const upperWeight = index / Math.max(1, bands.length - 1);
      const timbreScale = 1 + (vocaloid.upperFormantScale - 1) * upperWeight;
      const filterLoadScale = 1 - sourceFilter.filterLoad * upperWeight * 0.025;
      const mouthWeight = index === 0 ? 1 : index === 1 ? 0.3 : 0;
      const mouthFrequencyScale = 1 + (producerTuning.mouthScale - 1) * mouthWeight;
      const targetFrequency = band.frequency * mouthFrequencyScale;
      const nextFrequency = nextBands?.[index]?.frequency ?? null;
      return {
        startHz: onsetFormantFrequency(event.syllable, index, targetFrequency),
        targetHz: targetFrequency,
        nextHz: nextFrequency === null ? null : nextFrequency * mouthFrequencyScale,
        bandwidth: band.bandwidth * (1 + Math.abs(producerTuning.mouthScale - 1) * 0.35),
        gain: band.gain * timbreScale * filterLoadScale,
      };
    }),
    style: {
      glottalOpenQuotient: dynamicOpenQuotient,
      glottalSpeedQuotient: dynamicSpeedQuotient,
      vibratoRateHz: model.vibratoRateHz,
      vibratoDepthCents: model.vibratoDepthCents,
      vibratoDelaySeconds: model.vibratoDelaySeconds,
      intensityModDepth: model.intensityModDepth,
      jitterCents: model.jitterCents * producerTuning.jitterScale,
      shimmerDepth: model.shimmerDepth,
      presenceFrequency: model.presenceFrequency,
      presenceGain: model.presenceGain,
      breathLevel: dynamicBreathLevel,
      attackSeconds: model.attackSeconds * producerTuning.attackTimeScale,
      releaseSeconds: model.releaseSeconds,
      onsetPitchCents: model.onsetPitchCents * vocaloid.transitionPreservation,
      radiationFrequency: model.radiationFrequency,
      radiationGainDb: model.radiationGainDb,
      doubleDelaySeconds: model.doubleDelaySeconds,
      doubleLevel: model.doubleLevel,
    },
  };
}

export class VocalWorkletBridge {
  private node: AudioWorkletNode | null = null;
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
      node.connect(destination);
      this.node = node;
      this.statusValue = 'ready';
    } catch (error) {
      console.warn('Local vocal AudioWorklet unavailable', error);
      this.node = null;
      this.statusValue = 'unavailable';
    }
  }

  schedule(event: VocalWorkletEvent): void {
    if (!this.node || this.statusValue !== 'ready') return;
    this.node.port.postMessage({ type: 'schedule', event });
  }

  clear(): void {
    this.node?.port.postMessage({ type: 'clear' });
  }

  dispose(): void {
    if (!this.node) return;
    this.node.port.postMessage({ type: 'clear' });
    this.node.disconnect();
    this.node = null;
    this.statusValue = 'idle';
  }
}
