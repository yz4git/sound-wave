import { describe, expect, it } from 'vitest';
import { parseVoiceScript, prosodyOffset } from '../src/voice/VoiceScript';

describe('Voice Lab speech planning', () => {
  it('parses hiragana and katakana into the same phonetic units', () => {
    const hira = parseVoiceScript('こんにちは');
    const kata = parseVoiceScript('コンニチハ');

    expect(hira.units.map((unit) => unit.syllable)).toEqual(['ko', 'n', 'ni', 'chi', 'ha']);
    expect(kata.units.map((unit) => unit.syllable)).toEqual(hira.units.map((unit) => unit.syllable));
    expect(hira.unsupported).toEqual([]);
  });

  it('handles contracted kana and long vowels', () => {
    const script = parseVoiceScript('きょう、しゅー');

    expect(script.units[0]?.syllable).toBe('kyo');
    expect(script.units[1]?.syllable).toBe('u');
    expect(script.units[2]?.syllable).toBe('shu');
    expect(script.units[3]?.vowel).toBe('u');
    expect(script.units[1]?.pauseAfter).toBeGreaterThan(0.1);
  });

  it('marks sentence punctuation as phrase boundaries', () => {
    const script = parseVoiceScript('あさ。ひる？よる！');
    const phraseEnds = script.units.filter((unit) => unit.phraseEnd);

    expect(phraseEnds.length).toBe(3);
    expect(script.units[2]?.phraseStart).toBe(true);
    expect(script.units[4]?.phraseStart).toBe(true);
  });

  it('reports kanji instead of silently inventing a reading', () => {
    const script = parseVoiceScript('音声です');
    expect(script.units.length).toBeGreaterThan(0);
    expect(script.unsupported).toContain('音');
    expect(script.unsupported).toContain('声');
  });

  it('provides distinct controllable prosody shapes', () => {
    const risingStart = prosodyOffset(0, 5, 'rise', true, false);
    const risingEnd = prosodyOffset(4, 5, 'rise', false, true);
    const fallingStart = prosodyOffset(0, 5, 'fall', true, false);
    const fallingEnd = prosodyOffset(4, 5, 'fall', false, true);
    const questionEnd = prosodyOffset(4, 5, 'question', false, true);

    expect(risingEnd).toBeGreaterThan(risingStart);
    expect(fallingEnd).toBeLessThan(fallingStart);
    expect(questionEnd).toBeGreaterThan(1.5);
  });
});
