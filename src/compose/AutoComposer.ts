import {
  chordAtDegree,
  scaleFor,
  voiceLeadingDistance,
  type ChordState,
  type Mode,
  type PitchClass,
  type Tonality,
} from '../core/music';
import type { JamVoice } from '../jam/JamMachine';
import {
  genreStyle,
  type GenreId,
  type GenreStyleProfile,
} from './GenreStyle';

export interface AutoComposeSettings {
  tonic: PitchClass;
  mode: Mode;
  bpm: number;
  density: number;
  bars: number;
  seed: number;
  genre: GenreId;
  subgenre: string;
}

export interface CompositionChord {
  bar: number;
  degree: number;
  chord: ChordState;
}

export interface CompositionNote {
  step: number;
  pitch: PitchClass;
  octave: number;
  durationSteps: number;
  velocity: number;
}

export interface CompositionDrum {
  step: number;
  voice: Extract<JamVoice, 'kick' | 'snare' | 'hat' | 'clap'>;
  velocity: number;
}

export interface AutoComposition {
  settings: AutoComposeSettings;
  chords: CompositionChord[];
  melody: CompositionNote[];
  drums: CompositionDrum[];
  title: string;
}

const STEPS_PER_BAR = 16;
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

function randomSource(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let x = value;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function candidateDegrees(profile: GenreStyleProfile, barInPhrase: number): readonly number[] {
  return profile.progression[barInPhrase % profile.progression.length] ?? [0, 3, 4];
}

function chooseDegree(
  tonality: Tonality,
  previous: ChordState,
  bar: number,
  totalBars: number,
  random: () => number,
  profile: GenreStyleProfile,
): number {
  if (bar === totalBars - 1) return 0;
  const phrasePosition = bar % 4;
  const candidates = candidateDegrees(profile, phrasePosition);
  let bestDegree = candidates[0] ?? 0;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const degree of candidates) {
    const chord = chordAtDegree(tonality, degree);
    const movement = voiceLeadingDistance(previous, chord);
    const colorBonus = profile.colorDegrees.includes(degree) ? -0.11 : 0;
    const tonicPenalty = phrasePosition === 2 && chord.function === 'tonic' ? 0.2 : 0;
    const continuationBonus = phrasePosition === 3 && totalBars > 4 && chord.function === 'dominant' ? -0.16 : 0;
    const score = movement * 0.68 + tonicPenalty + colorBonus + continuationBonus + random() * 0.18;
    if (score < bestScore) {
      bestScore = score;
      bestDegree = degree;
    }
  }
  return bestDegree;
}

function buildProgression(
  settings: AutoComposeSettings,
  random: () => number,
  profile: GenreStyleProfile,
): CompositionChord[] {
  const tonality: Tonality = { tonic: settings.tonic, mode: settings.mode };
  const chords: CompositionChord[] = [];
  let previous = chordAtDegree(tonality, 0);
  for (let bar = 0; bar < settings.bars; bar += 1) {
    const degree = bar === 0 ? 0 : chooseDegree(tonality, previous, bar, settings.bars, random, profile);
    const chord = chordAtDegree(tonality, degree);
    chords.push({ bar, degree, chord });
    previous = chord;
  }
  return chords;
}

function nearestScaleTone(scale: readonly PitchClass[], from: PitchClass, random: () => number): PitchClass {
  const candidates = scale
    .map((pitch) => ({ pitch, distance: Math.min(Math.abs(pitch - from), 12 - Math.abs(pitch - from)) }))
    .sort((a, b) => a.distance - b.distance || random() - 0.5);
  return candidates[Math.floor(random() * Math.min(4, candidates.length))]?.pitch ?? from;
}

function widerScaleTone(scale: readonly PitchClass[], from: PitchClass, random: () => number): PitchClass {
  const candidates = scale
    .map((pitch) => ({ pitch, distance: Math.min(Math.abs(pitch - from), 12 - Math.abs(pitch - from)) }))
    .filter((candidate) => candidate.distance >= 3)
    .sort((a, b) => b.distance - a.distance || random() - 0.5);
  return candidates[Math.floor(random() * Math.min(3, candidates.length))]?.pitch
    ?? nearestScaleTone(scale, from, random);
}

