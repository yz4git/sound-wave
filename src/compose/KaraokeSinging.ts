import type { VocalEvent } from './VocalGenerator';
import type { VocalPhraseControl } from './VocalPhraseModel';

export interface KaraokeSingingControl {
  pitchStability: number;
  straightHoldRatio: number;
  vibratoGain: number;
  scoopCents: number;
  fallCents: number;
  dynamicGain: number;
  longTone: boolean;
}

const SECTION_GAINS = [0.94, 0.98, 1.03, 1.08] as const;

/**
 * Karaoke-score-inspired phrasing. The priority is accurate, stable pitch;
 * decorative techniques stay sparse so they do not compromise intonation.
 */
export function karaokeSingingControlFor(
  event: VocalEvent,
  durationSeconds: number,
  phrase: VocalPhraseControl,
): KaraokeSingingControl {
  const duration = Math.max(0.11, durationSeconds);
  const longTone = duration >= 0.62 && event.durationSteps >= 2;
  const bar = Math.floor(event.step / 16);
  const dynamicGain = SECTION_GAINS[bar % SECTION_GAINS.length] ?? 1;

  const scoopEligible = event.articulate
    && event.phraseStart
    && duration >= 0.24
    && phrase.phraseIndex % 2 === 0;
  const fallEligible = event.phraseEnd
    && duration >= 0.34
    && phrase.phraseIndex % 3 === 1;

  return {
    pitchStability: longTone ? 0.94 : 0.87,
    straightHoldRatio: longTone ? 0.62 : 0.9,
    vibratoGain: longTone ? 0.78 : 0.16,
    scoopCents: scoopEligible ? 9 : 0,
    fallCents: fallEligible ? 8 : 0,
    dynamicGain,
    longTone,
  };
}
