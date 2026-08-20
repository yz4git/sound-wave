import type { VocalEvent } from './VocalGenerator';
import type { VocalPhraseControl } from './VocalPhraseModel';

export interface VocalResonanceControl {
  collisionThresholdRatio: number;
  collisionGainFloor: number;
  collisionBandwidthBoost: number;
  bandwidthMotion: number;
  gainMotion: number;
  energyClosureDepth: number;
  releaseOpenBoost: number;
  highPitchOpenBoost: number;
  speedEnergyBoost: number;
  vibratoResonanceDepth: number;
  nasalZeroHz: number;
  nasalZeroQ: number;
  nasalZeroMix: number;
}

function nasalZeroForSyllable(syllable: string): Pick<VocalResonanceControl, 'nasalZeroHz' | 'nasalZeroQ' | 'nasalZeroMix'> {
  const normalized = syllable.trim().toLowerCase();
  if (normalized === 'n' || normalized === 'nn') {
    return { nasalZeroHz: 1180, nasalZeroQ: 2.2, nasalZeroMix: 0.3 };
  }

  const initial = normalized.charAt(0);
  if (initial === 'm') return { nasalZeroHz: 980, nasalZeroQ: 2.1, nasalZeroMix: 0.22 };
  if (initial === 'n') return { nasalZeroHz: 1420, nasalZeroQ: 2.4, nasalZeroMix: 0.24 };
  return { nasalZeroHz: 0, nasalZeroQ: 2.2, nasalZeroMix: 0 };
}

/**
 * Dynamic-resonance limits are intentionally conservative. They shape the
 * existing v20 vocal rather than layering a new fixed presence contour on top.
 */
export function vocalResonanceControlFor(
  event: VocalEvent,
  phrase: VocalPhraseControl,
): VocalResonanceControl {
  const nasal = nasalZeroForSyllable(event.syllable);
  const phraseSpan = Math.max(1, phrase.phraseEndStep - phrase.phraseStartStep);
  const relativeDuration = Math.min(1, event.durationSteps / phraseSpan);

  return {
    collisionThresholdRatio: 0.42,
    collisionGainFloor: 0.78,
    collisionBandwidthBoost: 0.34,
    bandwidthMotion: 0.16 + relativeDuration * 0.025,
    gainMotion: 0.1,
    energyClosureDepth: 0.032,
    releaseOpenBoost: event.phraseEnd ? 0.055 : 0.035,
    highPitchOpenBoost: 0.032,
    speedEnergyBoost: 0.024,
    vibratoResonanceDepth: 0.016,
    ...nasal,
  };
}
