import type { PitchClass } from '../core/music';
import type { VocalEvent, VocalStyle } from '../compose/VocalGenerator';
import type { VocalPhraseControl } from '../compose/VocalPhraseModel';
import { VocalWorkletBridge, vocalEventToWorklet, type VocalWorkletStatus } from '../compose/VocalWorkletBridge';
import type { VoiceCharacterPreset } from '../compose/VoiceCharacter';
import { WavCapture } from '../compose/SongExport';
import {
  prosodyOffsetForUnit,
  type VoiceIntonation,
  type VoiceScript,
  type VoiceUnit,
} from './VoiceScript';

export interface VoiceSynthSettings {
  style: VocalStyle;
  character: VoiceCharacterPreset;
  tone: number;
  rate: number;
  pitch: number;
  energy: number;
  intonation: VoiceIntonation;
}

export interface VoiceProsodyEdits {
  pitchOffsets?: readonly number[];
  energyScales?: readonly number[];
  durationScales?: readonly number[];
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
}

export interface VoicePlaybackPlan {
  duration: number;
  units: VoiceTimedUnit[];
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

function unitDuration(unit: VoiceUnit, rate: number): number {
  const consonantHeavy = /^(k|ky|s|sh|t|ch|ts|h|f|p|g|gy|z|j|d|b)/i.test(unit.syllable);
  const nasal = unit.moraicN;
  let base = nasal ? 0.155 : consonantHeavy ? 0.174 : 0.165;

  if (unit.longVowel) base *= 1.28;
  if (unit.devoiced) base *= 0.76;
  if (unit.accentEnd && !unit.phraseEnd) base *= 1.035;
  if (unit.phraseEnd) base *= 1.1;

  return clamp(base / clamp(rate, 0.55, 1.8), 0.072, 0.38);
}

function unitEnergyScale(unit: VoiceUnit): number {
  let scale = 1;
  if (unit.accentStart) scale *= 1.02;
  if (unit.accentEnd) scale *= 0.98;
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
  const boundaryRelease = unit.phraseEnd ? 0.91 : unit.accentEnd ? 0.97 : 1;

  return {
    phraseIndex: 0,
    phraseStartStep: 0,
    phraseEndStep: unit.phraseCount,
    progressStart,
    progressEnd,
    energyStart: clamp(crestStart * energy, 0.58, 1.32),
    energyEnd: clamp(crestEnd * energy * boundaryRelease, 0.55, 1.32),
    centeringStart: unit.phraseEnd ? 0.025 : 0,
    centeringEnd: unit.phraseEnd ? 0.11 : unit.accentEnd ? 0.045 : 0.015,
    aspirationDepth: clamp(0.068 + (1 - energy) * 0.05 + (unit.devoiced ? 0.035 : 0), 0.05, 0.145),
    sourceTractCoupling: unit.devoiced ? 0.0065 : 0.0085,
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

  plan(
    script: VoiceScript,
    settings: VoiceSynthSettings,
    prosodyInput: VoiceProsodyInput = {},
  ): VoicePlaybackPlan {
    const edits = normalizeProsodyEdits(prosodyInput);
    const units: VoiceTimedUnit[] = [];
    let cursor = 0;

    script.units.forEach((unit, index) => {
      if (unit.geminateBefore) {
        cursor += clamp(0.068 / clamp(settings.rate, 0.7, 1.5), 0.042, 0.105);
      }

      const offset = prosodyOffsetForUnit(unit, index, script.units.length, settings.intonation);
      const manualPitchOffset = clamp(edits.pitchOffsets?.[index] ?? 0, -3.5, 3.5);
      const manualEnergyScale = clamp(edits.energyScales?.[index] ?? 1, 0.45, 1.55);
      const manualDurationScale = clamp(edits.durationScales?.[index] ?? 1, 0.6, 1.65);

      const pitchMidi = clamp(settings.pitch + offset + manualPitchOffset, 40, 82);
      const duration = clamp(unitDuration(unit, settings.rate) * manualDurationScale, 0.055, 0.54);
      const energyScale = clamp(unitEnergyScale(unit) * manualEnergyScale, 0.28, 1.55);

      units.push({
        unit,
        start: cursor,
        duration,
        pitchMidi,
        energyScale,
        manualPitchOffset,
        manualEnergyScale,
        manualDurationScale,
      });

      cursor += duration + unit.pauseAfter / clamp(settings.rate, 0.7, 1.4);
    });

    return { duration: cursor + 0.08, units };
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
    let previousPitchMidi: number | null = null;

    plan.units.forEach((timed, index) => {
      const unit = timed.unit;
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
        startAt + timed.start,
        timed.duration,
        phrase,
        undefined,
        undefined,
        index % 16,
        { preset: settings.character, tone: settings.tone },
      );

      workletEvent.targetHz = midiToHz(timed.pitchMidi);
      workletEvent.glideFromHz = previousPitchMidi === null || unit.phraseStart
        ? null
        : midiToHz(previousPitchMidi);

      workletEvent.karaoke = {
        ...workletEvent.karaoke,
        scoopCents: unit.phraseStart ? 1.5 : 0,
        fallCents: unit.phraseEnd ? 2.5 : unit.accentEnd ? 1 : 0,
        vibratoGain: 0,
      };

      workletEvent.style = {
        ...workletEvent.style,
        vibratoDepthCents: 0,
        intensityModDepth: Math.min(workletEvent.style.intensityModDepth, 0.006),
        jitterCents: Math.min(workletEvent.style.jitterCents, 0.34),
        shimmerDepth: Math.min(workletEvent.style.shimmerDepth, 0.004),
        doubleLevel: 0,
        onsetPitchCents: unit.phraseStart ? 1.8 : 0,
        attackSeconds: workletEvent.style.attackSeconds * (unit.geminateBefore ? 0.78 : 1),
        releaseSeconds: workletEvent.style.releaseSeconds * (unit.phraseEnd ? 1.08 : 0.88),
      };

      if (unit.geminateBefore) {
        workletEvent.phoneme = {
          ...workletEvent.phoneme,
          closureSeconds: Math.max(workletEvent.phoneme.closureSeconds, 0.042),
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
      workletEvent.velocity = clamp(workletEvent.velocity, 0.16, 0.98);
      this.worklet.schedule(workletEvent);
      previousPitchMidi = timed.pitchMidi;
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
