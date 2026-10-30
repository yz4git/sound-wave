import { describe, expect, it } from 'vitest';
import {
  addPronunciationEntry, applyPronunciationLexicon, applyLexiconToNeuralPlan, lexiconFromStorage,
  normalizedPronunciationEntry, parsePronunciationLexicon, storePronunciationLexicon,
  VOICE_LEXICON_STORAGE_KEY,
} from '../src/voice/VoicePronunciationLexicon';

describe('VoiceStudio-inspired Japanese TTS pronunciation dictionary', () => {
  it('uses exact written words with user-verified kana readings, never alters original input', () => {
    const input = '東京の会社で生成AIを使います。';
    const dict = [
      { word: '生成AI', reading: 'せいせいエーアイ' },
      { word: '東京', reading: 'とうきょう' },
    ];
    const out = applyPronunciationLexicon(input, dict);
    expect(out.text).toBe('とうきょうの会社でせいせいエーアイを使います。');
    expect(out.replacements).toBe(2);
    expect(input).toBe('東京の会社で生成AIを使います。');
  });
  it('chooses longest phrase and does not apply replacements recursively', () => {
    const dict = [
      { word: '生成', reading: 'せいせい' },
      { word: '生成AI', reading: 'ジェネレーティブエーアイ' },
      { word: 'ジェネレーティブ', reading: 'べつのよみ' },
    ];
    expect(applyPronunciationLexicon('生成AI', dict).text).toBe('ジェネレーティブエーアイ');
    expect(applyPronunciationLexicon('生成を確認', dict).text).toBe('せいせいを確認');
  });
  it('does not replace short Latin keywords inside other words or identifiers', () => {
    const dict = [{ word: 'AI', reading: 'エーアイ' }];
    const out = applyPronunciationLexicon('AIとRAISEとAI2、AIです。', dict);
    expect(out.text).toBe('エーアイとRAISEとAI2、エーアイです。');
  });
  it('preserves emoji and unpaired surrogate behavior without corruption', () => {
    const text = 'こんにちは😊きょうの天気です';
    expect(applyPronunciationLexicon(text, [{ word: '天気', reading: 'てんき' }]).text)
      .toBe('こんにちは😊きょうのてんきです');
  });
  it('rejects HTML, tags, invalid readings and excessive text', () => {
    expect(normalizedPronunciationEntry('<script>', 'てすと')).toBeNull();
    expect(normalizedPronunciationEntry('テスト', '[excited]')).toBeNull();
    expect(normalizedPronunciationEntry('テスト', '東京')).toBeNull();
    expect(normalizedPronunciationEntry('テスト', '')).toBeNull();
    expect(normalizedPronunciationEntry('A'.repeat(41), 'えー')).toBeNull();
  });
  it('replaces a duplicate entry and caps persistent entries', () => {
    const a = addPronunciationEntry([], 'OpenAI', 'オープンエーアイ');
    const b = addPronunciationEntry(a, 'openai', 'オープンエイアイ');
    expect(b).toHaveLength(1);
    expect(b[0]!.reading).toBe('オープンエイアイ');
    const oversized = Array.from({length:80}, (_,i) => ({word:'用語'+i, reading:'ようご'}));
    expect(parsePronunciationLexicon(oversized)).toHaveLength(48);
  });
  it('restores entries from local storage without network calls', () => {
    const bag = new Map<string,string>();
    const store = { getItem: (k:string) => bag.get(k) ?? null, setItem: (k:string,v:string) => {bag.set(k,v);} };
    storePronunciationLexicon(store, [{word:'神戸',reading:'こうべ'}]);
    expect(bag.has(VOICE_LEXICON_STORAGE_KEY)).toBe(true);
    expect(lexiconFromStorage(store)).toEqual([{word:'神戸',reading:'こうべ'}]);
    bag.set(VOICE_LEXICON_STORAGE_KEY, '{broken');
    expect(lexiconFromStorage(store)).toEqual([]);
  });
  it('preserves exact original text if dictionary is empty', () => {
    const input = '[calm] 今日はいい天気。';
    expect(applyPronunciationLexicon(input, [])).toEqual({
      text:input, replacements:0, matchedWords:[],
    });
  });
});

describe('model-safe pronunciation replacements', () => {
  it('splits unusually expanded pronunciations and preserves trailing pause', () => {
    const text = 'こんにちは。'.repeat(18);
    const plan = {
      edited: false,
      segments: [{
        text, startUnit: 0, endUnit: 0, rateScale: 1, energyScale: 1,
        pitchSemitones: 0, pauseAfter: 0.22,
        expression: { preset: 'neutral' as const, intensity: 1 },
      }],
    };
    const original = JSON.stringify(plan);
    const changed = applyLexiconToNeuralPlan(plan, [{
      word: 'こんにちは', reading: 'ごあいさつはたいへんうれしいです',
    }]);
    expect(changed.segments.length).toBeGreaterThan(1);
    expect(changed.segments.every(x=>Array.from(x.text).length<=112)).toBe(true);
    expect(changed.segments.slice(0,-1).every(x=>x.pauseAfter===0)).toBe(true);
    expect(changed.segments.at(-1)!.pauseAfter).toBe(0.22);
    expect(JSON.stringify(plan)).toBe(original);
    expect(changed.segments.map(x=>x.text).join('')).toContain('ごあいさつはたいへんうれしいです');
  });
  it('keeps original plan identity when nothing matches', () => {
    const plan = {
      edited: false,
      segments: [{
        text: 'おはよう。', startUnit: 0, endUnit: 0,
        rateScale:1, energyScale:1, pitchSemitones:0,pauseAfter:0,
        expression:{preset:'neutral' as const,intensity:1},
      }],
    };
    expect(applyLexiconToNeuralPlan(plan,[{word:'神戸',reading:'こうべ'}])).toBe(plan);
  });
});
