import { describe, expect, it } from 'vitest';
import {
  applyPhraseBoundaryOverrides,
  buildPhraseControlArrays,
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
      }],
      [{
        after: 2,
        boundary: 'accent',
        pauseSeconds: 0.11,
      }],
    );

    expect(arrays.pitchOffsets.slice(0, 3)).toEqual([1.25, 1.25, 1.25]);
    expect(arrays.pitchOffsets.slice(3)).toEqual([0, 0]);
    expect(arrays.rateScales.slice(0, 3)).toEqual([1.2, 1.2, 1.2]);
    expect(arrays.rateScales.slice(3)).toEqual([1, 1]);
    expect(arrays.energyScales.slice(0, 3)).toEqual([1.15, 1.15, 1.15]);
    expect(arrays.energyScales.slice(3)).toEqual([1, 1]);
    expect(arrays.emphasisScales.slice(0, 3)).toEqual([0.5, 0.5, 0.5]);
    expect(arrays.emphasisScales.slice(3)).toEqual([0, 0]);
    expect(arrays.pauseOverrides[2]).toBe(0.11);
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
    });
    expect(clamped).toEqual([{
      start: 1,
      end: 3,
      pitchOffset: 3,
      rateScale: 1.35,
      energyScale: 1.45,
      emphasis: 1.5,
    }]);

    expect(updatePhraseShapeOverride(clamped, {
      start: 1,
      end: 3,
      pitchOffset: 0,
      rateScale: 1,
      energyScale: 1,
      emphasis: 0,
    })).toEqual([]);
  });
});
