import type { VocalEvent } from './VocalGenerator';

export interface VocalPhraseControl {
  phraseIndex: number;
  phraseStartStep: number;
  phraseEndStep: number;
  progressStart: number;
  progressEnd: number;
  energyStart: number;
  energyEnd: number;
  centeringStart: number;
  centeringEnd: number;
  aspirationDepth: number;
  sourceTractCoupling: number;
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

function smoothstep(value: number): number {
  const x = clamp01(value);
  return x * x * (3 - 2 * x);
}

/**
 * Human-like phrase dynamics: gentle entry, a modest crest around the middle,
 * then a softer release. The range is intentionally small so note velocity
 * still carries most of the musical expression.
 */
export function phraseEnergyAt(progress: number): number {
  const position = clamp01(progress);
  if (position <= 0.56) {
    return 0.88 + smoothstep(position / 0.56) * 0.16;
  }
  return 1.04 - smoothstep((position - 0.56) / 0.44) * 0.22;
}

/**
 * Only the end of a phrase moves slightly toward a neutral vowel. This avoids
 * the synthetic effect of holding a perfectly static formant target until the
 * exact release frame.
 */
export function vowelCenteringAt(progress: number): number {
  const position = clamp01(progress);
  if (position <= 0.72) return 0;
  return smoothstep((position - 0.72) / 0.28) * 0.16;
}

export function neutralPhraseControl(event: VocalEvent): VocalPhraseControl {
  return {
    phraseIndex: 0,
    phraseStartStep: event.step,
    phraseEndStep: event.step + event.durationSteps,
    progressStart: 0,
    progressEnd: 1,
    energyStart: 0.92,
    energyEnd: 0.88,
    centeringStart: 0,
    centeringEnd: event.phraseEnd ? 0.12 : 0,
    aspirationDepth: 0.1,
    sourceTractCoupling: 0.026,
  };
}

export function buildVocalPhraseControls(line: readonly VocalEvent[]): ReadonlyMap<number, VocalPhraseControl> {
  const controls = new Map<number, VocalPhraseControl>();
  if (line.length === 0) return controls;

  let phraseIndex = 0;
  let startIndex = 0;

  const commitPhrase = (endIndex: number): void => {
    const first = line[startIndex];
    const last = line[endIndex];
    if (!first || !last) return;

    const phraseStartStep = first.step;
    const phraseEndStep = Math.max(phraseStartStep + 1, last.step + last.durationSteps);
    const phraseSpan = Math.max(1, phraseEndStep - phraseStartStep);

    for (let index = startIndex; index <= endIndex; index += 1) {
      const event = line[index];
      if (!event) continue;
      const progressStart = clamp01((event.step - phraseStartStep) / phraseSpan);
      const progressEnd = clamp01((event.step + event.durationSteps - phraseStartStep) / phraseSpan);
      const latePhrase = Math.max(progressStart, progressEnd);

      controls.set(event.step, {
        phraseIndex,
        phraseStartStep,
        phraseEndStep,
        progressStart,
        progressEnd,
        energyStart: phraseEnergyAt(progressStart),
        energyEnd: phraseEnergyAt(progressEnd),
        centeringStart: vowelCenteringAt(progressStart),
        centeringEnd: vowelCenteringAt(progressEnd),
        aspirationDepth: 0.085 + latePhrase * 0.035,
        sourceTractCoupling: 0.022 + (1 - latePhrase) * 0.008,
      });
    }

    phraseIndex += 1;
  };

  for (let index = 0; index < line.length; index += 1) {
    const event = line[index];
    if (!event) continue;
    const next = line[index + 1];
    if (event.phraseEnd || !next || next.phraseStart) {
      commitPhrase(index);
      startIndex = index + 1;
    }
  }

  return controls;
}
