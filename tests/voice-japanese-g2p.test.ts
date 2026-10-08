import { describe, expect, it } from 'vitest';
import {
  JapaneseAnalysisCache,
  JapaneseAnalysisMemoryCache,
  japaneseAnalysisCacheKey,
  loadCachedJapaneseAnalysis,
  rememberJapaneseAnalysis,
  validJapaneseAnalysis,
} from '../src/voice/JapaneseAnalysisCache';
import {
  analyzeJapaneseText,
  applyOpenJTalkFullContext,
  buildScriptFromJapaneseFrontend,
  containsAmbiguousJapaneseLongVowel,
  containsKanji,
  japaneseFirstUsePlaybackStrategy,
  needsJapanesePronunciationAnalysis,
  parseOpenJTalkFullContext,
  pitchAccentPattern,
  type JapaneseFrontendNode,
} from '../src/voice/JapaneseG2P';
import { prosodyOffsetForUnit, remapVoiceSpeechEvents } from '../src/voice/VoiceScript';
import { parseVoiceMarkup } from '../src/voice/VoiceMarkup';

describe('VOICE LAB Japanese G2P mapping', () => {
  it('remaps speech-event positions onto Open JTalk mora ranges', () => {
    const markup = parseVoiceMarkup('今日は（笑）行く');
    const nodes: JapaneseFrontendNode[] = [
      {
        string: '今日は',
        read: 'キョーワ',
        pron: 'キョーワ',
        acc: 1,
        mora_size: 3,
        chain_flag: -1,
        pos: '名詞',
      },
      {
        string: '行く',
        read: 'イク',
        pron: 'イク',
        acc: 0,
        mora_size: 2,
        chain_flag: 0,
        pos: '動詞',
      },
    ];

    const analysis = buildScriptFromJapaneseFrontend(nodes, markup.plainText);
    const events = remapVoiceSpeechEvents(markup.events, analysis.unitSourceRanges);

    expect(markup.plainText).toBe('今日は行く');
    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe('laugh');
    expect(events[0]?.afterUnit).toBe(2);
  });

  it('keeps first-use G2P playback non-blocking', () => {
    expect(japaneseFirstUsePlaybackStrategy('おんせいです。', false)).toBe('quick-local');
    expect(japaneseFirstUsePlaybackStrategy('音声です。', false)).toBe('quick-system');
    expect(japaneseFirstUsePlaybackStrategy('音声です。', true)).toBe('precise-local');
    expect(japaneseFirstUsePlaybackStrategy('こんにちは。', false)).toBe('precise-local');
  });

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

  it('preserves content-question detection through Open JTalk readings', () => {
    const nodes: JapaneseFrontendNode[] = [
      {
        string: '何',
        read: 'ナニ',
        pron: 'ナニ',
        acc: 1,
        mora_size: 2,
        chain_flag: -1,
      },
      {
        string: 'です',
        read: 'デス',
        pron: 'デス',
        acc: 1,
        mora_size: 2,
        chain_flag: 0,
      },
      {
        string: 'か',
        read: 'カ',
        pron: 'カ',
        acc: 0,
        mora_size: 1,
        chain_flag: 1,
      },
      {
        string: '？',
        read: '、',
        pron: '、',
        acc: 0,
        mora_size: 0,
        chain_flag: 0,
      },
    ];

    const { script } = buildScriptFromJapaneseFrontend(nodes, '何ですか？');

    expect(script.units[0]?.questionKind).toBe('content');
    expect(script.units[0]?.questionFocus).toBe(true);
    expect(script.units[1]?.questionFocus).toBe(true);
    expect(script.units.at(-1)?.sentenceTerminal).toBe('question');
  });

  it('uses Open JTalk token surfaces to recognize single-mora connectives safely', () => {
    const nodes: JapaneseFrontendNode[] = [
      {
        string: '雨',
        read: 'アメ',
        pron: 'アメ',
        acc: 1,
        mora_size: 2,
        chain_flag: -1,
      },
      {
        string: 'が',
        read: 'ガ',
        pron: 'ガ',
        acc: 0,
        mora_size: 1,
        chain_flag: 1,
        pos: '助詞',
        pos_group1: '接続助詞',
      },
      {
        string: '行く',
        read: 'イク',
        pron: 'イク',
        acc: 0,
        mora_size: 2,
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

    const { script } = buildScriptFromJapaneseFrontend(nodes, '雨が行く。');
    const ga = script.units.find((unit) => unit.display === 'が')!;
    const next = script.units[ga.index + 1]!;

    expect(ga.continuationAfter).toBe('contrast');
    expect(ga.boundaryAfter).toBe('accent');
    expect(ga.pauseAfter).toBeGreaterThanOrEqual(0.052);
    expect(next.continuationBefore).toBe('contrast');
  });

  it('separates topic は from subject が using Open JTalk POS', () => {
    const topicNodes: JapaneseFrontendNode[] = [
      {
        string: '私',
        read: 'ワタシ',
        pron: 'ワタシ',
        acc: 0,
        mora_size: 3,
        chain_flag: -1,
        pos: '名詞',
      },
      {
        string: 'は',
        read: 'ワ',
        pron: 'ワ',
        acc: 0,
        mora_size: 1,
        chain_flag: 1,
        pos: '助詞',
        pos_group1: '係助詞',
      },
      {
        string: '行く',
        read: 'イク',
        pron: 'イク',
        acc: 0,
        mora_size: 2,
        chain_flag: 0,
        pos: '動詞',
      },
    ];
    const subjectNodes: JapaneseFrontendNode[] = topicNodes.map((node) => ({ ...node }));
    subjectNodes[1] = {
      string: 'が',
      read: 'ガ',
      pron: 'ガ',
      acc: 0,
      mora_size: 1,
      chain_flag: 1,
      pos: '助詞',
      pos_group1: '格助詞',
      pos_group2: '一般',
    };

    const topic = buildScriptFromJapaneseFrontend(topicNodes, '私は行く').script;
    const subject = buildScriptFromJapaneseFrontend(subjectNodes, '私が行く').script;
    const topicParticle = topic.units.find((unit) => unit.discourseAfter === 'topic')!;
    const subjectParticle = subject.units.find((unit) => unit.discourseAfter === 'subject')!;

    expect(topicParticle.discourseAfter).toBe('topic');
    expect(topic.units[topicParticle.index + 1]?.discourseBefore).toBe('topic');
    expect(topicParticle.pauseAfter).toBeGreaterThan(subjectParticle.pauseAfter);
    expect(subjectParticle.discourseAfter).toBe('subject');
    expect(subjectParticle.continuationAfter).toBe('none');
    expect(subject.units[0]!.focusStrength).toBeGreaterThan(topic.units[0]!.focusStrength);
  });

  it('recognizes quote and list particles from Open JTalk POS groups', () => {
    const nodes: JapaneseFrontendNode[] = [
      {
        string: '行く',
        read: 'イク',
        pron: 'イク',
        acc: 0,
        mora_size: 2,
        chain_flag: -1,
        pos: '動詞',
      },
      {
        string: 'と',
        read: 'ト',
        pron: 'ト',
        acc: 0,
        mora_size: 1,
        chain_flag: 1,
        pos: '助詞',
        pos_group1: '格助詞',
        pos_group2: '引用',
      },
      {
        string: '犬',
        read: 'イヌ',
        pron: 'イヌ',
        acc: 1,
        mora_size: 2,
        chain_flag: 0,
        pos: '名詞',
      },
      {
        string: 'や',
        read: 'ヤ',
        pron: 'ヤ',
        acc: 0,
        mora_size: 1,
        chain_flag: 1,
        pos: '助詞',
        pos_group1: '並立助詞',
      },
      {
        string: '猫',
        read: 'ネコ',
        pron: 'ネコ',
        acc: 1,
        mora_size: 2,
        chain_flag: 0,
        pos: '名詞',
      },
    ];

    const { script } = buildScriptFromJapaneseFrontend(nodes, '行くと犬や猫');
    const quote = script.units.find((unit) => unit.display === 'と')!;
    const list = script.units.find((unit) => unit.display === 'や')!;

    expect(quote.discourseAfter).toBe('quote');
    expect(quote.pauseAfter).toBeGreaterThanOrEqual(0.035);
    expect(script.units[quote.index + 1]?.discourseBefore).toBe('quote');
    expect(list.discourseAfter).toBe('list');
    expect(list.pauseAfter).toBeGreaterThanOrEqual(0.055);
    expect(script.units[list.index + 1]?.discourseBefore).toBe('list');
  });

  it('does not treat case-particle から as a causal connective', () => {
    const nodes: JapaneseFrontendNode[] = [
      {
        string: '東京',
        read: 'トーキョー',
        pron: 'トーキョー',
        acc: 0,
        mora_size: 4,
        chain_flag: -1,
        pos: '名詞',
      },
      {
        string: 'から',
        read: 'カラ',
        pron: 'カラ',
        acc: 1,
        mora_size: 2,
        chain_flag: 1,
        pos: '助詞',
        pos_group1: '格助詞',
        pos_group2: '一般',
      },
      {
        string: '行く',
        read: 'イク',
        pron: 'イク',
        acc: 0,
        mora_size: 2,
        chain_flag: 0,
        pos: '動詞',
      },
    ];

    const { script } = buildScriptFromJapaneseFrontend(nodes, '東京から行く');
    const karaEnd = script.units.filter((unit) => unit.display === 'ら').at(-1)!;

    expect(karaEnd.continuationAfter).toBe('none');
  });

  it('uses focus particles to emphasize the preceding lexical token', () => {
    const nodes: JapaneseFrontendNode[] = [
      {
        string: '私',
        read: 'ワタシ',
        pron: 'ワタシ',
        acc: 0,
        mora_size: 3,
        chain_flag: -1,
        pos: '名詞',
      },
      {
        string: 'こそ',
        read: 'コソ',
        pron: 'コソ',
        acc: 1,
        mora_size: 2,
        chain_flag: 1,
        pos: '助詞',
        pos_group1: '係助詞',
      },
      {
        string: '行く',
        read: 'イク',
        pron: 'イク',
        acc: 0,
        mora_size: 2,
        chain_flag: 0,
        pos: '動詞',
      },
    ];

    const { script } = buildScriptFromJapaneseFrontend(nodes, '私こそ行く');
    const focusParticle = script.units.find((unit) => unit.discourseAfter === 'focus')!;

    expect(focusParticle).toBeTruthy();
    expect(script.units[0]!.focusStrength).toBe(1);
    expect(script.units[1]!.focusStrength).toBe(1);
    expect(script.units[2]!.focusStrength).toBe(1);
    expect(script.units[0]!.autoRateScale).toBeLessThan(1);
  });

  it('adds a short pre-focus hold when a focused token is not sentence-initial', () => {
    const nodes: JapaneseFrontendNode[] = [
      {
        string: '今日は',
        read: 'キョーワ',
        pron: 'キョーワ',
        acc: 1,
        mora_size: 3,
        chain_flag: -1,
        pos: '名詞',
      },
      {
        string: '私',
        read: 'ワタシ',
        pron: 'ワタシ',
        acc: 0,
        mora_size: 3,
        chain_flag: 0,
        pos: '名詞',
      },
      {
        string: 'だけ',
        read: 'ダケ',
        pron: 'ダケ',
        acc: 1,
        mora_size: 2,
        chain_flag: 1,
        pos: '助詞',
        pos_group1: '副助詞',
      },
      {
        string: '行く',
        read: 'イク',
        pron: 'イク',
        acc: 0,
        mora_size: 2,
        chain_flag: 0,
        pos: '動詞',
      },
    ];

    const { script } = buildScriptFromJapaneseFrontend(nodes, '今日は私だけ行く');
    const focusedStart = script.units.findIndex((unit) => unit.focusStrength > 0);
    const beforeFocus = script.units[focusedStart - 1]!;

    expect(focusedStart).toBeGreaterThan(0);
    expect(beforeFocus.expressivePauseAfter).toBeGreaterThanOrEqual(0.05);
    expect(script.units[focusedStart]!.focusStrength).toBeGreaterThan(0.7);
  });

  it('uses POS to avoid mistaking lexical readings for sentence-final particles', () => {
    const nodes: JapaneseFrontendNode[] = [
      {
        string: '鴨',
        read: 'カモ',
        pron: 'カモ',
        acc: 1,
        mora_size: 2,
        chain_flag: -1,
        pos: '名詞',
        pos_group1: '一般',
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

    const { script } = buildScriptFromJapaneseFrontend(nodes, '鴨。');

    expect(script.units.at(-1)?.sentenceAttitude).toBe('none');
    expect(script.units.every((unit) => unit.suppressAttitudeInference)).toBe(true);
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


describe('Persistent Japanese reading and accent analysis', () => {
  const makeAnalysis = () => {
    const nodes: JapaneseFrontendNode[] = [
      {
        string: '音声',
        read: 'オンセイ',
        pron: 'オンセイ',
        acc: 2,
        mora_size: 4,
        chain_flag: -1,
      },
    ];
    const built = buildScriptFromJapaneseFrontend(nodes, '音声');
    return {
      ...built,
      nodes,
      labels: ['sil-k+o'],
      fullContextMatched: false,
      source: 'open-jtalk' as const,
    };
  };

  it('uses an exact, versioned text identity', () => {
    expect(japaneseAnalysisCacheKey('音声')).not.toBe(japaneseAnalysisCacheKey('音声。'));
    expect(japaneseAnalysisCacheKey('音声')).toBe(japaneseAnalysisCacheKey('音声'));
    expect(japaneseAnalysisCacheKey('音声')).toContain('open-jtalk');
  });

  it('accepts complete analysis, rejects malformed or oversized snapshots', () => {
    const example = makeAnalysis();
    expect(validJapaneseAnalysis(example)).toBe(true);
    expect(validJapaneseAnalysis({ ...example, labels: null })).toBe(false);
    expect(validJapaneseAnalysis({ ...example, source: 'unknown' })).toBe(false);
    expect(validJapaneseAnalysis(example, 10)).toBe(false);
  });

  it('returns defensive copies, evicts least recently used entries and limits RAM', () => {
    const cache = new JapaneseAnalysisMemoryCache(32 * 1024, 2);
    const example = makeAnalysis();
    expect(cache.put('a', example)).toBe(true);
    expect(cache.put('b', example)).toBe(true);
    const first = cache.get('a')!;
    first.script.units[0]!.display = 'CHANGED';
    expect(cache.get('a')!.script.units[0]!.display).not.toBe('CHANGED');
    cache.put('c', example);
    expect(cache.get('b')).toBeNull();
    expect(cache.size).toBe(2);
    expect(cache.bytes).toBeGreaterThan(0);
  });

  it('works without IndexedDB and never blocks analysis for storage denial', async () => {
    const cache = new JapaneseAnalysisCache(null);
    const analysis = makeAnalysis();
    expect(await cache.put('音声', analysis)).toBe(false); // RAM cache still warm
    expect(await cache.get('音声')).toEqual(analysis);
    expect(await cache.get('別の文')).toBeNull();
  });

  it('skips the worker/dictionary for a cached exact sentence', async () => {
    const text = '解析の永続キャッシュ検証用';
    const analysis = makeAnalysis();
    await rememberJapaneseAnalysis(text, analysis);
    const progress: string[] = [];
    const restored = await analyzeJapaneseText(text, (event) => {
      progress.push(event.message);
    });
    expect(restored).toEqual(analysis);
    expect(progress).toEqual(['JAPANESE G2P · SAVED READING + ACCENT RESTORED']);
    expect(await loadCachedJapaneseAnalysis(text)).toEqual(analysis);
  });
});
