import type { PitchClass } from '../core/music';
import type { AutoComposition } from './AutoComposer';
import type { VocalEvent, VocalStyle } from './VocalGenerator';
import {
  VOCAL_STYLE_MODELS,
  deterministicOnsetCents,
  formantsFor,
  glottalHarmonicSeries,
  onsetFormantFrequency,
} from './VocalModel';

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
  private readonly vocalWaves = new Map<VocalStyle, PeriodicWave>();

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
      this.vocalBus = this.context.createGain();
      this.drumBus = this.context.createGain();
      this.compressor = this.context.createDynamicsCompressor();
      this.master.gain.value = 0.72;
      this.musicBus.gain.value = 0.59;
      this.vocalBus.gain.value = 0.78;
      this.drumBus.gain.value = 0.73;
      this.compressor.threshold.value = -14;
      this.compressor.ratio.value = 3.2;
      this.compressor.attack.value = 0.005;
      this.compressor.release.value = 0.22;
      this.musicBus.connect(this.master);
      this.vocalBus.connect(this.master);
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
    const duration = 1.25;
    const buffer = this.context.createBuffer(1, Math.floor(this.context.sampleRate * duration), this.context.sampleRate);
    const channel = buffer.getChannelData(0);
    let seed = 0xace1;
    for (let index = 0; index < channel.length; index += 1) {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      channel[index] = seed / 4294967296 * 2 - 1;
    }
    return buffer;
  }

  private vocalWave(style: VocalStyle): PeriodicWave | null {
    if (!this.context) return null;
    const cached = this.vocalWaves.get(style);
    if (cached) return cached;
    const imag = glottalHarmonicSeries(style, 48);
    const real = new Float32Array(imag.length);
    const wave = this.context.createPeriodicWave(real, imag, { disableNormalization: false });
    this.vocalWaves.set(style, wave);
    return wave;
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

  private playConsonantAttack(syllable: string, velocity: number, fundamental: number, when: number): void {
    if (!this.context || !this.vocalBus) return;
    const initial = syllable.charAt(0).toLowerCase();
    const level = clamp(velocity, 0.3, 1);

    if (initial === 'm' || initial === 'n') {
      const murmur = this.context.createOscillator();
      const resonator = this.context.createBiquadFilter();
      const gain = this.context.createGain();
      murmur.type = 'triangle';
      murmur.frequency.value = fundamental;
      resonator.type = 'lowpass';
      resonator.frequency.value = initial === 'm' ? 620 : 950;
      resonator.Q.value = 1.2;
      gain.gain.setValueAtTime(0.0001, when);
      gain.gain.exponentialRampToValueAtTime(0.026 * level, when + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.052);
      murmur.connect(resonator);
      resonator.connect(gain);
      gain.connect(this.vocalBus);
      murmur.start(when);
      murmur.stop(when + 0.06);
      return;
    }

    if (!this.noise || !['l', 'r', 'y'].includes(initial)) return;
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    source.buffer = this.noise;
    filter.type = 'bandpass';
    filter.frequency.value = initial === 'l' ? 1650 : initial === 'r' ? 2200 : 3100;
    filter.Q.value = 1.4;
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(0.0045 * level, when + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.026);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.vocalBus);
    source.start(when);
    source.stop(when + 0.032);
  }

  private playBreath(level: number, velocity: number, start: number, end: number): void {
    if (!this.context || !this.vocalBus || !this.noise || level <= 0) return;
    const breath = this.context.createBufferSource();
    const highpass = this.context.createBiquadFilter();
    const breathGain = this.context.createGain();
    breath.buffer = this.noise;
    breath.loop = true;
    highpass.type = 'highpass';
    highpass.frequency.value = 2900;
    highpass.Q.value = 0.55;
    breathGain.gain.setValueAtTime(0.0001, start);
    breathGain.gain.exponentialRampToValueAtTime(level * clamp(velocity, 0.3, 1), start + 0.035);
    breathGain.gain.setValueAtTime(level * clamp(velocity, 0.3, 1) * 0.72, Math.max(start + 0.04, end - 0.07));
    breathGain.gain.exponentialRampToValueAtTime(0.0001, end);
    breath.connect(highpass);
    highpass.connect(breathGain);
    breathGain.connect(this.vocalBus);
    breath.start(start);
    breath.stop(end + 0.015);
  }

  private addMicroVariation(
    detune: AudioParam,
    amplitude: AudioParam,
    jitterCents: number,
    shimmerDepth: number,
    start: number,
    end: number,
  ): void {
    if (!this.context || !this.noise) return;

    const jitter = this.context.createBufferSource();
    const jitterFilter = this.context.createBiquadFilter();
    const jitterGain = this.context.createGain();
    jitter.buffer = this.noise;
    jitter.loop = true;
    jitterFilter.type = 'lowpass';
    jitterFilter.frequency.value = 11;
    jitterFilter.Q.value = 0.52;
    jitterGain.gain.value = jitterCents;
    jitter.connect(jitterFilter);
    jitterFilter.connect(jitterGain);
    jitterGain.connect(detune);

    const shimmer = this.context.createBufferSource();
    const shimmerFilter = this.context.createBiquadFilter();
    const shimmerGain = this.context.createGain();
    shimmer.buffer = this.noise;
    shimmer.loop = true;
    shimmerFilter.type = 'lowpass';
    shimmerFilter.frequency.value = 7.5;
    shimmerFilter.Q.value = 0.5;
    shimmerGain.gain.value = shimmerDepth;
    shimmer.connect(shimmerFilter);
    shimmerFilter.connect(shimmerGain);
    shimmerGain.connect(amplitude);

    jitter.start(start, (start * 0.137) % this.noise.duration);
    shimmer.start(start, (start * 0.263 + 0.17) % this.noise.duration);
    jitter.stop(end + 0.02);
    shimmer.stop(end + 0.02);
  }

  playVocal(event: VocalEvent, style: VocalStyle, duration: number, when: number): void {
    if (!this.context || !this.vocalBus) return;
    const model = VOCAL_STYLE_MODELS[style];
    const start = Math.max(this.context.currentTime, when);
    const noteDuration = Math.max(0.11, duration);
    const end = start + noteDuration;
    const fundamental = midiToHz(midiForPitchClass(event.pitch, event.octave));
    const source = this.context.createOscillator();
    const sourceGain = this.context.createGain();
    const voiceEnvelope = this.context.createGain();
    const vibrato = this.context.createOscillator();
    const vibratoDepth = this.context.createGain();
    const pitchDrift = this.context.createOscillator();
    const pitchDriftDepth = this.context.createGain();
    const intensityDepth = this.context.createGain();
    const wave = this.vocalWave(style);
    const legato = !event.articulate;
    const sourceLevel = style === 'bright' ? 0.068 : style === 'airy' ? 0.054 : 0.063;
    const attackSeconds = legato ? 0.008 : model.attackSeconds;
    const releaseSeconds = event.phraseEnd ? model.releaseSeconds * 1.28 : legato ? 0.045 : model.releaseSeconds;
    const attackEnd = start + Math.min(attackSeconds, noteDuration * 0.25);
    const releaseStart = Math.max(attackEnd + 0.012, end - Math.min(releaseSeconds, noteDuration * 0.44));
    const formantTransitionEnd = start + Math.min(legato ? 0.035 : 0.075, noteDuration * 0.3);

    if (wave) source.setPeriodicWave(wave);
    else source.type = 'sawtooth';

    if (event.glideFromMidi !== null) {
      const glideFrom = midiToHz(event.glideFromMidi);
      const glideEnd = start + Math.min(0.085, noteDuration * 0.3);
      source.frequency.setValueAtTime(Math.max(20, glideFrom), start);
      source.frequency.exponentialRampToValueAtTime(Math.max(20, fundamental), glideEnd);
      source.detune.setValueAtTime(0, start);
    } else {
      source.frequency.setValueAtTime(fundamental, start);
      source.detune.setValueAtTime(deterministicOnsetCents(event.step, style), start);
      source.detune.linearRampToValueAtTime(0, start + Math.min(0.06, noteDuration * 0.24));
    }

    sourceGain.gain.setValueAtTime(0.78, start);
    voiceEnvelope.gain.setValueAtTime(0.0001, start);
    voiceEnvelope.gain.exponentialRampToValueAtTime(sourceLevel * clamp(event.velocity, 0.3, 1), attackEnd);
    voiceEnvelope.gain.setValueAtTime(sourceLevel * clamp(event.velocity, 0.3, 1), releaseStart);
    voiceEnvelope.gain.exponentialRampToValueAtTime(0.0001, end);

    vibrato.type = 'sine';
    vibrato.frequency.value = model.vibratoRateHz;
    vibratoDepth.gain.setValueAtTime(0, start);
    vibratoDepth.gain.setValueAtTime(0, start + Math.min(model.vibratoDelaySeconds, noteDuration * 0.45));
    vibratoDepth.gain.linearRampToValueAtTime(
      model.vibratoDepthCents,
      start + Math.min(model.vibratoDelaySeconds + 0.085, noteDuration * 0.72),
    );
    vibrato.connect(vibratoDepth);
    vibratoDepth.connect(source.detune);

    pitchDrift.type = 'sine';
    pitchDrift.frequency.value = 0.68 + (event.step % 5) * 0.035;
    pitchDriftDepth.gain.value = style === 'bright' ? 2.2 : 3.4;
    pitchDrift.connect(pitchDriftDepth);
    pitchDriftDepth.connect(source.detune);

    intensityDepth.gain.value = model.intensityModDepth;
    vibrato.connect(intensityDepth);
    intensityDepth.connect(sourceGain.gain);
    this.addMicroVariation(source.detune, sourceGain.gain, model.jitterCents, model.shimmerDepth, start, end);
    source.connect(sourceGain);

    const formants = formantsFor(event.vowel, style);
    formants.forEach((band, index) => {
      const filter = this.context!.createBiquadFilter();
      const bandGain = this.context!.createGain();
      const onsetFrequency = event.articulate
        ? onsetFormantFrequency(event.syllable, index, band.frequency)
        : band.frequency;
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(Math.max(80, onsetFrequency), start);
      filter.frequency.exponentialRampToValueAtTime(Math.max(80, band.frequency), formantTransitionEnd);
      filter.Q.value = clamp(band.frequency / band.bandwidth, 2, 22);
      bandGain.gain.value = band.gain;
      sourceGain.connect(filter);
      filter.connect(bandGain);
      bandGain.connect(voiceEnvelope);
    });

    const presence = this.context.createBiquadFilter();
    const presenceGain = this.context.createGain();
    presence.type = 'bandpass';
    presence.frequency.value = model.presenceFrequency;
    presence.Q.value = 4.7;
    presenceGain.gain.value = model.presenceGain;
    sourceGain.connect(presence);
    presence.connect(presenceGain);
    presenceGain.connect(voiceEnvelope);

    const rumbleCut = this.context.createBiquadFilter();
    const radiation = this.context.createBiquadFilter();
    rumbleCut.type = 'highpass';
    rumbleCut.frequency.value = 72;
    rumbleCut.Q.value = 0.55;
    radiation.type = 'highshelf';
    radiation.frequency.value = model.radiationFrequency;
    radiation.gain.value = model.radiationGainDb;
    voiceEnvelope.connect(rumbleCut);
    rumbleCut.connect(radiation);
    radiation.connect(this.vocalBus);

    if (model.doubleLevel > 0) {
      const doubleDelay = this.context.createDelay(0.05);
      const doubleGain = this.context.createGain();
      doubleDelay.delayTime.value = model.doubleDelaySeconds;
      doubleGain.gain.value = model.doubleLevel;
      radiation.connect(doubleDelay);
      doubleDelay.connect(doubleGain);
      doubleGain.connect(this.vocalBus);
    }

    if (event.articulate) this.playConsonantAttack(event.syllable, event.velocity, fundamental, start);
    const breathLevel = model.breathLevel * (event.phraseStart ? 1.22 : legato ? 0.58 : 0.82);
    this.playBreath(breathLevel, event.velocity, start, end);

    source.start(start);
    vibrato.start(start);
    pitchDrift.start(start);
    source.stop(end + 0.04);
    vibrato.stop(end + 0.04);
    pitchDrift.stop(end + 0.04);
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

    if (voice === 'hat') burst(0, 0.05, 6500, 0.1);
    else if (voice === 'snare') burst(0, 0.14, 1800, 0.2);
    else {
      burst(0, 0.05, 2500, 0.12);
      burst(0.026, 0.07, 3000, 0.08);
      burst(0.052, 0.08, 3400, 0.06);
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
    const hasVocal = vocalsAtStep.length > 0;

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
        const melodyVelocity = hasVocal ? note.velocity * 0.16 : note.velocity;
        this.playMelody(note.pitch, note.octave, stepSeconds * note.durationSteps * 0.88, melodyVelocity, when);
      }
    }
    for (const vocal of vocalsAtStep) {
      this.playVocal(vocal, vocalStyle, stepSeconds * vocal.durationSteps * 0.98, when);
    }
  }
}
