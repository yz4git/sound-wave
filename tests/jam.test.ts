import { describe, expect, it } from 'vitest';
import {
  advanceJamStep,
  clearJamPattern,
  createJamState,
  cycleStepVelocity,
  jamStepDurationMs,
  randomizeJamPattern,
  restoreJamState,
  serializeJamState,
  setJamTempo,
  setJamSwing,
  swingDelayMs,
  triggersForStep,
} from '../src/jam/JamMachine';

describe('Jam Lab sequencer', () => {
  it('starts with a playable four-track groove', () => {
    const state = createJamState();
    expect(triggersForStep(state, 0).some((trigger) => trigger.voice === 'kick')).toBe(true);
    expect(triggersForStep(state, 4).some((trigger) => trigger.voice === 'snare')).toBe(true);
  });

  it('cycles each sequencer cell through normal, accent and off', () => {
    let state = clearJamPattern(createJamState());
    state = cycleStepVelocity(state, 'kick', 3);
    expect(state.pattern.kick[3]).toBeCloseTo(0.72);
    state = cycleStepVelocity(state, 'kick', 3);
    expect(state.pattern.kick[3]).toBe(1);
    state = cycleStepVelocity(state, 'kick', 3);
    expect(state.pattern.kick[3]).toBe(0);
  });

  it('uses sixteenth-note timing and only delays odd swung steps', () => {
    const state = setJamSwing(setJamTempo(createJamState(), 120), 0.2);
    expect(jamStepDurationMs(state.bpm)).toBeCloseTo(125);
    expect(swingDelayMs(state, 0)).toBe(0);
    expect(swingDelayMs(state, 1)).toBeCloseTo(25);
  });

  it('wraps transport after sixteen steps', () => {
    let state = { ...createJamState(), step: 15 };
    state = advanceJamStep(state);
    expect(state.step).toBe(0);
  });

  it('randomizes deterministically from a seed', () => {
    const a = randomizeJamPattern(createJamState(), 44);
    const b = randomizeJamPattern(createJamState(), 44);
    expect(a.pattern).toEqual(b.pattern);
  });

  it('round-trips saved tempo, swing and pattern safely', () => {
    let state = setJamTempo(createJamState(), 138);
    state = setJamSwing(state, 0.24);
    state = cycleStepVelocity(state, 'clap', 7);
    const restored = restoreJamState(serializeJamState(state));
    expect(restored.bpm).toBe(138);
    expect(restored.swing).toBeCloseTo(0.24);
    expect(restored.pattern).toEqual(state.pattern);
  });
});
