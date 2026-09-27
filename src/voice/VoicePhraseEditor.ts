import {
  refreshVoiceUnitBoundaryMetadata,
  type VoiceScript,
} from './VoiceScript';
import { collectAccentPhrases } from './VoiceAccentEditor';

export interface VoicePhraseBoundaryOverride {
  after: number;
  boundary: 'none' | 'accent';
  pauseSeconds: number | null;
}

export interface VoicePhraseShapeOverride {
  start: number;
  end: number;
  pitchOffset: number;
  rateScale: number;
  energyScale: number;
  emphasis: number;
}

export interface VoicePhraseControlArrays {
  pitchOffsets: number[];
  rateScales: number[];
  energyScales: number[];
  emphasisScales: number[];
  pauseOverrides: (number | null)[];
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

export function applyPhraseBoundaryOverrides(
  script: VoiceScript,
  overrides: readonly VoicePhraseBoundaryOverride[],
): void {
  for (const override of overrides) {
    const unit = script.units[override.after];
    if (!unit) continue;
    if (unit.boundaryAfter === 'sentence') continue;

    unit.boundaryAfter = override.boundary;
    if (override.pauseSeconds !== null) {
      unit.pauseAfter = clamp(override.pauseSeconds, 0, 0.36);
    } else if (override.boundary === 'none') {
      unit.pauseAfter = 0;
    } else if (unit.pauseAfter <= 0) {
      unit.pauseAfter = 0.045;
    }
  }
  refreshVoiceUnitBoundaryMetadata(script.units);
}

export function buildPhraseControlArrays(
  script: VoiceScript,
  shapes: readonly VoicePhraseShapeOverride[],
  boundaries: readonly VoicePhraseBoundaryOverride[],
): VoicePhraseControlArrays {
  const count = script.units.length;
  const pitchOffsets = new Array<number>(count).fill(0);
  const rateScales = new Array<number>(count).fill(1);
  const energyScales = new Array<number>(count).fill(1);
  const emphasisScales = new Array<number>(count).fill(0);
  const pauseOverrides = new Array<number | null>(count).fill(null);
  const phrases = collectAccentPhrases(script);

  for (const shape of shapes) {
    const phrase = phrases.find((candidate) => (
      candidate.start === shape.start && candidate.end === shape.end
    ));
    if (!phrase) continue;

    const pitch = clamp(shape.pitchOffset, -3, 3);
    const rate = clamp(shape.rateScale, 0.72, 1.35);
    const energy = clamp(shape.energyScale, 0.65, 1.45);
    const emphasis = clamp(shape.emphasis, 0, 1.5);
    for (let index = phrase.start; index <= phrase.end; index += 1) {
      pitchOffsets[index] = pitch;
      rateScales[index] = rate;
      energyScales[index] = energy;
      emphasisScales[index] = emphasis;
    }
  }

  for (const boundary of boundaries) {
    if (boundary.pauseSeconds === null) continue;
    if (boundary.after < 0 || boundary.after >= count) continue;
    pauseOverrides[boundary.after] = clamp(boundary.pauseSeconds, 0, 0.36);
  }

  return { pitchOffsets, rateScales, energyScales, emphasisScales, pauseOverrides };
}

export function updatePhraseBoundaryOverride(
  overrides: readonly VoicePhraseBoundaryOverride[],
  next: VoicePhraseBoundaryOverride,
): VoicePhraseBoundaryOverride[] {
  const filtered = overrides.filter((item) => item.after !== next.after);
  return [...filtered, next].sort((a, b) => a.after - b.after);
}

export function updatePhraseShapeOverride(
  overrides: readonly VoicePhraseShapeOverride[],
  next: VoicePhraseShapeOverride,
): VoicePhraseShapeOverride[] {
  const filtered = overrides.filter((item) => item.start !== next.start || item.end !== next.end);
  const pitchOffset = clamp(next.pitchOffset, -3, 3);
  const rateScale = clamp(next.rateScale, 0.72, 1.35);
  const energyScale = clamp(next.energyScale, 0.65, 1.45);
  const emphasis = clamp(next.emphasis, 0, 1.5);
  if (
    Math.abs(pitchOffset) < 0.001
    && Math.abs(rateScale - 1) < 0.001
    && Math.abs(energyScale - 1) < 0.001
    && emphasis < 0.001
  ) {
    return filtered;
  }
  return [...filtered, {
    ...next,
    pitchOffset,
    rateScale,
    energyScale,
    emphasis,
  }];
}
