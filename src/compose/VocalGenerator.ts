import type { PitchClass } from '../core/music';
import type { AutoComposition, CompositionNote } from './AutoComposer';

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
  articulate: boolean;
  phraseStart: boolean;
  phraseEnd: boolean;
  glideFromMidi: number | null;
}

// Soft consonants and open/bright vowels keep the local singer close to a
// light pop delivery without imitating any one real vocalist or lyric.
const PHRASES: readonly (readonly { syllable: string; vowel: VocalVowel }[])[] = [
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
] as const;

function randomSource(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value ^ 0x9e3779b9, 1664525) + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function keepForVocal(note: CompositionNote, random: () => number): boolean {
  const localStep = note.step % 16;
  if (localStep % 4 === 0) return true;
  if (note.durationSteps >= 2 && localStep % 2 === 0) return true;
  if (localStep % 2 === 0) return random() < 0.74;
  return random() < 0.28;
}

function midiFor(pitch: PitchClass, octave: number): number {
  return 12 * (octave + 1) + pitch;
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

export function generateVocalLine(composition: AutoComposition, seed = composition.settings.seed ^ 0x51f15e): VocalEvent[] {
  const random = randomSource(seed >>> 0);
  const fallbackPhrase = PHRASES[0]!;
  const phrase = PHRASES[Math.floor(random() * PHRASES.length)] ?? fallbackPhrase;
  const vocal: VocalEvent[] = [];
  let syllableIndex = 0;
  let activeToken: { syllable: string; vowel: VocalVowel } | null = null;
  let previousEvent: VocalEvent | null = null;

  for (const note of composition.melody) {
    if (!keepForVocal(note, random)) continue;

    const octave = Math.max(3, Math.min(5, note.octave));
    const gap = previousEvent ? note.step - previousEvent.step : Number.POSITIVE_INFINITY;
    const closeToPrevious = previousEvent !== null && gap <= Math.max(3, previousEvent.durationSteps + 1);
    const continueMelisma = closeToPrevious && (random() < 0.5 || vocal.length % 7 === 5);
    const phraseStart = previousEvent === null || gap > 4;
    let articulate = phraseStart || !continueMelisma;

    if (!activeToken || articulate) {
      activeToken = phrase[syllableIndex % phrase.length] ?? { syllable: 'ah', vowel: 'a' as const };
      syllableIndex += 1;
      articulate = true;
    }

    if (phraseStart && previousEvent) previousEvent.phraseEnd = true;

    const baseVelocity = note.velocity * (phraseStart ? 0.94 : 0.9) * vowelVelocityScale(activeToken.vowel);
    const event: VocalEvent = {
      step: note.step,
      pitch: note.pitch,
      octave,
      durationSteps: Math.max(1, Math.min(3, note.durationSteps + (random() > 0.82 ? 1 : 0))),
      velocity: Math.max(0.42, Math.min(0.86, baseVelocity)),
      syllable: articulate ? activeToken.syllable : activeToken.vowel,
      vowel: activeToken.vowel,
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
