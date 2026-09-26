import { describe, expect, it } from 'vitest';
import {
  finalizeVoiceUnits,
  parseVoiceScript,
  prosodyOffset,
  prosodyOffsetForUnit,
} from '../src/voice/VoiceScript';

describe('Voice Lab speech planning', () => {
  it('parses hiragana and katakana into the same phonetic units', () => {
    const hira = parseVoiceScript('こんにちは');
    const kata = parseVoiceScript('コンニチハ');

    expect(hira.units.map((unit) => unit.syllable)).toEqual(['ko', 'n', 'ni', 'chi', 'ha']);
    expect(kata.units.map((unit) => unit.syllable)).toEqual(hira.units.map((unit) => unit.syllable));
    expect(hira.unsupported).toEqual([]);
  });

  it('handles contracted kana and long vowels as morae', () => {
    const script = parseVoiceScript('きょう、しゅー');

    expect(script.units[0]?.syllable).toBe('kyo');
    expect(script.units[1]?.syllable).toBe('u');
    expect(script.units[2]?.syllable).toBe('shu');
    expect(script.units[3]?.vowel).toBe('u');
    expect(script.units[3]?.longVowel).toBe(true);
    expect(script.units[1]?.pauseAfter).toBeGreaterThan(0.1);
  });

  it('marks sokuon on the following consonant mora', () => {
    const script = parseVoiceScript('きって');

    expect(script.units.map((unit) => unit.syllable)).toEqual(['ki', 'te']);
    expect(script.units[0]?.geminateBefore).toBe(false);
    expect(script.units[1]?.geminateBefore).toBe(true);
  });

  it('marks sentence punctuation and accent phrase boundaries', () => {
    const script = parseVoiceScript('あさ ひる、よる。');

    expect(script.units[0]?.phraseStart).toBe(true);
    expect(script.units[1]?.accentEnd).toBe(true);
    expect(script.units[2]?.accentStart).toBe(true);
    expect(script.units[3]?.accentEnd).toBe(true);
    expect(script.units[4]?.accentStart).toBe(true);
    expect(script.units[5]?.phraseEnd).toBe(true);
  });

  it('devoices isolated high vowels between voiceless consonants without erasing consecutive morae', () => {
    const script = parseVoiceScript('すき');

    expect(script.units[0]?.syllable).toBe('su');
    expect(script.units[0]?.devoiced).toBe(true);
    expect(script.units[1]?.devoiced).toBe(false);
  });

  it('preserves lexical-high morae instead of fully devoicing them', () => {
    const script = parseVoiceScript('すき');
    expect(script.units[0]?.devoiced).toBe(true);

    script.units[0]!.pitchAccent = 'high';
    finalizeVoiceUnits(script.units);

    expect(script.units[0]?.devoiced).toBe(false);
  });

  it('reports kanji instead of silently inventing a reading', () => {
    const script = parseVoiceScript('音声です');
    expect(script.units.length).toBeGreaterThan(0);
    expect(script.unsupported).toContain('音');
    expect(script.unsupported).toContain('声');
  });

  it('provides distinct controllable global prosody shapes', () => {
    const risingStart = prosodyOffset(0, 5, 'rise', true, false);
    const risingEnd = prosodyOffset(4, 5, 'rise', false, true);
    const fallingStart = prosodyOffset(0, 5, 'fall', true, false);
    const fallingEnd = prosodyOffset(4, 5, 'fall', false, true);
    const questionEnd = prosodyOffset(4, 5, 'question', false, true);

    expect(risingEnd).toBeGreaterThan(risingStart);
    expect(fallingEnd).toBeLessThan(fallingStart);
    expect(questionEnd).toBeGreaterThan(1.5);
  });

  it('adds mora-level accent phrase motion while keeping flat mode flat', () => {
    const script = parseVoiceScript('あさ ひる。');
    const first = script.units[0]!;
    const secondPhraseStart = script.units[2]!;
    const final = script.units[3]!;

    expect(prosodyOffsetForUnit(first, 0, script.units.length, 'flat')).toBe(0);
    expect(prosodyOffsetForUnit(secondPhraseStart, 2, script.units.length, 'natural')).not.toBe(0);
    expect(prosodyOffsetForUnit(final, 3, script.units.length, 'question'))
      .toBeGreaterThan(prosodyOffsetForUnit(final, 3, script.units.length, 'natural'));
  });
});
