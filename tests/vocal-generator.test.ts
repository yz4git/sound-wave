import { describe, expect, it } from 'vitest';
import { defaultComposeSettings, generateComposition } from '../src/compose/AutoComposer';
import { generateVocalLine, vocalSyllableAtStep } from '../src/compose/VocalGenerator';

describe('local vocal generation', () => {
  it('is deterministic for the same composition and seed', () => {
    const composition = generateComposition({ ...defaultComposeSettings(1234), seed: 1234 });
    expect(generateVocalLine(composition, 77)).toEqual(generateVocalLine(composition, 77));
  });

  it('follows the generated melody and emits valid vowel syllables', () => {
    const composition = generateComposition({ ...defaultComposeSettings(99), seed: 99 });
    const line = generateVocalLine(composition, 101);
    const melodySteps = new Set(composition.melody.map((note) => note.step));
    expect(line.length).toBeGreaterThan(0);
    expect(line.every((event) => melodySteps.has(event.step))).toBe(true);
    expect(line.every((event) => ['a', 'e', 'i', 'o', 'u'].includes(event.vowel))).toBe(true);
    expect(line.every((event) => event.durationSteps >= 1 && event.durationSteps <= 4)).toBe(true);
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
});
