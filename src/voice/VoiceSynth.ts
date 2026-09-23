import type { PitchClass } from '../core/music';
import type { VocalEvent, VocalStyle } from '../compose/VocalGenerator';
import type { VocalPhraseControl } from '../compose/VocalPhraseModel';
import { VocalWorkletBridge, vocalEventToWorklet, type VocalWorkletStatus } from '../compose/VocalWorkletBridge';
import type { VoiceCharacterPreset } from '../compose/VoiceCharacter';
import { WavCapture } from '../compose/SongExport';
import { prosodyOffset, type VoiceIntonation, type VoiceScript, type VoiceUnit } from './VoiceScript';

export interface VoiceSynthSettings {
  style: VocalStyle;
  character: VoiceCharacterPreset;
  tone: number;
  rate: number;
  pitch: number;
  energy: number;
  intonation: VoiceIntonation;
}

export interface VoiceTimedUnit {
  unit: VoiceUnit;
  start: number;
  duration: number;
  pitchMidi: number;
}

export interface VoicePlaybackPlan {
  duration: number;
  units: VoiceTimedUnit[];
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

function pitchClassForMidi(midi: number): PitchClass {
  return (((Math.round(midi) % 12) + 12) % 12) as PitchClass;
}

function octaveForMidi(midi: number): number {
  return Math.floor(Math.round(midi) / 12) - 1;
}

function unitDuration(unit: VoiceUnit, rate: number): number {
  const consonantHeavy = /^[kstshfpgbzcjtd]/i.test(unit.syllable);
  const nasal = unit.syllable === 'n' || unit.syllable === 'nn';
  const base = nasal ? 0.16 : consonantHeavy ? 0.18 : 0.17;
  return clamp(base / clamp(rate, 0.55, 1.8), 0.085, 0.34);
}

function phraseControlFor(index: number, count: number, unit: VoiceUnit, energy: number): VocalPhraseControl {
  const progressStart = count <= 1 ? 0 : index / count;
  const progressEnd = count <= 1 ? 1 : (index + 1) / count;
  const crestStart = 0.9 + Math.sin(progressStart * Math.PI) * 0.08;
  const crestEnd = 0.9 + Math.sin(progressEnd * Math.PI) * 0.08;
  return {
    phraseIndex: 0,
    phraseStartStep: 0,
    phraseEndStep: count,
    progressStart,
    progressEnd,
    energyStart: clamp(crestStart * energy, 0.72, 1.16),
    energyEnd: clamp(crestEnd * energy * (unit.phraseEnd ? 0.94 : 1), 0.7, 1.16),
    centeringStart: unit.phraseEnd ? 0.025 : 0,
    centeringEnd: unit.phraseEnd ? 0.1 : 0.02,
    aspirationDepth: clamp(0.07 + (1 - energy) * 0.05, 0.05, 0.13),
    sourceTractCoupling: 0.0085,
  };
}

export class VoiceSynth {
  private context: AudioContext | null = null;
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

  plan(script: VoiceScript, settings: VoiceSynthSettings): VoicePlaybackPlan {
    const units: VoiceTimedUnit[] = [];
    let cursor = 0;
    let previousMidi = settings.pitch;

    script.units.forEach((unit, index) => {
      const offset = prosodyOffset(index, script.units.length, settings.intonation, unit.phraseStart, unit.phraseEnd);
      const microMotion = Math.sin(index * 1.71) * 0.18;
      const pitchMidi = clamp(settings.pitch + offset + microMotion, 40, 82);
      const duration = unitDuration(unit, settings.rate);
      units.push({ unit, start: cursor, duration, pitchMidi });
      cursor += duration + unit.pauseAfter / clamp(settings.rate, 0.7, 1.4);
      previousMidi = pitchMidi;
    });

    void previousMidi;
    return { duration: cursor + 0.08, units };
  }

  async play(script: VoiceScript, settings: VoiceSynthSettings): Promise<VoicePlaybackPlan> {
    await this.unlock();
    if (!this.context) throw new Error('Voice AudioContext unavailable');
    if (this.worklet.status !== 'ready') throw new Error('Voice AudioWorklet unavailable');

    this.worklet.clear();
    const plan = this.plan(script, settings);
    const startAt = this.context.currentTime + 0.055;
    let previousMidi: number | null = null;

    plan.units.forEach((timed, index) => {
      const unit = timed.unit;
      const roundedMidi = Math.round(timed.pitchMidi);
      const event: VocalEvent = {
        step: index,
        pitch: pitchClassForMidi(roundedMidi),
        octave: octaveForMidi(roundedMidi),
        durationSteps: 1,
        velocity: clamp(0.7 * settings.energy, 0.4, 0.95),
        syllable: unit.syllable,
        vowel: unit.vowel,
        nextVowel: plan.units[index + 1]?.unit.vowel ?? null,
        articulate: true,
        phraseStart: unit.phraseStart,
        phraseEnd: unit.phraseEnd,
        glideFromMidi: previousMidi,
      };

      const phrase = phraseControlFor(index, Math.max(1, plan.units.length), unit, settings.energy);
      const workletEvent = vocalEventToWorklet(
        event,
        settings.style,
        startAt + timed.start,
        timed.duration,
        phrase,
        undefined,
        undefined,
        index % 16,
        { preset: settings.character, tone: settings.tone },
      );

      workletEvent.karaoke = {
        ...workletEvent.karaoke,
        scoopCents: 0,
        fallCents: unit.phraseEnd ? 3 : 0,
        vibratoGain: 0,
      };
      workletEvent.style = {
        ...workletEvent.style,
        vibratoDepthCents: 0,
        intensityModDepth: Math.min(workletEvent.style.intensityModDepth, 0.008),
        jitterCents: Math.min(workletEvent.style.jitterCents, 0.42),
        doubleLevel: 0,
        onsetPitchCents: unit.phraseStart ? 2 : 0,
      };
      workletEvent.ensemble = {
        label: 'LEAD',
        harmonyTargetHz: null,
        harmonyGainScale: 0,
      };
      workletEvent.velocity = clamp(workletEvent.velocity * settings.energy, 0.32, 0.95);
      this.worklet.schedule(workletEvent);
      previousMidi = roundedMidi;
    });

    return plan;
  }

  async renderWav(script: VoiceScript, settings: VoiceSynthSettings): Promise<Blob> {
    await this.unlock();
    if (!this.context || !this.limiter) throw new Error('Voice render unavailable');
    this.stop();
    this.wavCapture.start(this.context, this.limiter);
    const plan = await this.play(script, settings);
    await new Promise<void>((resolve) => window.setTimeout(resolve, Math.ceil((plan.duration + 0.18) * 1000)));
    return this.wavCapture.finish();
  }
}
