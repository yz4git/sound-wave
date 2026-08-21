import type { ArrangementBar } from './GenreArrangement';
import type { GenreStyleProfile } from './GenreStyle';
import type { VocalEvent } from './VocalGenerator';
import type { VocalPhraseControl } from './VocalPhraseModel';

export interface ProducerTuningControl {
  /** Additional consonant lead before the score onset. Note-off stays fixed. */
  timingLeadSeconds: number;
  /** Scales consonant closure/frication/VOT duration, similar to VOCALOID Velocity. */
  consonantLengthScale: number;
  /** Phrase-head energy contour multiplier. */
  dynamicsStartScale: number;
  /** Phrase-tail energy contour multiplier. */
  dynamicsEndScale: number;
  /** Scales the local vocal attack time; below 1 is crisper. */
  attackTimeScale: number;
  /** Air/breath automation multiplier. */
  airScale: number;
  /** Small mouth-opening proxy applied only to F1/F2. */
  mouthScale: number;
  /** Scales consonant noise/articulation strength. */
  articulationScale: number;
  /** Additional score-safe scoop depth in cents. */
  scoopCentsAdd: number;
  /** Additional score-safe fall depth in cents. */
  fallCentsAdd: number;
  /** Per-note vibrato amount multiplier. */
  vibratoScale: number;
  /** Per-note micro-instability multiplier. */
  jitterScale: number;
  /** How much instrumental level should yield while the lead is active. */
  vocalPocket: number;
  /** Stable tag useful for tests and future diagnostics. */
  role: 'plain' | 'phrase-head' | 'long-tone' | 'phrase-tail' | 'hook';
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

function deterministicUnit(step: number, salt: number): number {
  let value = Math.imul(step + 17 + salt * 131, 0x45d9f3b) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x45d9f3b) >>> 0;
  value ^= value >>> 16;
  return value / 4294967296;
}

function isHookSection(state: ArrangementBar | undefined): boolean {
  return state?.section === 'chorus' || state?.section === 'drop' || state?.section === 'climax';
}

function genreBias(profile: GenreStyleProfile): {
  consonant: number;
  attack: number;
  air: number;
  scoopChance: number;
  scoopDepth: number;
  fallChance: number;
  fallDepth: number;
  vibrato: number;
  jitter: number;
  pocket: number;
} {
  if (profile.genre === 'rock') {
    return {
      consonant: 0.94,
      attack: 0.84,
      air: profile.id === 'indie' ? 1.08 : 0.86,
      scoopChance: 0.12,
      scoopDepth: 3.5,
      fallChance: 0.16,
      fallDepth: 3,
      vibrato: 0.92,
      jitter: 0.95,
      pocket: 0.032,
    };
  }
  if (profile.genre === 'k-pop') {
    return {
      consonant: 0.9,
      attack: 0.82,
      air: profile.id === 'ballad' || profile.id === 'rnb-pop' ? 1.12 : 0.94,
      scoopChance: 0.16,
      scoopDepth: 3,
      fallChance: 0.12,
      fallDepth: 2.5,
      vibrato: profile.id === 'ballad' ? 1.08 : 0.9,
      jitter: 0.68,
      pocket: 0.028,
    };
  }
  if (profile.genre === 'game-music') {
    return {
      consonant: 0.98,
      attack: 0.9,
      air: profile.id === 'puzzle' ? 1.12 : 0.92,
      scoopChance: 0.1,
      scoopDepth: 2.5,
      fallChance: 0.1,
      fallDepth: 2.2,
      vibrato: 0.94,
      jitter: 0.8,
      pocket: 0.024,
    };
  }
  return {
    consonant: 1,
    attack: 0.92,
    air: profile.id === 'ballad' ? 1.16 : 1,
    scoopChance: profile.id === 'ballad' ? 0.24 : 0.32,
    scoopDepth: profile.id === 'ballad' ? 4.5 : 5.5,
    fallChance: profile.id === 'ballad' ? 0.2 : 0.14,
    fallDepth: 3.5,
    vibrato: profile.id === 'ballad' ? 1.12 : 1.02,
    jitter: 0.82,
    pocket: 0.026,
  };
}

