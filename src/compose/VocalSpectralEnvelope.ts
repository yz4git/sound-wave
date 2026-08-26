import type { VocalEvent } from './VocalGenerator';
import type { VocalPhraseControl } from './VocalPhraseModel';
import type { ScoreAlignedExpressionControl } from './ScoreAlignedExpression';

export interface VocalSpectralEnvelopeControl {
  /** One-pole time smoothing used once the vowel has settled. */
  timeSmoothingMs: number;
  /** Faster smoothing during consonant/vowel transitions so articulation is not smeared. */
  transitionSmoothingMs: number;
  /** Blend neighbouring formant gain targets to suppress narrow spectral spikes. */
  frequencySmoothing: number;
  /** Seconds from event start kept in transition-preserving mode. */
  transitionProtectionSeconds: number;
  /** Slow continuous spectral-tilt trajectory across the sustained vowel. */
  spectralTiltDepth: number;
  /** Very small formant-envelope modulation synchronized to vibrato. */
  vibratoEnvelopeDepth: number;
  /** Limits how strongly the trajectory follows per-note timbre motion. */
  trajectoryDepth: number;
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

/**
 * Lightweight approximation of the time-frequency smoothing used for spectral
 * envelope trajectories in VocaListener2. Transition regions stay relatively
 * fast; stable vowels receive stronger smoothing and more gradual timbre motion.
 */
export function spectralEnvelopeControlFor(
  event: VocalEvent,
  durationSeconds: number,
  phrase: VocalPhraseControl,
  scoreAligned: ScoreAlignedExpressionControl,
): VocalSpectralEnvelopeControl {
  const duration = Math.max(0.11, durationSeconds);
  const sustain = clamp((duration - 0.24) / 0.9, 0, 1);
  const phraseMotion = clamp(Math.abs(phrase.energyEnd - phrase.energyStart) / 0.18, 0, 1);
  const articulated = event.articulate ? 1 : 0;
  const transitionProtectionSeconds = clamp(
    scoreAligned.consonantPreRollSeconds + (articulated ? 0.055 : 0.025),
    0.025,
    0.12,
  );

  return {
    timeSmoothingMs: 22 + sustain * 18,
    transitionSmoothingMs: articulated ? 7.5 : 11,
    frequencySmoothing: clamp(0.08 + sustain * 0.08 + phraseMotion * 0.025, 0.08, 0.19),
    transitionProtectionSeconds,
    spectralTiltDepth: clamp(0.006 + sustain * 0.011 + phraseMotion * 0.004, 0.006, 0.021),
    vibratoEnvelopeDepth: clamp(0.004 + sustain * 0.004, 0.004, 0.008),
    trajectoryDepth: clamp(scoreAligned.sustainTimbreMotion * (0.82 + sustain * 0.16), 0.72, 1.08),
  };
}
