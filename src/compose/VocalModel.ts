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

const FORMANT_BANDWIDTHS = [82, 96, 135, 190, 240] as const;
const FORMANT_GAINS = [1, 0.68, 0.36, 0.16, 0.08] as const;

export const VOCAL_STYLE_MODELS: Record<VocalStyle, VocalStyleModel> = {
  warm: {
    glottalOpenQuotient: 0.64,
    glottalSpeedQuotient: 0.68,
    spectralTilt: 1.25,
    vibratoRateHz: 5.35,
    vibratoDepthCents: 24,
    vibratoDelaySeconds: 0.22,
    intensityModDepth: 0.035,
    jitterCents: 1.2,
    shimmerDepth: 0.012,
    formantShift: 0.98,
    presenceFrequency: 2920,
    presenceGain: 0.145,
    breathLevel: 0.0045,
    attackSeconds: 0.035,
    releaseSeconds: 0.09,
    onsetPitchCents: 7,
    radiationFrequency: 1250,
    radiationGainDb: 2.2,
    doubleDelaySeconds: 0.012,
    doubleLevel: 0,
  },
  bright: {
    glottalOpenQuotient: 0.54,
    glottalSpeedQuotient: 0.75,
    spectralTilt: 1.06,
    vibratoRateHz: 5.65,
    vibratoDepthCents: 20,
    vibratoDelaySeconds: 0.19,
    intensityModDepth: 0.03,
    jitterCents: 0.9,
    shimmerDepth: 0.01,
    formantShift: 1.03,
    presenceFrequency: 3020,
    presenceGain: 0.19,
    breathLevel: 0.0032,
    attackSeconds: 0.028,
    releaseSeconds: 0.075,
    onsetPitchCents: 6,
    radiationFrequency: 1180,
    radiationGainDb: 2.8,
    doubleDelaySeconds: 0.009,
    doubleLevel: 0,
  },
  airy: {
    glottalOpenQuotient: 0.7,
    glottalSpeedQuotient: 0.6,
    spectralTilt: 1.5,
    vibratoRateHz: 5.1,
    vibratoDepthCents: 28,
    vibratoDelaySeconds: 0.25,
    intensityModDepth: 0.045,
    jitterCents: 1.6,
    shimmerDepth: 0.018,
    formantShift: 1,
    presenceFrequency: 2860,
    presenceGain: 0.105,
    breathLevel: 0.012,
    attackSeconds: 0.05,
    releaseSeconds: 0.125,
    onsetPitchCents: 10,
    radiationFrequency: 1450,
    radiationGainDb: 1.6,
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