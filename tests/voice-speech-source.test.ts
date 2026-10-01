import { describe, expect, it } from 'vitest';
import { parseVoiceScript } from '../src/voice/VoiceScript';
import {
  geminatePreclosureSeconds,
  speechAttitudeProfileFor,
  speechContextDeliveryFor,
  speechFinalityProfileFor,
  speechPresenceProfileFor,
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

  it('adds speech-only upper-formant presence without changing the base vocal model', () => {
    const unit = parseVoiceScript('さ。').units[0]!;
    const neutral = speechPresenceProfileFor(unit, { preset: 'neutral', intensity: 1 });
    const excited = speechPresenceProfileFor(unit, { preset: 'excited', intensity: 1 });

    expect(neutral.upperFormantGain[0]).toBe(1);
    expect(neutral.upperFormantGain[2]).toBeGreaterThan(1.35);
    expect(neutral.upperFormantGain[3]).toBeGreaterThan(neutral.upperFormantGain[2]);
    expect(neutral.presenceGainScale).toBeGreaterThan(1.4);
    expect(neutral.presenceGainAdd).toBeGreaterThan(0.07);
    expect(neutral.consonantNoiseScale).toBeGreaterThan(1.5);
    expect(neutral.harmonicPresence).toBeGreaterThan(0.14);
    expect(neutral.airPresence).toBeGreaterThan(0.1);
    expect(neutral.fricativeGain).toBeGreaterThan(1.7);
    expect(excited.presenceGainScale).toBeGreaterThan(neutral.presenceGainScale);
  });

  it('keeps vowel presence restrained while giving fricatives extra air', () => {
    const vowel = speechPresenceProfileFor(parseVoiceScript('あ。').units[0]!, { preset: 'neutral', intensity: 1 });
    const fricative = speechPresenceProfileFor(parseVoiceScript('さ。').units[0]!, { preset: 'neutral', intensity: 1 });

    expect(vowel.airPresence).toBeLessThan(0.04);
    expect(fricative.airPresence).toBeGreaterThan(vowel.airPresence * 3);
    expect(fricative.fricativeGain).toBeGreaterThan(vowel.fricativeGain);
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
    const shared = speechAttitudeProfileFor(parseVoiceScript('そうだね。').units.at(-1)!);
    const assertive = speechAttitudeProfileFor(parseVoiceScript('いくよ。').units.at(-1)!);
    const wonder = speechAttitudeProfileFor(parseVoiceScript('どうしようかな。').units.at(-1)!);
    const uncertain = speechAttitudeProfileFor(parseVoiceScript('いくかも。').units.at(-1)!);

    expect(shared.pitchSemitones).toBeGreaterThan(0);
    expect(shared.releaseScale).toBeGreaterThan(1);
    expect(shared.fallCentsOffset).toBeLessThan(0);
    expect(assertive.energyScale).toBeGreaterThan(1);
    expect(assertive.releaseScale).toBeLessThan(1);
    expect(wonder.pitchSemitones).toBeGreaterThan(shared.pitchSemitones);
    expect(wonder.durationScale).toBeGreaterThan(shared.durationScale);
    expect(uncertain.energyScale).toBeLessThan(shared.energyScale);
    expect(uncertain.breathAdd).toBeGreaterThan(shared.breathAdd);
  });

  it('combines attitude with punctuation instead of replacing it', () => {
    const sharedQuestion = speechAttitudeProfileFor(parseVoiceScript('そうだね？').units.at(-1)!);
    const plainShared = speechAttitudeProfileFor(parseVoiceScript('そうだね。').units.at(-1)!);
    const assertiveExclaim = speechAttitudeProfileFor(parseVoiceScript('いくよ！').units.at(-1)!);
    const plainAssertive = speechAttitudeProfileFor(parseVoiceScript('いくよ。').units.at(-1)!);
    const wonderHesitation = speechAttitudeProfileFor(parseVoiceScript('どうしようかな……').units.at(-1)!);

    expect(sharedQuestion.pitchSemitones).toBeGreaterThan(plainShared.pitchSemitones);
    expect(sharedQuestion.releaseScale).toBeGreaterThan(plainShared.releaseScale);
    expect(assertiveExclaim.energyScale).toBeGreaterThan(plainAssertive.energyScale);
    expect(assertiveExclaim.releaseScale).toBeLessThan(plainAssertive.releaseScale);
    expect(wonderHesitation.durationScale).toBeGreaterThan(1.1);
    expect(wonderHesitation.breathAdd).toBeGreaterThan(0.06);
  });

  it('ramps rate and energy toward the compound sentence ending', () => {
    const shared = parseVoiceScript('これはそうだね？');
    const emphatic = parseVoiceScript('これはいくよ！');
    const wondering = parseVoiceScript('これはどうかな……');

    const sharedStart = speechContextDeliveryFor(
      shared.units[0]!,
      { preset: 'neutral', intensity: 1 },
    );
    const sharedEnd = speechContextDeliveryFor(
      shared.units.at(-1)!,
      { preset: 'neutral', intensity: 1 },
    );
    const emphaticEnd = speechContextDeliveryFor(
      emphatic.units.at(-1)!,
      { preset: 'excited', intensity: 1 },
    );
    const wonderingEnd = speechContextDeliveryFor(
      wondering.units.at(-1)!,
      { preset: 'neutral', intensity: 1 },
    );

    expect(sharedEnd.rateScale).toBeLessThan(sharedStart.rateScale);
    expect(sharedEnd.energyScale).toBeLessThan(sharedStart.energyScale);
    expect(emphaticEnd.energyScale).toBeGreaterThan(1.05);
    expect(wonderingEnd.rateScale).toBeLessThan(0.96);
    expect(wonderingEnd.energyScale).toBeLessThan(0.93);
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
