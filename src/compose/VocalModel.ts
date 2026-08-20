import type { VocalStyle, VocalVowel } from './VocalGenerator';

export interface FormantBand {
  frequency: number;
  bandwidth: number;
  gain: number;
}

export interface VocalStyleModel {
  glottalOpenQuotient: number;
  glottalSpeedQuotient: number;
  spectralTilt: number;
  vibratoRateHz: number;
  vibratoDepthCents: number;
  vibratoDelaySeconds: number;
  intensityModDepth: number;
  jitterCents: number;
  shimmerDepth: number;
  formantShift: number;
  presenceFrequency: number;
  presenceGain: number;
  breathLevel: number;
  attackSeconds: number;
  releaseSeconds: number;
  onsetPitchCents: number;
  radiationFrequency: number;
  radiationGainDb: number;
  doubleDelaySeconds: number;
  doubleLevel: number;
}

const VOWEL_FORMANTS: Record<VocalVowel, readonly [number, number, number, number, number]> = {
  a: [800, 1150, 2900, 3900, 4950],
  e: [530, 1850, 2500, 3500, 4950],
  i: [270, 2290, 3010, 3660, 4950],
  o: [570, 840, 2410, 3300, 4950],
  u: [300, 870, 2240, 3300, 4950],
};

// Slightly wider resonances and a gentler upper-formant roll-off reduce the
// metallic edge while keeping the vowel identity readable on small speakers.
const FORMANT_BANDWIDTHS = [96, 112, 158, 215, 270] as const;
const FORMANT_GAINS = [1, 0.62, 0.31, 0.12, 0.055] as const;

export const VOCAL_STYLE_MODELS: Record<VocalStyle, VocalStyleModel> = {
  warm: {
    glottalOpenQuotient: 0.66,
    glottalSpeedQuotient: 0.66,
    spectralTilt: 1.32,
    vibratoRateHz: 5.25,
    vibratoDepthCents: 20,
    vibratoDelaySeconds: 0.27,
    intensityModDepth: 0.026,
    jitterCents: 0.8,
    shimmerDepth: 0.008,
    formantShift: 0.975,
    presenceFrequency: 2860,
    presenceGain: 0.13,
    breathLevel: 0.0055,
    attackSeconds: 0.052,
    releaseSeconds: 0.12,
    onsetPitchCents: 4,
    radiationFrequency: 1320,
    radiationGainDb: 1.6,
    doubleDelaySeconds: 0.012,
    doubleLevel: 0,
  },
  bright: {
    glottalOpenQuotient: 0.57,
    glottalSpeedQuotient: 0.72,
    spectralTilt: 1.13,
    vibratoRateHz: 5.5,
    vibratoDepthCents: 18,
    vibratoDelaySeconds: 0.24,
    intensityModDepth: 0.024,
    jitterCents: 0.65,
    shimmerDepth: 0.007,
    formantShift: 1.02,
    presenceFrequency: 2980,
    presenceGain: 0.17,
    breathLevel: 0.004,
    attackSeconds: 0.042,
    releaseSeconds: 0.1,
    onsetPitchCents: 4,
    radiationFrequency: 1260,
    radiationGainDb: 2,
    doubleDelaySeconds: 0.009,
    doubleLevel: 0,
  },
  airy: {
    glottalOpenQuotient: 0.72,
    glottalSpeedQuotient: 0.59,
    spectralTilt: 1.56,
    vibratoRateHz: 5.05,
    vibratoDepthCents: 24,
    vibratoDelaySeconds: 0.3,
    intensityModDepth: 0.034,
    jitterCents: 1.15,
    shimmerDepth: 0.013,
    formantShift: 0.995,
    presenceFrequency: 2820,
    presenceGain: 0.095,
    breathLevel: 0.014,
    attackSeconds: 0.066,
    releaseSeconds: 0.15,
    onsetPitchCents: 7,
    radiationFrequency: 1520,
    radiationGainDb: 1.2,
    doubleDelaySeconds: 0.016,
    doubleLevel: 0,
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

function glottalFlowSample(phase: number, openQuotient: number, speedQuotient: number): number {
  if (phase >= openQuotient) return 0;
  const openingEnd = openQuotient * speedQuotient;
  if (phase <= openingEnd) {
    const normalized = phase / Math.max(0.0001, openingEnd);
    return 0.5 - 0.5 * Math.cos(Math.PI * normalized);
  }
  const normalized = (phase - openingEnd) / Math.max(0.0001, openQuotient - openingEnd);
  return Math.cos(normalized * Math.PI * 0.5) ** 2;
}

export function glottalHarmonicSeries(style: VocalStyle, count = 48): Float32Array {
  const model = VOCAL_STYLE_MODELS[style];
  const sampleCount = 512;
  const flow = new Float32Array(sampleCount);
  for (let index = 0; index < sampleCount; index += 1) {
    flow[index] = glottalFlowSample(index / sampleCount, model.glottalOpenQuotient, model.glottalSpeedQuotient);
  }

  const harmonics = new Float32Array(Math.max(2, count + 1));
  for (let harmonic = 1; harmonic < harmonics.length; harmonic += 1) {
    let imaginary = 0;
    for (let index = 0; index < sampleCount; index += 1) {
      imaginary += flow[index]! * Math.sin(2 * Math.PI * harmonic * index / sampleCount);
    }
    const normalized = Math.abs(imaginary) / sampleCount;
    harmonics[harmonic] = normalized / harmonic ** model.spectralTilt;
  }

  let peak = 0;
  for (let harmonic = 1; harmonic < harmonics.length; harmonic += 1) peak = Math.max(peak, harmonics[harmonic] ?? 0);
  if (peak > 0) {
    for (let harmonic = 1; harmonic < harmonics.length; harmonic += 1) {
      harmonics[harmonic] = (harmonics[harmonic] ?? 0) / peak;
    }
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