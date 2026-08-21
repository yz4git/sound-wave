import { describe, expect, it } from 'vitest';
import { defaultFullSongSettings, fullSongSectionAtStep, generateFullSongComposition } from '../src/compose/FullSongComposer';
import { genreStyle } from '../src/compose/GenreStyle';
import { applyJapaneseLyricsV2 } from '../src/compose/JapaneseLyricsV2';
import { generateVocalLine } from '../src/compose/VocalGenerator';

describe('Japanese Lyrics v2', () => {
  it('creates section-aware Japanese story lyrics and preserves mora events', () => {
    const composition = generateFullSongComposition({ ...defaultFullSongSettings(777), seed: 777 });
    const profile = genreStyle(composition.settings.genre, composition.settings.subgenre);
    const result = applyJapaneseLyricsV2(composition, profile, generateVocalLine(composition));
    expect(result.events.length).toBeGreaterThan(20);
    expect(result.lines.length).toBeGreaterThan(4);
    expect(result.events.every((event) => event.lyric.length > 0 && event.lyricLine.length > 0)).toBe(true);
    expect(result.events.some((event) => /[ぁ-ん一-龯]/.test(event.lyricLine))).toBe(true);
    expect(result.events[0]?.phraseStart).toBe(true);
  });

  it('uses a changed conclusion in the final hook', () => {
    const composition = generateFullSongComposition({ ...defaultFullSongSettings(991), seed: 991 });
    const profile = genreStyle(composition.settings.genre, composition.settings.subgenre);
    const result = applyJapaneseLyricsV2(composition, profile, generateVocalLine(composition));
    const chorusEvents = result.events.filter((event) => fullSongSectionAtStep(composition, event.step)?.kind === 'chorus');
    const chorusSections = composition.songSections.filter((section) => section.kind === 'chorus');
    expect(chorusSections.length).toBeGreaterThanOrEqual(2);
    const firstIndex = chorusSections[0]?.index;
    const finalIndex = chorusSections.at(-1)?.index;
    const firstLines = new Set(chorusEvents.filter((event) => fullSongSectionAtStep(composition, event.step)?.index === firstIndex).map((event) => event.lyricLine));
    const finalLines = new Set(chorusEvents.filter((event) => fullSongSectionAtStep(composition, event.step)?.index === finalIndex).map((event) => event.lyricLine));
    expect([...finalLines].some((line) => !firstLines.has(line))).toBe(true);
  });
});
