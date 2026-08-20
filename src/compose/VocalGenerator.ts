import type { PitchClass } from '../core/music';
import type { AutoComposition, CompositionNote } from './AutoComposer';
import { genreStyle, type GenreStyleProfile } from './GenreStyle';

export type VocalStyle = 'warm' | 'bright' | 'airy';
export type VocalVowel = 'a' | 'e' | 'i' | 'o' | 'u';

export interface VocalEvent {
  step: number;
  pitch: PitchClass;
  octave: number;
  durationSteps: number;
  velocity: number;
  syllable: string;
  vowel: VocalVowel;
  nextVowel: VocalVowel | null;
  articulate: boolean;
  phraseStart: boolean;
  phraseEnd: boolean;
  glideFromMidi: number | null;
}

interface VocalToken {
  syllable: string;
  vowel: VocalVowel;
}

const PHRASES: readonly (readonly VocalToken[])[] = [
  [
    { syllable: 'na', vowel: 'a' },
    { syllable: 'ni', vowel: 'i' },
    { syllable: 'yo', vowel: 'o' },
    { syllable: 'ne', vowel: 'e' },
  ],
  [
    { syllable: 'ma', vowel: 'a' },
    { syllable: 'mi', vowel: 'i' },
    { syllable: 'yu', vowel: 'u' },
    { syllable: 'ne', vowel: 'e' },
  ],
  [
    { syllable: 'la', vowel: 'a' },
    { syllable: 'li', vowel: 'i' },
    { syllable: 'yo', vowel: 'o' },
    { syllable: 'na', vowel: 'a' },
  ],
  [
    { syllable: 'ah', vowel: 'a' },
    { syllable: 'ee', vowel: 'i' },
    { syllable: 'oo', vowel: 'u' },
    { syllable: 'eh', vowel: 'e' },
  ],
  [
    { syllable: 'ka', vowel: 'a' },
    { syllable: 'ki', vowel: 'i' },
    { syllable: 'sa', vowel: 'a' },
    { syllable: 'se', vowel: 'e' },
  ],
  [
    { syllable: 'ta', vowel: 'a' },
    { syllable: 'te', vowel: 'e' },
    { syllable: 'ha', vowel: 'a' },
    { syllable: 'hi', vowel: 'i' },
  ],
  [
    { syllable: 'fu', vowel: 'u' },
    { syllable: 'pa', vowel: 'a' },
    { syllable: 'ba', vowel: 'a' },
    { syllable: 'be', vowel: 'e' },
  ],
  [
    { syllable: 'ga', vowel: 'a' },
    { syllable: 'za', vowel: 'a' },
    { syllable: 'n', vowel: 'u' },
    { syllable: 'ke', vowel: 'e' },
  ],
] as const;

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

function randomSource(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value ^ 0x9e3779b9, 1664525) + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function keepForVocal(note: CompositionNote, random: () => number, profile: GenreStyleProfile): boolean {
  const localStep = note.step % 16;
  const densityFactor = clamp(profile.melodyDensity + profile.densityBias, 0.48, 1.35);
  if (localStep % 4 === 0) return random() < clamp(0.78 + densityFactor * 0.16, 0.72, 0.98);
  if (note.durationSteps >= 2 && localStep % 2 === 0) return random() < clamp(0.72 + profile.longNoteChance * 0.22, 0.66, 0.94);
  if (localStep % 2 === 0) return random() < clamp(0.44 + densityFactor * 0.24, 0.42, 0.82);
  return random() < clamp(0.08 + profile.syncopation * 0.38 + (densityFactor - 0.8) * 0.08, 0.05, 0.46);
}

function midiFor(pitch: PitchClass, octave: number): number {
  return 12 * (octave + 1) + pitch;
}

