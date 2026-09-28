import { describe, expect, it } from 'vitest';
import {
  finalizeVoiceUnits,
  parseVoiceScript,
  prosodyOffset,
  prosodyOffsetForUnit,
  resolveVoiceIntonation,
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

  it('keeps sentence punctuation metadata for AUTO intonation', () => {
    const script = parseVoiceScript('あい？うえ！お。');

    expect(script.units[0]?.sentenceTerminal).toBe('question');
    expect(script.units[1]?.terminalAfter).toBe('question');
    expect(script.units[2]?.sentenceTerminal).toBe('exclamation');
    expect(script.units[3]?.terminalAfter).toBe('exclamation');
    expect(script.units[4]?.sentenceTerminal).toBe('statement');

    expect(resolveVoiceIntonation(script.units[0]!, 'auto')).toBe('question');
    expect(resolveVoiceIntonation(script.units[2]!, 'auto')).toBe('exclaim');
    expect(resolveVoiceIntonation(script.units[4]!, 'auto')).toBe('natural');
  });

  it('lets a trailing question mark dominate mixed sentence punctuation', () => {
    const script = parseVoiceScript('ほんと！？');
    const final = script.units.at(-1)!;

    expect(final.terminalAfter).toBe('question');
    expect(final.sentenceTerminal).toBe('question');
  });

  it('resets sentence-local declination for each new sentence', () => {
    const script = parseVoiceScript('あいう。あいう。');
    const firstStart = script.units[0]!;
    const secondStart = script.units[3]!;

    expect(firstStart.phraseStart).toBe(true);
    expect(secondStart.phraseStart).toBe(true);
    expect(
      prosodyOffsetForUnit(firstStart, 0, script.units.length, 'auto'),
    ).toBeCloseTo(
      prosodyOffsetForUnit(secondStart, 3, script.units.length, 'auto'),
      8,
    );
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

  it('spreads question rise across the sentence ending instead of jumping only on the final mora', () => {
    const script = parseVoiceScript('あいうえお。');
    const offsets = script.units.map((unit, index) => (
      prosodyOffsetForUnit(unit, index, script.units.length, 'question')
    ));

    expect(offsets[2]).toBeLessThan(offsets[3]!);
    expect(offsets[3]).toBeLessThan(offsets[4]!);
    expect(offsets[4]).toBeGreaterThan(1);
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
