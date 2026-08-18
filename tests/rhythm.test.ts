import { describe, expect, it } from 'vitest';
import {
  aggregateSkill,
  createInitialSkill,
  generateRhythmChallenge,
  judgeTiming,
  nearestActiveStep,
  targetDifficultyFor,
  updateSkill,
} from '../src/core/rhythm';

describe('adaptive rhythm engine', () => {
  it('aims slightly above current aggregate skill', () => {
    const skill = createInitialSkill();
    expect(targetDifficultyFor(skill)).toBeGreaterThan(aggregateSkill(skill));
  });

  it('generates deterministic readable challenges', () => {
    const skill = createInitialSkill();
    const a = generateRhythmChallenge(skill, 42);
    const b = generateRhythmChallenge(skill, 42);
    expect(a.steps).toEqual(b.steps);
    expect(a.steps[0]).toBe(true);
    expect(a.steps.filter(Boolean).length).toBeGreaterThanOrEqual(2);
  });

  it('improves skill estimate after accurate samples', () => {
    const before = createInitialSkill();
    const after = updateSkill(before, [
      { hit: true, errorMs: 8, syncopated: true, polyrhythmic: false },
      { hit: true, errorMs: -12, syncopated: true, polyrhythmic: false },
      { hit: true, errorMs: 4, syncopated: false, polyrhythmic: false },
    ]);
    expect(after.timing).toBeGreaterThan(before.timing);
    expect(after.syncopation).toBeGreaterThan(before.syncopation);
  });

  it('grades timing continuously instead of binary perfect/miss', () => {
    expect(judgeTiming(0, 125)).toBe(1);
    expect(judgeTiming(30, 125)).toBeGreaterThan(judgeTiming(60, 125));
  });

  it('finds the nearest active rhythm target across bar wrap', () => {
    const challenge = generateRhythmChallenge(createInitialSkill(), 7);
    const result = nearestActiveStep(challenge, 0.99);
    expect(result.distanceInSteps).toBeLessThan(1);
  });
});
