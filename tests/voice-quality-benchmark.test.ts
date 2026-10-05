import { describe, expect, it } from 'vitest';
import {
  VOICE_QUALITY_CASES,
  runVoicePlanQualityCase,
  runVoicePlanQualitySuite,
  type VoiceQualityCase,
} from '../src/voice/VoiceQualityBenchmark';
import type { VoiceSynthSettings } from '../src/voice/VoiceSynth';

const SETTINGS: VoiceSynthSettings = {
  quality: 'hq',
  style: 'warm',
  character: 'natural',
  tone: 0,
  tractLength: 0,
  rate: 1,
  pitch: 60,
  energy: 0.92,
  intonation: 'auto',
  expression: { preset: 'neutral', intensity: 1 },
};

function run(id: string) {
  const testCase = VOICE_QUALITY_CASES.find((candidate) => candidate.id === id);
  if (!testCase) throw new Error(`Missing quality case: ${id}`);
  return runVoicePlanQualityCase(testCase, SETTINGS);
}

describe('Voice Lab quality benchmark suite', () => {
  it('keeps the fixed regression corpus executable and finite', () => {
    const results = runVoicePlanQualitySuite(SETTINGS);

    expect(results).toHaveLength(10);
    for (const result of results) {
      expect(result.metrics.unitCount).toBeGreaterThan(0);
      expect(Number.isFinite(result.metrics.duration)).toBe(true);
      expect(Number.isFinite(result.metrics.pitchRangeSemitones)).toBe(true);
      expect(Number.isFinite(result.metrics.meanEnergy)).toBe(true);
      expect(Number.isFinite(result.metrics.maxInterUnitGap)).toBe(true);
      expect(result.metrics.duration).toBeGreaterThan(0.1);
    }
  });

  it('preserves separate short, long-single, and multi-sentence HQ strategies', () => {
    const short = run('short').metrics.strategy;
    const longSingle = run('long-single').metrics.strategy;
    const multi = run('multi-sentence').metrics.strategy;

    expect(short.kind).toBe('short');
    expect(short.samplingGrid).toBe('linear');
    expect(short.refinementSteps).toEqual([0.25, 0.25, 0.25, 0.25]);

    expect(longSingle.kind).toBe('long-single');
    expect(longSingle.samplingGrid).toBe('front-loaded');
    expect(longSingle.refinementSteps).toEqual([0.125, 0.125, 0.25, 0.5]);
    expect(longSingle.residualSmoothingScale).toBeGreaterThan(1);

    expect(multi.kind).toBe('multi-sentence');
    expect(multi.samplingGrid).toBe('linear');
  });

  it('keeps repair timing conversational rather than stacking long pauses', () => {
    const repair = run('repair');

    expect(repair.metrics.eventCount).toBe(2);
    expect(repair.metrics.maxInterUnitGap).toBeLessThan(0.38);
  });

  it('keeps normal speech pitch motion non-flat', () => {
    const neutral = run('neutral');

    expect(neutral.metrics.pitchRangeSemitones).toBeGreaterThan(1.35);
    expect(neutral.metrics.meanUnitDuration).toBeGreaterThan(0.07);
  });

  it('preserves a stronger question ending than the same statement', () => {
    const statementCase: VoiceQualityCase = {
      id: 'statement-pair',
      kind: 'neutral',
      text: 'いいね。',
    };
    const questionCase: VoiceQualityCase = {
      id: 'question-pair',
      kind: 'question',
      text: 'いいね？',
    };
    const statement = runVoicePlanQualityCase(statementCase, SETTINGS);
    const question = runVoicePlanQualityCase(questionCase, SETTINGS);
    const statementLast = statement.metrics.unitCount - 1;
    const questionLast = question.metrics.unitCount - 1;

    // Both cases have the same mora count; the difference is sentence-final delivery.
    expect(questionLast).toBe(statementLast);
    expect(question.metrics.pitchRangeSemitones).toBeGreaterThan(statement.metrics.pitchRangeSemitones);
  });

  it('keeps long-single HQ stability more conservative than normal HQ', () => {
    const normal = run('neutral').metrics.strategy;
    const longSingle = run('long-single').metrics.strategy;

    expect(longSingle.phonationVariationScale).toBeLessThan(normal.phonationVariationScale);
    expect(longSingle.coarticulationScale).toBeGreaterThan(normal.coarticulationScale);
    expect(longSingle.closureSmoothingScale).toBeGreaterThan(normal.closureSmoothingScale);
  });
});
