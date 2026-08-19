import type { ChordState, PitchClass, PlayerIntent } from '../core/music';

export interface SoundEngineOptions {
  masterGain?: number;
  tempo?: number;
}

export type PercussionVoice = 'kick' | 'tick' | 'accent' | 'hit' | 'miss';

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

function midiForPitchClass(pitch: PitchClass, octave = 4): number {
  return 12 * (octave + 1) + pitch;
}

function midiToHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

export class SoundEngine {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private percussionBus: GainNode | null = null;
  private currentChordGain: GainNode | null = null;
  private masterGain: number;
  private tempo: number;

  constructor(options: SoundEngineOptions = {}) {
    this.masterGain = options.masterGain ?? 0.72;
    this.tempo = options.tempo ?? 116;
  }

  get isReady(): boolean {
    return this.context !== null && this.context.state === 'running';
  }

  get currentTime(): number {
    return this.context?.currentTime ?? 0;
  }

  get bpm(): number {
    return this.tempo;
  }

  setTempo(bpm: number): void {
    this.tempo = clamp(bpm, 70, 190);
  }

  async unlock(): Promise<void> {
    if (!this.context) {
      const AudioContextCtor = window.AudioContext;
      this.context = new AudioContextCtor({ latencyHint: 'interactive' });
      this.master = this.context.createGain();
      this.musicBus = this.context.createGain();
      this.percussionBus = this.context.createGain();

      this.master.gain.value = this.masterGain;
      this.musicBus.gain.value = 0.48;
      this.percussionBus.gain.value = 0.7;

      this.musicBus.connect(this.master);
      this.percussionBus.connect(this.master);
      this.master.connect(this.context.destination);
    }

    if (this.context.state !== 'running') {
      await this.context.resume();
    }

    const buffer = this.context.createBuffer(1, 1, this.context.sampleRate);
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.master!);
    source.start();
  }

  suspend(): void {
    void this.context?.suspend();
  }

  resume(): void {
    void this.context?.resume();
  }

  setMasterGain(value: number): void {
    this.masterGain = clamp(value, 0, 1);
    if (!this.context || !this.master) return;
    this.master.gain.setTargetAtTime(this.masterGain, this.context.currentTime, 0.02);
  }

  playChord(chord: ChordState, tension: number, when = this.currentTime): void {
    if (!this.context || !this.musicBus) return;

    const now = Math.max(this.context.currentTime, when);
    if (this.currentChordGain) {
      this.currentChordGain.gain.cancelScheduledValues(now);
      this.currentChordGain.gain.setTargetAtTime(0.0001, now, 0.06);
    }

    const group = this.context.createGain();
    const filter = this.context.createBiquadFilter();
    group.gain.setValueAtTime(0.0001, now);
    group.gain.exponentialRampToValueAtTime(0.24, now + 0.035);
    group.gain.exponentialRampToValueAtTime(0.08, now + 1.45);
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(900 + tension * 2800, now);
    filter.Q.value = 0.7 + tension * 2.2;
    group.connect(filter);
    filter.connect(this.musicBus);
    this.currentChordGain = group;

    chord.tones.forEach((pitch, index) => {
      const oscillator = this.context!.createOscillator();
      const voiceGain = this.context!.createGain();
      oscillator.type = index === 0 ? 'triangle' : 'sine';
      const octave = index === 0 ? 3 : 4;
      oscillator.frequency.value = midiToHz(midiForPitchClass(pitch, octave));
      oscillator.detune.value = index % 2 === 0 ? -3 : 3;
      voiceGain.gain.value = index === 0 ? 0.7 : 0.42;
      oscillator.connect(voiceGain);
      voiceGain.connect(group);
      oscillator.start(now);
      oscillator.stop(now + 1.8);
    });
  }

  playBass(pitch: PitchClass, accent = 0.7, when = this.currentTime): void {
    if (!this.context || !this.musicBus) return;
    const now = Math.max(this.context.currentTime, when);
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = 'sawtooth';
    oscillator.frequency.setValueAtTime(midiToHz(midiForPitchClass(pitch, 2)), now);
    oscillator.frequency.exponentialRampToValueAtTime(midiToHz(midiForPitchClass(pitch, 2)) * 0.995, now + 0.18);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.11 + accent * 0.08, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);
    oscillator.connect(gain);
    gain.connect(this.musicBus);
    oscillator.start(now);
    oscillator.stop(now + 0.28);
  }

  playPercussion(voice: PercussionVoice, accent = 0.7, when = this.currentTime): void {
    if (!this.context || !this.percussionBus) return;
    const now = Math.max(this.context.currentTime, when);
    const gain = this.context.createGain();
    const oscillator = this.context.createOscillator();
    const level = clamp(accent, 0.1, 1);

    switch (voice) {
      case 'kick':
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(125, now);
        oscillator.frequency.exponentialRampToValueAtTime(48, now + 0.13);
        gain.gain.setValueAtTime(0.22 * level, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.15);
        break;
      case 'tick':
        oscillator.type = 'square';
        oscillator.frequency.value = 1250;
        gain.gain.setValueAtTime(0.045 * level, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.035);
        break;
      case 'accent':
        oscillator.type = 'triangle';
        oscillator.frequency.setValueAtTime(720, now);
        oscillator.frequency.exponentialRampToValueAtTime(390, now + 0.08);
        gain.gain.setValueAtTime(0.11 * level, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);
        break;
      case 'hit':
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(520, now);
        oscillator.frequency.exponentialRampToValueAtTime(880, now + 0.055);
        gain.gain.setValueAtTime(0.1 * level, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
        break;
      case 'miss':
        oscillator.type = 'sawtooth';
        oscillator.frequency.setValueAtTime(180, now);
        oscillator.frequency.exponentialRampToValueAtTime(92, now + 0.09);
        gain.gain.setValueAtTime(0.07 * level, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.11);
        break;
    }

    oscillator.connect(gain);
    gain.connect(this.percussionBus);
    oscillator.start(now);
    oscillator.stop(now + 0.3);
  }

  playIntentAccent(intent: PlayerIntent, pitch: PitchClass, intensity: number, when = this.currentTime): void {
    if (!this.context || !this.musicBus) return;
    const now = Math.max(this.context.currentTime, when);
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    const baseMidi = midiForPitchClass(pitch, 5);
    const level = 0.055 + clamp(intensity, 0, 1) * 0.085;
    let duration = 0.24;

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(level, now + 0.008);

    switch (intent) {
      case 'resolve':
        oscillator.type = 'triangle';
        oscillator.frequency.setValueAtTime(midiToHz(baseMidi + 12), now);
        oscillator.frequency.exponentialRampToValueAtTime(midiToHz(baseMidi), now + 0.16);
        duration = 0.34;
        break;
      case 'delay':
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(midiToHz(baseMidi + 7), now);
        oscillator.detune.setValueAtTime(-9, now);
        oscillator.detune.linearRampToValueAtTime(9, now + 0.32);
        duration = 0.46;
        break;
      case 'diverge':
        oscillator.type = 'triangle';
        oscillator.frequency.setValueAtTime(midiToHz(baseMidi + 3), now);
        oscillator.frequency.exponentialRampToValueAtTime(midiToHz(baseMidi + 8), now + 0.11);
        duration = 0.3;
        break;
      case 'intensify':
        oscillator.type = 'sawtooth';
        oscillator.frequency.setValueAtTime(midiToHz(baseMidi), now);
        oscillator.frequency.exponentialRampToValueAtTime(midiToHz(baseMidi + 12), now + 0.13);
        duration = 0.27;
        break;
    }

    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain);
    gain.connect(this.musicBus);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.04);
  }

  playEnergyPulse(
    pitch: PitchClass,
    flow: number,
    tension: number,
    accent = 0.7,
    when = this.currentTime,
  ): void {
    if (!this.context || !this.musicBus || flow < 0.58) return;
    const now = Math.max(this.context.currentTime, when);
    const oscillator = this.context.createOscillator();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    const lift = flow >= 0.82 ? 12 : 7;
    oscillator.type = tension >= 0.7 ? 'sawtooth' : 'sine';
    oscillator.frequency.value = midiToHz(midiForPitchClass(pitch, 4) + lift);
    filter.type = 'lowpass';
    filter.frequency.value = 1200 + flow * 3000 + tension * 1200;
    filter.Q.value = 0.6 + tension * 1.5;
    const level = (0.018 + (flow - 0.58) * 0.11) * clamp(accent, 0.25, 1);
    gain.gain.setValueAtTime(Math.max(0.0001, level), now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.1 + flow * 0.08);
    oscillator.connect(filter);
    filter.connect(gain);
    gain.connect(this.musicBus);
    oscillator.start(now);
    oscillator.stop(now + 0.22);
  }

  playDrop(pitch: PitchClass, when = this.currentTime): void {
    if (!this.context || !this.musicBus || !this.percussionBus) return;
    const now = Math.max(this.context.currentTime, when);
    const sub = this.context.createOscillator();
    const subGain = this.context.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(midiToHz(midiForPitchClass(pitch, 2)) * 1.6, now);
    sub.frequency.exponentialRampToValueAtTime(midiToHz(midiForPitchClass(pitch, 1)), now + 0.28);
    subGain.gain.setValueAtTime(0.24, now);
    subGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.42);
    sub.connect(subGain);
    subGain.connect(this.musicBus);
    sub.start(now);
    sub.stop(now + 0.46);
    this.playPercussion('accent', 1, now);
  }
}
