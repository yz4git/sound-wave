import { describe, expect, it } from 'vitest';
import {
  VOCAL_STYLE_MODELS,
  deterministicOnsetCents,
  formantsFor,
  glottalHarmonicSeries,
  onsetFormantFrequency,
} from '../src/compose/VocalModel';

describe('local vocal model', () => {
  it('uses restrained soft-pop modulation instead of wide constant vibrato', () => {
    for (const model of Object.values(VOCAL_STYLE_MODELS)) {
      expect(model.vibratoRateHz).toBeGreaterThanOrEqual(4.8);
      expect(model.vibratoRateHz).toBeLessThanOrEqual(5.6);
      expect(model.vibratoDepthCents).toBeGreaterThanOrEqual(10);
      expect(model.vibratoDepthCents).toBeLessThanOrEqual(18);
      expect(model.vibratoDelaySeconds).toBeGreaterThanOrEqual(0.3);
      expect(model.jitterCents).toBeGreaterThan(0);
      expect(model.jitterCents).toBeLessThan(1.5);
      expect(model.shimmerDepth).toBeGreaterThan(0);
      expect(model.shimmerDepth).toBeLessThan(0.015);
      expect(model.doubleLevel).toBe(0);
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

  it('uses broadened resonances to avoid narrow metallic formant peaks', () => {
    const bands = formantsFor('a', 'warm');
    expect(bands[0]!.bandwidth).toBeGreaterThanOrEqual(100);
    expect(bands[4]!.bandwidth).toBeGreaterThanOrEqual(280);
    expect(bands[4]!.gain).toBeLessThan(0.06);
  });

  it('derives a rich tilted spectrum from a glottal pulse shape', () => {
    const harmonics = glottalHarmonicSeries('warm', 32);
    expect(harmonics).toHaveLength(33);
    expect(harmonics[1]).toBeGreaterThan(0);
    expect(harmonics[2]).toBeGreaterThan(0);
    expect(harmonics[1]).toBeGreaterThan(harmonics[20]!);
  });

  it('uses plausible glottal open and speed quotients', () => {
    for (const model of Object.values(VOCAL_STYLE_MODELS)) {
      expect(model.glottalOpenQuotient).toBeGreaterThan(0.4);
      expect(model.glottalOpenQuotient).toBeLessThan(0.8);
      expect(model.glottalSpeedQuotient).toBeGreaterThan(0.45);
      expect(model.glottalSpeedQuotient).toBeLessThan(0.9);
    }
  });

  it('moves soft consonant onsets toward vowel targets', () => {
    const target = formantsFor('a', 'warm')[2]!.frequency;
    expect(onsetFormantFrequency('na', 2, target)).toBeLessThan(target);
    expect(onsetFormantFrequency('ah', 2, target)).toBe(target);
  });

  it('creates deterministic micro-pitch onsets inside the style range', () => {
    const a = deterministicOnsetCents(23, 'airy');
    const b = deterministicOnsetCents(23, 'airy');
    expect(a).toBe(b);
    expect(Math.abs(a)).toBeLessThanOrEqual(VOCAL_STYLE_MODELS.airy.onsetPitchCents);
  });
});
