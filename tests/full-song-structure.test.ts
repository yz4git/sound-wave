import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FULL_SONG_BARS,
  compositionLengthSteps,
  defaultFullSongSettings,
  generateFullSongComposition,
} from '../src/compose/FullSongComposer';
import { buildFullSongPlan } from '../src/compose/FullSongStructure';
import { genreStyle } from '../src/compose/GenreStyle';

describe('Auto Compose v3 full song structure', () => {
  it('builds a 56-bar J-pop song with a lifted final chorus', () => {
    const profile = genreStyle('j-pop', 'mainstream');
    const plan = buildFullSongPlan(profile, DEFAULT_FULL_SONG_BARS);
    expect(plan.sections.reduce((sum, section) => sum + section.bars, 0)).toBe(DEFAULT_FULL_SONG_BARS);
    expect(plan.arrangement).toHaveLength(DEFAULT_FULL_SONG_BARS);
    expect(plan.sections.map((section) => section.kind)).toEqual([
      'intro', 'verse', 'pre', 'chorus', 'interlude', 'verse', 'pre', 'bridge', 'chorus', 'outro',
    ]);
    const finalChorus = [...plan.sections].reverse().find((section) => section.kind === 'chorus');
    expect(finalChorus?.keyShiftSemitones).toBe(2);
  });

  it('uses genre-specific long-form structures', () => {
    const rock = buildFullSongPlan(genreStyle('rock', 'hard-rock'), 56);
    const kpop = buildFullSongPlan(genreStyle('k-pop', 'dance-pop'), 56);
    const game = buildFullSongPlan(genreStyle('game-music', 'battle'), 56);
    expect(rock.sections.some((section) => section.kind === 'chorus')).toBe(true);
    expect(kpop.sections.some((section) => section.kind === 'drop')).toBe(true);
    expect(kpop.sections.some((section) => section.kind === 'post')).toBe(true);
    expect(game.sections.some((section) => section.kind === 'climax')).toBe(true);
  });

  it('generates a deterministic complete composition while preserving the core composer contract', () => {
    const settings = { ...defaultFullSongSettings(20260821), seed: 20260821 };
    const first = generateFullSongComposition(settings);
    const second = generateFullSongComposition(settings);
    expect(first.settings.bars).toBe(DEFAULT_FULL_SONG_BARS);
    expect(first.songSections.length).toBeGreaterThan(4);
    expect(first.arrangement).toHaveLength(DEFAULT_FULL_SONG_BARS);
    expect(first.chords).toHaveLength(DEFAULT_FULL_SONG_BARS);
    expect(compositionLengthSteps(first)).toBe(DEFAULT_FULL_SONG_BARS * 16);
    expect(first.chords.map((item) => item.chord.root)).toEqual(second.chords.map((item) => item.chord.root));
    expect(first.melody.slice(0, 40)).toEqual(second.melody.slice(0, 40));
  });
});
