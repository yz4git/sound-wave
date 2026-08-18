import { describe, expect, it } from 'vitest';
import {
  advanceGame,
  barDurationMs,
  coherenceForIntent,
  createGameState,
  handleIntent,
  startGame,
} from '../src/game/GameEngine';
import { applyHarmonicIntent } from '../src/core/music';

describe('game flow model', () => {
  it('prefers resolve when tension is high', () => {
    const base = createGameState(1);
    const tenseMusic = applyHarmonicIntent(base.music, 'intensify');
    expect(coherenceForIntent(tenseMusic, 'resolve')).toBeGreaterThan(
      coherenceForIntent(tenseMusic, 'intensify'),
    );
  });

  it('advances into a newly generated bar', () => {
    let state = startGame(createGameState(2));
    state = advanceGame(state, 250);
    const duration = barDurationMs(state.bpm);
    for (let elapsed = 250; elapsed < duration + 300; elapsed += 250) {
      state = advanceGame(state, 250);
    }
    expect(state.bar).toBeGreaterThanOrEqual(1);
  });

  it('turns a well-timed intent into score and musical state change', () => {
    let state = startGame(createGameState(3));
    state = handleIntent(state, 'intensify');
    expect(state.score).toBeGreaterThan(0);
    expect(state.combo).toBe(1);
    expect(state.music.tension).toBeGreaterThan(0.2);
    expect(state.lastInput?.judgement).toBe('perfect');
  });
});
