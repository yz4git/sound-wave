import type { VocalStyle, VocalVowel } from './VocalGenerator';

export interface FormantBand {
  frequency: number;
  bandwidth: number;
  gain: number;
}

export interface VocalStyleModel {
  harmonicSlope: number;
  vibratoRateHz: number;
  vibratoDepthCents: number;
  vibratoDelaySeconds: number;
  intensityModDepth: number;
  formantShift: number;
  presenceFrequency: number;
  presenceGain: number;
  breathLevel: number;
  attackSeconds: number;
  releaseSeconds: number;
  onsetPitchCents: number;
}

const VOWEL_FORMANTS: Record<VocalVowel, readonly [number, number, number, number, number]> = {
  a: [800, 1150, 2900, 3900, 4950],
  e: [530, 1850, 2500, 3500, 4950],
  i: [270, 2290, 3010, 3660, 4950],
  o: [570, 840, 2410, 3300, 4950],
  u: [300, 870, 2240, 3300, 4950],
};

const FORMANT_BANDWIDTHS = [82, 96, 135, 190, 240] as const;
const FORMANT_GAINS = [1, 0.7, 0.42, 0.2, 0.11] as const;

export const VOCAL_STYLE_MODELS: Record<VocalStyle, VocalStyleModel> = {
  warm: {
    harmonicSlope: 1.42,
    vibratoRateHz: 5.45,
    vibratoDepthCents: 38,
    vibratoDelaySeconds: 0.12,
    intensityModDepth: 0.075,
    formantShift: 0.96,
    presenceFrequency: 2920,
    presenceGain: 0.12,
    breathLevel: 0.006,
    attackSeconds: 0.032,
    releaseSeconds: 0.085,
    onsetPitchCents: 16,
  },
  bright: {
    harmonicSlope: 1.14,
    vibratoRateHz: 5.85,
    vibratoDepthCents: 28,
    vibratoDelaySeconds: 0.1,
    intensityModDepth: 0.06,
    formantShift: 1.055,
    presenceFrequency: 3050,
    presenceGain: 0.2,
    breathLevel: 0.004,
    attackSeconds: 0.024,
    releaseSeconds: 0.07,
    onsetPitchCents: 12,
  },
  airy: {
    harmonicSlope: 1.68,
    vibratoRateHz: 5.15,
    vibratoDepthCents: 44,
    vibratoDelaySeconds: 0.15,
    intensityModDepth: 0.09,
    formantShift: 1.015,
    presenceFrequency: 2850,
    presenceGain: 0.075,
    breathLevel: 0.019,
    attackSeconds: 0.045,
    releaseSeconds: 0.12,
    onsetPitchCents: 22,
  },
};

export function formantsFor(vowel: VocalVowel, style: VocalStyle): FormantBand[] {
  const frequencies = VOWEL_FORMANTS[vowel];
  const model = VOCAL_STYLE_MODELS[style];
  return frequencies.map((frequency, index) => ({
    frequency: frequency * model.formantShift,
    bandwidth: FORMANT_BANDWIDTHS[index] ?? 180,
    gain: FORMANT_GAINS[index] ?? 0.1,
  }));
}

export function harmonicSeries(style: VocalStyle, count = 32): Float32Array {
  const model = VOCAL_STYLE_MODELS[style];
  const harmonics = new Float32Array(Math.max(2, count + 1));
  for (let harmonic = 1; harmonic < harmonics.length; harmonic += 1) {
    const openPulseShape = harmonic === 2 ? 1.12 : harmonic % 2 === 1 ? 1 : 0.92;
    harmonics[harmonic] = openPulseShape / harmonic ** model.harmonicSlope;
  }
  return harmonics;
}

export function onsetFormantFrequency(syllable: string, index: number, targetFrequency: number): number {
  const initial = syllable.charAt(0).toLowerCase();
  const presets: Record<string, readonly number[]> = {
    m: [250, 900, 2200, 3300, 4700],
    n: [300, 1350, 2450, 3400, 4800],
    l: [390, 1200, 2450, 3500, 4900],
    r: [380, 1250, 1750, 3450, 4850],
    y: [280, 2200, 3000, 3700, 4950],
  };
  return presets[initial]?.[index] ?? targetFrequency;
}

export function deterministicOnsetCents(step: number, style: VocalStyle): number {
  const extent = VOCAL_STYLE_MODELS[style].onsetPitchCents;
  const normalized = (((Math.imul(step + 11, 37) >>> 0) % 101) / 100) * 2 - 1;
  return normalized * extent;
}
