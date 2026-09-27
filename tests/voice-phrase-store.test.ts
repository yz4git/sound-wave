import { describe, expect, it } from 'vitest';
import { voiceProsodyKey } from '../src/voice/VoiceProsodyStore';
import {
  clearVoicePhraseEdits,
  loadVoicePhraseEdits,
  saveVoicePhraseEdits,
  VOICE_PHRASE_STORAGE_KEY,
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
      [{ start: 0, end: 2, pitchOffset: 0.5, rateScale: 0.9, energyScale: 1.1, emphasis: 0.5, curveStart: -0.4, curvePeak: 0.8, curveEnd: -0.2 }],
      100,
    );

    expect(loadVoicePhraseEdits(storage, '今日は静かです')).toEqual({
      boundaries: [{ after: 2, boundary: 'accent', pauseSeconds: 0.09 }],
      shapes: [{ start: 0, end: 2, pitchOffset: 0.5, rateScale: 0.9, energyScale: 1.1, emphasis: 0.5, curveStart: -0.4, curvePeak: 0.8, curveEnd: -0.2 }],
    });
    expect(loadVoicePhraseEdits(storage, '別の文章')).toEqual({
      boundaries: [],
      shapes: [],
    });
  });

  it('loads older phrase saves with neutral curve defaults', () => {
    const storage = new MemoryStorage();
    const text = '旧保存';
    storage.setItem(VOICE_PHRASE_STORAGE_KEY, JSON.stringify({
      version: 1,
      entries: [{
        key: voiceProsodyKey(text),
        boundaries: [],
        shapes: [{
          start: 0,
          end: 2,
          pitchOffset: 0.5,
          rateScale: 1,
          energyScale: 1,
          emphasis: 0,
        }],
        updatedAt: 1,
      }],
    }));

    expect(loadVoicePhraseEdits(storage, text).shapes[0]).toMatchObject({
      curveStart: 0,
      curvePeak: 0,
      curveEnd: 0,
    });
  });

  it('clamps malformed phrase values', () => {
    const storage = new MemoryStorage();
    saveVoicePhraseEdits(
      storage,
      'テスト',
      [{ after: 1, boundary: 'accent', pauseSeconds: 99 }],
      [{ start: 0, end: 1, pitchOffset: 99, rateScale: 99, energyScale: 99, emphasis: 99, curveStart: 99, curvePeak: -99, curveEnd: 99 }],
    );

    expect(loadVoicePhraseEdits(storage, 'テスト')).toEqual({
      boundaries: [{ after: 1, boundary: 'accent', pauseSeconds: 0.36 }],
      shapes: [{ start: 0, end: 1, pitchOffset: 3, rateScale: 1.35, energyScale: 1.45, emphasis: 1.5, curveStart: 2.5, curvePeak: -2.5, curveEnd: 2.5 }],
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
