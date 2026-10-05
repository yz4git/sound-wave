import type { VoiceCharacterPreset } from '../compose/VoiceCharacter';
import type { VoiceIdentityImprint } from './VoiceImprint';

export interface VoiceIdentityConditioning {
  formantGain: readonly [number, number, number, number, number];
  sourceTiltScale: number;
  presenceFrequencyScale: number;
  presenceGainScale: number;
  breathScale: number;
  radiationGainDb: number;
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const BASE: Record<VoiceCharacterPreset, VoiceIdentityConditioning> = {
  soft: {
    formantGain: [1.055, 1.04, 0.995, 0.95, 0.92],
    sourceTiltScale: 1.045,
    presenceFrequencyScale: 0.985,
    presenceGainScale: 0.94,
    breathScale: 1.055,
    radiationGainDb: -0.35,
  },
  natural: {
    formantGain: [1.025, 1.02, 1, 0.985, 0.97],
    sourceTiltScale: 1,
    presenceFrequencyScale: 1,
    presenceGainScale: 1,
    breathScale: 1,
    radiationGainDb: 0,
  },
  clear: {
    formantGain: [0.99, 1.01, 1.04, 1.065, 1.045],
    sourceTiltScale: 0.96,
    presenceFrequencyScale: 1.02,
    presenceGainScale: 1.055,
    breathScale: 0.94,
    radiationGainDb: 0.42,
  },
  airy: {
    formantGain: [0.975, 0.995, 1, 0.975, 0.94],
    sourceTiltScale: 1.065,
    presenceFrequencyScale: 0.995,
    presenceGainScale: 0.96,
    breathScale: 1.12,
    radiationGainDb: -0.12,
  },
  power: {
    formantGain: [1.075, 1.065, 1.03, 1.005, 0.98],
    sourceTiltScale: 0.935,
    presenceFrequencyScale: 1.012,
    presenceGainScale: 1.035,
    breathScale: 0.9,
    radiationGainDb: 0.62,
  },
};

/**
 * Procedural analogue of separating speaker/reference conditioning from delivery.
 * Character, tone and tract length define the stable identity. Expression is
 * applied later by VoiceSynth as a relative performance delta.
 */
export function voiceIdentityConditioningFor(
  character: VoiceCharacterPreset,
  tone: number,
  tractLength: number = 0,
  imprint: VoiceIdentityImprint | null = null,
): VoiceIdentityConditioning {
  const base = BASE[character] ?? BASE.natural;
  const brightness = clamp(tone, -1, 1);
  const length = clamp(tractLength, -1, 1);
  const spectralSlope = brightness * 0.028 - length * 0.014;

  const formantGain = base.formantGain.map((value, index) => {
    const normalizedBand = index / 4 - 0.5;
    return clamp(value * (1 + normalizedBand * spectralSlope * 2), 0.88, 1.13);
  }) as [number, number, number, number, number];

  const identity: VoiceIdentityConditioning = {
    formantGain,
    sourceTiltScale: clamp(
      base.sourceTiltScale * (1 - brightness * 0.035 + length * 0.018),
      0.88,
      1.14,
    ),
    presenceFrequencyScale: clamp(
      base.presenceFrequencyScale * (1 + brightness * 0.018 - length * 0.01),
      0.96,
      1.05,
    ),
    presenceGainScale: clamp(
      base.presenceGainScale * (1 + brightness * 0.045 - length * 0.018),
      0.88,
      1.13,
    ),
    breathScale: clamp(
      base.breathScale * (1 + length * 0.012 - brightness * 0.008),
      0.84,
      1.18,
    ),
    radiationGainDb: clamp(
      base.radiationGainDb + brightness * 0.28 - length * 0.16,
      -0.8,
      0.95,
    ),
  };

  if (!imprint) return identity;
  const mix = clamp(imprint.confidence * 0.72, 0, 0.72);
  const blendMultiplier = (value: number): number => 1 + (value - 1) * mix;

  return {
    formantGain: identity.formantGain.map((value, index) => (
      clamp(value * blendMultiplier(imprint.formantGain[index] ?? 1), 0.84, 1.18)
    )) as [number, number, number, number, number],
    sourceTiltScale: clamp(
      identity.sourceTiltScale * blendMultiplier(imprint.sourceTiltScale),
      0.82,
      1.2,
    ),
    presenceFrequencyScale: clamp(
      identity.presenceFrequencyScale * blendMultiplier(imprint.presenceFrequencyScale),
      0.94,
      1.07,
    ),
    presenceGainScale: clamp(
      identity.presenceGainScale * blendMultiplier(imprint.presenceGainScale),
      0.82,
      1.2,
    ),
    breathScale: clamp(
      identity.breathScale * blendMultiplier(imprint.breathScale),
      0.8,
      1.24,
    ),
    radiationGainDb: clamp(
      identity.radiationGainDb + imprint.radiationGainDb * mix,
      -1.1,
      1.2,
    ),
  };
}
