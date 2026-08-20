import { describe, expect, it } from 'vitest';
import { defaultComposeSettings, generateComposition } from '../src/compose/AutoComposer';
import { generateVocalLine } from '../src/compose/VocalGenerator';
import { buildVocalPhraseControls } from '../src/compose/VocalPhraseModel';
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
    expect(mapped.phrase.energyStart).toBeGreaterThan(0);
    expect(mapped.phrase.sourceTractCoupling).toBeGreaterThan(0);
  });

  it('preserves phrase and portamento planning for melisma events', () => {
    const composition = generateComposition({ ...defaultComposeSettings(98765), seed: 98765, density: 1 });
    const line = generateVocalLine(composition, 314159);
    const melisma = line.find((event) => !event.articulate && event.glideFromMidi !== null);
    expect(melisma).toBeDefined();

    const controls = buildVocalPhraseControls(line);
    const phraseControl = controls.get(melisma!.step);
    expect(phraseControl).toBeDefined();

    const mapped = vocalEventToWorklet(melisma!, 'airy', 2, 0.32, phraseControl!);
    expect(mapped.articulate).toBe(false);
    expect(mapped.glideFromHz).not.toBeNull();
    expect(mapped.glideFromHz!).toBeGreaterThan(40);
    expect(mapped.phraseStart).toBe(melisma!.phraseStart);
    expect(mapped.phraseEnd).toBe(melisma!.phraseEnd);
    expect(mapped.phrase.progressStart).toBe(phraseControl!.progressStart);
    expect(mapped.phrase.progressEnd).toBe(phraseControl!.progressEnd);
    expect(mapped.phrase.energyStart).toBe(phraseControl!.energyStart);
    expect(mapped.phrase.energyEnd).toBe(phraseControl!.energyEnd);
    expect(mapped.phrase.centeringEnd).toBe(phraseControl!.centeringEnd);
    expect(mapped.phrase.aspirationDepth).toBeGreaterThan(0);
    expect(mapped.phrase.sourceTractCoupling).toBeGreaterThan(0);
    expect(mapped.style.breathLevel).toBeGreaterThan(0);
    expect(mapped.style.doubleDelaySeconds).toBeGreaterThan(0);
  });
});
