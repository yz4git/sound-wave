import { describe, expect, it } from 'vitest';
import { defaultFullSongSettings, generateFullSongComposition } from '../src/compose/FullSongComposer';
import { genreStyle } from '../src/compose/GenreStyle';
import { applyJapaneseLyricsV2 } from '../src/compose/JapaneseLyricsV2';
import { createSongProjectSnapshot, generatedSongTitle } from '../src/compose/SongExport';
import { generateVocalLine } from '../src/compose/VocalGenerator';

describe('Song Export', () => {
  it('creates a deterministic titled project snapshot containing seed, sections and lyrics', () => {
    const composition = generateFullSongComposition({ ...defaultFullSongSettings(424242), seed: 424242 });
    const profile = genreStyle(composition.settings.genre, composition.settings.subgenre);
    const lyrics = applyJapaneseLyricsV2(composition, profile, generateVocalLine(composition));
    const snapshot = createSongProjectSnapshot(composition, lyrics.events, lyrics.theme, {
      character: 'natural', tone: 0, director: 'auto',
    });
    expect(snapshot.version).toBe('sound-wave-song-v1');
    expect(snapshot.settings.seed).toBe(424242);
    expect(snapshot.title).toBe(generatedSongTitle(lyrics.theme, 424242));
    expect(snapshot.sections.length).toBeGreaterThan(4);
    expect(snapshot.lyrics.length).toBeGreaterThan(2);
    expect(snapshot.vocal.length).toBe(lyrics.events.length);
  });
});
