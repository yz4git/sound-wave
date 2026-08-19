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

export interface AutoComposeSettings {
  tonic: PitchClass;
  mode: Mode;
  bpm: number;
  density: number;
  bars: number;
  seed: number;
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

function candidateDegrees(barInPhrase: number): readonly number[] {
  switch (barInPhrase) {
    case 0: return [0, 2, 5];
    case 1: return [1, 3, 5];
    case 2: return [4, 6, 3];
    default: return [0, 4, 6];
  }
}

function modeColorDegrees(mode: Mode): readonly number[] {
  switch (mode) {
    case 'major': return [3, 5];
    case 'minor': return [5, 6];
    case 'dorian': return [5, 3];
    case 'phrygian': return [1, 6];
    case 'mixolydian': return [6, 3];
  }
}

function chooseDegree(
  tonality: Tonality,
  previous: ChordState,
  bar: number,
  totalBars: number,
  random: () => number,
): number {
  if (bar === totalBars - 1) return 0;
  const phrasePosition = bar % 4;
  const candidates = candidateDegrees(phrasePosition);
  const color = modeColorDegrees(tonality.mode);
  let bestDegree = candidates[0] ?? 0;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const degree of candidates) {
    const chord = chordAtDegree(tonality, degree);
    const movement = voiceLeadingDistance(previous, chord);
    const colorBonus = color.includes(degree) ? -0.08 : 0;
    const tonicPenalty = phrasePosition === 2 && chord.function === 'tonic' ? 0.18 : 0;
    const continuationBonus = bar === 3 && totalBars > 4 && chord.function === 'dominant' ? -0.14 : 0;
    const score = movement * 0.72 + tonicPenalty + colorBonus + continuationBonus + random() * 0.2;
    if (score < bestScore) {
      bestScore = score;
      bestDegree = degree;
    }
  }
  return bestDegree;
}

function buildProgression(settings: AutoComposeSettings, random: () => number): CompositionChord[] {
  const tonality: Tonality = { tonic: settings.tonic, mode: settings.mode };
  const chords: CompositionChord[] = [];
  let previous = chordAtDegree(tonality, 0);
  for (let bar = 0; bar < settings.bars; bar += 1) {
    const degree = bar === 0 ? 0 : chooseDegree(tonality, previous, bar, settings.bars, random);
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

function buildMelody(
  settings: AutoComposeSettings,
  chords: readonly CompositionChord[],
  random: () => number,
): CompositionNote[] {
  const tonality: Tonality = { tonic: settings.tonic, mode: settings.mode };
  const scale = scaleFor(tonality);
  const melody: CompositionNote[] = [];
  let previousPitch: PitchClass = settings.tonic;
  const density = clamp(settings.density, 0.15, 1);

  for (const item of chords) {
    const barStart = item.bar * STEPS_PER_BAR;
    for (let localStep = 0; localStep < STEPS_PER_BAR; localStep += 1) {
      const strongBeat = localStep % 4 === 0;
      const eighth = localStep % 2 === 0;
      const chance = strongBeat ? 0.86 : eighth ? 0.22 + density * 0.42 : density * 0.16;
      if (random() > chance) continue;

      const chordTones = item.chord.tones;
      let pitch: PitchClass;
      if (strongBeat || random() < 0.64) {
        const options = chordTones
          .map((tone) => ({ tone, distance: Math.min(Math.abs(tone - previousPitch), 12 - Math.abs(tone - previousPitch)) }))
          .sort((a, b) => a.distance - b.distance);
        pitch = options[Math.floor(random() * Math.min(2, options.length))]?.tone ?? item.chord.root;
      } else {
        pitch = nearestScaleTone(scale, previousPitch, random);
      }

      const upwardLeap = pitch < previousPitch && previousPitch - pitch > 6;
      const downwardLeap = pitch > previousPitch && pitch - previousPitch > 6;
      const octave = upwardLeap ? 5 : downwardLeap ? 4 : 4 + (random() > 0.76 ? 1 : 0);
      const durationSteps = strongBeat && random() > 0.48 ? 2 : 1;
      melody.push({
        step: barStart + localStep,
        pitch,
        octave,
        durationSteps,
        velocity: strongBeat ? 0.82 + random() * 0.16 : 0.5 + random() * 0.3,
      });
      previousPitch = pitch;
    }
  }
  return melody;
}

function buildDrums(settings: AutoComposeSettings, random: () => number): CompositionDrum[] {
  const drums: CompositionDrum[] = [];
  const density = clamp(settings.density, 0.15, 1);
  for (let bar = 0; bar < settings.bars; bar += 1) {
    const start = bar * STEPS_PER_BAR;
    for (let step = 0; step < STEPS_PER_BAR; step += 1) {
      const global = start + step;
      if (step === 0 || step === 8 || (density > 0.65 && step === 10 && random() < 0.5)) {
        drums.push({ step: global, voice: 'kick', velocity: step === 0 ? 1 : 0.82 });
      }
      if (step === 4 || step === 12) drums.push({ step: global, voice: 'snare', velocity: 0.88 });
      if (step % 2 === 0 && random() < 0.58 + density * 0.32) {
        drums.push({ step: global, voice: 'hat', velocity: step % 4 === 2 ? 0.62 : 0.46 });
      }
      if ((step === 6 || step === 14) && density > 0.55 && random() < 0.42) {
        drums.push({ step: global, voice: 'clap', velocity: 0.5 + density * 0.24 });
      }
    }
  }
  return drums;
}

export function defaultComposeSettings(seed = Date.now()): AutoComposeSettings {
  return { tonic: 0, mode: 'minor', bpm: 108, density: 0.55, bars: 8, seed };
}

export function generateComposition(settings: AutoComposeSettings): AutoComposition {
  const normalized: AutoComposeSettings = {
    ...settings,
    bpm: clamp(Math.round(settings.bpm), 60, 180),
    density: clamp(settings.density, 0.15, 1),
    bars: clamp(Math.round(settings.bars), 4, 16),
    seed: settings.seed >>> 0,
  };
  const random = randomSource(normalized.seed);
  const chords = buildProgression(normalized, random);
  const melody = buildMelody(normalized, chords, random);
  const drums = buildDrums(normalized, random);
  const modeName = normalized.mode.toUpperCase();
  const title = `${modeName} CURRENT ${String(normalized.seed >>> 0).slice(-4).padStart(4, '0')}`;
  return { settings: normalized, chords, melody, drums, title };
}

export function compositionStepMs(composition: Pick<AutoComposition, 'settings'>): number {
  return 60000 / composition.settings.bpm / 4;
}

export function compositionLengthSteps(composition: AutoComposition): number {
  return composition.settings.bars * STEPS_PER_BAR;
}
