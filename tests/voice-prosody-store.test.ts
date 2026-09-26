import { describe, expect, it } from 'vitest';
import {
  clearVoiceProsodySnapshot,
  hasMeaningfulProsodyEdits,
  loadVoiceProsodySnapshot,
  saveVoiceProsodySnapshot,
  voiceProsodyKey,
} from '../src/voice/VoiceProsodyStore';

class MemoryStorage implements Storage {
  private readonly data = new Map<string, string>();

  get length(): number { return this.data.size; }

  clear(): void { this.data.clear(); }

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.data.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

describe('VOICE LAB prosody persistence', () => {
  it('uses a stable per-text key', () => {
    expect(voiceProsodyKey('おはよう')).toBe(voiceProsodyKey('おはよう'));
    expect(voiceProsodyKey('おはよう')).not.toBe(voiceProsodyKey('こんばんは'));
  });

  it('saves and restores pitch, energy and duration edits for the same text', () => {
    const storage = new MemoryStorage();
    const text = '今日は静かに話します';

    saveVoiceProsodySnapshot(
      storage,
      text,
      4,
      [0, 1.25, 0, -0.4],
      [1, 0.72, 1, 1.18],
      [1, 1.35, 0.9, 1],
      123,
    );

    const restored = loadVoiceProsodySnapshot(storage, text, 4);
    expect(restored).not.toBeNull();
    expect(restored?.pitch).toEqual([0, 1.25, 0, -0.4]);
    expect(restored?.energy).toEqual([1, 0.72, 1, 1.18]);
    expect(restored?.duration).toEqual([1, 1.35, 0.9, 1]);
    expect(restored?.updatedAt).toBe(123);
  });

  it('does not apply a curve to a different text or different mora count', () => {
    const storage = new MemoryStorage();
    saveVoiceProsodySnapshot(storage, '同じ文章', 3, [1, 0, 0], [1, 1, 1], [1, 1, 1]);

    expect(loadVoiceProsodySnapshot(storage, '別の文章', 3)).toBeNull();
    expect(loadVoiceProsodySnapshot(storage, '同じ文章', 4)).toBeNull();
  });

  it('removes the stored curve when all values return to neutral', () => {
    const storage = new MemoryStorage();
    const text = '保存テスト';

    saveVoiceProsodySnapshot(storage, text, 2, [1, 0], [1, 1], [1, 1]);
    expect(loadVoiceProsodySnapshot(storage, text, 2)).not.toBeNull();

    saveVoiceProsodySnapshot(storage, text, 2, [0, 0], [1, 1], [1, 1]);
    expect(loadVoiceProsodySnapshot(storage, text, 2)).toBeNull();
  });

  it('clamps corrupted values and supports explicit clearing', () => {
    const storage = new MemoryStorage();
    const text = 'クランプ';
    saveVoiceProsodySnapshot(
      storage,
      text,
      2,
      [99, -99],
      [0, 99],
      [0, 99],
    );

    const restored = loadVoiceProsodySnapshot(storage, text, 2);
    expect(restored?.pitch).toEqual([3, -3]);
    expect(restored?.energy).toEqual([0.45, 1.55]);
    expect(restored?.duration).toEqual([0.6, 1.65]);

    clearVoiceProsodySnapshot(storage, text);
    expect(loadVoiceProsodySnapshot(storage, text, 2)).toBeNull();
  });

  it('detects whether any lane actually contains a manual edit', () => {
    expect(hasMeaningfulProsodyEdits([0], [1], [1])).toBe(false);
    expect(hasMeaningfulProsodyEdits([0.05], [1], [1])).toBe(true);
    expect(hasMeaningfulProsodyEdits([0], [0.9], [1])).toBe(true);
    expect(hasMeaningfulProsodyEdits([0], [1], [1.1])).toBe(true);
  });
});
