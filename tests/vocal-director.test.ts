import { describe, expect, it } from 'vitest';
import { genreStyle } from '../src/compose/GenreStyle';
import { autoVocalDirectorFor, vocalDirectorControlFor } from '../src/compose/VocalDirector';

describe('Vocal Director v1', () => {
  it('resolves AUTO from genre context', () => {
    expect(autoVocalDirectorFor(genreStyle('j-pop', 'idol-pop'))).toBe('cute');
    expect(autoVocalDirectorFor(genreStyle('rock', 'hard-rock'))).toBe('energetic');
    expect(autoVocalDirectorFor(genreStyle('k-pop', 'dance-pop'))).toBe('cool');
    expect(autoVocalDirectorFor(genreStyle('j-pop', 'city-pop'))).toBe('intimate');
  });

  it('changes performance dimensions without extreme values', () => {
    const profile = genreStyle('j-pop', 'mainstream');
    const sad = vocalDirectorControlFor(profile, 'sad');
    const energetic = vocalDirectorControlFor(profile, 'energetic');
    expect(sad.airScale).toBeGreaterThan(energetic.airScale);
    expect(sad.releaseScale).toBeGreaterThan(energetic.releaseScale);
    expect(energetic.attackScale).toBeLessThan(sad.attackScale);
    expect(energetic.articulationScale).toBeGreaterThan(sad.articulationScale);
    for (const control of [sad, energetic]) {
      expect(control.jitterScale).toBeGreaterThanOrEqual(0.7);
      expect(control.ensembleScale).toBeLessThanOrEqual(1.14);
    }
  });
});
