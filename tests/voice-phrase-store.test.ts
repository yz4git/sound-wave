import { describe, expect, it } from 'vitest';
import {
  clearVoicePhraseEdits,
  loadVoicePhraseEdits,
  saveVoicePhraseEdits,
} from '../src/voice/VoicePhraseStore';

class MemoryStorage implements Storage {
  private readonly data = new Map<string, string>();
  get length(): number { return this.data.size; }
  clear(): void { this.data.clear(); }
  getItem(key: string): string | null { return this.data.get(key) ?? null; }
  key(index: number): string | null { return [...this.data.keys()][index] ?? null; }
  removeItem(key: string): void { this.data.delete(key); }
  setItem(key: string, value: string): void { this.data.set(key, value); }
}

describe('VOICE LAB phrase edit persistence', () => {
  it('restores phrase boundary and shape edits only for the same text', () => {
    const storage = new MemoryStorage();
    saveVoicePhraseEdits(
      storage,
      '今日は静かです',
      [{ after: 2, boundary: 'accent', pauseSeconds: 0.09 }],
      [{ start: 0, end: 2, pitchOffset: 0.5, rateScale: 0.9 }],
      100,
    );

    expect(loadVoicePhraseEdits(storage, '今日は静かです')).toEqual({
      boundaries: [{ after: 2, boundary: 'accent', pauseSeconds: 0.09 }],
      shapes: [{ start: 0, end: 2, pitchOffset: 0.5, rateScale: 0.9 }],
    });
    expect(loadVoicePhraseEdits(storage, '別の文章')).toEqual({
      boundaries: [],
      shapes: [],
    });
  });

  it('clamps malformed phrase values', () => {
    const storage = new MemoryStorage();
    saveVoicePhraseEdits(
      storage,
      'テスト',
      [{ after: 1, boundary: 'accent', pauseSeconds: 99 }],
      [{ start: 0, end: 1, pitchOffset: 99, rateScale: 99 }],
    );

    expect(loadVoicePhraseEdits(storage, 'テスト')).toEqual({
      boundaries: [{ after: 1, boundary: 'accent', pauseSeconds: 0.36 }],
      shapes: [{ start: 0, end: 1, pitchOffset: 3, rateScale: 1.35 }],
    });
  });

  it('clears all phrase edits for the current text', () => {
    const storage = new MemoryStorage();
    saveVoicePhraseEdits(
      storage,
      'テスト',
      [{ after: 0, boundary: 'none', pauseSeconds: 0 }],
      [],
    );
    clearVoicePhraseEdits(storage, 'テスト');

    expect(loadVoicePhraseEdits(storage, 'テスト')).toEqual({
      boundaries: [],
      shapes: [],
    });
  });
});
