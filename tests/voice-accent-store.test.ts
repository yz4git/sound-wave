import { describe, expect, it } from 'vitest';
import {
  clearVoiceAccentOverrides,
  loadVoiceAccentOverrides,
  saveVoiceAccentOverrides,
} from '../src/voice/VoiceAccentStore';

class MemoryStorage implements Storage {
  private readonly data = new Map<string, string>();
  get length(): number { return this.data.size; }
  clear(): void { this.data.clear(); }
  getItem(key: string): string | null { return this.data.get(key) ?? null; }
  key(index: number): string | null { return [...this.data.keys()][index] ?? null; }
  removeItem(key: string): void { this.data.delete(key); }
  setItem(key: string, value: string): void { this.data.set(key, value); }
}

describe('VOICE LAB accent override persistence', () => {
  it('restores accent overrides only for the same text', () => {
    const storage = new MemoryStorage();
    saveVoiceAccentOverrides(storage, '今日は静かです', [
      { start: 0, end: 2, nucleus: 1 },
      { start: 3, end: 5, nucleus: 0 },
    ], 100);

    expect(loadVoiceAccentOverrides(storage, '今日は静かです')).toEqual([
      { start: 0, end: 2, nucleus: 1 },
      { start: 3, end: 5, nucleus: 0 },
    ]);
    expect(loadVoiceAccentOverrides(storage, '別の文章')).toEqual([]);
  });

  it('clamps invalid nucleus values to the phrase length', () => {
    const storage = new MemoryStorage();
    saveVoiceAccentOverrides(storage, 'テスト', [
      { start: 4, end: 6, nucleus: 99 },
    ]);

    expect(loadVoiceAccentOverrides(storage, 'テスト')).toEqual([
      { start: 4, end: 6, nucleus: 3 },
    ]);
  });

  it('clears all overrides for the current text', () => {
    const storage = new MemoryStorage();
    saveVoiceAccentOverrides(storage, 'テスト', [
      { start: 0, end: 2, nucleus: 2 },
    ]);
    clearVoiceAccentOverrides(storage, 'テスト');
    expect(loadVoiceAccentOverrides(storage, 'テスト')).toEqual([]);
  });
});