function buildMelody(
  settings: AutoComposeSettings,
  chords: readonly CompositionChord[],
  random: () => number,
  profile: GenreStyleProfile,
): CompositionNote[] {
  const tonality: Tonality = { tonic: settings.tonic, mode: settings.mode };
  const scale = scaleFor(tonality);
  const melody: CompositionNote[] = [];
  let previousPitch: PitchClass = settings.tonic;
  const density = clamp((settings.density + profile.densityBias) * profile.melodyDensity, 0.12, 1.18);

  for (const item of chords) {
    const barStart = item.bar * STEPS_PER_BAR;
    for (let localStep = 0; localStep < STEPS_PER_BAR; localStep += 1) {
      const strongBeat = localStep % 4 === 0;
      const eighth = localStep % 2 === 0;
      const offbeat = localStep % 2 === 1;
      const strongChance = clamp(0.72 + density * 0.2, 0.55, 0.96);
      const eighthChance = clamp(0.14 + density * 0.42, 0.1, 0.72);
      const offbeatChance = clamp(density * 0.13 + profile.syncopation * 0.25, 0.03, 0.54);
      const chance = strongBeat ? strongChance : eighth ? eighthChance : offbeat ? offbeatChance : density * 0.1;
      if (random() > chance) continue;

      const chordTones = item.chord.tones;
      let pitch: PitchClass;
      if (strongBeat || random() < 0.58 + (1 - profile.syncopation) * 0.12) {
        const options = chordTones
          .map((tone) => ({ tone, distance: Math.min(Math.abs(tone - previousPitch), 12 - Math.abs(tone - previousPitch)) }))
          .sort((a, b) => a.distance - b.distance);
        pitch = options[Math.floor(random() * Math.min(2, options.length))]?.tone ?? item.chord.root;
      } else if (random() < profile.leapChance) {
        pitch = widerScaleTone(scale, previousPitch, random);
      } else {
        pitch = nearestScaleTone(scale, previousPitch, random);
      }

      const upwardLeap = pitch < previousPitch && previousPitch - pitch > 6;
      const downwardLeap = pitch > previousPitch && pitch - previousPitch > 6;
      const octaveLiftChance = clamp(0.12 + profile.leapChance * 0.5, 0.1, 0.34);
      const octave = upwardLeap ? 5 : downwardLeap ? 4 : 4 + (random() < octaveLiftChance ? 1 : 0);
      const longTone = strongBeat && random() < profile.longNoteChance;
      const durationSteps = longTone ? (random() < profile.longNoteChance * 0.45 ? 3 : 2) : 1;
      const velocityBias = profile.melodyDrive - 1;
      melody.push({
        step: barStart + localStep,
        pitch,
        octave,
        durationSteps,
        velocity: clamp((strongBeat ? 0.82 + random() * 0.16 : 0.5 + random() * 0.3) + velocityBias * 0.16, 0.35, 1),
      });
      previousPitch = pitch;
    }
  }
  return melody;
}

function addDrum(
  drums: CompositionDrum[],
  step: number,
  voice: CompositionDrum['voice'],
  velocity: number,
): void {
  if (velocity <= 0.05) return;
  drums.push({ step, voice, velocity: clamp(velocity, 0.1, 1) });
}

