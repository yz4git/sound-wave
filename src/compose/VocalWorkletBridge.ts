import type { VocalEvent, VocalStyle } from './VocalGenerator';
import { phonemeTimingFor, type JapanesePhonemeTiming } from './JapanesePhoneme';
import { karaokeSingingControlFor, type KaraokeSingingControl } from './KaraokeSinging';
import { VOCAL_STYLE_MODELS, formantsFor, onsetFormantFrequency } from './VocalModel';
import { neutralPhraseControl, type VocalPhraseControl } from './VocalPhraseModel';
import { vocalResonanceControlFor, type VocalResonanceControl } from './VocalResonance';

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
): VocalWorkletEvent {
  const model = VOCAL_STYLE_MODELS[style];
  const bands = formantsFor(event.vowel, style);
  const nextBands = event.nextVowel === null ? null : formantsFor(event.nextVowel, style);
  const targetHz = midiToHz(midiForPitchClass(event.pitch, event.octave));
  const phoneme = phonemeTimingFor(event.syllable);
  const normalizedDuration = Math.max(0.11, duration);
  const karaoke = karaokeSingingControlFor(event, normalizedDuration, phraseControl);
  const resonance = vocalResonanceControlFor(event, phraseControl);

  return {
    when,
    duration: normalizedDuration,
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
    phrase: {
      progressStart: phraseControl.progressStart,
      progressEnd: phraseControl.progressEnd,
      energyStart: phraseControl.energyStart,
      energyEnd: phraseControl.energyEnd,
      centeringStart: phraseControl.centeringStart,
      centeringEnd: phraseControl.centeringEnd,
      aspirationDepth: phraseControl.aspirationDepth,
      sourceTractCoupling: phraseControl.sourceTractCoupling,
    },
    formants: bands.map((band, index) => ({
      startHz: onsetFormantFrequency(event.syllable, index, band.frequency),
      targetHz: band.frequency,
      nextHz: nextBands?.[index]?.frequency ?? null,
      bandwidth: band.bandwidth,
      gain: band.gain,
    })),
    style: {
      glottalOpenQuotient: model.glottalOpenQuotient,
      glottalSpeedQuotient: model.glottalSpeedQuotient,
      vibratoRateHz: model.vibratoRateHz,
      vibratoDepthCents: model.vibratoDepthCents,
      vibratoDelaySeconds: model.vibratoDelaySeconds,
      intensityModDepth: model.intensityModDepth,
      jitterCents: model.jitterCents,
      shimmerDepth: model.shimmerDepth,
      presenceFrequency: model.presenceFrequency,
      presenceGain: model.presenceGain,
      breathLevel: model.breathLevel,
      attackSeconds: model.attackSeconds,
      releaseSeconds: model.releaseSeconds,
      onsetPitchCents: model.onsetPitchCents,
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
