import { describe, expect, it } from 'vitest';
import {
  analyzeVoxLocalAB,
  matchVoicePcmLevel,
  measureVoicePcm,
} from '../src/voice/VoxLocalCompare';
import {
  designVoxLocalVoice,
  reconstructVoxLocalAudio,
  type VoxLocalDesign,
} from '../src/voice/VoxLocalVoice';

const design: VoxLocalDesign = {
  description: '静かでやさしい女性の声',
  quality: 'balanced',
  fallbackCharacter: 'natural',
  rate: 1,
  pitch: 60,
  energy: 0.95,
  tone: 0,
  expression: { preset: 'neutral', intensity: 1 },
};

function syntheticSpeech(length = 7200): Float32Array {
  const signal = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const t = i / 24000;
    const phrase = Math.sin(Math.PI * Math.min(1, i / length));
    signal[i] = phrase * (
      0.22 * Math.sin(t * 2 * Math.PI * 180) +
      0.10 * Math.sin(t * 2 * Math.PI * 360) +
      0.04 * Math.sin(t * 2 * Math.PI * 2500)
    );
  }
  return signal;
}

describe('VOX LOCAL vs identical NEURAL HQ baseline A/B measurements', () => {
  it('matches near-equal RMS rather than increasing volume to win comparison', () => {
    const reference = syntheticSpeech();
    const candidate = Float32Array.from(reference, s => s * 0.8);
    const corrected = matchVoicePcmLevel(reference, candidate);
    const m = analyzeVoxLocalAB(reference, corrected);
    expect(Math.abs(m.levelDifferenceDb)).toBeLessThan(0.01);
    expect(m.waveformDifferencePercent).toBeLessThan(0.01);
    expect(m.reference.clippedSamples).toBe(0);
    expect(m.local.clippedSamples).toBe(0);
  });

  it('reports a *non-quality* waveform difference when timbre is shaped', () => {
    const source = syntheticSpeech();
    const processed = reconstructVoxLocalAudio(source, 24000, designVoxLocalVoice(design), 'studio');
    const matched = matchVoicePcmLevel(source, processed);
    const m = analyzeVoxLocalAB(source, matched);
    expect(m.comparedSamples).toBe(source.length);
    expect(Math.abs(m.levelDifferenceDb)).toBeLessThan(0.25);
    expect(m.waveformDifferencePercent).toBeGreaterThan(0.01);
    expect(m.waveformDifferencePercent).toBeLessThan(50);
    expect(m.local.clippedSamples).toBe(0);
    expect(m.local.peak).toBeLessThan(0.98);
  });

  it('keeps no extra white-noise output during complete silence', () => {
    const hush = designVoxLocalVoice({ ...design, description: 'ささやく、ハスキーな声' });
    const silence = new Float32Array(4800);
    const output = reconstructVoxLocalAudio(silence, 24000, hush, 'studio');
    expect(measureVoicePcm(output).rms).toBe(0);
    const spoken = reconstructVoxLocalAudio(syntheticSpeech(4800), 24000, hush, 'studio');
    expect([...spoken].every(Number.isFinite)).toBe(true);
  });

  it('does not amplify strong sample peaks into hard clipping', () => {
    const signal = Float32Array.from({ length: 2400 }, (_, i) => i % 13 === 0 ? 0.94 : Math.sin(i) * 0.24);
    const profile = designVoxLocalVoice({
      ...design, description: 'loud powerful high bright clear voice',
    });
    const processed = reconstructVoxLocalAudio(signal, 24000, profile, 'studio');
    const matched = matchVoicePcmLevel(signal, processed);
    expect(measureVoicePcm(matched).peak).toBeLessThanOrEqual(0.98);
    expect(measureVoicePcm(matched).clippedSamples).toBe(0);
  });

  it('handles silent signals without invalid level comparisons', () => {
    const silence = new Float32Array(32);
    const metrics = analyzeVoxLocalAB(silence, silence);
    expect(metrics.levelDifferenceDb).toBe(0);
    expect(metrics.waveformDifferencePercent).toBe(0);
    expect(measureVoicePcm(silence).rmsDbfs).toBe(-160);
    expect(matchVoicePcmLevel(silence, silence)).toEqual(silence);
  });
});
