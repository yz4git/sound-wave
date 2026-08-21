import { describe, expect, it } from 'vitest';
import { defaultFullSongSettings, generateFullSongComposition } from '../src/compose/FullSongComposer';
import { genreStyle } from '../src/compose/GenreStyle';
import { applyJapaneseLyrics } from '../src/compose/JapaneseLyrics';
import { generateVocalLine } from '../src/compose/VocalGenerator';

describe('Japanese Lyrics Engine', () => {
  it('assigns original Japanese mora lyrics deterministically', () => {
    const composition = generateFullSongComposition({ ...defaultFullSongSettings(404), seed: 404 });
    const profile = genreStyle('j-pop', 'mainstream');
    const raw = generateVocalLine(composition, 505);
    const first = applyJapaneseLyrics(composition, profile, raw);
    const second = applyJapaneseLyrics(composition, profile, raw);
    expect(first.events.length).toBeGreaterThan(0);
    expect(first.events.map((event) => `${event.lyric}:${event.lyricLine}`)).toEqual(
      second.events.map((event) => `${event.lyric}:${event.lyricLine}`),
    );
    expect(first.events.every((event) => /[ぁ-んァ-ン一-龯]/u.test(event.lyric))).toBe(true);
    expect(first.events.every((event) => /^[a-z]+$/i.test(event.syllable))).toBe(true);
  });

  it('keeps low-vocal intro and interlude sections instrumental', () => {
    const composition = generateFullSongComposition({ ...defaultFullSongSettings(606), seed: 606 });
    const profile = genreStyle('j-pop', 'mainstream');
    const raw = generateVocalLine(composition, 707);
    const lyrics = applyJapaneseLyrics(composition, profile, raw);
    for (const section of composition.songSections.filter((candidate) => candidate.vocalScale <= 0.24)) {
      const start = section.startBar * 16;
      const end = (section.startBar + section.bars) * 16;
      expect(lyrics.events.some((event) => event.step >= start && event.step < end)).toBe(false);
    }
  });

  it('chooses theme families from the selected genre', () => {
    const kpopSettings = { ...defaultFullSongSettings(808), genre: 'k-pop' as const, subgenre: 'dance-pop', seed: 808 };
    const kpop = generateFullSongComposition(kpopSettings);
    const result = applyJapaneseLyrics(kpop, genreStyle('k-pop', 'dance-pop'), generateVocalLine(kpop, 909));
    expect(result.theme).toBe('future');
    expect(result.lines.length).toBeGreaterThan(0);
  });
});
