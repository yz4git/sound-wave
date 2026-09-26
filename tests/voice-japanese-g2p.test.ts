import { describe, expect, it } from 'vitest';
import {
  buildScriptFromJapaneseFrontend,
  containsKanji,
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

  it('detects kanji without treating kana as kanji', () => {
    expect(containsKanji('音声合成です')).toBe(true);
    expect(containsKanji('おんせいごうせいです')).toBe(false);
  });
});
