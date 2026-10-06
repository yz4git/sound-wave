import { describe, expect, it } from 'vitest';
import {
  finalizeVoiceUnits,
  japaneseF0LayersForUnit,
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

  it('extracts nonverbal speech events without speaking their labels', () => {
    const script = parseVoiceScript('（息）あ（笑）い（ため息）（言い直し）う（思い直し）え。');

    expect(script.units.map((unit) => unit.display)).toEqual(['あ', 'い', 'う', 'え']);
    expect(script.unsupported).toEqual([]);
    expect(script.events.map((event) => event.kind)).toEqual([
      'inhale',
      'laugh',
      'sigh',
      'restart',
      'rethink',
    ]);
    expect(script.events.map((event) => event.afterUnit)).toEqual([-1, 0, 1, 1, 2]);
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

  it('keeps punctuation kind and repeated strength as explicit prosody tokens', () => {
    const comma = parseVoiceScript('あ、い。');
    const question = parseVoiceScript('ほんと？？');
    const exclaim = parseVoiceScript('いく！！！');
    const ellipsis = parseVoiceScript('まつ……');
    const dash = parseVoiceScript('あ――い。');

    expect(comma.units[0]!.punctuationAfter).toBe('comma');
    expect(question.units.at(-1)!.punctuationAfter).toBe('question');
    expect(question.units.at(-1)!.punctuationCount).toBe(2);
    expect(exclaim.units.at(-1)!.punctuationAfter).toBe('exclamation');
    expect(exclaim.units.at(-1)!.punctuationCount).toBe(3);
    expect(ellipsis.units.at(-1)!.punctuationAfter).toBe('ellipsis');
    expect(ellipsis.units.at(-1)!.punctuationCount).toBe(2);
    expect(dash.units[0]!.punctuationAfter).toBe('dash');
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

  it('separates Japanese phrase baseline from lexical accent movement', () => {
    const script = parseVoiceScript('あいうえお。');
    const start = script.units[0]!;
    const middle = script.units[2]!;
    const end = script.units.at(-1)!;

    const startLayers = japaneseF0LayersForUnit(start, 'natural');
    const middleLayers = japaneseF0LayersForUnit(middle, 'natural');
    const endLayers = japaneseF0LayersForUnit(end, 'natural');

    expect(startLayers.phrase).toBeGreaterThan(middleLayers.phrase);
    expect(middleLayers.phrase).toBeGreaterThan(endLayers.phrase);
    expect(startLayers.total).toBeCloseTo(
      prosodyOffsetForUnit(start, start.index, script.units.length, 'natural'),
      8,
    );
  });

  it('keeps lexical H/L contrast independent from sentence declination', () => {
    const script = parseVoiceScript('あいう。');
    const low = { ...script.units[0]!, pitchAccent: 'low' as const, accentIndex: 0 };
    const high = { ...script.units[0]!, pitchAccent: 'high' as const, accentIndex: 0 };
    const lowLayers = japaneseF0LayersForUnit(low, 'natural');
    const highLayers = japaneseF0LayersForUnit(high, 'natural');

    expect(highLayers.phrase).toBeCloseTo(lowLayers.phrase, 8);
    expect(highLayers.accent).toBeGreaterThan(lowLayers.accent + 0.65);
  });

  it('adds phrase reset but preserves downstep across later accent phrases', () => {
    const script = parseVoiceScript('あいうえおかきく。');
    for (const index of [1, 3, 5]) {
      script.units[index]!.boundaryAfter = 'accent';
      script.units[index]!.pauseAfter = 0.09;
    }
    finalizeVoiceUnits(script.units);

    const secondStart = script.units[2]!;
    const thirdStart = script.units[4]!;
    const second = japaneseF0LayersForUnit(secondStart, 'natural');
    const third = japaneseF0LayersForUnit(thirdStart, 'natural');

    expect(secondStart.accentStart).toBe(true);
    expect(thirdStart.accentStart).toBe(true);
    expect(third.phrase).toBeLessThan(second.phrase);
  });

  it('adds a small F0 reset after a comma-like accent boundary', () => {
    const script = parseVoiceScript('あい、うえ。');
    const afterComma = script.units[2]!;
    const withoutReset = {
      ...afterComma,
      boundaryBefore: 'none' as const,
      pauseBefore: 0,
    };

    expect(afterComma.boundaryBefore).toBe('accent');
    expect(afterComma.pauseBefore).toBeGreaterThan(0.1);
    expect(
      prosodyOffsetForUnit(afterComma, 2, script.units.length, 'natural'),
    ).toBeGreaterThan(
      prosodyOffsetForUnit(withoutReset, 2, script.units.length, 'natural') + 0.12,
    );
  });

  it('marks connective endings and gives the following clause a continuation reset', () => {
    const script = parseVoiceScript('いくけど、かえる。');
    const connectiveEnd = script.units.find((unit) => unit.display === 'ど')!;
    const next = script.units[connectiveEnd.index + 1]!;

    expect(connectiveEnd.continuationAfter).toBe('contrast');
    expect(next.continuationBefore).toBe('contrast');
    expect(connectiveEnd.pauseAfter).toBeGreaterThan(0.1);

    const withoutContinuation = {
      ...next,
      continuationBefore: 'none' as const,
    };
    expect(
      prosodyOffsetForUnit(next, next.index, script.units.length, 'natural'),
    ).toBeGreaterThan(
      prosodyOffsetForUnit(withoutContinuation, next.index, script.units.length, 'natural') + 0.1,
    );
  });

  it('detects several multi-mora connective families conservatively at boundaries', () => {
    const cause = parseVoiceScript('いくので、まつ。');
    const condition = parseVoiceScript('いくなら、まつ。');
    const concessive = parseVoiceScript('いっても、まつ。');
    const lexical = parseVoiceScript('からだ、げんき。');

    expect(cause.units.find((unit) => unit.display === 'で')?.continuationAfter).toBe('cause');
    expect(condition.units.find((unit) => unit.display === 'ら')?.continuationAfter).toBe('condition');
    expect(concessive.units.find((unit) => unit.display === 'も')?.continuationAfter).toBe('concessive');
    expect(lexical.units.every((unit) => unit.continuationAfter === 'none')).toBe(true);
  });

  it('distinguishes content questions from yes-no questions in AUTO mode', () => {
    const contentQuestion = parseVoiceScript('どこですか？');
    const yesNoQuestion = parseVoiceScript('いいですか？');

    expect(contentQuestion.units.every((unit) => unit.questionKind === 'content')).toBe(true);
    expect(contentQuestion.units.some((unit) => unit.questionFocus)).toBe(true);
    expect(yesNoQuestion.units.every((unit) => unit.questionKind === 'yes-no')).toBe(true);
    expect(resolveVoiceIntonation(contentQuestion.units[0]!, 'auto')).toBe('content-question');
    expect(resolveVoiceIntonation(yesNoQuestion.units[0]!, 'auto')).toBe('question');

    const contentFinal = contentQuestion.units.at(-1)!;
    const yesNoFinal = yesNoQuestion.units.at(-1)!;
    expect(
      prosodyOffsetForUnit(contentFinal, contentQuestion.units.length - 1, contentQuestion.units.length, 'auto'),
    ).toBeLessThan(
      prosodyOffsetForUnit(yesNoFinal, yesNoQuestion.units.length - 1, yesNoQuestion.units.length, 'auto'),
    );
  });

  it('applies gentle phrase-by-phrase downstep across a long sentence', () => {
    const script = parseVoiceScript('あいうえおかきく。');
    for (const index of [1, 3, 5]) {
      script.units[index]!.boundaryAfter = 'accent';
      script.units[index]!.pauseAfter = 0.012;
    }
    finalizeVoiceUnits(script.units);

    const laterStart = script.units[4]!;
    const withoutDownstep = {
      ...laterStart,
      accentPhraseIndex: 0,
    };

    expect(laterStart.accentPhraseIndex).toBe(2);
    expect(laterStart.accentPhraseCount).toBeGreaterThanOrEqual(4);
    expect(
      prosodyOffsetForUnit(laterStart, laterStart.index, script.units.length, 'natural'),
    ).toBeLessThan(
      prosodyOffsetForUnit(withoutDownstep, laterStart.index, script.units.length, 'natural') - 0.08,
    );
  });

  it('keeps ellipsis and dash hesitation inside the same sentence', () => {
    const ellipsis = parseVoiceScript('あ……い。');
    const dash = parseVoiceScript('う――え。');

    expect(ellipsis.units[0]!.hesitationAfter).toBe(true);
    expect(ellipsis.units[0]!.expressivePauseAfter).toBeGreaterThanOrEqual(0.24);
    expect(ellipsis.units[0]!.boundaryAfter).not.toBe('sentence');
    expect(ellipsis.units[1]!.sentenceTerminal).toBe('statement');

    expect(dash.units[0]!.hesitationAfter).toBe(true);
    expect(dash.units[0]!.expressivePauseAfter).toBeGreaterThanOrEqual(0.2);
  });

  it('recognizes conservative Japanese filled pauses without treating plain words as fillers', () => {
    const longFiller = parseVoiceScript('えーと いく。');
    const sokuonFiller = parseVoiceScript('えっと いく。');
    const lexical = parseVoiceScript('えと いく。');

    expect(longFiller.units.slice(0, 3).every((unit) => unit.filledPause)).toBe(true);
    expect(longFiller.units[2]!.hesitationAfter).toBe(true);
    expect(longFiller.units[2]!.expressivePauseAfter).toBeGreaterThanOrEqual(0.13);

    expect(sokuonFiller.units.slice(0, 2).every((unit) => unit.filledPause)).toBe(true);
    expect(lexical.units.slice(0, 2).every((unit) => !unit.filledPause)).toBe(true);
  });

  it('keeps quote and parenthetical spans as non-spoken context metadata', () => {
    const script = parseVoiceScript('あ「いう」え（おか）き。');

    const quoted = script.units.filter((unit) => unit.quoted);
    const aside = script.units.filter((unit) => unit.parenthetical);

    expect(quoted.map((unit) => unit.display)).toEqual(['い', 'う']);
    expect(aside.map((unit) => unit.display)).toEqual(['お', 'か']);
    expect(quoted.every((unit) => unit.autoRateScale < 1)).toBe(true);
    expect(aside.every((unit) => unit.autoRateScale > 1)).toBe(true);
    expect(script.unsupported).toEqual([]);
  });

  it('chooses existing phrase boundaries as breathing points in long sentences', () => {
    const script = parseVoiceScript('あいうえお かきくけこ さしすせそ たちつてと なにぬねの。');
    const breaths = script.units.filter((unit) => unit.breathAfter);

    expect(script.units.length).toBeGreaterThanOrEqual(20);
    expect(breaths.length).toBeGreaterThanOrEqual(1);
    expect(breaths.every((unit) => unit.boundaryAfter === 'accent')).toBe(true);
    expect(breaths.every((unit) => unit.pauseAfter >= 0.12)).toBe(true);
  });

  it('distinguishes common Japanese sentence-final attitudes', () => {
    const shared = parseVoiceScript('そうだね。');
    const assertive = parseVoiceScript('いくよ。');
    const wonder = parseVoiceScript('どうしようかな。');
    const uncertain = parseVoiceScript('いくかも。');
    const explicitQuestion = parseVoiceScript('いくよ？');

    expect(shared.units.at(-1)?.sentenceAttitude).toBe('shared');
    expect(shared.units.at(-1)?.attitudeFocus).toBe(true);
    expect(assertive.units.at(-1)?.sentenceAttitude).toBe('assertive');
    expect(wonder.units.at(-1)?.sentenceAttitude).toBe('wonder');
    expect(wonder.units.at(-2)?.attitudeFocus).toBe(true);
    expect(uncertain.units.at(-1)?.sentenceAttitude).toBe('uncertain');
    expect(explicitQuestion.units.at(-1)?.sentenceAttitude).toBe('assertive');
    expect(explicitQuestion.units.at(-1)?.sentenceTerminal).toBe('question');
  });

  it('keeps attitude metadata when punctuation adds question or exclamation force', () => {
    const sharedQuestion = parseVoiceScript('そうだね？');
    const assertiveExclaim = parseVoiceScript('いくよ！');
    const wonderingHesitation = parseVoiceScript('どうしようかな……');

    expect(sharedQuestion.units.at(-1)?.sentenceAttitude).toBe('shared');
    expect(sharedQuestion.units.at(-1)?.sentenceTerminal).toBe('question');
    expect(sharedQuestion.units.at(-1)?.attitudeFocus).toBe(true);

    expect(assertiveExclaim.units.at(-1)?.sentenceAttitude).toBe('assertive');
    expect(assertiveExclaim.units.at(-1)?.sentenceTerminal).toBe('exclamation');

    expect(wonderingHesitation.units.at(-1)?.sentenceAttitude).toBe('wonder');
    expect(wonderingHesitation.units.at(-1)?.hesitationAfter).toBe(true);
    expect(wonderingHesitation.units.at(-1)?.sentenceTerminal).toBe('statement');
  });

  it('spreads hesitation across the final morae instead of changing only the last mora', () => {
    const hesitant = parseVoiceScript('まつかな……');

    expect(hesitant.units.every((unit) => unit.sentenceHesitation)).toBe(true);

    const index = hesitant.units.length - 2;
    const withHesitation = hesitant.units[index]!;
    const withoutHesitation = {
      ...withHesitation,
      sentenceHesitation: false,
    };
    expect(
      prosodyOffsetForUnit(withHesitation, index, hesitant.units.length, 'natural'),
    ).toBeLessThan(
      prosodyOffsetForUnit(withoutHesitation, index, hesitant.units.length, 'natural') - 0.04,
    );
  });

  it('adds a tiny breath lead only to sufficiently long sentence starts', () => {
    const long = parseVoiceScript('あいうえおか。');
    const short = parseVoiceScript('あい。');

    expect(long.units[0]!.breathBefore).toBeGreaterThan(0.02);
    expect(short.units[0]!.breathBefore).toBe(0);
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

  it('keeps neutral conversational speech from collapsing into a near-flat F0 range', () => {
    const script = parseVoiceScript('あいうえお。');
    const offsets = script.units.map((unit, index) => (
      prosodyOffsetForUnit(unit, index, script.units.length, 'natural')
    ));
    const spread = Math.max(...offsets) - Math.min(...offsets);

    expect(spread).toBeGreaterThan(1.7);
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
