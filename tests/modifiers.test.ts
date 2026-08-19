import { describe, expect, it } from 'vitest';
import { calculateModifierBonus, chooseModifier, chooseModifierOptions } from '../src/game/RunModifiers';

describe('run modifiers', () => {
  it('chooses only an unowned modifier', () => {
    const owned = ['resonant-release', 'offbeat-engine'] as const;
    const next = chooseModifier(owned, 1234);
    expect(next).not.toBeNull();
    expect(owned.includes(next as (typeof owned)[number])).toBe(false);
  });

  it('offers up to three unique unowned mutations', () => {
    const owned = ['resonant-release'] as const;
    const options = chooseModifierOptions(owned, 9876, 3);
    expect(options).toHaveLength(3);
    expect(new Set(options).size).toBe(options.length);
    expect(options).not.toContain('resonant-release');
  });

  it('rewards high-tension resolution when Resonant Release is active', () => {
    const bonus = calculateModifierBonus(['resonant-release'], {
      intent: 'resolve',
      judgement: 'perfect',
      tension: 0.8,
      syncopated: false,
      polyrhythm: 1,
    });
    expect(bonus.scoreMultiplier).toBeCloseTo(1.35);
    expect(bonus.triggered).toContain('resonant-release');
  });
});
