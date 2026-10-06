import { describe, expect, it } from 'vitest';
import { parseVoiceScript } from '../src/voice/VoiceScript';
import {
  geminatePreclosureSeconds,
  speechAperiodicityProfileFor,
  speechArticulatoryFilterFor,
  speechArticulatoryStateFor,
  speechArticulatoryTransitionScalesFor,
  speechAttitudeProfileFor,
  speechConsonantTransientProfileFor,
  speechContextDeliveryFor,
  speechFinalityProfileFor,
  speechHarmonicNoiseProfileFor,
  speechPhonationMicrostructureFor,
  speechPresenceProfileFor,
  speechQualityProfileFor,
  speechSourceProfileFor,
  speechTakeVariationFor,
  speechTimbreProfileFor,
  speechVocalTractProfileFor,
  voiceSpeechControlFrameFor,
} from '../src/voice/VoiceSynth';

describe('VOICE LAB speech source', () => {
  it('keeps FAST and HQ rendering paths audibly distinct but control-frame compatible', () => {
    const unit = parseVoiceScript('さ。').units[0]!;
    const settings = {
      style: 'warm' as const,
      character: 'natural' as const,
      tone: 0,
      rate: 1,
      pitch: 60,
      energy: 0.92,
      intonation: 'auto' as const,
      expression: { preset: 'neutral' as const, intensity: 1 },
    };
    const frame = voiceSpeechControlFrameFor(
      unit,
      0,
      60.5,
      0.9,
      0.14,
      settings,
      settings.expression,
    );
    const fast = speechQualityProfileFor('fast', frame);
    const hq = speechQualityProfileFor('hq', frame);

    expect(fast.sourceOversample).toBe(1);
    expect(fast.residualAmount).toBe(0);
    expect(fast.residualBody).toBe(0);
    expect(fast.residualPresence).toBe(0);
    expect(fast.residualAir).toBe(0);
    expect(fast.residualSmoothingMs).toBe(0);
    expect(fast.closureSmoothingMs).toBe(0);

    expect(hq.sourceOversample).toBe(2);
    expect(hq.residualAmount).toBeGreaterThan(0.13);
    expect(hq.residualPresence).toBeGreaterThan(0.04);
    expect(hq.residualAir).toBeGreaterThanOrEqual(0);
    expect(hq.residualSmoothingMs).toBeGreaterThanOrEqual(12);
    expect(hq.closureSmoothingMs).toBeGreaterThan(0.3);
  });

  it('adapts HQ residual tone to articulatory and phoneme content', () => {
    const settings = {
      style: 'warm' as const,
      character: 'natural' as const,
      tone: 0,
      rate: 1,
      pitch: 60,
      energy: 0.92,
      intonation: 'auto' as const,
      expression: { preset: 'neutral' as const, intensity: 1 },
    };
    const vowelUnit = parseVoiceScript('お。').units[0]!;
    const fricativeUnit = parseVoiceScript('し。').units[0]!;
    const vowelFrame = voiceSpeechControlFrameFor(
      vowelUnit, 0, 60, 0.9, 0.14, settings, settings.expression,
    );
    const fricativeFrame = voiceSpeechControlFrameFor(
      fricativeUnit, 0, 60, 0.9, 0.14, settings, settings.expression,
    );
    const vowel = speechQualityProfileFor('hq', vowelFrame);
    const fricative = speechQualityProfileFor('hq', fricativeFrame);

    expect(vowel.residualBody).toBeGreaterThan(fricative.residualBody);
    expect(fricative.residualPresence).toBeGreaterThanOrEqual(vowel.residualPresence);
    expect(fricative.residualAir).toBeGreaterThan(vowel.residualAir);
  });

  it('adds WORLD-style banded aperiodicity only to the HQ speech path', () => {
    const expression = { preset: 'neutral' as const, intensity: 1 };
    const vowel = parseVoiceScript('あ。').units[0]!;
    const sibilant = parseVoiceScript('さ。').units[0]!;
    const devoiced = parseVoiceScript('すき。').units.find((unit) => unit.devoiced)!;

    const fast = speechAperiodicityProfileFor(vowel, 'fast', expression);
    const hqVowel = speechAperiodicityProfileFor(vowel, 'hq', expression);
    const hqSibilant = speechAperiodicityProfileFor(sibilant, 'hq', expression);
    const hqDevoiced = speechAperiodicityProfileFor(devoiced, 'hq', expression);

    expect(fast.amount).toBe(0);
    expect(fast.lfBlend).toBe(0);
    expect(hqVowel.amount).toBeGreaterThan(0);
    expect(hqVowel.low).toBeGreaterThan(hqVowel.air);
    expect(hqSibilant.presence).toBeGreaterThan(hqSibilant.mid);
    expect(hqSibilant.air).toBeGreaterThan(0.8);
    expect(hqDevoiced.amount).toBeGreaterThan(hqSibilant.amount);
  });

  it('maps delivery style onto a stable LF-style Rd voice-quality axis', () => {
    const unit = parseVoiceScript('あ。').units[0]!;
    const serious = speechAperiodicityProfileFor(unit, 'hq', { preset: 'serious', intensity: 1 });
    const neutral = speechAperiodicityProfileFor(unit, 'hq', { preset: 'neutral', intensity: 1 });
    const calm = speechAperiodicityProfileFor(unit, 'hq', { preset: 'calm', intensity: 1 });
    const whisper = speechAperiodicityProfileFor(unit, 'hq', { preset: 'whisper', intensity: 1 });

    expect(serious.lfRd).toBeLessThan(neutral.lfRd);
    expect(neutral.lfRd).toBeLessThan(calm.lfRd);
    expect(calm.lfRd).toBeLessThan(whisper.lfRd);
    expect(neutral.lfBlend).toBeGreaterThan(0.75);
  });

  it('adds subtle HQ-only phonation microstructure and vowel coupling', () => {
    const neutral = { preset: 'neutral' as const, intensity: 1 };
    const aUnit = parseVoiceScript('あ。').units[0]!;
    const iUnit = parseVoiceScript('い。').units[0]!;

    const fast = speechPhonationMicrostructureFor(aUnit, 'fast', neutral);
    const hqA = speechPhonationMicrostructureFor(aUnit, 'hq', neutral);
    const hqI = speechPhonationMicrostructureFor(iUnit, 'hq', neutral);

    expect(fast.cycleVariation).toBe(0);
    expect(fast.subharmonicMix).toBe(0);
    expect(fast.sourceTractCoupling).toBe(0);

    expect(hqA.cycleVariation).toBeGreaterThan(0.006);
    expect(hqA.cycleVariation).toBeLessThan(0.02);
    expect(hqA.subharmonicMix).toBeGreaterThan(0);
    expect(hqA.subharmonicMix).toBeLessThan(0.015);
    expect(hqA.sourceTractCoupling).toBeGreaterThan(hqI.sourceTractCoupling);
  });

  it('lets serious finals carry a little more subharmonic structure than excited speech', () => {
    const unit = parseVoiceScript('あ。').units[0]!;
    const serious = speechPhonationMicrostructureFor(
      unit,
      'hq',
      { preset: 'serious', intensity: 1 },
    );
    const excited = speechPhonationMicrostructureFor(
      unit,
      'hq',
      { preset: 'excited', intensity: 1 },
    );

    expect(serious.subharmonicMix).toBeGreaterThan(excited.subharmonicMix);
    expect(serious.sourceTractCoupling).toBeGreaterThan(excited.sourceTractCoupling);
  });

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

    expect(neutral.upperFormantGain[0]).toBeGreaterThan(1);
    expect(neutral.upperFormantGain[2]).toBeGreaterThan(1.2);
    expect(neutral.upperFormantGain[3]).toBeGreaterThan(neutral.upperFormantGain[2]);
    expect(neutral.upperFormantGain[3]).toBeLessThan(1.45);
    expect(neutral.presenceGainScale).toBeGreaterThan(1.2);
    expect(neutral.presenceGainScale).toBeLessThan(1.35);
    expect(neutral.presenceGainAdd).toBeGreaterThan(0.045);
    expect(neutral.consonantNoiseScale).toBeGreaterThan(1.2);
    expect(neutral.consonantNoiseScale).toBeLessThan(1.4);
    expect(neutral.harmonicPresence).toBeGreaterThan(0.1);
    expect(neutral.airPresence).toBeGreaterThan(0.06);
    expect(neutral.fricativeGain).toBeGreaterThan(1.3);
    expect(neutral.fricativeGain).toBeLessThan(1.5);
    expect(excited.presenceGainScale).toBeGreaterThan(neutral.presenceGainScale);
  });

  it('keeps vowel presence restrained while giving fricatives extra air', () => {
    const vowel = speechPresenceProfileFor(parseVoiceScript('あ。').units[0]!, { preset: 'neutral', intensity: 1 });
    const fricative = speechPresenceProfileFor(parseVoiceScript('さ。').units[0]!, { preset: 'neutral', intensity: 1 });

    expect(vowel.airPresence).toBeLessThan(0.04);
    expect(fricative.airPresence).toBeGreaterThan(vowel.airPresence * 3);
    expect(fricative.fricativeGain).toBeGreaterThan(vowel.fricativeGain);
  });

  it('uses consonant-class clarity instead of one oversized fricative boost', () => {
    const expression = { preset: 'neutral' as const, intensity: 1 };
    const sibilant = speechPresenceProfileFor(parseVoiceScript('さ。').units[0]!, expression);
    const affricate = speechPresenceProfileFor(parseVoiceScript('ち。').units[0]!, expression);
    const breathy = speechPresenceProfileFor(parseVoiceScript('は。').units[0]!, expression);
    const vowel = speechPresenceProfileFor(parseVoiceScript('あ。').units[0]!, expression);

    expect(sibilant.consonantNoiseScale).toBeGreaterThan(affricate.consonantNoiseScale);
    expect(affricate.consonantNoiseScale).toBeGreaterThan(breathy.consonantNoiseScale);
    expect(sibilant.fricativeGain).toBeGreaterThan(affricate.fricativeGain);
    expect(breathy.airPresence).toBeGreaterThan(vowel.airPresence);
    expect(sibilant.fricativeGain).toBeLessThan(1.5);
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

  it('aims anticipatory formants at the next mora articulatory state', () => {
    const script = parseVoiceScript('あい。');
    const first = script.units[0]!;
    const second = script.units[1]!;

    const f1 = speechArticulatoryTransitionScalesFor(first, second, 0);
    const f2 = speechArticulatoryTransitionScalesFor(first, second, 1);
    const terminal = speechArticulatoryTransitionScalesFor(second, null, 1);

    expect(f1.current).not.toBeCloseTo(f1.next, 4);
    expect(f2.current).not.toBeCloseTo(f2.next, 4);
    expect(f2.next).toBeGreaterThan(f2.current);
    expect(terminal.next).toBeCloseTo(terminal.current, 8);
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

  it('controls vocal tract length independently from F0', () => {
    const unit = parseVoiceScript('あ。').units[0]!;
    const articulation = speechArticulatoryStateFor(unit);
    const short = speechVocalTractProfileFor('natural', 0, -1, articulation);
    const neutral = speechVocalTractProfileFor('natural', 0, 0, articulation);
    const long = speechVocalTractProfileFor('natural', 0, 1, articulation);

    expect(short.lengthScale).toBeLessThan(neutral.lengthScale);
    expect(long.lengthScale).toBeGreaterThan(neutral.lengthScale);
    expect(short.frequencyScale).toBeGreaterThan(neutral.frequencyScale);
    expect(long.frequencyScale).toBeLessThan(neutral.frequencyScale);
    expect(short.frequencyScale / long.frequencyScale).toBeGreaterThan(1.09);
  });

  it('gives stops and nasals distinct speech transients', () => {
    const k = speechConsonantTransientProfileFor(parseVoiceScript('か。').units[0]!);
    const t = speechConsonantTransientProfileFor(parseVoiceScript('た。').units[0]!);
    const b = speechConsonantTransientProfileFor(parseVoiceScript('ば。').units[0]!);
    const n = speechConsonantTransientProfileFor(parseVoiceScript('な。').units[0]!);
    const m = speechConsonantTransientProfileFor(parseVoiceScript('ま。').units[0]!);
    const moraic = speechConsonantTransientProfileFor(parseVoiceScript('ん。').units[0]!);

    expect(t.burstGain).toBeGreaterThan(k.burstGain);
    expect(t.burstSharpness).toBeGreaterThan(k.burstSharpness);
    expect(b.closureVoicingRise).toBeGreaterThan(0.6);
    expect(n.nasalOnsetBoost).toBeGreaterThan(0.15);
    expect(m.nasalOnsetBoost).toBeGreaterThan(n.nasalOnsetBoost);
    expect(moraic.nasalReleaseScale).toBeGreaterThan(m.nasalReleaseScale);
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

  it('builds one neural-ready control frame per spoken mora', () => {
    const unit = parseVoiceScript('な。').units[0]!;
    const settings = {
      style: 'warm' as const,
      character: 'natural' as const,
      tone: 0,
      rate: 1,
      pitch: 60,
      energy: 0.92,
      intonation: 'auto' as const,
      expression: { preset: 'neutral' as const, intensity: 1 },
    };
    const frame = voiceSpeechControlFrameFor(
      unit,
      0,
      61.25,
      0.88,
      0.14,
      settings,
      settings.expression,
    );

    expect(frame.unitIndex).toBe(0);
    expect(frame.f0Midi).toBeCloseTo(61.25);
    expect(frame.energy).toBeCloseTo(0.88);
    expect(frame.duration).toBeCloseTo(0.14);
    expect(frame.articulation.velumOpen).toBeGreaterThan(0.5);
    expect(frame.timbre.closureStrength).toBeGreaterThan(0.9);
    expect(frame.harmonicNoise.harmonicGain).toBeGreaterThan(1);
    expect(frame.harmonicNoise.noiseGain).toBeLessThan(1);
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

    expect(neutral.creak).toBeGreaterThan(0.08);
    expect(neutral.creak).toBeLessThan(0.18);
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
