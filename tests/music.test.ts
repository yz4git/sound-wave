import { describe, expect, it } from 'vitest';
import {
  applyHarmonicIntent,
  chordAtDegree,
  createInitialMusicState,
  resolutionStrength,
  scaleFor,
  voiceLeadingDistance,
} from '../src/core/music';

describe('music theory engine', () => {
  it('builds the C major scale', () => {
    expect(scaleFor({ tonic: 0, mode: 'major' })).toEqual([0, 2, 4, 5, 7, 9, 11]);
  });

  it('classifies degree V as dominant and I as tonic', () => {
    expect(chordAtDegree({ tonic: 0, mode: 'major' }, 4).function).toBe('dominant');
    expect(chordAtDegree({ tonic: 0, mode: 'major' }, 0).function).toBe('tonic');
  });

  it('rates dominant to tonic as a strong resolution', () => {
    const dominant = chordAtDegree({ tonic: 0, mode: 'major' }, 4);
    const tonic = chordAtDegree({ tonic: 0, mode: 'major' }, 0);
    expect(resolutionStrength(dominant, tonic)).toBeGreaterThan(0.7);
  });

  it('keeps voice-leading normalized', () => {
    const a = chordAtDegree({ tonic: 0, mode: 'minor' }, 0);
    const b = chordAtDegree({ tonic: 0, mode: 'minor' }, 4);
    expect(voiceLeadingDistance(a, b)).toBeGreaterThanOrEqual(0);
    expect(voiceLeadingDistance(a, b)).toBeLessThanOrEqual(1);
  });

  it('intensify raises tension and resolve can release it', () => {
    const initial = createInitialMusicState({ tonic: 0, mode: 'minor' });
    const tense = applyHarmonicIntent(initial, 'intensify');
    const resolved = applyHarmonicIntent(tense, 'resolve');
    expect(tense.tension).toBeGreaterThan(initial.tension);
    expect(resolved.tension).toBeLessThan(tense.tension);
    expect(resolved.resolution).toBeGreaterThan(0.6);
  });
});
