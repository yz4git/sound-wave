import { describe, expect, it } from 'vitest';
import { defaultComposeSettings, generateComposition } from '../src/compose/AutoComposer';
import { generateVocalLine } from '../src/compose/VocalGenerator';
import { vocalEventToWorklet } from '../src/compose/VocalWorkletBridge';

describe('producer tuning bridge mapping', () => {
  it('preserves musical Note-Off while adding producer consonant lead', () => {
    const composition = generateComposition({ ...defaultComposeSettings(909), seed: 909, density: 1 });
    const base = generateVocalLine(composition, 3030)[0];
    expect(base).toBeDefined();
    const event = { ...base!, syllable: 'ka', vowel: 'a' as const, articulate: true, phraseStart: true };

    const scoreWhen = 2;
    const scoreDuration = 0.5;
    const mapped = vocalEventToWorklet(event, 'warm', scoreWhen, scoreDuration);

    expect(mapped.producerTuning.timingLeadSeconds).toBeGreaterThan(0);
    expect(mapped.when).toBeLessThan(scoreWhen);
    expect(mapped.when + mapped.duration).toBeCloseTo(scoreWhen + scoreDuration, 8);
  });

  it('maps Velocity-like consonant length, Air, Attack and Mouth controls separately', () => {
    const composition = generateComposition({ ...defaultComposeSettings(707), seed: 707, density: 1 });
    const base = generateVocalLine(composition, 5050)[0];
    expect(base).toBeDefined();
    const mapped = vocalEventToWorklet({ ...base!, syllable: 'sa', vowel: 'a' as const, articulate: true }, 'warm', 1, 0.5);

    expect(mapped.producerTuning.consonantLengthScale).toBeGreaterThan(0.75);
    expect(mapped.phoneme.fricationSeconds).toBeGreaterThan(0);
    expect(mapped.style.attackSeconds).toBeLessThanOrEqual(0.06);
    expect(mapped.style.breathLevel).toBeGreaterThan(0);
    expect(mapped.formants[0]!.targetHz).toBeGreaterThan(0);
    expect(mapped.style.presenceGain).toBe(0);
  });

  it('keeps producer tuning bounded around the anti-crack vocal baseline', () => {
    const composition = generateComposition({ ...defaultComposeSettings(515), seed: 515, density: 1 });
    const line = generateVocalLine(composition, 6161);
    const mapped = line.slice(0, 12).map((event) => vocalEventToWorklet(event, 'warm', 1, 0.42));

    expect(mapped.length).toBeGreaterThan(0);
    expect(mapped.every((event) => event.karaoke.scoopCents <= 14)).toBe(true);
    expect(mapped.every((event) => event.karaoke.fallCents <= 12)).toBe(true);
    expect(mapped.every((event) => event.style.jitterCents <= 0.525)).toBe(true);
    expect(mapped.every((event) => event.phrase.sourceTractCoupling <= 0.013)).toBe(true);
  });
});
