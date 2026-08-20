import type { PitchClass } from '../core/music';
import type { AutoComposition } from './AutoComposer';
import { vocalActiveAtStep, type VocalEvent, type VocalStyle } from './VocalGenerator';
import {
  VocalWorkletBridge,
  vocalEventToWorklet,
  type VocalWorkletStatus,
} from './VocalWorkletBridge';

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

function midiToHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

function midiForPitchClass(pitch: PitchClass, octave: number): number {
  return 12 * (octave + 1) + pitch;
}

export class ComposeAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private vocalBus: GainNode | null = null;
  private drumBus: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private noise: AudioBuffer | null = null;
  private readonly vocalWorklet = new VocalWorkletBridge();

  get currentTime(): number {
    return this.context?.currentTime ?? 0;
  }

  get isReady(): boolean {
    return this.context !== null && this.context.state === 'running';
  }

  get vocalEngineStatus(): VocalWorkletStatus {
    return this.vocalWorklet.status;
  }

  async unlock(): Promise<void> {
    if (!this.context) {
      this.context = new AudioContext({ latencyHint: 'interactive' });
      this.master = this.context.createGain();
      this.musicBus = this.context.createGain();
      this.vocalBus = this.context.createGain();
      this.drumBus = this.context.createGain();
      this.compressor = this.context.createDynamicsCompressor();

      const vocalHighpass = this.context.createBiquadFilter();
      const vocalPresence = this.context.createBiquadFilter();
      const vocalAir = this.context.createBiquadFilter();
      const vocalCompressor = this.context.createDynamicsCompressor();
      const vocalMakeup = this.context.createGain();

      this.master.gain.value = 0.72;
      this.musicBus.gain.value = 0.55;
      this.vocalBus.gain.value = 0.98;
      this.drumBus.gain.value = 0.7;

      vocalHighpass.type = 'highpass';
      vocalHighpass.frequency.value = 68;
      vocalHighpass.Q.value = 0.48;

      vocalPresence.type = 'peaking';
      vocalPresence.frequency.value = 2480;
      vocalPresence.Q.value = 0.62;
      vocalPresence.gain.value = 1.55;

      vocalAir.type = 'highshelf';
      vocalAir.frequency.value = 7200;
      vocalAir.gain.value = 0.55;

      vocalCompressor.threshold.value = -26;
      vocalCompressor.knee.value = 20;
      vocalCompressor.ratio.value = 2;
      vocalCompressor.attack.value = 0.018;
      vocalCompressor.release.value = 0.3;
      vocalMakeup.gain.value = 1.08;

      this.compressor.threshold.value = -9;
      this.compressor.knee.value = 12;
      this.compressor.ratio.value = 2.2;
      this.compressor.attack.value = 0.008;
      this.compressor.release.value = 0.22;

      this.musicBus.connect(this.master);
      this.vocalBus.connect(vocalHighpass);
      vocalHighpass.connect(vocalPresence);
      vocalPresence.connect(vocalAir);
      vocalAir.connect(vocalCompressor);
      vocalCompressor.connect(vocalMakeup);
      vocalMakeup.connect(this.master);
      this.drumBus.connect(this.master);
      this.master.connect(this.compressor);
      this.compressor.connect(this.context.destination);
      this.noise = this.makeNoiseBuffer();

      const moduleUrl = new URL('vocal-worklet.js', document.baseURI).toString();
      await this.vocalWorklet.initialize(this.context, this.vocalBus, moduleUrl);
    }
    if (this.context.state !== 'running') await this.context.resume();
  }

  suspend(): void {
    void this.context?.suspend();
  }

  resume(): void {
    void this.context?.resume();
  }

  clearVocalStream(): void {
    this.vocalWorklet.clear();
  }

  private scheduleVocalDucking(active: boolean, when: number): void {
    if (!this.context || !this.musicBus || !this.drumBus) return;
    const start = Math.max(this.context.currentTime, when);
    const musicTarget = active ? 0.44 : 0.55;
    const drumTarget = active ? 0.62 : 0.7;
    const timeConstant = active ? 0.05 : 0.14;
    this.musicBus.gain.setTargetAtTime(musicTarget, start, timeConstant);
    this.drumBus.gain.setTargetAtTime(drumTarget, start, timeConstant);
  }

  private makeNoiseBuffer(): AudioBuffer | null {
    if (!this.context) return null;
    const duration = 0.75;
    const buffer = this.context.createBuffer(1, Math.floor(this.context.sampleRate * duration), this.context.sampleRate);
    const channel = buffer.getChannelData(0);
    let seed = 0xace1;
    for (let index = 0; index < channel.length; index += 1) {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      channel[index] = seed / 4294967296 * 2 - 1;
    }
    return buffer;
  }

  playChord(tones: readonly PitchClass[], tension: number, duration: number, when: number): void {
    if (!this.context || !this.musicBus) return;
    const start = Math.max(this.context.currentTime, when);
    const group = this.context.createGain();
    const filter = this.context.createBiquadFilter();
    group.gain.setValueAtTime(0.0001, start);
    group.gain.exponentialRampToValueAtTime(0.11, start + 0.03);
    group.gain.exponentialRampToValueAtTime(0.032, start + Math.max(0.12, duration * 0.65));
    group.gain.exponentialRampToValueAtTime(0.0001, start + Math.max(0.2, duration));
    filter.type = 'lowpass';
    filter.frequency.value = 1050 + clamp(tension, 0, 1) * 2450;
    filter.Q.value = 0.7 + tension * 1.3;
    group.connect(filter);
    filter.connect(this.musicBus);

    tones.forEach((pitch, index) => {
      const osc = this.context!.createOscillator();
      const voiceGain = this.context!.createGain();
      osc.type = index === 0 ? 'triangle' : 'sine';
      osc.frequency.value = midiToHz(midiForPitchClass(pitch, index === 0 ? 3 : 4));
      osc.detune.value = index % 2 === 0 ? -4 : 4;
      voiceGain.gain.value = index === 0 ? 0.7 : 0.44;
      osc.connect(voiceGain);
      voiceGain.connect(group);
      osc.start(start);
      osc.stop(start + duration + 0.06);
    });
  }

  playBass(pitch: PitchClass, duration: number, velocity: number, when: number): void {
    if (!this.context || !this.musicBus) return;
    const start = Math.max(this.context.currentTime, when);
    const osc = this.context.createOscillator();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    osc.type = 'sawtooth';
    osc.frequency.value = midiToHz(midiForPitchClass(pitch, 2));
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(590, start);
    filter.frequency.exponentialRampToValueAtTime(165, start + Math.min(0.28, duration));
    filter.Q.value = 4;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.11 * clamp(velocity, 0.2, 1), start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + Math.max(0.12, duration));
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.musicBus);
    osc.start(start);
    osc.stop(start + duration + 0.03);
  }

  playMelody(pitch: PitchClass, octave: number, duration: number, velocity: number, when: number): void {
    if (!this.context || !this.musicBus) return;
    const start = Math.max(this.context.currentTime, when);
    const osc = this.context.createOscillator();
    const gain = this.context.createGain();
    const filter = this.context.createBiquadFilter();
    osc.type = 'triangle';
    osc.frequency.value = midiToHz(midiForPitchClass(pitch, octave));
    filter.type = 'lowpass';
    filter.frequency.value = 2700;
    filter.Q.value = 0.5;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.065 * clamp(velocity, 0.2, 1), start + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + Math.max(0.06, duration));
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.musicBus);
    osc.start(start);
    osc.stop(start + duration + 0.025);
  }

  playDrum(voice: 'kick' | 'snare' | 'hat' | 'clap', velocity: number, when: number): void {
    if (!this.context || !this.drumBus) return;
    const start = Math.max(this.context.currentTime, when);
    const level = clamp(velocity, 0.1, 1);

    if (voice === 'kick') {
      const osc = this.context.createOscillator();
      const gain = this.context.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(145, start);
      osc.frequency.exponentialRampToValueAtTime(46, start + 0.14);
      gain.gain.setValueAtTime(0.28 * level, start);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.18);
      osc.connect(gain);
      gain.connect(this.drumBus);
      osc.start(start);
      osc.stop(start + 0.2);
      return;
    }

    if (!this.noise) return;
    const burst = (offset: number, burstDuration: number, frequency: number, gainValue: number): void => {
      if (!this.context || !this.drumBus || !this.noise) return;
      const source = this.context.createBufferSource();
      const filter = this.context.createBiquadFilter();
      const gain = this.context.createGain();
      source.buffer = this.noise;
      filter.type = voice === 'hat' ? 'highpass' : 'bandpass';
      filter.frequency.value = frequency;
      filter.Q.value = voice === 'hat' ? 0.6 : 0.9;
      gain.gain.setValueAtTime(gainValue * level, start + offset);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + burstDuration);
      source.connect(filter);
      filter.connect(gain);
      gain.connect(this.drumBus);
      source.start(start + offset);
      source.stop(start + offset + burstDuration + 0.02);
    };

    if (voice === 'hat') burst(0, 0.05, 6500, 0.09);
    else if (voice === 'snare') burst(0, 0.14, 1800, 0.18);
    else {
      burst(0, 0.05, 2500, 0.11);
      burst(0.026, 0.07, 3000, 0.072);
      burst(0.052, 0.08, 3400, 0.054);
    }
  }

  scheduleStep(
    composition: AutoComposition,
    step: number,
    when: number,
    vocalLine: readonly VocalEvent[] = [],
    vocalStyle: VocalStyle = 'warm',
  ): void {
    const stepSeconds = 60 / composition.settings.bpm / 4;
    const bar = Math.floor(step / 16);
    const localStep = step % 16;
    const vocalsAtStep = vocalLine.filter((vocal) => vocal.step === step);
    const vocalActive = vocalActiveAtStep(vocalLine, step) && this.vocalWorklet.status === 'ready';

    this.scheduleVocalDucking(vocalActive, when);

    if (localStep === 0) {
      const chord = composition.chords[bar]?.chord;
      if (chord) {
        this.playChord(chord.tones, chord.tension, stepSeconds * 15.5, when);
        this.playBass(chord.root, stepSeconds * 3.4, 0.9, when);
      }
    } else if (localStep === 8) {
      const chord = composition.chords[bar]?.chord;
      if (chord) this.playBass(chord.root, stepSeconds * 2.5, 0.64, when);
    }

    for (const drum of composition.drums) {
      if (drum.step === step) this.playDrum(drum.voice, drum.velocity, when);
    }
    for (const note of composition.melody) {
      if (note.step === step) {
        const melodyVelocity = vocalActive ? note.velocity * 0.085 : note.velocity * 0.9;
        this.playMelody(note.pitch, note.octave, stepSeconds * note.durationSteps * 0.88, melodyVelocity, when);
      }
    }
    for (const vocal of vocalsAtStep) {
      const duration = stepSeconds * vocal.durationSteps * 0.98;
      this.vocalWorklet.schedule(vocalEventToWorklet(vocal, vocalStyle, when, duration));
    }
  }
}
