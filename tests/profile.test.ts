import { describe, expect, it } from 'vitest';
import { createProfile, loadProfile, saveProfile, updateProfile } from '../src/game/Profile';
import { createInitialSkill } from '../src/core/rhythm';

class MemoryStorage {
  value: string | null = null;
  getItem(): string | null { return this.value; }
  setItem(_key: string, value: string): void { this.value = value; }
}

describe('adaptive player profile', () => {
  it('round-trips through storage', () => {
    const storage = new MemoryStorage();
    const profile = { ...createProfile(), bestScore: 9001, sessions: 3 };
    saveProfile(profile, storage);
    expect(loadProfile(storage).bestScore).toBe(9001);
    expect(loadProfile(storage).sessions).toBe(3);
  });

  it('keeps personal bests while updating learned skill', () => {
    const base = { ...createProfile(), bestScore: 500, bestCombo: 8 };
    const skill = { ...createInitialSkill(), timing: 0.8 };
    const next = updateProfile(base, skill, 400, 12);
    expect(next.bestScore).toBe(500);
    expect(next.bestCombo).toBe(12);
    expect(next.skill.timing).toBe(0.8);
  });
});
