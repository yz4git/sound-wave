import type { PitchClass } from '../core/music';
import type { AutoComposition } from './AutoComposer';
import type { ArrangementBar, BassPattern, ChordPattern } from './GenreArrangement';
import { genreStyle, type GenreStyleProfile } from './GenreStyle';
import { vocalActiveAtStep, type VocalEvent, type VocalStyle } from './VocalGenerator';
import { buildVocalPhraseControls, neutralPhraseControl, type VocalPhraseControl } from './VocalPhraseModel';
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

function fifthPitch(root: PitchClass): PitchClass {
  return ((root + 7) % 12) as PitchClass;
}

function chordTrigger(pattern: ChordPattern, localStep: number): boolean {
  if (pattern === 'sustain') return localStep === 0;
  if (pattern === 'pulse') return localStep % 4 === 0;
  if (pattern === 'offbeat-stabs') return localStep === 2 || localStep === 6 || localStep === 10 || localStep === 14;
  return localStep % 2 === 0;
}

function chordDurationSteps(pattern: ChordPattern): number {
  if (pattern === 'sustain') return 15.5;
  if (pattern === 'pulse') return 3.3;
  if (pattern === 'offbeat-stabs') return 1.55;
  if (pattern === 'power-pulse') return 1.55;
  return 1.45;
}

function bassTrigger(pattern: BassPattern, localStep: number): boolean {
  if (pattern === 'root-pulse' || pattern === 'root-fifth') return localStep === 0 || localStep === 8;
  if (pattern === 'syncopated-808') return localStep === 0 || localStep === 6 || localStep === 10 || localStep === 14;
  return localStep % 2 === 0;
}

function bassPitch(pattern: BassPattern, root: PitchClass, localStep: number): PitchClass {
  if (pattern === 'root-fifth') return localStep === 8 ? fifthPitch(root) : root;
  if (pattern === 'eighth-drive' || pattern === 'ostinato') return localStep % 4 === 2 ? fifthPitch(root) : root;
  if (pattern === 'syncopated-808') return localStep === 10 ? fifthPitch(root) : root;
  return root;
}

