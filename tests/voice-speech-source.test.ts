import { describe, expect, it } from 'vitest';
import {
  geminatePreclosureSeconds,
  speechAttitudeProfileFor,
  speechFinalityProfileFor,
  speechSourceProfileFor,
  speechTakeVariationFor,
} from '../src/voice/VoiceSynth';

describe('VOICE LAB speech source', () => {
  it('uses a strongly speech-weighted source for neutral delivery', () => {
    const profile = speechSourceProfileFor({ preset: 'neutral', intensity: 1 });

    expect(profile.sourceMix).toBeGreaterThan(0.85);
    expect(profile.sourceTilt).toBeGreaterThan(0.5);
    expect(profile.coarticulation).toBeGreaterThan(0.75);
    expect(profile.pulseNoise).toBeGreaterThan(0);
  });

  it('moves whisper toward more tilt and aspiration', () => {
    const neutral = speechSourceProfileFor({ preset: 'neutral', intensity: 1 });
    const whisper = speechSourceProfileFor({ preset: 'whisper', intensity: 1 });

    expect(whisper.sourceTilt).toBeGreaterThan(neutral.sourceTilt);
    expect(whisper.pulseNoise).toBeGreaterThan(neutral.pulseNoise);
    expect(whisper.sourceMix).toBeLessThan(neutral.sourceMix);
  });

  it('returns to neutral source behavior when style intensity is zero', () => {
    const neutral = speechSourceProfileFor({ preset: 'neutral', intensity: 1 });
    const mutedExcited = speechSourceProfileFor({ preset: 'excited', intensity: 0 });

    expect(mutedExcited).toEqual(neutral);
  });

  it('keeps declarative finality subtle and suppresses creak on questions', () => {
    const neutral = speechFinalityProfileFor({ preset: 'neutral', intensity: 1 }, 'natural');
    const question = speechFinalityProfileFor({ preset: 'neutral', intensity: 1 }, 'question');
    const serious = speechFinalityProfileFor({ preset: 'serious', intensity: 1 }, 'natural');
    const calm = speechFinalityProfileFor({ preset: 'calm', intensity: 1 }, 'natural');
    const excited = speechFinalityProfileFor({ preset: 'excited', intensity: 1 }, 'natural');
    const whisper = speechFinalityProfileFor({ preset: 'whisper', intensity: 1 }, 'natural');

    expect(neutral.creak).toBeGreaterThan(0.1);
    expect(neutral.pitchSemitones).toBeLessThan(0);
    expect(question.creak).toBeLessThan(neutral.creak);
    expect(question.pitchSemitones).toBeGreaterThan(0);
    expect(question.fallCents).toBe(0);
    expect(question.durationScale).toBeGreaterThan(1);
    expect(serious.creak).toBeGreaterThan(neutral.creak);
    expect(serious.pitchSemitones).toBeLessThan(neutral.pitchSemitones);
    expect(calm.durationScale).toBeGreaterThan(neutral.durationScale);
    expect(calm.releaseScale).toBeGreaterThan(neutral.releaseScale);
    expect(excited.energyScale).toBeGreaterThan(neutral.energyScale);
    expect(whisper.breath).toBeGreaterThan(neutral.breath);
    expect(whisper.fallCents).toBeLessThan(neutral.fallCents);
  });

  it('keeps content questions less terminally raised than yes-no questions', () => {
    const yesNo = speechFinalityProfileFor(
      { preset: 'neutral', intensity: 1 },
      'question',
    );
    const content = speechFinalityProfileFor(
      { preset: 'neutral', intensity: 1 },
      'content-question',
    );

    expect(content.pitchSemitones).toBeLessThan(yesNo.pitchSemitones);
    expect(content.releaseScale).toBeGreaterThan(yesNo.releaseScale);
    expect(content.fallCents).toBe(0);
    expect(content.creak).toBeLessThanOrEqual(0.07);
  });

  it('keeps rising endings open even with serious delivery', () => {
    const seriousQuestion = speechFinalityProfileFor(
      { preset: 'serious', intensity: 1.35 },
      'question',
    );
    const seriousRise = speechFinalityProfileFor(
      { preset: 'serious', intensity: 1.35 },
      'rise',
    );

    expect(seriousQuestion.creak).toBeLessThanOrEqual(0.07);
    expect(seriousQuestion.fallCents).toBe(0);
    expect(seriousRise.fallCents).toBe(0);
  });

  it('maps sentence-final particles to distinct attitude endings', () => {
    const shared = speechAttitudeProfileFor(
      { ...({
        index: 0,
        display: 'ね',
        syllable: 'ne',
        vowel: 'e',
        phraseStart: true,
        phraseEnd: true,
        phraseIndex: 0,
        phraseCount: 1,
        accentStart: true,
        accentEnd: true,
        accentIndex: 0,
        accentCount: 1,
        accentPhraseIndex: 0,
        accentPhraseCount: 1,
        boundaryAfter: 'sentence',
        pauseAfter: 0.3,
        boundaryBefore: 'none',
        pauseBefore: 0,
        questionKind: 'none',
        questionFocus: false,
        sentenceAttitude: 'shared',
        attitudeFocus: true,
        suppressAttitudeInference: false,
        continuationAfter: 'none',
        continuationBefore: 'none',
        suppressContinuationInference: false,
        discourseAfter: 'none',
        discourseBefore: 'none',
        focusStrength: 0,
        quoted: false,
        parenthetical: false,
        breathBefore: 0,
        breathAfter: false,
        expressivePauseAfter: 0,
        hesitationAfter: false,
        filledPause: false,
        autoRateScale: 1,
        sentenceTerminal: 'statement',
        terminalAfter: 'statement',
        geminateBefore: false,
        longVowel: false,
        moraicN: false,
        devoiced: false,
        pitchAccent: 'auto',
      } as const) },
    );
    const assertive = speechAttitudeProfileFor({ ...shared as never });

    expect(shared.pitchSemitones).toBeGreaterThan(0);
    expect(shared.releaseScale).toBeGreaterThan(1);
    expect(shared.fallCentsOffset).toBeLessThan(0);
    expect(assertive).toBeTruthy();
  });

  it('keeps per-take microvariation tiny, deterministic, and take-dependent', () => {
    const first = speechTakeVariationFor(3, 2);
    const repeat = speechTakeVariationFor(3, 2);
    const nextTake = speechTakeVariationFor(3, 3);

    expect(first).toEqual(repeat);
    expect(nextTake).not.toEqual(first);
    expect(Math.abs(first.pitchCents)).toBeLessThanOrEqual(1.6);
    expect(Math.abs(first.velocityScale - 1)).toBeLessThanOrEqual(0.012);
    expect(Math.abs(first.timingOffsetSeconds)).toBeLessThanOrEqual(0.0015);
  });

  it('keeps Japanese sokuon pre-closure in a speech-like range', () => {
    expect(geminatePreclosureSeconds(1)).toBeGreaterThanOrEqual(0.08);
    expect(geminatePreclosureSeconds(0.7)).toBeGreaterThan(geminatePreclosureSeconds(1.4));
    expect(geminatePreclosureSeconds(1.5)).toBeGreaterThanOrEqual(0.06);
  });
});
