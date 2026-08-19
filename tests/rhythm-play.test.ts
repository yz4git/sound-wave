import { describe, expect, it } from 'vitest';
import {
  advanceRhythmPlay,
  createRhythmPlayState,
  rhythmAccuracy,
  rhythmBeatMs,
  rhythmJudgement,
  rhythmRank,
  submitRhythmInput,
} from '../src/rhythm/RhythmPlayEngine';

describe('Rhythm Play timing', () => {
  it('uses forgiving mobile-friendly timing grades', () => {
    expect(rhythmJudgement(30)).toBe('perfect');
    expect(rhythmJudgement(80)).toBe('good');
    expect(rhythmJudgement(150)).toBe('okay');
    expect(rhythmJudgement(220)).toBe('miss');
  });

  it('scores Beat Pop on the scheduled beat', () => {
    const state = createRhythmPlayState('beat-pop', 1);
    const target = state.targets[0];
    expect(target).toBeDefined();
    if (!target) return;
    const result = submitRhythmInput(state, 'tap', target.timeMs + 18);
    expect(result.judgement).toBe('perfect');
    expect(result.scoreDelta).toBe(100);
    expect(result.state.combo).toBe(1);
  });

  it('fails Echo Pair when the side is wrong even on time', () => {
    const state = createRhythmPlayState('echo-pair', 42);
    const target = state.targets[0];
    expect(target).toBeDefined();
    if (!target) return;
    const wrong = target.input === 'left' ? 'right' : 'left';
    const result = submitRhythmInput(state, wrong, target.timeMs);
    expect(result.judgement).toBe('miss');
    expect(result.scoreDelta).toBe(0);
  });

  it('marks ignored targets as misses after the grace window', () => {
    const state = createRhythmPlayState('hold-release', 7);
    const first = state.targets[0];
    expect(first).toBeDefined();
    if (!first) return;
    const advanced = advanceRhythmPlay(state, first.timeMs + 260);
    expect(advanced.targets[0]?.judgement).toBe('miss');
    expect(advanced.combo).toBe(0);
  });

  it('creates deterministic Echo Pair patterns', () => {
    const a = createRhythmPlayState('echo-pair', 99);
    const b = createRhythmPlayState('echo-pair', 99);
    expect(a.targets.map((target) => target.input)).toEqual(b.targets.map((target) => target.input));
  });

  it('wraps a completed perfect run into SUPERB rank', () => {
    let state = createRhythmPlayState('beat-pop', 2);
    for (const target of state.targets) {
      state = submitRhythmInput(state, target.input, target.timeMs).state;
    }
    expect(rhythmAccuracy(state)).toBe(1);
    expect(rhythmRank(state)).toBe('SUPERB');
    expect(state.finished).toBe(true);
  });

  it('converts bpm to a stable beat duration', () => {
    expect(rhythmBeatMs(120)).toBe(500);
  });
});
