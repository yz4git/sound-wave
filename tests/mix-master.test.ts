import { describe, expect, it } from 'vitest';
import { buildGenreArrangement } from '../src/compose/GenreArrangement';
import { genreStyle } from '../src/compose/GenreStyle';
import { mixMasterControlFor } from '../src/compose/MixMaster';

describe('Mix & Master v1', () => {
  it('ducks accompaniment under vocals and bass under kick', () => {
    const profile = genreStyle('j-pop', 'mainstream');
    const state = buildGenreArrangement(profile, 8)[0];
    const open = mixMasterControlFor(profile, state, false, false);
    const vocal = mixMasterControlFor(profile, state, true, false);
    const kick = mixMasterControlFor(profile, state, false, true);
    expect(vocal.musicGain).toBeLessThan(open.musicGain);
    expect(kick.bassGain).toBeLessThan(open.bassGain);
    expect(kick.lowEndDuck).toBeLessThan(1);
  });

  it('widens hook sections more than verses while keeping sane gain bounds', () => {
    const profile = genreStyle('j-pop', 'mainstream');
    const bars = buildGenreArrangement(profile, 8);
    const verse = bars.find((bar) => bar.section === 'verse');
    const chorus = bars.find((bar) => bar.section === 'chorus');
    expect(verse).toBeDefined();
    expect(chorus).toBeDefined();
    const verseMix = mixMasterControlFor(profile, verse, false, false);
    const chorusMix = mixMasterControlFor(profile, chorus, false, false);
    expect(chorusMix.stereoWidth).toBeGreaterThan(verseMix.stereoWidth);
    expect(chorusMix.masterDrive).toBeLessThanOrEqual(1.035);
    expect(chorusMix.vocalGain).toBeLessThanOrEqual(1.03);
  });
});
