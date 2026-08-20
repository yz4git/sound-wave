import { describe, expect, it } from 'vitest';
import { defaultComposeSettings, generateComposition } from '../src/compose/AutoComposer';
import {
  GENRE_DEFINITIONS,
  genreStyle,
  type GenreId,
} from '../src/compose/GenreStyle';
import { generateVocalLine } from '../src/compose/VocalGenerator';

describe('Auto Compose v2 Genre Style Engine', () => {
  it('ships four top-level genres and 24 selectable subgenres', () => {
    expect(GENRE_DEFINITIONS.map((genre) => genre.id)).toEqual([
      'j-pop',
      'rock',
      'k-pop',
      'game-music',
    ]);
    expect(GENRE_DEFINITIONS.reduce((total, genre) => total + genre.subgenres.length, 0)).toBe(24);
  });

  it('keeps every style profile inside safe generator and vocal ranges', () => {
    for (const genre of GENRE_DEFINITIONS) {
      expect(genre.subgenres.length).toBeGreaterThanOrEqual(5);
      for (const style of genre.subgenres) {
        expect(style.bpmRange[0]).toBeGreaterThanOrEqual(60);
        expect(style.bpmRange[1]).toBeLessThanOrEqual(190);
        expect(style.bpmRange[1]).toBeGreaterThan(style.bpmRange[0]);
        expect(style.progression).toHaveLength(4);
        expect(style.progression.every((degrees) => degrees.length >= 3)).toBe(true);
        expect(style.syncopation).toBeGreaterThanOrEqual(0);
        expect(style.syncopation).toBeLessThanOrEqual(1);
        expect(style.longNoteChance).toBeGreaterThanOrEqual(0);
        expect(style.longNoteChance).toBeLessThanOrEqual(1);
        expect(style.vocalEnergy).toBeGreaterThan(0.7);
        expect(style.vocalEnergy).toBeLessThan(1.3);
      }
    }
  });

  it('is deterministic for the same seed and style', () => {
    const settings = {
      ...defaultComposeSettings(424242),
      genre: 'k-pop' as const,
      subgenre: 'dance-pop',
      bpm: 124,
      density: 0.68,
    };
    const first = generateComposition(settings);
    const second = generateComposition(settings);
    expect(second).toEqual(first);
    expect(generateVocalLine(second, 999)).toEqual(generateVocalLine(first, 999));
  });

  it('produces materially different arrangements for the four genre families', () => {
    const genres: readonly [GenreId, string][] = [
      ['j-pop', 'mainstream'],
      ['rock', 'pop-rock'],
      ['k-pop', 'dance-pop'],
      ['game-music', 'battle'],
    ];
    const signatures = genres.map(([genre, subgenre]) => {
      const composition = generateComposition({
        ...defaultComposeSettings(778899),
        genre,
        subgenre,
        bpm: 126,
        density: 0.66,
      });
      const vocal = generateVocalLine(composition, 13579);
      return JSON.stringify({
        degrees: composition.chords.map((chord) => chord.degree),
        melody: composition.melody.map((note) => [note.step, note.pitch, note.durationSteps]),
        drums: composition.drums.map((drum) => [drum.step, drum.voice]),
        vocal: vocal.map((event) => [event.step, event.durationSteps, event.articulate]),
      });
    });
    expect(new Set(signatures).size).toBe(4);
  });

  it('encodes ballads as longer and softer-articulated vocal styles than dance pop', () => {
    const ballad = genreStyle('j-pop', 'ballad');
    const dance = genreStyle('k-pop', 'dance-pop');
    expect(ballad.longNoteChance).toBeGreaterThan(dance.longNoteChance);
    expect(ballad.vocalArticulation).toBeLessThan(dance.vocalArticulation);
    expect(ballad.melodyDensity).toBeLessThan(dance.melodyDensity);
  });

  it('resolves each default subgenre to the requested genre', () => {
    for (const definition of GENRE_DEFINITIONS) {
      const style = genreStyle(definition.id, definition.defaultSubgenre);
      expect(style.genre).toBe(definition.id);
      expect(style.id).toBe(definition.defaultSubgenre);
    }
  });
});