function vocalOctaveFor(pitch: PitchClass, sourceOctave: number, previousEvent: VocalEvent | null): number {
  const source = Math.max(4, Math.min(5, sourceOctave));
  if (!previousEvent) return source;

  const previousMidi = midiFor(previousEvent.pitch, previousEvent.octave);
  const candidates = [4, 5] as const;
  let best = source;
  let bestDistance = Math.abs(midiFor(pitch, source) - previousMidi);

  for (const candidate of candidates) {
    const distance = Math.abs(midiFor(pitch, candidate) - previousMidi);
    if (distance < bestDistance || (distance === bestDistance && candidate === source)) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

function vowelVelocityScale(vowel: VocalVowel): number {
  if (vowel === 'i') return 0.95;
  if (vowel === 'e') return 0.97;
  return 1;
}

function ensureSoftMelisma(line: VocalEvent[]): void {
  if (line.some((event) => !event.articulate)) return;
  for (let index = 1; index < line.length; index += 1) {
    const previous = line[index - 1]!;
    const current = line[index]!;
    const gap = current.step - previous.step;
    if (gap > 3 || current.phraseStart) continue;
    current.articulate = false;
    current.syllable = previous.vowel;
    current.vowel = previous.vowel;
    current.glideFromMidi = midiFor(previous.pitch, previous.octave);
    return;
  }
}

function connectShortGaps(line: VocalEvent[]): void {
  for (let index = 0; index < line.length - 1; index += 1) {
    const current = line[index]!;
    const next = line[index + 1]!;
    const gapSteps = next.step - current.step;

    if (gapSteps <= 3) {
      current.durationSteps = Math.max(current.durationSteps, Math.min(5, gapSteps));
      current.phraseEnd = false;
      next.phraseStart = false;
    } else {
      current.phraseEnd = true;
    }
  }

  const finalEvent = line[line.length - 1];
  if (finalEvent) finalEvent.phraseEnd = true;
}

function planNextVowels(line: VocalEvent[]): void {
  for (let index = 0; index < line.length; index += 1) {
    const event = line[index]!;
    const next = line[index + 1];
    if (!next || event.phraseEnd || next.phraseStart || next.step - event.step > 3) {
      event.nextVowel = null;
      continue;
    }
    event.nextVowel = next.vowel;
  }
}

export function generateVocalLine(composition: AutoComposition, seed = composition.settings.seed ^ 0x51f15e): VocalEvent[] {
  const random = randomSource(seed >>> 0);
  const profile = genreStyle(composition.settings.genre, composition.settings.subgenre);
  const fallbackPhrase = PHRASES[0]!;
  const phrase = PHRASES[Math.floor(random() * PHRASES.length)] ?? fallbackPhrase;
  const vocal: VocalEvent[] = [];
  let syllableIndex = 0;
  let activeToken: VocalToken | null = null;
  let previousEvent: VocalEvent | null = null;
  const melismaChance = clamp(
    0.26 + (1 - profile.vocalArticulation) * 0.5 + profile.longNoteChance * 0.26,
    0.16,
    0.64,
  );

  for (const note of composition.melody) {
    if (!keepForVocal(note, random, profile)) continue;

    const octave = vocalOctaveFor(note.pitch, note.octave, previousEvent);
    const gap = previousEvent ? note.step - previousEvent.step : Number.POSITIVE_INFINITY;
    const closeToPrevious = previousEvent !== null && gap <= Math.max(3, previousEvent.durationSteps + 1);
    const continueMelisma = closeToPrevious && (random() < melismaChance || vocal.length % 9 === 6);
    const phraseGap = profile.genre === 'k-pop' || profile.genre === 'rock' ? 4 : 5;
    const phraseStart = previousEvent === null || gap > phraseGap;
    let articulate = phraseStart || !continueMelisma;

    if (!activeToken || articulate) {
      activeToken = phrase[syllableIndex % phrase.length] ?? { syllable: 'ah', vowel: 'a' as const };
      syllableIndex += 1;
      articulate = true;
    }

    if (phraseStart && previousEvent) previousEvent.phraseEnd = true;

    const baseVelocity = note.velocity * (phraseStart ? 0.94 : 0.9) * vowelVelocityScale(activeToken.vowel);
    const extensionChance = clamp(0.08 + profile.longNoteChance * 0.48, 0.08, 0.44);
    const extraDuration = random() < extensionChance ? 1 : 0;
    const maxDuration = profile.longNoteChance > 0.58 ? 4 : 3;
    const event: VocalEvent = {
      step: note.step,
      pitch: note.pitch,
      octave,
      durationSteps: Math.max(1, Math.min(maxDuration, note.durationSteps + extraDuration)),
      velocity: Math.max(0.42, Math.min(0.86, baseVelocity)),
      syllable: articulate ? activeToken.syllable : activeToken.vowel,
      vowel: activeToken.vowel,
      nextVowel: null,
      articulate,
      phraseStart,
      phraseEnd: false,
      glideFromMidi: !articulate && previousEvent
        ? midiFor(previousEvent.pitch, previousEvent.octave)
        : null,
    };
    vocal.push(event);
    previousEvent = event;
  }

  connectShortGaps(vocal);
  ensureSoftMelisma(vocal);
  planNextVowels(vocal);
  return vocal;
}

export function vocalActiveAtStep(line: readonly VocalEvent[], step: number): boolean {
  return line.some((event) => step >= event.step && step < event.step + event.durationSteps);
}

export function vocalSyllableAtStep(line: readonly VocalEvent[], step: number): string {
  const direct = line.find((candidate) => candidate.step === step);
  if (direct) return direct.articulate ? direct.syllable : `~${direct.vowel}`;

  for (let index = line.length - 1; index >= 0; index -= 1) {
    const event = line[index]!;
    if (step > event.step && step < event.step + event.durationSteps) return `~${event.vowel}`;
    if (event.step < step - 5) break;
  }
  return '';
}
