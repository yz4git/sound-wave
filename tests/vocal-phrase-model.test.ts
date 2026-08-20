import { describe, expect, it } from 'vitest';
import { defaultComposeSettings, generateComposition } from '../src/compose/AutoComposer';
import { generateVocalLine } from '../src/compose/VocalGenerator';
import { buildVocalPhraseControls, phraseEnergyAt, vowelCenteringAt } from '../src/compose/VocalPhraseModel';

describe('human phrase control model', () => {
  it('creates a gentle phrase arch instead of flat note-by-note gain', () => {
    expect(phraseEnergyAt(0)).toBeLessThan(phraseEnergyAt(0.56));
    expect(phraseEnergyAt(1)).toBeLessThan(phraseEnergyAt(0.56));
    expect(phraseEnergyAt(0.56)).toBeLessThanOrEqual(1.05);
  });

  it('keeps vowel centering near zero until the phrase tail', () => {
    expect(vowelCenteringAt(0.5)).toBe(0);
    expect(vowelCenteringAt(0.8)).toBeGreaterThan(0);
    expect(vowelCenteringAt(1)).toBeLessThanOrEqual(0.16);
  });

  it('maps every generated vocal event to a bounded phrase control', () => {
    const composition = generateComposition({ ...defaultComposeSettings(2468), seed: 2468, density: 0.9 });
    const line = generateVocalLine(composition, 1357);
    const controls = buildVocalPhraseControls(line);

    expect(line.length).toBeGreaterThan(0);
    expect(controls.size).toBe(line.length);

    for (const event of line) {
      const control = controls.get(event.step);
      expect(control).toBeDefined();
      expect(control!.progressStart).toBeGreaterThanOrEqual(0);
      expect(control!.progressEnd).toBeLessThanOrEqual(1);
      expect(control!.progressEnd).toBeGreaterThanOrEqual(control!.progressStart);
      expect(control!.energyStart).toBeGreaterThan(0.75);
      expect(control!.energyEnd).toBeLessThan(1.1);
      expect(control!.centeringStart).toBeGreaterThanOrEqual(0);
      expect(control!.centeringEnd).toBeLessThanOrEqual(0.16);
      expect(control!.aspirationDepth).toBeGreaterThan(0);
      expect(control!.sourceTractCoupling).toBeGreaterThan(0);
      expect(control!.sourceTractCoupling).toBeLessThanOrEqual(0.012);
    }
  });
});
