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
  curveStart: number;
  curvePeak: number;
  curveEnd: number;
}

export interface VoicePhraseControlArrays {
  pitchOffsets: number[];
  rateScales: number[];
  energyScales: number[];
  emphasisScales: number[];
  pauseOverrides: (number | null)[];
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

export type VoiceEmphasisPreset = 'weak' | 'normal' | 'strong' | 'critical';

export function phraseEmphasisPreset(
  preset: VoiceEmphasisPreset,
): { energyScale: number; emphasis: number } {
  if (preset === 'weak') return { energyScale: 0.88, emphasis: 0 };
  if (preset === 'strong') return { energyScale: 1.08, emphasis: 0.7 };
  if (preset === 'critical') return { energyScale: 1.18, emphasis: 1.3 };
  return { energyScale: 1, emphasis: 0 };
}

export function phrasePitchFromDrag(
  startPitch: number,
  deltaY: number,
  pixelsPerSemitone = 36,
): number {
  const safePixels = Math.max(12, Math.abs(pixelsPerSemitone));
  const raw = startPitch - deltaY / safePixels;
  return clamp(Math.round(raw * 10) / 10, -3, 3);
}

export function phraseCurvePointFromDrag(
  startValue: number,
  deltaY: number,
  pixelsPerSemitone = 26,
): number {
  const safePixels = Math.max(12, Math.abs(pixelsPerSemitone));
  const raw = startValue - deltaY / safePixels;
  return clamp(Math.round(raw * 10) / 10, -2.5, 2.5);
}

export function phraseCurveAtProgress(
  curveStart: number,
  curvePeak: number,
  curveEnd: number,
  progress: number,
): number {
  const t = clamp(progress, 0, 1);
  const smooth = (value: number): number => value * value * (3 - 2 * value);
  if (t <= 0.5) {
    const local = smooth(t * 2);
    return curveStart + (curvePeak - curveStart) * local;
  }
  const local = smooth((t - 0.5) * 2);
  return curvePeak + (curveEnd - curvePeak) * local;
}

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
    const curveStart = clamp(shape.curveStart, -2.5, 2.5);
    const curvePeak = clamp(shape.curvePeak, -2.5, 2.5);
    const curveEnd = clamp(shape.curveEnd, -2.5, 2.5);
    const span = Math.max(1, phrase.end - phrase.start);
    for (let index = phrase.start; index <= phrase.end; index += 1) {
      const progress = (index - phrase.start) / span;
      pitchOffsets[index] = pitch + phraseCurveAtProgress(
        curveStart,
        curvePeak,
        curveEnd,
        progress,
      );
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
  const curveStart = clamp(next.curveStart, -2.5, 2.5);
  const curvePeak = clamp(next.curvePeak, -2.5, 2.5);
  const curveEnd = clamp(next.curveEnd, -2.5, 2.5);
  if (
    Math.abs(pitchOffset) < 0.001
    && Math.abs(rateScale - 1) < 0.001
    && Math.abs(energyScale - 1) < 0.001
    && emphasis < 0.001
    && Math.abs(curveStart) < 0.001
    && Math.abs(curvePeak) < 0.001
    && Math.abs(curveEnd) < 0.001
  ) {
    return filtered;
  }
  return [...filtered, {
    ...next,
    pitchOffset,
    rateScale,
    energyScale,
    emphasis,
    curveStart,
    curvePeak,
    curveEnd,
  }];
}
