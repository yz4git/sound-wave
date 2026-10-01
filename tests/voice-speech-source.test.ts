import { describe, expect, it } from 'vitest';
import { parseVoiceScript } from '../src/voice/VoiceScript';
import {
  geminatePreclosureSeconds,
  speechArticulatoryFilterFor,
  speechArticulatoryStateFor,
  speechAttitudeProfileFor,
  speechContextDeliveryFor,
  speechFinalityProfileFor,
  speechHarmonicNoiseProfileFor,
  speechPresenceProfileFor,
  speechSourceProfileFor,
  speechTakeVariationFor,
  speechTimbreProfileFor,
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

  it('uses speech-only tract carry, CV overlap, and glottal microvariation', () => {
    const neutral = speechSourceProfileFor({ preset: 'neutral', intensity: 1 });
    const calm = speechSourceProfileFor({ preset: 'calm', intensity: 1 });
    const excited = speechSourceProfileFor({ preset: 'excited', intensity: 1 });

    expect(neutral.formantCarry).toBeGreaterThanOrEqual(0.9);
    expect(neutral.vowelTransitionScale).toBeGreaterThan(1.1);
    expect(neutral.cvOverlap).toBeGreaterThan(0.6);
    expect(neutral.glottalDriftCents).toBeGreaterThan(0.5);
    expect(neutral.glottalDriftCents).toBeLessThan(1);
    expect(neutral.glottalJitterCents).toBeGreaterThan(0.6);
    expect(neutral.glottalJitterCents).toBeLessThan(1);
    expect(neutral.openQuotientMotion).toBeGreaterThan(0.008);
    expect(neutral.openQuotientMotion).toBeLessThan(0.02);

    expect(calm.formantCarry).toBeGreaterThan(neutral.formantCarry);
    expect(calm.vowelTransitionScale).toBeGreaterThan(neutral.vowelTransitionScale);
    expect(excited.cvOverlap).toBeLessThan(neutral.cvOverlap);
    expect(excited.glottalJitterCents).toBeGreaterThan(neutral.glottalJitterCents);
  });

  it('maps Japanese vowels into physically consistent articulatory states', () => {
    const a = speechArticulatoryStateFor(parseVoiceScript('あ。').units[0]!);
    const i = speechArticulatoryStateFor(parseVoiceScript('い。').units[0]!);
    const o = speechArticulatoryStateFor(parseVoiceScript('お。').units[0]!);
    const n = speechArticulatoryStateFor(parseVoiceScript('な。').units[0]!);

    expect(a.jawOpen).toBeGreaterThan(i.jawOpen);
    expect(i.tongueFront).toBeGreaterThan(o.tongueFront);
    expect(i.tongueHeight).toBeGreaterThan(a.tongueHeight);
    expect(o.lipRound).toBeGreaterThan(a.lipRound);
    expect(n.velumOpen).toBeGreaterThan(0.5);
  });

  it('derives vocal-tract and harmonic-noise controls from articulation', () => {
    const aFilter = speechArticulatoryFilterFor(
      speechArticulatoryStateFor(parseVoiceScript('あ。').units[0]!),
    );
    const iFilter = speechArticulatoryFilterFor(
      speechArticulatoryStateFor(parseVoiceScript('い。').units[0]!),
    );
    const oFilter = speechArticulatoryFilterFor(
      speechArticulatoryStateFor(parseVoiceScript('お。').units[0]!),
    );
    const nFilter = speechArticulatoryFilterFor(
      speechArticulatoryStateFor(parseVoiceScript('な。').units[0]!),
    );

    expect(aFilter.formantScale[0]).toBeGreaterThan(iFilter.formantScale[0]);
    expect(iFilter.formantScale[1]).toBeGreaterThan(oFilter.formantScale[1]);
    expect(oFilter.formantScale[2]).toBeLessThan(iFilter.formantScale[2]);
    expect(nFilter.nasalMixAdd).toBeGreaterThan(0.2);
    expect(nFilter.bandwidthScale).toBeGreaterThan(aFilter.bandwidthScale);
  });

  it('uses an explicit harmonic-noise balance per phoneme class', () => {
    const vowel = speechHarmonicNoiseProfileFor(parseVoiceScript('あ。').units[0]!);
    const fricative = speechHarmonicNoiseProfileFor(parseVoiceScript('さ。').units[0]!);
    const nasal = speechHarmonicNoiseProfileFor(parseVoiceScript('な。').units[0]!);

    expect(vowel.harmonicGain).toBeGreaterThan(1);
    expect(vowel.noiseGain).toBeLessThan(1);
    expect(fricative.noiseGain).toBeGreaterThan(1.08);
    expect(fricative.harmonicGain).toBeLessThan(vowel.harmonicGain);
    expect(nasal.harmonicGain).toBeGreaterThan(1);
    expect(nasal.noiseGain).toBeLessThan(vowel.noiseGain);
  });

  it('gives voice characters distinct spoken timbre mechanics', () => {
    const expression = { preset: 'neutral' as const, intensity: 1 };
    const natural = speechTimbreProfileFor('natural', 0, expression);
    const soft = speechTimbreProfileFor('soft', 0, expression);
    const clear = speechTimbreProfileFor('clear', 0, expression);
    const airy = speechTimbreProfileFor('airy', 0, expression);
    const power = speechTimbreProfileFor('power', 0, expression);

    expect(power.closureStrength).toBeGreaterThan(natural.closureStrength);
    expect(power.bodyMix).toBeGreaterThan(clear.bodyMix);
    expect(soft.sourceDamping).toBeGreaterThan(clear.sourceDamping);
    expect(airy.closureStrength).toBeLessThan(soft.closureStrength);
    expect(clear.upperFormantGain).toBeGreaterThan(soft.upperFormantGain);
    expect(soft.lowerFormantGain).toBeGreaterThan(clear.lowerFormantGain);
    expect(airy.formantMotion).toBeGreaterThan(power.formantMotion);
  });

  it('uses the tone control to shift spoken body and harmonic brightness', () => {
    const expression = { preset: 'neutral' as const, intensity: 1 };
    const dark = speechTimbreProfileFor('natural', -1, expression);
    const bright = speechTimbreProfileFor('natural', 1, expression);

    expect(dark.bodyMix).toBeGreaterThan(bright.bodyMix);
    expect(dark.sourceDamping).toBeGreaterThan(bright.sourceDamping);
    expect(bright.upperFormantGain).toBeGreaterThan(dark.upperFormantGain);
    expect(bright.closureStrength).toBeGreaterThan(dark.closureStrength);
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
