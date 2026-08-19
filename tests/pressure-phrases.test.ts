import { describe, expect, it } from 'vitest';
import { applyHarmonicIntent } from '../src/core/music';
import {
  advanceGame,
  barDurationMs,
  createGameState,
  handleIntent,
  startGame,
} from '../src/game/GameEngine';

describe('pressure phrase goals', () => {
  it('rewards resolving amplified pressure for AMPLIFY → RELEASE', () => {
    let state = startGame(createGameState(301));
    const priority = [...state.pressure.waves].sort((a, b) => a.etaMs - b.etaMs)[0];
    expect(priority).toBeDefined();
    if (!priority) return;

    let tenseMusic = state.music;
    for (let i = 0; i < 3 && tenseMusic.tension < 0.65; i += 1) {
      tenseMusic = applyHarmonicIntent(tenseMusic, 'intensify');
    }

    state = {
      ...state,
      music: tenseMusic,
      phraseGoal: {
        id: 'risk-release',
        name: 'AMPLIFY → RELEASE',
        description: 'test',
        progress: 0,
        target: 2,
      },
      pressure: {
        ...state.pressure,
        waves: state.pressure.waves.map((wave, index) => index < 2 ? { ...wave, amplified: true } : wave),
      },
    };

    state = handleIntent(state, 'resolve');

    expect(state.lastInput?.judgement).toBe('perfect');
    expect(state.phraseGoal.progress).toBeGreaterThan(0);
    expect(state.pressure.lastEvent?.type).toBe('resolve');
    expect(state.pressure.lastEvent?.scoreBonus ?? 0).toBeGreaterThan(0);
  });

  it('rewards ending bars with a stable core for HOLD THE CORE', () => {
    let state = startGame(createGameState(302));
    state = {
      ...state,
      phaseMs: barDurationMs(state.bpm) - 1,
      phraseGoal: {
        id: 'core-stability',
        name: 'HOLD THE CORE',
        description: 'test',
        progress: 0,
        target: 4,
      },
      pressure: {
        ...state.pressure,
        stability: 0.82,
        waves: [],
      },
    };

    state = advanceGame(state, 16);

    expect(state.bar).toBe(1);
    expect(state.phraseGoal.progress).toBe(1);
    expect(state.pressure.stability).toBeGreaterThanOrEqual(0.82);
  });
});
