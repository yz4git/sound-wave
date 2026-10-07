import { describe, expect, it } from 'vitest';
import {
  KOKORO_JP_CDN,
  buildNeuralProsodyPlan,
  neuralSpeedForSettings,
  neuralVoiceIdForCharacter,
} from '../src/voice/NeuralVoice';

describe('Neural HQ configuration', () => {
  it('pins the browser renderer instead of following an unversioned CDN', () => {
    expect(KOKORO_JP_CDN).toContain('kokoro-js-jp@0.2.0');
  });

  it('maps each Sound Wave character to a Japanese Kokoro voice', () => {
    expect(neuralVoiceIdForCharacter('natural')).toBe('jf_alpha');
    expect(neuralVoiceIdForCharacter('soft')).toBe('jf_tebukuro');
    expect(neuralVoiceIdForCharacter('clear')).toBe('jf_nezumi');
    expect(neuralVoiceIdForCharacter('airy')).toBe('jf_gongitsune');
    expect(neuralVoiceIdForCharacter('power')).toBe('jm_kumo');
  });

  it('uses expression duration as neural speaking-rate control with safe bounds', () => {
    const neutral = neuralSpeedForSettings(1, { preset: 'neutral', intensity: 1 });
    const calm = neuralSpeedForSettings(1, { preset: 'calm', intensity: 1 });
    const excited = neuralSpeedForSettings(1, { preset: 'excited', intensity: 1 });
    expect(neutral).toBeGreaterThan(0.8);
    expect(calm).toBeLessThan(neutral);
    expect(excited).toBeGreaterThan(neutral);
    expect(neuralSpeedForSettings(10, { preset: 'neutral', intensity: 1 })).toBe(1.55);
    expect(neuralSpeedForSettings(0.1, { preset: 'neutral', intensity: 1 })).toBe(0.62);
  });
});


describe('Neural HQ VOICE LAB adapter', () => {
  const unit = (index: number, display: string, overrides: Record<string, unknown> = {}) => ({
    index,
    display,
    syllable: display,
    vowel: 'a',
    phraseStart: index === 0,
    phraseEnd: false,
    phraseIndex: index,
    phraseCount: 4,
    accentStart: index === 0,
    accentEnd: false,
    accentIndex: index,
    accentCount: 4,
    accentPhraseIndex: 0,
    accentPhraseCount: 1,
    boundaryAfter: 'none',
    pauseAfter: 0,
    boundaryBefore: 'none',
    pauseBefore: 0,
    questionKind: 'none',
    questionFocus: false,
    sentenceAttitude: 'none',
    sentenceHesitation: false,
    attitudeFocus: false,
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
    punctuationAfter: 'none',
    punctuationCount: 0,
    filledPause: false,
    pitchAccent: index === 0 ? 'low' : 'high',
    autoRateScale: 1,
    devoiced: false,
    geminateBefore: false,
    longVowel: false,
    terminalAfter: 'none',
    ...overrides,
  }) as any;

  const timed = (u: any, overrides: Record<string, unknown> = {}) => ({
    unit: u,
    start: u.index * 0.15,
    duration: 0.15,
    pitchMidi: 60,
    energyScale: 1,
    manualPitchOffset: 0,
    manualEnergyScale: 1,
    manualDurationScale: 1,
    phrasePitchOffset: 0,
    phraseRateScale: 1,
    phraseEnergyScale: 1,
    phraseEmphasis: 0,
    phraseF0Offset: 0,
    accentF0Offset: 0,
    expression: { preset: 'neutral', intensity: 1 },
    ...overrides,
  }) as any;

  it('preserves one model-native utterance when no editor control is changed', () => {
    const units = ['こ', 'ん', 'に', 'ち'].map((text, index) => unit(index, text));
    const plan = buildNeuralProsodyPlan({
      originalText: 'こんにちは。',
      script: { units, unsupported: [], events: [] },
      timedUnits: units.map((item) => timed(item)),
      edits: {},
      globalExpression: { preset: 'neutral', intensity: 1 },
    });
    expect(plan.edited).toBe(false);
    expect(plan.segments).toHaveLength(1);
    expect(plan.segments[0]!.text).toBe('こんにちは。');
  });

  it('turns phrase timing, energy and pitch edits into bounded neural controls', () => {
    const units = ['こ', 'ん', 'に', 'ち', 'は'].map((text, index) => unit(index, text));
    const timedUnits = units.map((item, index) => timed(item, index < 4 ? {
      manualPitchOffset: 2.5,
      manualEnergyScale: 1.2,
      manualDurationScale: 1.25,
      phraseRateScale: 0.9,
      phraseEnergyScale: 1.1,
    } : {}));
    const plan = buildNeuralProsodyPlan({
      originalText: 'こんにちは。',
      script: { units, unsupported: [], events: [] },
      timedUnits,
      edits: { pitchOffsets: [2.5, 2.5, 2.5, 2.5, 0] },
      hasPhraseEdits: true,
      globalExpression: { preset: 'neutral', intensity: 1 },
    });
    expect(plan.edited).toBe(true);
    expect(plan.segments[0]!.pitchSemitones).toBeGreaterThan(0);
    expect(plan.segments[0]!.pitchSemitones).toBeLessThanOrEqual(0.65);
    expect(plan.segments[0]!.rateScale).toBeLessThan(1);
    expect(plan.segments[0]!.energyScale).toBeGreaterThan(1);
  });

  it('uses user phrase splits and pauses as neural segment boundaries', () => {
    const units = ['あ', 'り', 'が', 'と', 'う', 'ね'].map((text, index) =>
      unit(index, text, index === 2 ? { boundaryAfter: 'accent', pauseAfter: 0.16 } : {}),
    );
    const plan = buildNeuralProsodyPlan({
      originalText: 'ありがとうね',
      script: { units, unsupported: [], events: [] },
      timedUnits: units.map((item) => timed(item)),
      edits: { pauseOverrides: [null, null, 0.2, null, null, null] },
      phraseBoundaries: [{ after: 2, boundary: 'accent', pauseSeconds: 0.2 }],
      hasPhraseEdits: true,
      globalExpression: { preset: 'neutral', intensity: 1 },
    });
    expect(plan.segments.length).toBeGreaterThan(1);
    expect(plan.segments[0]!.text.endsWith('、')).toBe(true);
    expect(plan.segments[0]!.pauseAfter).toBeGreaterThan(0.1);
  });

  it('can map edited accent H/L into only a subtle quality-safe pitch bias', () => {
    const units = [
      unit(0, 'あ', { pitchAccent: 'high' }),
      unit(1, 'め', { pitchAccent: 'high' }),
      unit(2, 'だ', { pitchAccent: 'low' }),
      unit(3, 'ね', { pitchAccent: 'low' }),
    ];
    const plan = buildNeuralProsodyPlan({
      originalText: 'あめだね',
      script: { units, unsupported: [], events: [] },
      timedUnits: units.map((item) => timed(item)),
      edits: {},
      hasAccentEdits: true,
      globalExpression: { preset: 'neutral', intensity: 1 },
    });
    expect(plan.edited).toBe(true);
    expect(Math.max(...plan.segments.map((segment) => Math.abs(segment.pitchSemitones)))).toBeLessThanOrEqual(0.65);
  });
});
