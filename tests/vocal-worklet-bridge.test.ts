import { describe, expect, it } from 'vitest';
import { defaultComposeSettings, generateComposition } from '../src/compose/AutoComposer';
import { generateVocalLine } from '../src/compose/VocalGenerator';
import { vocalEventToWorklet } from '../src/compose/VocalWorkletBridge';

describe('continuous vocal AudioWorklet bridge', () => {
  it('maps a vocal note into one complete DSP event', () => {
    const composition = generateComposition({ ...defaultComposeSettings(4242), seed: 4242, density: 1 });
    const line = generateVocalLine(composition, 99);
    const event = line[0];
    expect(event).toBeDefined();

    const mapped = vocalEventToWorklet(event!, 'warm', 1.25, 0.5);
    expect(mapped.when).toBe(1.25);
    expect(mapped.duration).toBe(0.5);
    expect(mapped.targetHz).toBeGreaterThan(60);
    expect(mapped.formants).toHaveLength(5);
    expect(mapped.formants.every((band) => band.bandwidth > 0 && band.targetHz > 0)).toBe(true);
    expect(mapped.style.glottalOpenQuotient).toBeGreaterThan(0);
    expect(mapped.style.glottalOpenQuotient).toBeLessThan(1);
    expect(mapped.style.vibratoRateHz).toBeGreaterThanOrEqual(5);
    expect(mapped.style.vibratoRateHz).toBeLessThanOrEqual(7);
  });

  it('preserves phrase and portamento planning for melisma events', () => {
    const composition = generateComposition({ ...defaultComposeSettings(98765), seed: 98765, density: 1 });
    const line = generateVocalLine(composition, 314159);
    const melisma = line.find((event) => !event.articulate && event.glideFromMidi !== null);
    expect(melisma).toBeDefined();

    const mapped = vocalEventToWorklet(melisma!, 'airy', 2, 0.32);
    expect(mapped.articulate).toBe(false);
    expect(mapped.glideFromHz).not.toBeNull();
    expect(mapped.glideFromHz!).toBeGreaterThan(40);
    expect(mapped.phraseStart).toBe(melisma!.phraseStart);
    expect(mapped.phraseEnd).toBe(melisma!.phraseEnd);
    expect(mapped.style.breathLevel).toBeGreaterThan(0);
    expect(mapped.style.doubleDelaySeconds).toBeGreaterThan(0);
  });
});