function bassDurationSteps(pattern: BassPattern): number {
  if (pattern === 'root-pulse' || pattern === 'root-fifth') return 3.25;
  if (pattern === 'syncopated-808') return 2.15;
  return 1.5;
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
  private phraseControlLine: readonly VocalEvent[] | null = null;
  private phraseControls: ReadonlyMap<number, VocalPhraseControl> = new Map<number, VocalPhraseControl>();

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

      // Presence Reset stays neutral. Genre character comes from source,
      // arrangement and articulation rather than a fixed presence shelf.
      vocalPresence.type = 'peaking';
      vocalPresence.frequency.value = 2480;
      vocalPresence.Q.value = 0.62;
      vocalPresence.gain.value = 0;

      vocalAir.type = 'highshelf';
      vocalAir.frequency.value = 7200;
      vocalAir.gain.value = 0;

      vocalCompressor.threshold.value = 0;
      vocalCompressor.knee.value = 0;
      vocalCompressor.ratio.value = 1;
      vocalCompressor.attack.value = 0.003;
      vocalCompressor.release.value = 0.25;
      vocalMakeup.gain.value = 1;

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

  private phraseControlFor(line: readonly VocalEvent[], event: VocalEvent): VocalPhraseControl {
    if (this.phraseControlLine !== line) {
      this.phraseControlLine = line;
      this.phraseControls = buildVocalPhraseControls(line);
    }
    return this.phraseControls.get(event.step) ?? neutralPhraseControl(event);
  }

  private scheduleVocalDucking(active: boolean, when: number): void {
    if (!this.context || !this.musicBus || !this.drumBus) return;
    const start = Math.max(this.context.currentTime, when);
    const musicTarget = active ? 0.53 : 0.55;
    const drumTarget = active ? 0.69 : 0.7;
    const timeConstant = active ? 0.06 : 0.14;
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

  private chordOscillatorType(profile: GenreStyleProfile, index: number): OscillatorType {
    if (profile.genre === 'rock') return index === 0 ? 'sawtooth' : 'triangle';
    if (profile.genre === 'game-music' && (profile.id === 'battle' || profile.id === 'boss-battle')) {
      return index === 0 ? 'triangle' : 'sawtooth';
    }
    if (profile.genre === 'k-pop') return index === 0 ? 'triangle' : 'sine';
    return index === 0 ? 'triangle' : 'sine';
  }

  playChord(
    tones: readonly PitchClass[],
    tension: number,
    duration: number,
    when: number,
    profile: GenreStyleProfile,
  ): void {
    if (!this.context || !this.musicBus) return;
    const start = Math.max(this.context.currentTime, when);
    const group = this.context.createGain();
    const filter = this.context.createBiquadFilter();
    const drive = clamp(profile.chordDrive, 0.55, 1.25);
    const rockShort = profile.genre === 'rock' ? 0.72 : 1;
    const kpopShort = profile.genre === 'k-pop' ? 0.8 : 1;
    const sustainScale = rockShort * kpopShort;
    const peak = 0.11 * drive;
    group.gain.setValueAtTime(0.0001, start);
    group.gain.exponentialRampToValueAtTime(peak, start + (profile.genre === 'rock' ? 0.016 : 0.03));
    group.gain.exponentialRampToValueAtTime(Math.max(0.018, 0.032 * drive), start + Math.max(0.1, duration * 0.65 * sustainScale));
    group.gain.exponentialRampToValueAtTime(0.0001, start + Math.max(0.18, duration * sustainScale));
    filter.type = 'lowpass';
    const brightness = profile.genre === 'rock'
      ? 1550
      : profile.genre === 'k-pop'
        ? 2200
        : profile.genre === 'game-music'
          ? 2050
          : 1750;
    filter.frequency.value = brightness + clamp(tension, 0, 1) * 2200;
    filter.Q.value = 0.65 + tension * 1.15;
    group.connect(filter);
    filter.connect(this.musicBus);

    tones.forEach((pitch, index) => {
      const osc = this.context!.createOscillator();
      const voiceGain = this.context!.createGain();
      osc.type = this.chordOscillatorType(profile, index);
      osc.frequency.value = midiToHz(midiForPitchClass(pitch, index === 0 ? 3 : 4));
      osc.detune.value = profile.genre === 'rock' ? (index % 2 === 0 ? -2 : 2) : (index % 2 === 0 ? -4 : 4);
      voiceGain.gain.value = index === 0 ? 0.68 : 0.42;
      osc.connect(voiceGain);
      voiceGain.connect(group);
      osc.start(start);
      osc.stop(start + duration * sustainScale + 0.08);
    });
  }

  playBass(
    pitch: PitchClass,
    duration: number,
    velocity: number,
    when: number,
    profile: GenreStyleProfile,
  ): void {
    if (!this.context || !this.musicBus) return;
    const start = Math.max(this.context.currentTime, when);
    const osc = this.context.createOscillator();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    osc.type = profile.genre === 'rock' ? 'square' : profile.genre === 'k-pop' ? 'sine' : 'sawtooth';
    osc.frequency.value = midiToHz(midiForPitchClass(pitch, 2));
    filter.type = 'lowpass';
    const startCutoff = profile.genre === 'k-pop' ? 320 : profile.genre === 'rock' ? 520 : 610;
    const endCutoff = profile.genre === 'k-pop' ? 92 : profile.genre === 'rock' ? 190 : 165;
    filter.frequency.setValueAtTime(startCutoff, start);
    filter.frequency.exponentialRampToValueAtTime(endCutoff, start + Math.min(0.28, duration));
    filter.Q.value = profile.genre === 'k-pop' ? 2.4 : 3.6;
    const drive = clamp(profile.bassDrive, 0.5, 1.25);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.105 * drive * clamp(velocity, 0.2, 1), start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + Math.max(0.12, duration));
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.musicBus);
    osc.start(start);
    osc.stop(start + duration + 0.03);
  }

  playMelody(
    pitch: PitchClass,
    octave: number,
    duration: number,
    velocity: number,
    when: number,
    profile: GenreStyleProfile,
  ): void {
    if (!this.context || !this.musicBus) return;
    const start = Math.max(this.context.currentTime, when);
    const osc = this.context.createOscillator();
    const gain = this.context.createGain();
    const filter = this.context.createBiquadFilter();
    osc.type = profile.genre === 'game-music'
      ? (profile.id === 'puzzle' ? 'sine' : 'triangle')
      : 'triangle';
    osc.frequency.value = midiToHz(midiForPitchClass(pitch, octave));
    filter.type = 'lowpass';
    filter.frequency.value = profile.genre === 'k-pop'
      ? 3400
      : profile.genre === 'game-music'
        ? 3150
        : profile.genre === 'rock'
          ? 2350
          : 2850;
    filter.Q.value = profile.genre === 'k-pop' ? 0.7 : 0.5;
    const drive = clamp(profile.melodyDrive, 0.55, 1.25);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.062 * drive * clamp(velocity, 0.2, 1), start + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + Math.max(0.06, duration));
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.musicBus);
    osc.start(start);
    osc.stop(start + duration + 0.025);
  }

  playDrum(
    voice: 'kick' | 'snare' | 'hat' | 'clap',
    velocity: number,
    when: number,
    profile: GenreStyleProfile,
  ): void {
    if (!this.context || !this.drumBus) return;
    const start = Math.max(this.context.currentTime, when);
    const level = clamp(velocity, 0.1, 1);

    if (voice === 'kick') {
      const osc = this.context.createOscillator();
      const gain = this.context.createGain();
      osc.type = 'sine';
      const startHz = profile.genre === 'k-pop' ? 165 : profile.genre === 'rock' ? 132 : 145;
      const endHz = profile.genre === 'k-pop' ? 42 : profile.genre === 'rock' ? 50 : 46;
      const decay = profile.genre === 'k-pop' ? 0.16 : profile.genre === 'rock' ? 0.13 : 0.18;
      osc.frequency.setValueAtTime(startHz, start);
      osc.frequency.exponentialRampToValueAtTime(endHz, start + Math.min(decay, 0.16));
      gain.gain.setValueAtTime(0.27 * level, start);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + decay);
      osc.connect(gain);
      gain.connect(this.drumBus);
      osc.start(start);
      osc.stop(start + decay + 0.02);
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

    if (voice === 'hat') {
      const frequency = profile.genre === 'rock' ? 5900 : profile.genre === 'k-pop' ? 7600 : 6500;
      burst(0, profile.genre === 'rock' ? 0.06 : 0.05, frequency, 0.09);
    } else if (voice === 'snare') {
      const frequency = profile.genre === 'rock' ? 1650 : profile.genre === 'k-pop' ? 2100 : 1800;
      burst(0, profile.genre === 'rock' ? 0.16 : 0.14, frequency, 0.18);
    } else {
      const base = profile.genre === 'k-pop' ? 3000 : 2500;
      burst(0, 0.05, base, 0.11);
      burst(0.026, 0.07, base + 500, 0.072);
      burst(0.052, 0.08, base + 900, 0.054);
    }
  }

  private scheduleChordPattern(
    composition: AutoComposition,
    bar: number,
    localStep: number,
    when: number,
    stepSeconds: number,
    profile: GenreStyleProfile,
    state: ArrangementBar,
  ): void {
    const chord = composition.chords[bar]?.chord;
    if (!chord || !chordTrigger(state.chordPattern, localStep)) return;

    let tones: readonly PitchClass[] = chord.tones;
    if (state.chordPattern === 'power-pulse') tones = [chord.root, fifthPitch(chord.root)];
    if (state.chordPattern === 'arpeggio-pulse') {
      const index = Math.floor(localStep / 2) % Math.max(1, chord.tones.length);
      tones = [chord.tones[index] ?? chord.root];
    }

    this.playChord(
      tones,
      chord.tension,
      stepSeconds * chordDurationSteps(state.chordPattern),
      when,
      profile,
    );
  }

  private scheduleBassPattern(
    composition: AutoComposition,
    bar: number,
    localStep: number,
    when: number,
    stepSeconds: number,
    profile: GenreStyleProfile,
    state: ArrangementBar,
  ): void {
    const chord = composition.chords[bar]?.chord;
    if (!chord || !bassTrigger(state.bassPattern, localStep)) return;
    const velocity = (localStep === 0 ? 0.9 : 0.7) * state.energy;
    this.playBass(
      bassPitch(state.bassPattern, chord.root, localStep),
      stepSeconds * bassDurationSteps(state.bassPattern),
      velocity,
      when,
      profile,
    );
  }

  scheduleStep(
    composition: AutoComposition,
    step: number,
    when: number,
    vocalLine: readonly VocalEvent[] = [],
    vocalStyle: VocalStyle = 'warm',
  ): void {
    const profile = genreStyle(composition.settings.genre, composition.settings.subgenre);
    const stepSeconds = 60 / composition.settings.bpm / 4;
    const bar = Math.floor(step / 16);
    const localStep = step % 16;
    const state = composition.arrangement[bar] ?? composition.arrangement[0];
    const vocalsAtStep = vocalLine.filter((vocal) => vocal.step === step);
    const vocalActive = vocalActiveAtStep(vocalLine, step) && this.vocalWorklet.status === 'ready';

    this.scheduleVocalDucking(vocalActive, when);

    if (state) {
      this.scheduleChordPattern(composition, bar, localStep, when, stepSeconds, profile, state);
      this.scheduleBassPattern(composition, bar, localStep, when, stepSeconds, profile, state);
    }

    for (const drum of composition.drums) {
      if (drum.step === step) this.playDrum(drum.voice, drum.velocity, when, profile);
    }
    for (const note of composition.melody) {
      if (note.step === step) {
        const melodyVelocity = vocalActive ? note.velocity * 0.45 : note.velocity * 0.9;
        this.playMelody(note.pitch, note.octave, stepSeconds * note.durationSteps * 0.88, melodyVelocity, when, profile);
      }
    }
    for (const vocal of vocalsAtStep) {
      const duration = stepSeconds * vocal.durationSteps * 0.98;
      const phraseControl = this.phraseControlFor(vocalLine, vocal);
      const sectionEnergy = state?.energy ?? 1;
      const styledPhrase: VocalPhraseControl = {
        ...phraseControl,
        energyStart: clamp(phraseControl.energyStart * profile.vocalEnergy * sectionEnergy, 0.7, 1.18),
        energyEnd: clamp(phraseControl.energyEnd * profile.vocalEnergy * sectionEnergy, 0.7, 1.18),
      };
      const workletEvent = vocalEventToWorklet(
        vocal,
        vocalStyle,
        when,
        duration,
        styledPhrase,
        profile,
        state,
        localStep,
      );
      workletEvent.phoneme = {
        ...workletEvent.phoneme,
        noiseMix: clamp(workletEvent.phoneme.noiseMix * profile.vocalArticulation, 0, 1),
        aspirationMix: clamp(workletEvent.phoneme.aspirationMix * (2 - profile.vocalArticulation * 0.72), 0, 0.5),
      };
      workletEvent.velocity = clamp(workletEvent.velocity * profile.vocalEnergy * sectionEnergy, 0.3, 1);
      this.vocalWorklet.schedule(workletEvent);
    }
  }
}
