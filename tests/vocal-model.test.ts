import { describe, expect, it } from 'vitest';
import {
  VOCAL_STYLE_MODELS,
  deterministicOnsetCents,
  formantsFor,
  harmonicSeries,
  onsetFormantFrequency,
} from '../src/compose/VocalModel';

describe('local vocal model', () => {
  it('uses singing-like vibrato rates', () => {
    for (const model of Object.values(VOCAL_STYLE_MODELS)) {
      expect(model.vibratoRateHz).toBeGreaterThanOrEqual(5);
      expect(model.vibratoRateHz).toBeLessThanOrEqual(7);
      expect(model.vibratoDepthCents).toBeGreaterThan(20);
    }
  });

  it('keeps five ordered vocal-tract formants', () => {
    const bands = formantsFor('a', 'warm');
    expect(bands).toHaveLength(5);
    for (let index = 1; index < bands.length; index += 1) {
      expect(bands[index]!.frequency).toBeGreaterThan(bands[index - 1]!.frequency);
      expect(bands[index]!.bandwidth).toBeGreaterThan(0);
    }
  });

  it('builds a harmonically rich but tilted glottal-like source', () => {
    const harmonics = harmonicSeries('warm', 24);
    expect(harmonics[1]).toBeGreaterThan(harmonics[8]!);
    expect(harmonics[8]).toBeGreaterThan(harmonics[20]!);
    expect(harmonics[2]).toBeGreaterThan(0);
  });

  it('moves consonant onsets toward vowel targets', () => {
    const target = formantsFor('a', 'warm')[2]!.frequency;
    expect(onsetFormantFrequency('ra', 2, target)).toBeLessThan(target);
    expect(onsetFormantFrequency('ah', 2, target)).toBe(target);
  });

  it('creates deterministic micro-pitch onsets inside the style range', () => {
    const a = deterministicOnsetCents(23, 'airy');
    const b = deterministicOnsetCents(23, 'airy');
    expect(a).toBe(b);
    expect(Math.abs(a)).toBeLessThanOrEqual(VOCAL_STYLE_MODELS.airy.onsetPitchCents);
  });
});
