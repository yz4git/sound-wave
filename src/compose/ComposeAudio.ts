import type { PitchClass } from '../core/music';
import type { AutoComposition } from './AutoComposer';

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
  private drumBus: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private noise: AudioBuffer | null = null;

  get currentTime(): number {
    return this.context?.currentTime ?? 0;
  }

  get isReady(): boolean {
    return this.context !== null && this.context.state === 'running';
  }

  async unlock(): Promise<void> {
    if (!this.context) {
      this.context = new AudioContext({ latencyHint: 'interactive' });
      this.master = this.context.createGain();
      this.musicBus = this.context.createGain();
      this.drumBus = this.context.createGain();
      this.compressor = this.context.createDynamicsCompressor();
      this.master.gain.value = 0.72;
      this.musicBus.gain.value = 0.72;
      this.drumBus.gain.value = 0.78;
      this.compressor.threshold.value = -12;
      this.compressor.ratio.value = 4;
      this.compressor.attack.value = 0.004;
      this.compressor.release.value = 0.18;
      this.musicBus.connect(this.master);
      this.drumBus.connect(this.master);
      this.master.connect(this.compressor);
      this.compressor.connect(this.context.destination);
      this.noise = this.makeNoiseBuffer();
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
    const duration = 0.5;
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
    group.gain.exponentialRampToValueAtTime(0.12, start + 0.03);
    group.gain.exponentialRampToValueAtTime(0.035, start + Math.max(0.12, duration * 0.65));
    group.gain.exponentialRampToValueAtTime(0.0001, start + Math.max(0.2, duration));
    filter.type = 'lowpass';
    filter.frequency.value = 1100 + clamp(tension, 0, 1) * 2600;
    filter.Q.value = 0.7 + tension * 1.4;
    group.connect(filter);
    filter.connect(this.musicBus);

    tones.forEach((pitch, index) => {
      const osc = this.context!.createOscillator();
      const voiceGain = this.context!.createGain();
      osc.type = index === 0 ? 'triangle' : 'sine';
      osc.frequency.value = midiToHz(midiForPitchClass(pitch, index === 0 ? 3 : 4));
      osc.detune.value = index % 2 === 0 ? -4 : 4;
      voiceGain.gain.value = index === 0 ? 0.72 : 0.46;
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
    filter.frequency.setValueAtTime(620, start);
    filter.frequency.exponentialRampToValueAtTime(170, start + Math.min(0.28, duration));
    filter.Q.value = 4;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.12 * clamp(velocity, 0.2, 1), start + 0.008);
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
    filter.frequency.value = 3000;
    filter.Q.value = 0.5;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.07 * clamp(velocity, 0.2, 1), start + 0.006);
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
      gain.gain.setValueAtTime(0.3 * level, start);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.18);
      osc.connect(gain);
      gain.connect(this.drumBus);
      osc.start(start);
      osc.stop(start + 0.2);
      return;
    }

    if (!this.noise) return;
    const burst = (offset: number, duration: number, frequency: number, gainValue: number): void => {
      if (!this.context || !this.drumBus || !this.noise) return;
      const source = this.context.createBufferSource();
      const filter = this.context.createBiquadFilter();
      const gain = this.context.createGain();
      source.buffer = this.noise;
      filter.type = voice === 'hat' ? 'highpass' : 'bandpass';
      filter.frequency.value = frequency;
      filter.Q.value = voice === 'hat' ? 0.6 : 0.9;
      gain.gain.setValueAtTime(gainValue * level, start + offset);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + duration);
      source.connect(filter);
      filter.connect(gain);
      gain.connect(this.drumBus);
      source.start(start + offset);
      source.stop(start + offset + duration + 0.02);
    };

    if (voice === 'hat') burst(0, 0.05, 6500, 0.1);
    else if (voice === 'snare') burst(0, 0.14, 1800, 0.2);
    else {
      burst(0, 0.05, 2500, 0.12);
      burst(0.026, 0.07, 3000, 0.08);
      burst(0.052, 0.08, 3400, 0.06);
    }
  }

  scheduleStep(composition: AutoComposition, step: number, when: number): void {
    const stepSeconds = 60 / composition.settings.bpm / 4;
    const bar = Math.floor(step / 16);
    const localStep = step % 16;
    if (localStep === 0) {
      const chord = composition.chords[bar]?.chord;
      if (chord) {
        this.playChord(chord.tones, chord.tension, stepSeconds * 15.5, when);
        this.playBass(chord.root, stepSeconds * 3.4, 0.9, when);
      }
    } else if (localStep === 8) {
      const chord = composition.chords[bar]?.chord;
      if (chord) this.playBass(chord.root, stepSeconds * 2.5, 0.66, when);
    }

    for (const drum of composition.drums) {
      if (drum.step === step) this.playDrum(drum.voice, drum.velocity, when);
    }
    for (const note of composition.melody) {
      if (note.step === step) {
        this.playMelody(note.pitch, note.octave, stepSeconds * note.durationSteps * 0.88, note.velocity, when);
      }
    }
  }
}
