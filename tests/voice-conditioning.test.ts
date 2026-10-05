import { describe, expect, it } from 'vitest';
import type { VoiceCharacterPreset } from '../src/compose/VoiceCharacter';
import { voiceIdentityConditioningFor } from '../src/voice/VoiceConditioning';

const PRESETS: readonly VoiceCharacterPreset[] = ['soft', 'natural', 'clear', 'airy', 'power'];

describe('voice identity conditioning', () => {
  it('is deterministic and remains inside conservative bounds', () => {
    for (const preset of PRESETS) {
      const a = voiceIdentityConditioningFor(preset, 0.25, -0.2);
      expect(a).toEqual(voiceIdentityConditioningFor(preset, 0.25, -0.2));
      for (const gain of a.formantGain) {
        expect(gain).toBeGreaterThanOrEqual(0.88);
        expect(gain).toBeLessThanOrEqual(1.13);
      }
      expect(a.sourceTiltScale).toBeGreaterThanOrEqual(0.88);
      expect(a.sourceTiltScale).toBeLessThanOrEqual(1.14);
      expect(a.presenceFrequencyScale).toBeGreaterThanOrEqual(0.96);
      expect(a.presenceFrequencyScale).toBeLessThanOrEqual(1.05);
      expect(a.presenceGainScale).toBeGreaterThanOrEqual(0.88);
      expect(a.presenceGainScale).toBeLessThanOrEqual(1.13);
      expect(a.breathScale).toBeGreaterThanOrEqual(0.84);
      expect(a.breathScale).toBeLessThanOrEqual(1.18);
    }
  });

  it('keeps character fingerprints distinct', () => {
    const soft = voiceIdentityConditioningFor('soft', 0, 0);
    const clear = voiceIdentityConditioningFor('clear', 0, 0);
    const power = voiceIdentityConditioningFor('power', 0, 0);
    expect(soft.formantGain[4]).toBeLessThan(clear.formantGain[4]);
    expect(power.formantGain[0]).toBeGreaterThan(clear.formantGain[0]);
    expect(soft.sourceTiltScale).toBeGreaterThan(clear.sourceTiltScale);
  });

  it('uses tone as a relative brightness delta', () => {
    const dark = voiceIdentityConditioningFor('natural', -1, 0);
    const bright = voiceIdentityConditioningFor('natural', 1, 0);
    expect(bright.formantGain[4]).toBeGreaterThan(dark.formantGain[4]);
    expect(bright.formantGain[0]).toBeLessThan(dark.formantGain[0]);
    expect(bright.presenceGainScale).toBeGreaterThan(dark.presenceGainScale);
    expect(bright.sourceTiltScale).toBeLessThan(dark.sourceTiltScale);
  });

  it('lets tract length move identity only slightly', () => {
    const short = voiceIdentityConditioningFor('natural', 0, -1);
    const long = voiceIdentityConditioningFor('natural', 0, 1);
    expect(long.presenceFrequencyScale).toBeLessThan(short.presenceFrequencyScale);
    expect(long.sourceTiltScale).toBeGreaterThan(short.sourceTiltScale);
    expect(Math.abs(long.formantGain[4] - short.formantGain[4])).toBeLessThan(0.04);
  });
});
