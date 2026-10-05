import { describe, expect, it } from 'vitest';
import { voiceIdentityConditioningFor } from '../src/voice/VoiceConditioning';
import {
  analyzeVoiceImprint,
  resampleVoiceReference,
  validVoiceIdentityImprint,
  type VoiceIdentityImprint,
} from '../src/voice/VoiceImprint';

function sine(sampleRate: number, seconds: number, frequency: number): Float32Array {
  const length = Math.floor(sampleRate * seconds);
  const samples = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    const t = i / sampleRate;
    samples[i] = Math.sin(2 * Math.PI * frequency * t) * 0.42
      + Math.sin(2 * Math.PI * frequency * 2 * t) * 0.12
      + Math.sin(2 * Math.PI * frequency * 3 * t) * 0.05;
  }
  return samples;
}

describe('voice imprint', () => {
  it('extracts a stable F0 and bounded identity vector from a voiced reference', () => {
    const analysis = analyzeVoiceImprint(sine(48000, 3.2, 180), 48000);
    expect(analysis.imprint.medianF0Hz).toBeGreaterThan(165);
    expect(analysis.imprint.medianF0Hz).toBeLessThan(195);
    expect(analysis.imprint.confidence).toBeGreaterThan(0.45);
    expect(validVoiceIdentityImprint(analysis.imprint)).toBe(true);
    expect(analysis.voicedFrameCount).toBeGreaterThan(1);
  });

  it('normalizes 44.1 kHz references to 48 kHz without shifting the voice anchor', () => {
    const normalized = resampleVoiceReference(sine(44100, 3.2, 180), 44100);
    expect(normalized.length).toBe(48000 * 3.2);
    const analysis = analyzeVoiceImprint(normalized, 48000);
    expect(analysis.imprint.medianF0Hz).toBeGreaterThan(165);
    expect(analysis.imprint.medianF0Hz).toBeLessThan(195);
  });

  it('rejects silence instead of inventing a speaker fingerprint', () => {
    expect(() => analyzeVoiceImprint(new Float32Array(48000 * 2), 48000)).toThrow();
  });

  it('rejects severely clipped reference recordings', () => {
    const clipped = sine(48000, 3.2, 180);
    for (let i = 0; i < clipped.length; i += 1) clipped[i] = clipped[i] >= 0 ? 1 : -1;
    expect(() => analyzeVoiceImprint(clipped, 48000)).toThrow(/clipped/i);
  });

  it('down-rates silence-heavy references instead of applying them at full strength', () => {
    const clean = analyzeVoiceImprint(sine(48000, 6, 180), 48000);
    const sparse = new Float32Array(48000 * 6);
    sparse.set(sine(48000, 2, 180), 48000 * 2);
    const sparseAnalysis = analyzeVoiceImprint(sparse, 48000);
    expect(sparseAnalysis.quality.activeSpeechRatio).toBeLessThan(clean.quality.activeSpeechRatio);
    expect(sparseAnalysis.imprint.confidence).toBeLessThan(clean.imprint.confidence);
  });

  it('blends imprint gently on top of the selected procedural character', () => {
    const imprint: VoiceIdentityImprint = {
      version: 1,
      formantGain: [0.94, 0.97, 1, 1.05, 1.08],
      sourceTiltScale: 0.94,
      presenceFrequencyScale: 1.03,
      presenceGainScale: 1.08,
      breathScale: 1.06,
      radiationGainDb: 0.5,
      medianF0Hz: 180,
      suggestedPitchMidi: 54,
      confidence: 0.9,
      analyzedSeconds: 4,
    };
    const base = voiceIdentityConditioningFor('natural', 0, 0);
    const conditioned = voiceIdentityConditioningFor('natural', 0, 0, imprint);
    expect(conditioned.formantGain[4]).toBeGreaterThan(base.formantGain[4]);
    expect(conditioned.sourceTiltScale).toBeLessThan(base.sourceTiltScale);
    expect(conditioned.presenceGainScale).toBeGreaterThan(base.presenceGainScale);
    expect(conditioned.breathScale).toBeGreaterThan(base.breathScale);
  });

  it('validates persisted imprint data conservatively', () => {
    const valid: VoiceIdentityImprint = {
      version: 1,
      formantGain: [1, 1, 1, 1, 1],
      sourceTiltScale: 1,
      presenceFrequencyScale: 1,
      presenceGainScale: 1,
      breathScale: 1,
      radiationGainDb: 0,
      medianF0Hz: 160,
      suggestedPitchMidi: 52,
      confidence: 0.8,
      analyzedSeconds: 5,
    };
    expect(validVoiceIdentityImprint(valid)).toBe(true);
    expect(validVoiceIdentityImprint({ ...valid, confidence: 2 })).toBe(false);
  });
});
