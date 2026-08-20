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

const PHRASES: readonly (readonly { syllable: string; vowel: VocalVowel }[])[] = [
  [
    { syllable: 'la', vowel: 'a' },
    { syllable: 'na', vowel: 'a' },
    { syllable: 'ri', vowel: 'i' },
    { syllable: 'yo', vowel: 'o' },
  ],
  [
    { syllable: 'ah', vowel: 'a' },
    { syllable: 'oh', vowel: 'o' },
    { syllable: 'ee', vowel: 'i' },
    { syllable: 'oo', vowel: 'u' },
  ],
  [
    { syllable: 'ma', vowel: 'a' },
    { syllable: 're', vowel: 'e' },
    { syllable: 'mi', vowel: 'i' },
    { syllable: 'no', vowel: 'o' },
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
  return localStep % 2 === 0 && random() < 0.42;
}

function midiFor(pitch: PitchClass, octave: number): number {
  return 12 * (octave + 1) + pitch;
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
    const closeToPrevious = previousEvent !== null && gap <= Math.max(4, previousEvent.durationSteps + 1);
    const continueMelisma = closeToPrevious && (random() < 0.58 || vocal.length % 5 === 3);
    const phraseStart = previousEvent === null || gap > 5;
    let articulate = phraseStart || !continueMelisma;

    if (!activeToken || articulate) {
      activeToken = phrase[syllableIndex % phrase.length] ?? { syllable: 'ah', vowel: 'a' as const };
      syllableIndex += 1;
      articulate = true;
    }

    if (phraseStart && previousEvent) previousEvent.phraseEnd = true;

    const event: VocalEvent = {
      step: note.step,
      pitch: note.pitch,
      octave,
      durationSteps: Math.max(1, Math.min(4, note.durationSteps + (random() > 0.7 ? 1 : 0))),
      velocity: Math.max(0.38, Math.min(0.92, note.velocity * (phraseStart ? 0.94 : 0.9))),
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

  const finalEvent = vocal[vocal.length - 1];
  if (finalEvent) finalEvent.phraseEnd = true;
  return vocal;
}

export function vocalSyllableAtStep(line: readonly VocalEvent[], step: number): string {
  const event = line.find((candidate) => candidate.step === step);
  if (!event) return '';
  return event.articulate ? event.syllable : `~${event.vowel}`;
}
