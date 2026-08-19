import type { JamVoice } from './JamMachine';

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

export class JamAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private readonly samples = new Map<number, AudioBuffer>();

  get isReady(): boolean {
    return this.context !== null && this.context.state === 'running';
  }

  get currentTime(): number {
    return this.context?.currentTime ?? 0;
  }

  async unlock(): Promise<void> {
    if (!this.context) {
      this.context = new AudioContext({ latencyHint: 'interactive' });
      this.master = this.context.createGain();
      this.compressor = this.context.createDynamicsCompressor();
      this.master.gain.value = 0.78;
      this.compressor.threshold.value = -14;
      this.compressor.knee.value = 14;
      this.compressor.ratio.value = 4;
      this.compressor.attack.value = 0.003;
      this.compressor.release.value = 0.16;
      this.master.connect(this.compressor);
      this.compressor.connect(this.context.destination);
      this.noiseBuffer = this.makeNoiseBuffer();
    }
    if (this.context.state !== 'running') await this.context.resume();
  }

  suspend(): void {
    void this.context?.suspend();
  }

  resume(): void {
    void this.context?.resume();
  }

  private makeNoiseBuffer(): AudioBuffer | null {
    if (!this.context) return null;
    const duration = 0.7;
    const buffer = this.context.createBuffer(1, Math.floor(this.context.sampleRate * duration), this.context.sampleRate);
    const data = buffer.getChannelData(0);
    let seed = 0x51f15e;
    for (let i = 0; i < data.length; i += 1) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      data[i] = ((seed / 4294967296) * 2 - 1) * (1 - i / data.length * 0.18);
    }
    return buffer;
  }

  playVoice(voice: JamVoice, velocity = 0.8, when = this.currentTime): void {
    if (!this.context || !this.master) return;
    const now = Math.max(this.context.currentTime, when);
    const level = clamp(velocity, 0.05, 1);
    switch (voice) {
      case 'kick': this.playKick(level, now); break;
      case 'snare': this.playSnare(level, now); break;
      case 'hat': this.playHat(level, now); break;
      case 'clap': this.playClap(level, now); break;
      case 'tom-low': this.playTom(118, level, now); break;
      case 'tom-high': this.playTom(196, level, now); break;
      case 'bass': this.playBass(level, now); break;
      case 'stab': this.playStab(level, now); break;
    }
  }

  private playKick(level: number, now: number): void {
    if (!this.context || !this.master) return;
    const osc = this.context.createOscillator();
    const gain = this.context.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(155, now);
    osc.frequency.exponentialRampToValueAtTime(46, now + 0.16);
    gain.gain.setValueAtTime(0.34 * level, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(now);
    osc.stop(now + 0.24);
  }

  private noiseBurst(level: number, now: number, duration: number, frequency: number, q: number): void {
    if (!this.context || !this.master || !this.noiseBuffer) return;
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    source.buffer = this.noiseBuffer;
    filter.type = 'bandpass';
    filter.frequency.value = frequency;
    filter.Q.value = q;
    gain.gain.setValueAtTime(Math.max(0.0001, level), now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    source.start(now);
    source.stop(now + Math.min(duration + 0.04, 0.68));
  }

  private playSnare(level: number, now: number): void {
    if (!this.context || !this.master) return;
    this.noiseBurst(0.23 * level, now, 0.16, 1900, 0.75);
    const osc = this.context.createOscillator();
    const gain = this.context.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(205, now);
    osc.frequency.exponentialRampToValueAtTime(128, now + 0.08);
    gain.gain.setValueAtTime(0.14 * level, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.13);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(now);
    osc.stop(now + 0.15);
  }

  private playHat(level: number, now: number): void {
    this.noiseBurst(0.11 * level, now, 0.055, 7200, 0.55);
  }

  private playClap(level: number, now: number): void {
    this.noiseBurst(0.13 * level, now, 0.055, 2450, 0.65);
    this.noiseBurst(0.09 * level, now + 0.026, 0.07, 2900, 0.72);
    this.noiseBurst(0.07 * level, now + 0.052, 0.09, 3300, 0.8);
  }

  private playTom(frequency: number, level: number, now: number): void {
    if (!this.context || !this.master) return;
    const osc = this.context.createOscillator();
    const gain = this.context.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(frequency * 1.18, now);
    osc.frequency.exponentialRampToValueAtTime(frequency, now + 0.12);
    gain.gain.setValueAtTime(0.19 * level, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(now);
    osc.stop(now + 0.32);
  }

  private playBass(level: number, now: number): void {
    if (!this.context || !this.master) return;
    const osc = this.context.createOscillator();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(73.42, now);
    osc.frequency.exponentialRampToValueAtTime(65.41, now + 0.19);
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(900, now);
    filter.frequency.exponentialRampToValueAtTime(190, now + 0.24);
    filter.Q.value = 5.5;
    gain.gain.setValueAtTime(0.18 * level, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.34);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    osc.start(now);
    osc.stop(now + 0.36);
  }

  private playStab(level: number, now: number): void {
    if (!this.context || !this.master) return;
    const group = this.context.createGain();
    const filter = this.context.createBiquadFilter();
    group.gain.setValueAtTime(0.0001, now);
    group.gain.exponentialRampToValueAtTime(0.11 * level, now + 0.005);
    group.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
    filter.type = 'bandpass';
    filter.frequency.value = 1250;
    filter.Q.value = 1.1;
    group.connect(filter);
    filter.connect(this.master);
    for (const frequency of [261.63, 311.13, 392]) {
      const osc = this.context.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = frequency;
      osc.connect(group);
      osc.start(now);
      osc.stop(now + 0.24);
    }
  }

  async loadSample(slot: number, bytes: ArrayBuffer): Promise<number> {
    await this.unlock();
    if (!this.context) throw new Error('AudioContext is unavailable');
    const decoded = await this.context.decodeAudioData(bytes.slice(0));
    this.samples.set(slot, decoded);
    return decoded.duration;
  }

  hasSample(slot: number): boolean {
    return this.samples.has(slot);
  }

  clearSample(slot: number): void {
    this.samples.delete(slot);
  }

  playSample(slot: number, velocity = 0.9, when = this.currentTime): boolean {
    if (!this.context || !this.master) return false;
    const buffer = this.samples.get(slot);
    if (!buffer) return false;
    const now = Math.max(this.context.currentTime, when);
    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    source.buffer = buffer;
    gain.gain.value = clamp(velocity, 0.05, 1);
    source.connect(gain);
    gain.connect(this.master);
    source.start(now);
    return true;
  }
}
