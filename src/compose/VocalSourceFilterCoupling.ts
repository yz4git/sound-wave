import type { VocalEvent, VocalVowel } from './VocalGenerator';
import type { VocalPhraseControl } from './VocalPhraseModel';
import type { VocalSpectralEnvelopeControl } from './VocalSpectralEnvelope';

export interface VocalSourceFilterCouplingControl {
  /** Strength of F1/F2 feedback into the glottal source. Kept deliberately small. */
  tractFeedbackDepth: number;
  /** Extra source spectral tilt at high F0 / open vowels to avoid brittle upper harmonics. */
  sourceTiltDepth: number;
  /** Dynamic open-quotient offset driven by vowel openness and phrase energy. */
  openQuotientOffset: number;
  /** Dynamic speed-quotient offset for stronger/softer phonation. */
  speedQuotientOffset: number;
  /** Breath/aspiration modulation coupled to open quotient and phrase release. */
  aspirationCoupling: number;
  /** High-F0 compensation that reduces derivative emphasis and feedback. */
  highPitchCompensation: number;
  /** Vowel-dependent filter load used to soften source excitation near low formants. */
  filterLoad: number;
  /** Limits how much v20.8 spectral motion can influence source shaping. */
  spectralCouplingDepth: number;
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const VOWEL_OPENNESS: Record<VocalVowel, number> = {
  a: 1,
  e: 0.62,
  i: 0.28,
  o: 0.76,
  u: 0.42,
};

/**
 * v20.9 keeps source/filter interaction conservative: the tract may influence
 * glottal shape, but never enough to destabilise pitch or reintroduce cracking.
 */
export function sourceFilterCouplingFor(
  event: VocalEvent,
  targetHz: number,
  phrase: VocalPhraseControl,
  spectral: VocalSpectralEnvelopeControl,
): VocalSourceFilterCouplingControl {
  const openness = VOWEL_OPENNESS[event.vowel] ?? 0.55;
  const phraseEnergy = clamp((phrase.energyStart + phrase.energyEnd) * 0.5, 0.78, 1.12);
  const energy = clamp((phraseEnergy - 0.94) / 0.16, -1, 1);
  const highPitch = clamp((targetHz - 420) / 620, 0, 1);
  const phraseRelease = event.phraseEnd ? 1 : clamp((phrase.progressEnd - 0.72) / 0.28, 0, 1);
  const spectralMotion = clamp((spectral.trajectoryDepth - 0.72) / 0.36, 0, 1);

  return {
    tractFeedbackDepth: clamp(0.0055 + openness * 0.0035 + (1 - highPitch) * 0.0015, 0.0045, 0.0105),
    sourceTiltDepth: clamp(0.018 + highPitch * 0.052 + openness * 0.012, 0.018, 0.082),
    openQuotientOffset: clamp(openness * 0.018 - energy * 0.014 + phraseRelease * 0.02, -0.018, 0.046),
    speedQuotientOffset: clamp(energy * 0.014 - phraseRelease * 0.008 - highPitch * 0.006, -0.016, 0.018),
    aspirationCoupling: clamp(0.12 + openness * 0.12 + phraseRelease * 0.16, 0.1, 0.4),
    highPitchCompensation: clamp(0.08 + highPitch * 0.52, 0.08, 0.6),
    filterLoad: clamp(0.1 + openness * 0.2 + highPitch * 0.06, 0.1, 0.36),
    spectralCouplingDepth: clamp(0.18 + spectralMotion * 0.18, 0.18, 0.36),
  };
}
