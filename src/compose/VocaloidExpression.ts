import type { JapanesePhonemeTiming } from './JapanesePhoneme';
import type { VocalEvent } from './VocalGenerator';
import type { VocalPhraseControl } from './VocalPhraseModel';

export interface VocaloidExpressionControl {
  /** Start consonant material before the score note so the vowel nucleus lands near Note-On. */
  consonantPreRollSeconds: number;
  /** Preserve articulation/transition character; use most timbre motion on the sustained region. */
  transitionPreservation: number;
  /** Scale slow formant bandwidth/gain motion during the sustained part of the note. */
  sustainTimbreMotion: number;
  /** Small per-note dynamics trajectory derived from phrase position. */
  energyStartScale: number;
  energyEndScale: number;
  /** Keep late-vowel neutralisation smooth rather than exaggerating it at note boundaries. */
  centeringScale: number;
  /** Phrase-start/release aspiration remains subtle and context dependent. */
  aspirationScale: number;
  /** Very small spectral-envelope tilt proxy applied across the five formant gains. */
  upperFormantScale: number;
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

/**
 * Public VOCALOID descriptions place the vowel onset on score Note-On while
 * allowing consonantal material to precede it.  Our local singer is procedural,
 * so we derive a bounded pre-roll from the existing Japanese phoneme model.
 */
export function consonantPreRollSeconds(
  event: VocalEvent,
  phoneme: JapanesePhonemeTiming,
): number {
  if (!event.articulate || phoneme.consonant === 'vowel' || phoneme.moraicN) return 0;

  const articulationSpan = phoneme.closureSeconds
    + phoneme.burstSeconds
    + Math.min(0.06, phoneme.fricationSeconds);
  const required = Math.max(articulationSpan, phoneme.voicingDelaySeconds);
  return clamp(required, 0, 0.065);
}

/**
 * Derive a conservative, deterministic expression plan from score context.
 * The transition itself is intentionally protected; stronger timbre movement is
 * reserved for long/stationary vowels, mirroring the transition/stationary split
 * described in early VOCALOID literature.
 */
export function vocaloidExpressionFor(
  event: VocalEvent,
  phoneme: JapanesePhonemeTiming,
  durationSeconds: number,
  phrase: VocalPhraseControl,
): VocaloidExpressionControl {
  const duration = Math.max(0.11, durationSeconds);
  const preRoll = consonantPreRollSeconds(event, phoneme);
  const longSustain = clamp((duration - 0.38) / 0.8, 0, 1);
  const stationary = event.articulate ? 0.74 + longSustain * 0.24 : 1.04;
  const phraseEnergy = (phrase.energyStart + phrase.energyEnd) * 0.5;
  const timbreEnergy = clamp((phraseEnergy - 0.94) / 0.16, -1, 1);

  const energyStartScale = event.phraseStart
    ? 0.95
    : event.articulate
      ? 0.985
      : 0.995;
  const energyEndScale = event.phraseEnd
    ? 0.91
    : 1 + longSustain * 0.018;

  return {
    consonantPreRollSeconds: preRoll,
    transitionPreservation: event.articulate ? 0.9 + longSustain * 0.06 : 0.98,
    sustainTimbreMotion: clamp(stationary, 0.72, 1.08),
    energyStartScale,
    energyEndScale,
    centeringScale: event.phraseEnd ? 1.04 : 0.94,
    aspirationScale: event.phraseStart ? 1.04 : event.phraseEnd ? 1.03 : 0.96,
    upperFormantScale: clamp(1 + timbreEnergy * 0.025, 0.975, 1.025),
  };
}
