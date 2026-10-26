import { describe, expect, it } from 'vitest';
import type { NeuralProsodyPlan, NeuralProsodySegment } from '../src/voice/NeuralVoice';
import {
  conversationBoundaryPause,
  effectiveConversationPause,
  measureTrailingQuietSeconds,
  planVoxConversation,
} from '../src/voice/VoxConversation';

const segment = (text: string, extras: Partial<NeuralProsodySegment> = {}): NeuralProsodySegment => ({
  text, startUnit: 0, endUnit: 0, rateScale: 1, energyScale: 1,
  pitchSemitones: 0, pauseAfter: 0, expression: { preset: 'neutral', intensity: 1 },
  ...extras,
});

describe('2026 research-inspired Japanese conversational prosody', () => {
  it('keeps single sentences whole and never injects fillers or extra segment boundaries', () => {
    const original: NeuralProsodyPlan = { edited: false, segments: [segment('そうなんですね。')] };
    for (const style of ['natural', 'relaxed', 'lively'] as const) {
      const actual = planVoxConversation(original, style);
      expect(actual.segments).toHaveLength(1);
      expect(actual.segments[0]!.text).toBe('そうなんですね。');
      expect(actual.segments[0]!.pauseAfter).toBe(0);
      expect(actual.segments[0]!.rateScale).toBeGreaterThan(0.93);
    }
  });
  it('uses semantic punctuation for bounded sentence and comma pauses', () => {
    expect(conversationBoundaryPause('そうですね。', 'natural')).toBeGreaterThan(
      conversationBoundaryPause('そうですね、', 'natural'),
    );
    expect(conversationBoundaryPause('いいですか？', 'natural')).toBeGreaterThan(0);
    expect(conversationBoundaryPause('行きましょう！', 'natural')).toBeGreaterThan(0);
    expect(conversationBoundaryPause('助詞がまだ続く', 'natural')).toBe(0);
    expect(conversationBoundaryPause('そうです。\n', 'natural')).toBeGreaterThan(0);
    expect(conversationBoundaryPause('そうです。', 'off')).toBe(0);
  });
  it('retains edited boundaries, word content, user pauses and speaker identity', () => {
    const plan: NeuralProsodyPlan = {
      edited: true,
      segments: [
        segment('今日は、', { rateScale: 0.95, pauseAfter: 0.3, pitchSemitones: 0.25 }),
        segment('いいお天気ですね。', { rateScale: 1.03, pauseAfter: 0.1 }),
        segment('そうですね。'),
      ],
    };
    const natural = planVoxConversation(plan, 'natural');
    expect(natural.edited).toBe(true);
    expect(natural.segments.map(x => x.text)).toEqual(plan.segments.map(x => x.text));
    expect(natural.segments[0]!.pauseAfter).toBe(0.3);
    expect(natural.segments[0]!.pitchSemitones).toBe(0.25);
    expect(natural.segments[1]!.pauseAfter).toBeGreaterThanOrEqual(0.15);
    expect(natural.segments[2]!.pauseAfter).toBe(0);
    const off = planVoxConversation(plan, 'off');
    expect(off).toBe(plan);
  });
  it('makes relaxed cadence slower than lively without extreme speech rate', () => {
    const plan: NeuralProsodyPlan = { edited: false, segments: [segment('いいですね！'), segment('では、また。')] };
    const a = planVoxConversation(plan, 'relaxed');
    const b = planVoxConversation(plan, 'lively');
    expect(a.segments[0]!.rateScale).toBeLessThan(b.segments[0]!.rateScale);
    expect(a.segments[0]!.rateScale).toBeGreaterThan(0.9);
    expect(b.segments[0]!.rateScale).toBeLessThan(1.1);
  });
  it('does not double-insert silence Kokoro already synthesized', () => {
    const rate = 24_000;
    const pcm = new Float32Array(rate);
    for (let i = 0; i < rate * 0.75; i++) pcm[i] = 0.1 * Math.sin(i / 10);
    expect(measureTrailingQuietSeconds(pcm, rate)).toBeCloseTo(0.25, 1);
    expect(effectiveConversationPause(0.15, pcm, rate)).toBe(0);
    expect(effectiveConversationPause(0.36, pcm, rate)).toBeCloseTo(0.11, 1);
    const solid = new Float32Array(rate).fill(0.07);
    expect(effectiveConversationPause(0.16, solid, rate)).toBeCloseTo(0.16, 2);
  });
  it('does not crop consonants or alter original neural samples', () => {
    const pcm = new Float32Array(2400).fill(0.06);
    const copy = Float32Array.from(pcm);
    effectiveConversationPause(0.2, pcm, 24_000);
    expect(pcm).toEqual(copy);
  });
});