/**
 * Practical producer-style tuning grammar.  It deliberately selects only a
 * subset of notes for ornaments so the singer does not sound over-edited.
 */
export function producerTuningFor(
  event: VocalEvent,
  phrase: VocalPhraseControl,
  profile: GenreStyleProfile,
  state: ArrangementBar | undefined,
  localStep: number,
  durationSeconds: number,
): ProducerTuningControl {
  const bias = genreBias(profile);
  const strongBeat = localStep % 4 === 0;
  const phraseHead = event.phraseStart;
  const phraseTail = event.phraseEnd;
  const hook = isHookSection(state);
  const longTone = durationSeconds >= 0.58 || event.durationSteps >= 3;
  const dense = (state?.vocalDensityScale ?? 1) > 1.02;
  const energy = clamp(state?.energy ?? 1, 0.55, 1.2);
  const onsetPick = deterministicUnit(event.step, 3);
  const releasePick = deterministicUnit(event.step, 7);

  const scoopSelected = phraseHead
    && strongBeat
    && onsetPick < bias.scoopChance * (hook ? 1.18 : 1);
  const fallSelected = phraseTail
    && releasePick < bias.fallChance * (longTone ? 1.3 : 0.8);

  let role: ProducerTuningControl['role'] = 'plain';
  if (hook && phraseHead) role = 'hook';
  else if (phraseHead) role = 'phrase-head';
  else if (phraseTail) role = 'phrase-tail';
  else if (longTone) role = 'long-tone';

  const phraseRise = clamp((phrase.energyStart - 0.9) * 0.22, -0.025, 0.04);
  const phraseFall = clamp((phrase.energyEnd - phrase.energyStart) * 0.16, -0.035, 0.035);
  const headAccent = phraseHead ? 0.035 : strongBeat ? 0.012 : 0;
  const tailEase = phraseTail ? -0.055 : 0;
  const hookLift = hook ? 0.025 : 0;

  const timingLeadSeconds = event.articulate
    ? clamp((phraseHead ? 0.009 : strongBeat ? 0.0045 : 0.0025) * (profile.genre === 'k-pop' ? 0.72 : 1), 0, 0.012)
    : 0;

  return {
    timingLeadSeconds,
    consonantLengthScale: clamp(
      bias.consonant
        * (phraseHead ? 1.08 : 1)
        * (dense ? 0.94 : 1)
        * (profile.id === 'ballad' ? 1.05 : 1),
      0.78,
      1.18,
    ),
    dynamicsStartScale: clamp(1 + headAccent + hookLift + phraseRise, 0.9, 1.1),
    dynamicsEndScale: clamp(1 + tailEase + hookLift * 0.5 + phraseFall, 0.88, 1.08),
    attackTimeScale: clamp(bias.attack * (phraseHead ? 0.92 : 1) * (hook ? 0.96 : 1), 0.72, 1.08),
    airScale: clamp(
      bias.air
        * (phraseHead ? 1.08 : 1)
        * (phraseTail ? 1.12 : 1)
        * (state?.section === 'break' ? 1.1 : 1),
      0.72,
      1.35,
    ),
    mouthScale: clamp(1 + (hook ? 0.018 : 0) + (energy - 0.9) * 0.018, 0.985, 1.035),
    articulationScale: clamp(
      profile.vocalArticulation
        * (phraseHead ? 1.06 : 1)
        * (profile.genre === 'rock' || profile.genre === 'k-pop' ? 1.05 : 1),
      0.82,
      1.22,
    ),
    scoopCentsAdd: scoopSelected ? bias.scoopDepth : 0,
    fallCentsAdd: fallSelected ? bias.fallDepth : 0,
    vibratoScale: clamp(
      bias.vibrato * (longTone ? 1.08 : 0.9) * (hook ? 1.03 : 1),
      0.72,
      1.2,
    ),
    jitterScale: clamp(bias.jitter * (hook ? 0.92 : 1), 0.55, 1.05),
    vocalPocket: clamp(bias.pocket + (hook ? 0.01 : 0) + (dense ? 0.006 : 0), 0.018, 0.05),
    role,
  };
}
