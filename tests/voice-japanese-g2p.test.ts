import { describe, expect, it } from 'vitest';
import {
  applyOpenJTalkFullContext,
  buildScriptFromJapaneseFrontend,
  containsAmbiguousJapaneseLongVowel,
  containsKanji,
  needsJapanesePronunciationAnalysis,
  parseOpenJTalkFullContext,
  pitchAccentPattern,
  type JapaneseFrontendNode,
} from '../src/voice/JapaneseG2P';
import { prosodyOffsetForUnit } from '../src/voice/VoiceScript';

describe('VOICE LAB Japanese G2P mapping', () => {
  it('creates standard Japanese pitch-accent patterns', () => {
    expect(pitchAccentPattern(4, 0)).toEqual(['low', 'high', 'high', 'high']);
    expect(pitchAccentPattern(4, 1)).toEqual(['high', 'low', 'low', 'low']);
    expect(pitchAccentPattern(4, 2)).toEqual(['low', 'high', 'low', 'low']);
    expect(pitchAccentPattern(5, 4)).toEqual(['low', 'high', 'high', 'high', 'low']);
  });

  it('clamps malformed accent nuclei to the phrase mora count', () => {
    expect(pitchAccentPattern(3, 99)).toEqual(['low', 'high', 'high']);
    expect(pitchAccentPattern(0, 1)).toEqual([]);
  });

  it('maps Open JTalk readings into Voice Script morae and accent phrases', () => {
    const nodes: JapaneseFrontendNode[] = [
      {
        string: '音声',
        read: 'オンセイ',
        pron: 'オンセイ',
        acc: 2,
        mora_size: 4,
        chain_flag: -1,
      },
      {
        string: '合成',
        read: 'ゴーセイ',
        pron: 'ゴーセイ',
        acc: 0,
        mora_size: 4,
        chain_flag: 0,
      },
      {
        string: '。',
        read: '、',
        pron: '、',
        acc: 0,
        mora_size: 0,
        chain_flag: 0,
      },
    ];

    const { script, reading } = buildScriptFromJapaneseFrontend(nodes);

    expect(reading).toContain('おんせい');
    expect(reading).toContain('ごーせい');
    expect(script.unsupported).toEqual([]);
    expect(script.units.length).toBeGreaterThanOrEqual(8);

    const firstPhrase = script.units.slice(0, 4);
    expect(firstPhrase.map((unit) => unit.pitchAccent)).toEqual(['low', 'high', 'low', 'low']);
    expect(firstPhrase[3]?.boundaryAfter).toBe('accent');

    const secondPhrase = script.units.slice(4, 8);
    expect(secondPhrase.map((unit) => unit.pitchAccent)).toEqual(['low', 'high', 'high', 'high']);
  });

  it('maps analyzed morae back to source-text ranges for local style alignment', () => {
    const nodes: JapaneseFrontendNode[] = [
      {
        string: '今日',
        read: 'キョー',
        pron: 'キョー',
        acc: 1,
        mora_size: 2,
        chain_flag: -1,
      },
      {
        string: 'は',
        read: 'ワ',
        pron: 'ワ',
        acc: 0,
        mora_size: 1,
        chain_flag: 1,
      },
      {
        string: '静か',
        read: 'シズカ',
        pron: 'シズカ',
        acc: 1,
        mora_size: 3,
        chain_flag: 0,
      },
    ];

    const { script, unitSourceRanges } = buildScriptFromJapaneseFrontend(
      nodes,
      '今日は静か',
    );

    expect(unitSourceRanges).toHaveLength(script.units.length);
    expect(unitSourceRanges[0]).toMatchObject({ start: 0 });
    expect(unitSourceRanges[1]?.end).toBeLessThanOrEqual(2);
    expect(unitSourceRanges[2]).toEqual({ start: 2, end: 3 });
    expect(unitSourceRanges.slice(3).every((range) => range.start >= 3)).toBe(true);
  });

  it('parses full-context devoicing, sokuon and pause markers', () => {
    const labels = [
      'xx^xx-s+U=k/A:-2+1+3',
      'xx^s-U+k=a/A:-2+1+3',
      's^U-cl+k=a/A:-1+2+3',
      'U^cl-k+a=pau/A:-1+2+3',
      'cl^k-a+pau=xx/A:0+3+3',
      'k^a-pau+xx=xx/A:xx+xx+xx',
    ];

    const moras = parseOpenJTalkFullContext(labels);
    expect(moras).toHaveLength(2);
    expect(moras[0]).toMatchObject({
      vowel: 'u',
      devoiced: true,
      geminateBefore: false,
    });
    expect(moras[1]).toMatchObject({
      vowel: 'a',
      devoiced: false,
      geminateBefore: true,
      pauseAfter: true,
    });
  });

  it('applies full-context timing hints only when mora alignment is exact', () => {
    const script = buildScriptFromJapaneseFrontend([{
      string: 'すっか',
      read: 'スッカ',
      pron: 'スッカ',
      acc: 1,
      mora_size: 2,
      chain_flag: -1,
    }]).script;

    const labels = [
      'xx^xx-s+U=cl/A:-1+1+2',
      'xx^s-U+cl=k/A:-1+1+2',
      's^U-cl+k=a/A:0+2+2',
      'U^cl-k+a=sil/A:0+2+2',
      'cl^k-a+sil=xx/A:0+2+2',
    ];

    expect(applyOpenJTalkFullContext(script, labels)).toBe(true);
    expect(script.units[0]?.devoiced).toBe(true);
    expect(script.units[1]?.geminateBefore).toBe(true);

    const mismatch = buildScriptFromJapaneseFrontend([{
      string: 'かなさ',
      read: 'カナサ',
      pron: 'カナサ',
      acc: 0,
      mora_size: 3,
      chain_flag: -1,
    }]).script;
    expect(applyOpenJTalkFullContext(mismatch, labels)).toBe(false);
  });

  it('turns lexical high and low states into distinct F0 offsets', () => {
    const { script } = buildScriptFromJapaneseFrontend([{
      string: '橋',
      read: 'ハシ',
      pron: 'ハシ',
      acc: 2,
      mora_size: 2,
      chain_flag: -1,
    }]);

    const low = script.units[0]!;
    const high = script.units[1]!;
    expect(low.pitchAccent).toBe('low');
    expect(high.pitchAccent).toBe('high');
    expect(prosodyOffsetForUnit(high, 1, 2, 'natural'))
      .toBeGreaterThan(prosodyOffsetForUnit(low, 0, 2, 'natural'));
  });

  it('routes ambiguous kana ou/ei sequences through Open JTalk', () => {
    expect(containsAmbiguousJapaneseLongVowel('がっこう')).toBe(true);
    expect(containsAmbiguousJapaneseLongVowel('せいかつ')).toBe(true);
    expect(containsAmbiguousJapaneseLongVowel('きょう')).toBe(true);
    expect(containsAmbiguousJapaneseLongVowel('かさ')).toBe(false);
    expect(needsJapanesePronunciationAnalysis('思う')).toBe(true);
    expect(needsJapanesePronunciationAnalysis('おもう')).toBe(true);
  });

  it('detects kanji without treating kana as kanji', () => {
    expect(containsKanji('音声合成です')).toBe(true);
    expect(containsKanji('おんせいごうせいです')).toBe(false);
  });
});
