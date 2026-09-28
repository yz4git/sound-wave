import { describe, expect, it } from 'vitest';
import {
  applyPhraseBoundaryOverrides,
  buildPhraseControlArrays,
  phraseCurveAtProgress,
  phraseCurvePointFromDrag,
  phraseEmphasisPreset,
  phrasePitchFromDrag,
  updatePhraseBoundaryOverride,
  updatePhraseShapeOverride,
} from '../src/voice/VoicePhraseEditor';
import { parseVoiceScript } from '../src/voice/VoiceScript';

describe('VOICE LAB phrase controls', () => {
  it('splits and joins accent phrases without recomputing full-context devoicing', () => {
    const script = parseVoiceScript('すきもの');
    script.units[0]!.devoiced = true;

    applyPhraseBoundaryOverrides(script, [{
      after: 1,
      boundary: 'accent',
      pauseSeconds: 0.05,
    }]);

    expect(script.units[1]?.accentEnd).toBe(true);
    expect(script.units[2]?.accentStart).toBe(true);
    expect(script.units[0]?.devoiced).toBe(true);

    applyPhraseBoundaryOverrides(script, [{
      after: 1,
      boundary: 'none',
      pauseSeconds: 0,
    }]);

    expect(script.units[1]?.accentEnd).toBe(false);
    expect(script.units[2]?.accentStart).toBe(false);
    expect(script.units[0]?.devoiced).toBe(true);
  });

  it('maps phrase pitch rate and pause controls onto the matching unit range', () => {
    const script = parseVoiceScript('あいう、えお');
    const arrays = buildPhraseControlArrays(
      script,
      [{
        start: 0,
        end: 2,
        pitchOffset: 1.25,
        rateScale: 1.2,
        energyScale: 1.15,
        emphasis: 0.5,
        curveStart: -0.5,
        curvePeak: 1,
        curveEnd: -0.25,
      }],
      [{
        after: 2,
        boundary: 'accent',
        pauseSeconds: 0.11,
      }],
    );

    expect(arrays.pitchOffsets.slice(0, 3)).toEqual([0.75, 2.25, 1]);
    expect(arrays.pitchOffsets.slice(3)).toEqual([0, 0]);
    expect(arrays.rateScales.slice(0, 3)).toEqual([1.2, 1.2, 1.2]);
    expect(arrays.rateScales.slice(3)).toEqual([1, 1]);
    expect(arrays.energyScales.slice(0, 3)).toEqual([1.15, 1.15, 1.15]);
    expect(arrays.energyScales.slice(3)).toEqual([1, 1]);
    expect(arrays.emphasisScales.slice(0, 3)).toEqual([0.5, 0.5, 0.5]);
    expect(arrays.emphasisScales.slice(3)).toEqual([0, 0]);
    expect(arrays.pauseOverrides[2]).toBe(0.11);
  });

  it('maps vertical touch drag to clamped phrase pitch', () => {
    expect(phrasePitchFromDrag(0, -36)).toBe(1);
    expect(phrasePitchFromDrag(0.5, 18)).toBe(0);
    expect(phrasePitchFromDrag(2.8, -100)).toBe(3);
    expect(phrasePitchFromDrag(-2.8, 100)).toBe(-3);
  });

  it('maps three-point phrase curves and drag values deterministically', () => {
    expect(phraseCurveAtProgress(-1, 1, 0, 0)).toBe(-1);
    expect(phraseCurveAtProgress(-1, 1, 0, 0.5)).toBe(1);
    expect(phraseCurveAtProgress(-1, 1, 0, 1)).toBe(0);
    expect(phraseCurvePointFromDrag(0, -26)).toBe(1);
    expect(phraseCurvePointFromDrag(2.4, -100)).toBe(2.5);
  });

  it('smooths the phrase F0 curve near the handles instead of using linear corners', () => {
    expect(phraseCurveAtProgress(0, 2, 0, 0.125)).toBeCloseTo(0.3125, 8);
    expect(phraseCurveAtProgress(0, 2, 0, 0.25)).toBeCloseTo(1, 8);
    expect(phraseCurveAtProgress(0, 2, 0, 0.375)).toBeCloseTo(1.6875, 8);
    expect(phraseCurveAtProgress(0, 2, 0, 0.625)).toBeCloseTo(1.6875, 8);
  });

  it('provides distinct emphasis presets', () => {
    expect(phraseEmphasisPreset('weak')).toEqual({ energyScale: 0.88, emphasis: 0 });
    expect(phraseEmphasisPreset('normal')).toEqual({ energyScale: 1, emphasis: 0 });
    expect(phraseEmphasisPreset('strong').emphasis).toBeGreaterThan(0);
    expect(phraseEmphasisPreset('critical').emphasis)
      .toBeGreaterThan(phraseEmphasisPreset('strong').emphasis);
  });

  it('keeps only the latest boundary override for a mora boundary', () => {
    const result = updatePhraseBoundaryOverride(
      [{ after: 2, boundary: 'accent', pauseSeconds: 0.06 }],
      { after: 2, boundary: 'none', pauseSeconds: 0 },
    );

    expect(result).toEqual([{ after: 2, boundary: 'none', pauseSeconds: 0 }]);
  });

  it('clamps phrase shape controls and removes neutral shapes', () => {
    const clamped = updatePhraseShapeOverride([], {
      start: 1,
      end: 3,
      pitchOffset: 99,
      rateScale: 99,
      energyScale: 99,
      emphasis: 99,
      curveStart: 99,
      curvePeak: -99,
      curveEnd: 99,
    });
    expect(clamped).toEqual([{
      start: 1,
      end: 3,
      pitchOffset: 3,
      rateScale: 1.35,
      energyScale: 1.45,
      emphasis: 1.5,
      curveStart: 2.5,
      curvePeak: -2.5,
      curveEnd: 2.5,
    }]);

    expect(updatePhraseShapeOverride(clamped, {
      start: 1,
      end: 3,
      pitchOffset: 0,
      rateScale: 1,
      energyScale: 1,
      emphasis: 0,
      curveStart: 0,
      curvePeak: 0,
      curveEnd: 0,
    })).toEqual([]);
  });
});
