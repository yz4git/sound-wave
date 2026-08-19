import { describe, expect, it } from 'vitest';
import {
  advanceGame,
  barDurationMs,
  coherenceForIntent,
  createGameState,
  handleIntent,
  selectModifier,
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

describe('intentional play pressure', () => {
  it('scores a target only once and raises overplay on repeated taps', () => {
    let state = startGame(createGameState(77));
    state = handleIntent(state, 'intensify');
    const scoreAfterFirst = state.score;
    const comboAfterFirst = state.combo;
    const flowAfterFirst = state.flow;
    state = handleIntent(state, 'intensify');
    expect(state.score).toBe(scoreAfterFirst);
    expect(state.combo).toBe(comboAfterFirst);
    expect(state.lastInput?.judgement).toBe('echo');
    expect(state.overplay).toBeGreaterThan(0);
    expect(state.flow).toBeLessThan(flowAfterFirst);
  });

  it('reduces otherwise identical hit value while overplay is high', () => {
    const cleanBase = startGame(createGameState(55));
    const clean = handleIntent(cleanBase, 'intensify');
    const pressured = handleIntent({ ...cleanBase, overplay: 0.9 }, 'intensify');
    expect(clean.lastInput?.judgement).toBe('perfect');
    expect(pressured.lastInput?.judgement).toBe('perfect');
    expect(pressured.lastInput?.scoreDelta ?? 0).toBeLessThan(clean.lastInput?.scoreDelta ?? 0);
  });

  it('tracks phrase progress from deliberate musical actions', () => {
    let state = startGame(createGameState(9));
    state = {
      ...state,
      phraseGoal: {
        id: 'rising-pressure',
        name: 'BUILD THE WAVE',
        description: 'test',
        progress: 0,
        target: 5,
      },
    };
    state = handleIntent(state, 'intensify');
    expect(state.phraseGoal.progress).toBe(1);
  });
});

describe('run structure', () => {
  it('pauses progression for a three-choice mutation every four bars', () => {
    let state = startGame(createGameState(123));
    let guard = 0;
    while (state.bar < 4 && guard < 100) {
      state = advanceGame(state, 250);
      guard += 1;
    }
    expect(state.bar).toBe(4);
    expect(state.pendingModifierChoices.length).toBeGreaterThan(0);
    expect(state.pendingModifierChoices.length).toBeLessThanOrEqual(3);

    const frozenPhase = state.phaseMs;
    state = advanceGame(state, 250);
    expect(state.phaseMs).toBe(frozenPhase);

    const choice = state.pendingModifierChoices[0];
    expect(choice).toBeDefined();
    if (choice) state = selectModifier(state, choice);
    expect(state.pendingModifierChoices).toEqual([]);
    expect(state.activeModifiers.length).toBe(1);
  });
});
