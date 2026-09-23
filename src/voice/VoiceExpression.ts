import type { VoiceUnit } from './VoiceScript';

export type VoiceExpressionPreset =
  | 'neutral'
  | 'calm'
  | 'excited'
  | 'serious'
  | 'whisper'
  | 'narration';

export interface VoiceExpressionSettings {
  preset: VoiceExpressionPreset;
  intensity: number;
}

export interface VoiceExpressionControl {
  pitchShift: number;
  pitchRangeScale: number;
  energyScale: number;
  durationScale: number;
  breathScale: number;
  attackScale: number;
  articulationScale: number;
  toneOffset: number;
  voicingScale: number;
  sourceTiltScale: number;
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export const VOICE_EXPRESSION_PRESETS: readonly VoiceExpressionPreset[] = [
  'neutral',
  'calm',
  'excited',
  'serious',
  'whisper',
  'narration',
] as const;

const BASE: Record<VoiceExpressionPreset, VoiceExpressionControl> = {
  neutral: {
    pitchShift: 0,
    pitchRangeScale: 1,
    energyScale: 1,
    durationScale: 1,
    breathScale: 1,
    attackScale: 1,
    articulationScale: 1,
    toneOffset: 0,
    voicingScale: 1,
    sourceTiltScale: 1,
  },
  calm: {
    pitchShift: -0.18,
    pitchRangeScale: 0.72,
    energyScale: 0.84,
    durationScale: 1.12,
    breathScale: 1.08,
    attackScale: 1.1,
    articulationScale: 0.94,
    toneOffset: -0.08,
    voicingScale: 0.98,
    sourceTiltScale: 1.06,
  },
  excited: {
    pitchShift: 0.62,
    pitchRangeScale: 1.34,
    energyScale: 1.2,
    durationScale: 0.9,
    breathScale: 0.9,
    attackScale: 0.82,
    articulationScale: 1.09,
    toneOffset: 0.13,
    voicingScale: 1,
    sourceTiltScale: 0.93,
  },
  serious: {
    pitchShift: -0.5,
    pitchRangeScale: 0.82,
    energyScale: 1.04,
    durationScale: 1.03,
    breathScale: 0.82,
    attackScale: 0.9,
    articulationScale: 1.08,
    toneOffset: -0.18,
    voicingScale: 1,
    sourceTiltScale: 0.9,
  },
  whisper: {
    pitchShift: -0.12,
    pitchRangeScale: 0.76,
    energyScale: 0.7,
    durationScale: 1.08,
    breathScale: 1.72,
    attackScale: 1.2,
    articulationScale: 0.88,
    toneOffset: -0.04,
    voicingScale: 0.46,
    sourceTiltScale: 1.18,
  },
  narration: {
    pitchShift: -0.08,
    pitchRangeScale: 0.9,
    energyScale: 0.95,
    durationScale: 1.08,
    breathScale: 0.96,
    attackScale: 1.02,
    articulationScale: 1.04,
    toneOffset: -0.06,
    voicingScale: 1,
    sourceTiltScale: 1.01,
  },
};

export function validVoiceExpressionPreset(value: unknown): value is VoiceExpressionPreset {
  return typeof value === 'string'
    && VOICE_EXPRESSION_PRESETS.includes(value as VoiceExpressionPreset);
}

export function voiceExpressionControl(settings: VoiceExpressionSettings): VoiceExpressionControl {
  const preset = BASE[validVoiceExpressionPreset(settings.preset) ? settings.preset : 'neutral'];
  const intensity = clamp(settings.intensity, 0, 1.35);

  return {
    pitchShift: lerp(0, preset.pitchShift, intensity),
    pitchRangeScale: lerp(1, preset.pitchRangeScale, intensity),
    energyScale: lerp(1, preset.energyScale, intensity),
    durationScale: lerp(1, preset.durationScale, intensity),
    breathScale: lerp(1, preset.breathScale, intensity),
    attackScale: lerp(1, preset.attackScale, intensity),
    articulationScale: lerp(1, preset.articulationScale, intensity),
    toneOffset: lerp(0, preset.toneOffset, intensity),
    voicingScale: lerp(1, preset.voicingScale, intensity),
    sourceTiltScale: lerp(1, preset.sourceTiltScale, intensity),
  };
}

export interface VoiceExpressionUnitControl {
  pitchOffset: number;
  energyScale: number;
  durationScale: number;
}

export function voiceExpressionForUnit(
  unit: VoiceUnit,
  index: number,
  count: number,
  settings: VoiceExpressionSettings,
): VoiceExpressionUnitControl {
  const control = voiceExpressionControl(settings);
  const progress = count <= 1 ? 0 : index / Math.max(1, count - 1);
  let pitchOffset = control.pitchShift;
  let energyScale = control.energyScale;
  let durationScale = control.durationScale;

  if (settings.preset === 'excited') {
    pitchOffset += (unit.phraseStart ? 0.22 : 0) + Math.sin(progress * Math.PI * 2) * 0.12 * settings.intensity;
    energyScale *= unit.accentStart ? 1.08 : 1;
    durationScale *= unit.phraseEnd ? 1.04 : 0.98;
  } else if (settings.preset === 'calm') {
    pitchOffset += unit.phraseEnd ? -0.12 * settings.intensity : 0;
    energyScale *= unit.phraseEnd ? 0.94 : 1;
    durationScale *= unit.accentEnd ? 1.035 : 1;
  } else if (settings.preset === 'serious') {
    pitchOffset += unit.accentStart ? -0.06 * settings.intensity : 0;
    energyScale *= unit.accentStart ? 1.035 : 1;
  } else if (settings.preset === 'whisper') {
    pitchOffset += Math.sin(index * 1.37) * 0.04 * settings.intensity;
    energyScale *= unit.phraseEnd ? 0.9 : 1;
    durationScale *= unit.phraseStart ? 1.04 : 1;
  } else if (settings.preset === 'narration') {
    pitchOffset += unit.phraseStart ? 0.08 * settings.intensity : unit.phraseEnd ? -0.08 * settings.intensity : 0;
    energyScale *= unit.accentStart ? 1.025 : 1;
    durationScale *= unit.phraseEnd ? 1.06 : 1;
  }

  return {
    pitchOffset: clamp(pitchOffset, -2.2, 2.2),
    energyScale: clamp(energyScale, 0.5, 1.4),
    durationScale: clamp(durationScale, 0.72, 1.35),
  };
}
