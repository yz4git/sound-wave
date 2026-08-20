import type { VocalVowel } from './VocalGenerator';

export type JapaneseConsonant =
  | 'vowel'
  | 'k'
  | 't'
  | 's'
  | 'h'
  | 'f'
  | 'p'
  | 'b'
  | 'g'
  | 'z'
  | 'n'
  | 'm'
  | 'y'
  | 'r'
  | 'l'
  | 'N';

export interface JapanesePhonemeTiming {
  consonant: JapaneseConsonant;
  closureSeconds: number;
  burstSeconds: number;
  fricationSeconds: number;
  voicingDelaySeconds: number;
  noiseMix: number;
  voicedMix: number;
  nasalMix: number;
  aspirationMix: number;
  coarticulationLead: number;
  moraicN: boolean;
}

const VOWELS = new Set<VocalVowel>(['a', 'e', 'i', 'o', 'u']);

const TIMINGS: Record<JapaneseConsonant, Omit<JapanesePhonemeTiming, 'consonant'>> = {
  vowel: {
    closureSeconds: 0,
    burstSeconds: 0,
    fricationSeconds: 0,
    voicingDelaySeconds: 0,
    noiseMix: 0,
    voicedMix: 1,
    nasalMix: 0,
    aspirationMix: 0.04,
    coarticulationLead: 0.2,
    moraicN: false,
  },
  k: {
    closureSeconds: 0.028,
    burstSeconds: 0.014,
    fricationSeconds: 0.012,
    voicingDelaySeconds: 0.036,
    noiseMix: 0.2,
    voicedMix: 0.08,
    nasalMix: 0,
    aspirationMix: 0.22,
    coarticulationLead: 0.17,
    moraicN: false,
  },
  t: {
    closureSeconds: 0.024,
    burstSeconds: 0.011,
    fricationSeconds: 0.017,
    voicingDelaySeconds: 0.032,
    noiseMix: 0.22,
    voicedMix: 0.06,
    nasalMix: 0,
    aspirationMix: 0.17,
    coarticulationLead: 0.16,
    moraicN: false,
  },
  s: {
    closureSeconds: 0,
    burstSeconds: 0,
    fricationSeconds: 0.055,
    voicingDelaySeconds: 0.042,
    noiseMix: 0.24,
    voicedMix: 0.05,
    nasalMix: 0,
    aspirationMix: 0.1,
    coarticulationLead: 0.2,
    moraicN: false,
  },
  h: {
    closureSeconds: 0,
    burstSeconds: 0,
    fricationSeconds: 0.048,
    voicingDelaySeconds: 0.028,
    noiseMix: 0.14,
    voicedMix: 0.04,
    nasalMix: 0,
    aspirationMix: 0.28,
    coarticulationLead: 0.22,
    moraicN: false,
  },
  f: {
    closureSeconds: 0,
    burstSeconds: 0,
    fricationSeconds: 0.052,
    voicingDelaySeconds: 0.034,
    noiseMix: 0.18,
    voicedMix: 0.04,
    nasalMix: 0,
    aspirationMix: 0.2,
    coarticulationLead: 0.22,
    moraicN: false,
  },
  p: {
    closureSeconds: 0.032,
    burstSeconds: 0.012,
    fricationSeconds: 0.008,
    voicingDelaySeconds: 0.039,
    noiseMix: 0.17,
    voicedMix: 0.04,
    nasalMix: 0,
    aspirationMix: 0.2,
    coarticulationLead: 0.15,
    moraicN: false,
  },
  b: {
    closureSeconds: 0.025,
    burstSeconds: 0.011,
    fricationSeconds: 0.005,
    voicingDelaySeconds: 0.014,
    noiseMix: 0.1,
    voicedMix: 0.42,
    nasalMix: 0,
    aspirationMix: 0.04,
    coarticulationLead: 0.17,
    moraicN: false,
  },
  g: {
    closureSeconds: 0.024,
    burstSeconds: 0.012,
    fricationSeconds: 0.007,
    voicingDelaySeconds: 0.015,
    noiseMix: 0.11,
    voicedMix: 0.38,
    nasalMix: 0,
    aspirationMix: 0.05,
    coarticulationLead: 0.18,
    moraicN: false,
  },
  z: {
    closureSeconds: 0,
    burstSeconds: 0,
    fricationSeconds: 0.047,
    voicingDelaySeconds: 0.012,
    noiseMix: 0.18,
    voicedMix: 0.32,
    nasalMix: 0,
    aspirationMix: 0.03,
    coarticulationLead: 0.2,
    moraicN: false,
  },
  n: {
    closureSeconds: 0,
    burstSeconds: 0,
    fricationSeconds: 0.025,
    voicingDelaySeconds: 0,
    noiseMix: 0.015,
    voicedMix: 0.64,
    nasalMix: 0.52,
    aspirationMix: 0,
    coarticulationLead: 0.25,
    moraicN: false,
  },
  m: {
    closureSeconds: 0,
    burstSeconds: 0,
    fricationSeconds: 0.028,
    voicingDelaySeconds: 0,
    noiseMix: 0.012,
    voicedMix: 0.7,
    nasalMix: 0.58,
    aspirationMix: 0,
    coarticulationLead: 0.24,
    moraicN: false,
  },
  y: {
    closureSeconds: 0,
    burstSeconds: 0,
    fricationSeconds: 0.028,
    voicingDelaySeconds: 0,
    noiseMix: 0.008,
    voicedMix: 0.78,
    nasalMix: 0,
    aspirationMix: 0,
    coarticulationLead: 0.28,
    moraicN: false,
  },
  r: {
    closureSeconds: 0.01,
    burstSeconds: 0.006,
    fricationSeconds: 0.022,
    voicingDelaySeconds: 0,
    noiseMix: 0.02,
    voicedMix: 0.56,
    nasalMix: 0,
    aspirationMix: 0,
    coarticulationLead: 0.23,
    moraicN: false,
  },
  l: {
    closureSeconds: 0,
    burstSeconds: 0,
    fricationSeconds: 0.03,
    voicingDelaySeconds: 0,
    noiseMix: 0.012,
    voicedMix: 0.6,
    nasalMix: 0,
    aspirationMix: 0,
    coarticulationLead: 0.24,
    moraicN: false,
  },
  N: {
    closureSeconds: 0,
    burstSeconds: 0,
    fricationSeconds: 0,
    voicingDelaySeconds: 0,
    noiseMix: 0.008,
    voicedMix: 0.76,
    nasalMix: 0.76,
    aspirationMix: 0,
    coarticulationLead: 0.38,
    moraicN: true,
  },
};

export function consonantForSyllable(syllable: string): JapaneseConsonant {
  const normalized = syllable.trim().toLowerCase();
  if (normalized === 'n' || normalized === 'nn') return 'N';
  const first = normalized.charAt(0);
  if (VOWELS.has(first as VocalVowel)) return 'vowel';
  if (first === 'k' || first === 't' || first === 's' || first === 'h' || first === 'f'
    || first === 'p' || first === 'b' || first === 'g' || first === 'z' || first === 'n'
    || first === 'm' || first === 'y' || first === 'r' || first === 'l') return first;
  return 'vowel';
}

export function phonemeTimingFor(syllable: string): JapanesePhonemeTiming {
  const consonant = consonantForSyllable(syllable);
  return { consonant, ...TIMINGS[consonant] };
}
