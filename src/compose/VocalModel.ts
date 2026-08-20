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

// Presence Reset keeps the Soft Pop vocal-tract shape but disables the extra
// singer-presence resonator. This lets the Human Phrase Model be judged without
// a permanently emphasized 2.8-3.0 kHz layer on top of the five formants.
const FORMANT_BANDWIDTHS = [104, 122, 176, 238, 295] as const;
const FORMANT_GAINS = [1, 0.6, 0.28, 0.1, 0.04] as const;

export const VOCAL_STYLE_MODELS: Record<VocalStyle, VocalStyleModel> = {
  warm: {
    glottalOpenQuotient: 0.69,
    glottalSpeedQuotient: 0.63,
    spectralTilt: 1.38,
    vibratoRateHz: 5.15,
    vibratoDepthCents: 14,
    vibratoDelaySeconds: 0.36,
    intensityModDepth: 0.018,
    jitterCents: 0.5,
    shimmerDepth: 0.005,
    formantShift: 0.985,
    presenceFrequency: 2840,
    presenceGain: 0,
    breathLevel: 0.007,
    attackSeconds: 0.06,
    releaseSeconds: 0.145,
    onsetPitchCents: 3,
    radiationFrequency: 1400,
    radiationGainDb: 1.1,
    doubleDelaySeconds: 0.012,
    doubleLevel: 0,
  },
  bright: {
    glottalOpenQuotient: 0.62,
    glottalSpeedQuotient: 0.68,
    spectralTilt: 1.22,
    vibratoRateHz: 5.3,
    vibratoDepthCents: 12,
    vibratoDelaySeconds: 0.34,
    intensityModDepth: 0.015,
    jitterCents: 0.42,
    shimmerDepth: 0.004,
    formantShift: 1.025,
    presenceFrequency: 2960,
    presenceGain: 0,
    breathLevel: 0.0055,
    attackSeconds: 0.052,
    releaseSeconds: 0.125,
    onsetPitchCents: 3,
    radiationFrequency: 1340,
    radiationGainDb: 1.4,
    doubleDelaySeconds: 0.009,
    doubleLevel: 0,
  },
  airy: {
    glottalOpenQuotient: 0.75,
    glottalSpeedQuotient: 0.57,
    spectralTilt: 1.66,
    vibratoRateHz: 5,
    vibratoDepthCents: 16,
    vibratoDelaySeconds: 0.38,
    intensityModDepth: 0.021,
    jitterCents: 0.75,
    shimmerDepth: 0.008,
    formantShift: 1,
    presenceFrequency: 2800,
    presenceGain: 0,
    breathLevel: 0.017,
    attackSeconds: 0.074,
    releaseSeconds: 0.175,
    onsetPitchCents: 4.5,
    radiationFrequency: 1600,
    radiationGainDb: 0.8,
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
  const normalized = syllable.trim().toLowerCase();
  const initial = normalized === 'n' || normalized === 'nn' ? 'N' : normalized.charAt(0);
  const presets: Record<string, readonly number[]> = {
    // Nasals / approximants.
    m: [250, 900, 2200, 3300, 4700],
    n: [300, 1350, 2450, 3400, 4800],
    N: [280, 1050, 2200, 3250, 4550],
    l: [390, 1200, 2450, 3500, 4900],
    r: [380, 1250, 1750, 3450, 4850],
    y: [280, 2200, 3000, 3700, 4950],
    // Japanese-style places of articulation. These are transition anchors, not
    // static consonant formants: the worklet moves through them into the vowel.
    k: [360, 1180, 2500, 3500, 4800],
    g: [340, 1120, 2420, 3450, 4780],
    t: [350, 1650, 2850, 3850, 5000],
    s: [330, 1750, 3150, 4300, 5200],
    z: [340, 1650, 3000, 4150, 5100],
    p: [260, 820, 2180, 3300, 4680],
    b: [270, 860, 2220, 3320, 4700],
    h: [420, 1450, 2600, 3600, 4850],
    f: [360, 1250, 2380, 3500, 4750],
  };
  return presets[initial]?.[index] ?? targetFrequency;
}

export function deterministicOnsetCents(step: number, style: VocalStyle): number {
  const extent = VOCAL_STYLE_MODELS[style].onsetPitchCents;
  const normalized = (((Math.imul(step + 11, 37) >>> 0) % 101) / 100) * 2 - 1;
  return normalized * extent;
}
