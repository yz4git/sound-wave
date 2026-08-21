export type VoiceCharacterPreset = 'soft' | 'natural' | 'clear' | 'airy' | 'power';

export interface VoiceCharacterSettings {
  preset: VoiceCharacterPreset;
  /** -1 = darker/rounder, +1 = brighter/lighter. */
  tone: number;
}

export interface VoiceCharacterControl {
  breathScale: number;
  attackScale: number;
  openQuotientOffset: number;
  speedQuotientOffset: number;
  formantScale: number;
  upperFormantGainScale: number;
  articulationScale: number;
  vibratoScale: number;
  jitterScale: number;
  sourceTiltScale: number;
  dynamicsScale: number;
}

export const VOICE_CHARACTER_PRESETS: readonly VoiceCharacterPreset[] = [
  'soft',
  'natural',
  'clear',
  'airy',
  'power',
] as const;

export const DEFAULT_VOICE_CHARACTER: VoiceCharacterSettings = {
  preset: 'natural',
  tone: 0,
};

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const BASE: Record<VoiceCharacterPreset, VoiceCharacterControl> = {
  soft: {
    breathScale: 1.08,
    attackScale: 1.1,
    openQuotientOffset: 0.016,
    speedQuotientOffset: -0.008,
    formantScale: 0.992,
    upperFormantGainScale: 0.94,
    articulationScale: 0.9,
    vibratoScale: 1.04,
    jitterScale: 0.88,
    sourceTiltScale: 1.08,
    dynamicsScale: 0.97,
  },
  natural: {
    breathScale: 1,
    attackScale: 1,
    openQuotientOffset: 0,
    speedQuotientOffset: 0,
    formantScale: 1,
    upperFormantGainScale: 1,
    articulationScale: 1,
    vibratoScale: 1,
    jitterScale: 1,
    sourceTiltScale: 1,
    dynamicsScale: 1,
  },
  clear: {
    breathScale: 0.9,
    attackScale: 0.86,
    openQuotientOffset: -0.008,
    speedQuotientOffset: 0.009,
    formantScale: 1.01,
    upperFormantGainScale: 1.06,
    articulationScale: 1.1,
    vibratoScale: 0.94,
    jitterScale: 0.74,
    sourceTiltScale: 0.94,
    dynamicsScale: 1.02,
  },
  airy: {
    breathScale: 1.24,
    attackScale: 1.06,
    openQuotientOffset: 0.022,
    speedQuotientOffset: -0.012,
    formantScale: 0.997,
    upperFormantGainScale: 0.96,
    articulationScale: 0.88,
    vibratoScale: 1.03,
    jitterScale: 0.84,
    sourceTiltScale: 1.12,
    dynamicsScale: 0.95,
  },
  power: {
    breathScale: 0.84,
    attackScale: 0.82,
    openQuotientOffset: -0.016,
    speedQuotientOffset: 0.017,
    formantScale: 1.006,
    upperFormantGainScale: 1.08,
    articulationScale: 1.14,
    vibratoScale: 0.96,
    jitterScale: 0.8,
    sourceTiltScale: 0.9,
    dynamicsScale: 1.06,
  },
};

export function validVoiceCharacterPreset(value: unknown): value is VoiceCharacterPreset {
  return typeof value === 'string' && VOICE_CHARACTER_PRESETS.includes(value as VoiceCharacterPreset);
}

export function voiceCharacterFor(settings: VoiceCharacterSettings): VoiceCharacterControl {
  const base = BASE[settings.preset] ?? BASE.natural;
  const tone = clamp(settings.tone, -1, 1);

  return {
    breathScale: clamp(base.breathScale * (1 + tone * 0.025), 0.72, 1.35),
    attackScale: clamp(base.attackScale * (1 - tone * 0.025), 0.72, 1.16),
    openQuotientOffset: clamp(base.openQuotientOffset - tone * 0.006, -0.024, 0.034),
    speedQuotientOffset: clamp(base.speedQuotientOffset + tone * 0.004, -0.018, 0.022),
    formantScale: clamp(base.formantScale * (1 + tone * 0.018), 0.965, 1.035),
    upperFormantGainScale: clamp(base.upperFormantGainScale * (1 + tone * 0.08), 0.84, 1.18),
    articulationScale: clamp(base.articulationScale * (1 + tone * 0.035), 0.8, 1.2),
    vibratoScale: clamp(base.vibratoScale * (1 - Math.abs(tone) * 0.02), 0.86, 1.1),
    jitterScale: clamp(base.jitterScale * (1 - Math.abs(tone) * 0.04), 0.62, 1.02),
    sourceTiltScale: clamp(base.sourceTiltScale * (1 - tone * 0.08), 0.84, 1.2),
    dynamicsScale: clamp(base.dynamicsScale * (1 + tone * 0.012), 0.92, 1.1),
  };
}
