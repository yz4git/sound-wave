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

export function generateVocalLine(composition: AutoComposition, seed = composition.settings.seed ^ 0x51f15e): VocalEvent[] {
  const random = randomSource(seed >>> 0);
  const phrase = PHRASES[Math.floor(random() * PHRASES.length)] ?? PHRASES[0];
  const vocal: VocalEvent[] = [];
  let syllableIndex = 0;

  for (const note of composition.melody) {
    if (!keepForVocal(note, random)) continue;
    const token = phrase[syllableIndex % phrase.length] ?? { syllable: 'ah', vowel: 'a' as const };
    syllableIndex += 1;
    vocal.push({
      step: note.step,
      pitch: note.pitch,
      octave: Math.max(3, Math.min(5, note.octave)),
      durationSteps: Math.max(1, Math.min(4, note.durationSteps + (random() > 0.7 ? 1 : 0))),
      velocity: Math.max(0.38, Math.min(0.92, note.velocity * 0.9)),
      syllable: token.syllable,
      vowel: token.vowel,
    });
  }

  return vocal;
}

export function vocalSyllableAtStep(line: readonly VocalEvent[], step: number): string {
  return line.find((event) => event.step === step)?.syllable ?? '';
}
