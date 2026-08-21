import { describe, expect, it } from 'vitest';
import { arrangementInstrumentAccents } from '../src/compose/ArrangementInstruments';
import { buildGenreArrangement } from '../src/compose/GenreArrangement';
import { genreStyle } from '../src/compose/GenreStyle';

describe('Arrangement Instruments v2', () => {
  it('adds J-pop piano in verse and pad/strings in chorus', () => {
    const profile = genreStyle('j-pop', 'mainstream');
    const bars = buildGenreArrangement(profile, 8);
    const verse = bars.find((bar) => bar.section === 'verse');
    const chorus = bars.find((bar) => bar.section === 'chorus');
    const verseNames = arrangementInstrumentAccents(profile, verse, 0).map((item) => item.instrument);
    const chorusNames = arrangementInstrumentAccents(profile, chorus, 0).map((item) => item.instrument);
    expect(verseNames).toContain('piano');
    expect(chorusNames).toContain('pad');
    expect(chorusNames).toContain('strings');
  });

  it('uses genre-specific production layers', () => {
    const rock = genreStyle('rock', 'pop-rock');
    const kpop = genreStyle('k-pop', 'dance-pop');
    const game = genreStyle('game-music', 'battle');
    const rockBar = buildGenreArrangement(rock, 8).find((bar) => bar.section === 'chorus');
    const kpopBar = buildGenreArrangement(kpop, 8).find((bar) => bar.section === 'drop');
    const gameBar = buildGenreArrangement(game, 8).find((bar) => bar.section === 'climax');
    expect(arrangementInstrumentAccents(rock, rockBar, 0).some((item) => item.instrument === 'rhythm-guitar')).toBe(true);
    expect(arrangementInstrumentAccents(kpop, kpopBar, 2).some((item) => item.instrument === 'pluck')).toBe(true);
    expect(arrangementInstrumentAccents(game, gameBar, 0).some((item) => item.instrument === 'brass')).toBe(true);
  });
});
