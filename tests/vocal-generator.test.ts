import { describe, expect, it } from 'vitest';
import { defaultComposeSettings, generateComposition } from '../src/compose/AutoComposer';
import { consonantForSyllable } from '../src/compose/JapanesePhoneme';
import { generateVocalLine, vocalActiveAtStep, vocalSyllableAtStep } from '../src/compose/VocalGenerator';

function midiFor(pitch: number, octave: number): number {
  return 12 * (octave + 1) + pitch;
}

describe('local vocal generation', () => {
  it('is deterministic for the same composition and seed', () => {
    const composition = generateComposition({ ...defaultComposeSettings(1234), seed: 1234 });
    expect(generateVocalLine(composition, 77)).toEqual(generateVocalLine(composition, 77));
  });

  it('follows the generated melody and emits valid vowel carriers', () => {
    const composition = generateComposition({ ...defaultComposeSettings(99), seed: 99 });
    const line = generateVocalLine(composition, 101);
    const melodySteps = new Set(composition.melody.map((note) => note.step));
    expect(line.length).toBeGreaterThan(0);
    expect(line.every((event) => melodySteps.has(event.step))).toBe(true);
    expect(line.every((event) => ['a', 'e', 'i', 'o', 'u'].includes(event.vowel))).toBe(true);
    expect(line.every((event) => event.durationSteps >= 1 && event.durationSteps <= 3)).toBe(true);
  });

  it('keeps the sung register continuous instead of inheriting random melody octave flips', () => {
    for (const seed of [1, 42, 99, 2468, 98765, 314159]) {
      const composition = generateComposition({ ...defaultComposeSettings(seed), seed, density: 1 });
      const line = generateVocalLine(composition, seed ^ 0x55aa);
      expect(line.length).toBeGreaterThan(1);
      expect(line.every((event) => event.octave === 4 || event.octave === 5)).toBe(true);

      for (let index = 1; index < line.length; index += 1) {
        const previous = line[index - 1]!;
        const current = line[index]!;
        const interval = Math.abs(
          midiFor(current.pitch, current.octave) - midiFor(previous.pitch, previous.octave),
        );
        expect(interval).toBeLessThanOrEqual(6);
      }
    }
  });

  it('exercises the expanded Japanese consonant inventory across deterministic seeds', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 40; seed += 1) {
      const composition = generateComposition({ ...defaultComposeSettings(seed), seed, density: 1 });
      const line = generateVocalLine(composition, seed * 7919);
      for (const event of line) {
        if (!event.articulate) continue;
        seen.add(consonantForSyllable(event.syllable));
      }
    }

    for (const required of ['k', 't', 's', 'h', 'f', 'p', 'b', 'g', 'z', 'n', 'N']) {
      expect(seen.has(required)).toBe(true);
    }
  });

  it('plans next-vowel coarticulation only inside a connected phrase', () => {
    const composition = generateComposition({ ...defaultComposeSettings(76543), seed: 76543, density: 1 });
    const line = generateVocalLine(composition, 222);
    expect(line.length).toBeGreaterThan(1);

    let planned = 0;
    for (let index = 0; index < line.length; index += 1) {
      const current = line[index]!;
      const next = line[index + 1];
      const connected = next !== undefined
        && !current.phraseEnd
        && !next.phraseStart
        && next.step - current.step <= 3;

      if (connected) {
        expect(current.nextVowel).toBe(next!.vowel);
        planned += 1;
      } else {
        expect(current.nextVowel).toBeNull();
      }
    }
    expect(planned).toBeGreaterThan(0);
  });

  it('marks phrase boundaries for breath and release shaping', () => {
    const composition = generateComposition({ ...defaultComposeSettings(555), seed: 555, density: 0.78 });
    const line = generateVocalLine(composition, 123);
    expect(line[0]?.phraseStart).toBe(true);
    expect(line[line.length - 1]?.phraseEnd).toBe(true);
  });

  it('can surface a syllable for the visual playhead', () => {
    const composition = generateComposition({ ...defaultComposeSettings(42), seed: 42 });
    const line = generateVocalLine(composition, 5);
    const first = line[0];
    expect(first).toBeDefined();
    expect(vocalSyllableAtStep(line, first!.step)).toBe(first!.syllable);
  });

  it('uses vowel-only continuation events and plans glides for melisma', () => {
    const composition = generateComposition({ ...defaultComposeSettings(98765), seed: 98765, density: 1 });
    const line = generateVocalLine(composition, 314159);
    const continuations = line.filter((event) => !event.articulate);
    expect(continuations.length).toBeGreaterThan(0);
    expect(continuations.every((event) => ['a', 'e', 'i', 'o', 'u'].includes(event.syllable))).toBe(true);
    expect(continuations.every((event) => vocalSyllableAtStep(line, event.step).startsWith('~'))).toBe(true);
    expect(continuations.some((event) => event.glideFromMidi !== null)).toBe(true);
  });

  it('bridges only short melodic gaps without holding vowels through long rests', () => {
    const composition = generateComposition({ ...defaultComposeSettings(76543), seed: 76543, density: 0.82 });
    const line = generateVocalLine(composition, 222);
    let bridged = 0;

    for (let index = 0; index < line.length - 1; index += 1) {
      const current = line[index]!;
      const next = line[index + 1]!;
      const gap = next.step - current.step;
      if (gap <= 3) {
        expect(current.durationSteps).toBeGreaterThanOrEqual(gap);
        expect(current.phraseEnd).toBe(false);
        expect(vocalActiveAtStep(line, next.step - 1)).toBe(true);
        bridged += 1;
      } else {
        expect(current.phraseEnd).toBe(true);
      }
    }

    expect(bridged).toBeGreaterThan(0);
  });
});