function buildDrums(
  settings: AutoComposeSettings,
  random: () => number,
  profile: GenreStyleProfile,
): CompositionDrum[] {
  const drums: CompositionDrum[] = [];
  const density = clamp(settings.density + profile.densityBias, 0.15, 1);

  for (let bar = 0; bar < settings.bars; bar += 1) {
    const start = bar * STEPS_PER_BAR;
    for (let step = 0; step < STEPS_PER_BAR; step += 1) {
      const global = start + step;

      if (profile.genre === 'rock') {
        if (step === 0 || step === 8 || ((step === 6 || step === 10) && random() < 0.24 + density * 0.34)) {
          addDrum(drums, global, 'kick', (step === 0 ? 0.96 : 0.82) * profile.kickDrive);
        }
        if (step === 4 || step === 12) addDrum(drums, global, 'snare', 0.9 * profile.snareDrive);
        if (step % 2 === 0 && random() < 0.74 + density * 0.22) {
          addDrum(drums, global, 'hat', (step % 4 === 2 ? 0.62 : 0.46) * profile.hatDrive);
        }
        continue;
      }

      if (profile.genre === 'k-pop') {
        if (step % 4 === 0 && random() < 0.56 + profile.kickDrive * 0.28) {
          addDrum(drums, global, 'kick', (step === 0 || step === 8 ? 0.94 : 0.72) * profile.kickDrive);
        }
        if ((step === 4 || step === 12)) {
          addDrum(drums, global, 'snare', 0.82 * profile.snareDrive);
          if (random() < 0.45 + profile.clapDrive * 0.32) addDrum(drums, global, 'clap', 0.64 * profile.clapDrive);
        }
        if (step % 2 === 0 || (step % 2 === 1 && random() < profile.syncopation * 0.3)) {
          if (random() < 0.62 + density * 0.28) addDrum(drums, global, 'hat', 0.46 * profile.hatDrive);
        }
        if ((step === 6 || step === 14) && random() < profile.syncopation * 0.7) {
          addDrum(drums, global, 'kick', 0.62 * profile.kickDrive);
        }
        continue;
      }

      if (profile.genre === 'game-music') {
        const intense = profile.id === 'battle' || profile.id === 'boss-battle' || profile.id === 'racing';
        if (step === 0 || step === 8 || (intense && step % 4 === 0) || (random() < profile.syncopation * 0.16 && step % 2 === 0)) {
          addDrum(drums, global, 'kick', (step === 0 ? 0.95 : 0.72) * profile.kickDrive);
        }
        if (step === 4 || step === 12) addDrum(drums, global, 'snare', 0.82 * profile.snareDrive);
        const hatEvery = intense ? 1 : 2;
        if (step % hatEvery === 0 && random() < 0.46 + density * 0.38) {
          addDrum(drums, global, 'hat', (step % 4 === 2 ? 0.58 : 0.4) * profile.hatDrive);
        }
        continue;
      }

      // J-POP baseline: clear backbeat with modest syncopated support.
      if (step === 0 || step === 8 || (density > 0.62 && step === 10 && random() < 0.42 + profile.syncopation * 0.2)) {
        addDrum(drums, global, 'kick', (step === 0 ? 0.96 : 0.8) * profile.kickDrive);
      }
      if (step === 4 || step === 12) addDrum(drums, global, 'snare', 0.88 * profile.snareDrive);
      if (step % 2 === 0 && random() < 0.56 + density * 0.32) {
        addDrum(drums, global, 'hat', (step % 4 === 2 ? 0.62 : 0.46) * profile.hatDrive);
      }
      if ((step === 6 || step === 14) && density > 0.5 && random() < 0.28 + profile.syncopation * 0.34) {
        addDrum(drums, global, 'clap', (0.44 + density * 0.18) * profile.clapDrive);
      }
    }
  }
  return drums;
}

export function defaultComposeSettings(seed = Date.now()): AutoComposeSettings {
  return {
    tonic: 0,
    mode: 'minor',
    bpm: 108,
    density: 0.55,
    bars: 8,
    seed,
    genre: 'j-pop',
    subgenre: 'mainstream',
  };
}

export function generateComposition(settings: AutoComposeSettings): AutoComposition {
  const profile = genreStyle(settings.genre, settings.subgenre);
  const normalized: AutoComposeSettings = {
    ...settings,
    genre: profile.genre,
    subgenre: profile.id,
    bpm: clamp(Math.round(settings.bpm), 60, 190),
    density: clamp(settings.density, 0.15, 1),
    bars: clamp(Math.round(settings.bars), 4, 16),
    seed: settings.seed >>> 0,
  };
  const random = randomSource(normalized.seed);
  const chords = buildProgression(normalized, random, profile);
  const melody = buildMelody(normalized, chords, random, profile);
  const drums = buildDrums(normalized, random, profile);
  const modeName = normalized.mode.toUpperCase();
  const title = `${profile.label.toUpperCase()} · ${modeName} · ${String(normalized.seed >>> 0).slice(-4).padStart(4, '0')}`;
  return { settings: normalized, chords, melody, drums, title };
}

export function compositionStepMs(composition: Pick<AutoComposition, 'settings'>): number {
  return 60000 / composition.settings.bpm / 4;
}

export function compositionLengthSteps(composition: AutoComposition): number {
  return composition.settings.bars * STEPS_PER_BAR;
}
