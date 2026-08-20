import { describe, expect, it } from 'vitest';
import { defaultComposeSettings, generateComposition } from '../src/compose/AutoComposer';
import { buildGenreArrangement } from '../src/compose/GenreArrangement';
import { genreStyle } from '../src/compose/GenreStyle';

describe('genre arrangement fidelity', () => {
  it('gives each top-level genre a distinct eight-bar section grammar', () => {
    const jpop = buildGenreArrangement(genreStyle('j-pop', 'mainstream'), 8);
    const rock = buildGenreArrangement(genreStyle('rock', 'pop-rock'), 8);
    const kpop = buildGenreArrangement(genreStyle('k-pop', 'dance-pop'), 8);
    const game = buildGenreArrangement(genreStyle('game-music', 'battle'), 8);

    expect(jpop.map((bar) => bar.section)).toEqual([
      'verse', 'verse', 'pre', 'pre', 'chorus', 'chorus', 'chorus', 'turnaround',
    ]);
    expect(rock.map((bar) => bar.section)).toEqual([
      'riff', 'verse', 'verse', 'pre', 'chorus', 'chorus', 'break', 'chorus',
    ]);
    expect(kpop.map((bar) => bar.section)).toEqual([
      'verse', 'verse', 'pre', 'pre', 'drop', 'post', 'break', 'drop',
    ]);
    expect(game.map((bar) => bar.section)).toEqual([
      'motif', 'motif', 'development', 'development', 'climax', 'climax', 'turnaround', 'loop',
    ]);
  });

  it('assigns genre-defining chord and bass patterns', () => {
    const rock = buildGenreArrangement(genreStyle('rock', 'hard-rock'), 8);
    const kpop = buildGenreArrangement(genreStyle('k-pop', 'dance-pop'), 8);
    const game = buildGenreArrangement(genreStyle('game-music', 'battle'), 8);

    expect(rock.some((bar) => bar.chordPattern === 'power-pulse')).toBe(true);
    expect(rock.some((bar) => bar.bassPattern === 'eighth-drive')).toBe(true);
    expect(kpop.some((bar) => bar.chordPattern === 'offbeat-stabs')).toBe(true);
    expect(kpop.some((bar) => bar.bassPattern === 'syncopated-808')).toBe(true);
    expect(game.some((bar) => bar.chordPattern === 'arpeggio-pulse')).toBe(true);
    expect(game.some((bar) => bar.bassPattern === 'ostinato')).toBe(true);
  });

  it('builds a J-POP chorus with the Royal-Road core degrees before resolution', () => {
    const composition = generateComposition({
      ...defaultComposeSettings(4242),
      genre: 'j-pop',
      subgenre: 'mainstream',
      mode: 'major',
    });
    expect(composition.chords.slice(4, 7).map((item) => item.degree)).toEqual([3, 4, 2]);
    expect(composition.chords.at(-1)?.degree).toBe(0);
  });

  it('keeps K-POP drops tonic-centered and game battle endings loop-oriented', () => {
    const kpop = generateComposition({
      ...defaultComposeSettings(8080),
      genre: 'k-pop',
      subgenre: 'dance-pop',
    });
    const game = generateComposition({
      ...defaultComposeSettings(9090),
      genre: 'game-music',
      subgenre: 'battle',
    });

    expect(kpop.chords[4]?.degree).toBe(0);
    expect(kpop.chords[7]?.degree).toBe(0);
    expect(game.chords.at(-1)?.degree).toBe(4);
  });

  it('stores section energy and motif-repeat plans in the generated composition', () => {
    const composition = generateComposition({
      ...defaultComposeSettings(13579),
      genre: 'k-pop',
      subgenre: 'dance-pop',
    });
    expect(composition.arrangement).toHaveLength(composition.settings.bars);
    expect(composition.arrangement[4]?.section).toBe('drop');
    expect(composition.arrangement[4]?.energy).toBeGreaterThan(1);
    expect(composition.arrangement[7]?.hookRepeat).toBeGreaterThan(0.8);
  });
});
