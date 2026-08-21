import type { GenreStyleProfile } from './GenreStyle';

export type VocalDirectorPreset = 'auto' | 'cute' | 'cool' | 'emotional' | 'sad' | 'energetic' | 'intimate';

export interface VocalDirectorControl {
  resolvedPreset: Exclude<VocalDirectorPreset, 'auto'>;
  airScale: number;
  attackScale: number;
  dynamicsScale: number;
  articulationScale: number;
  vibratoScale: number;
  scoopCentsAdd: number;
  fallCentsAdd: number;
  jitterScale: number;
  ensembleScale: number;
  releaseScale: number;
}

export const VOCAL_DIRECTOR_PRESETS: readonly VocalDirectorPreset[] = [
  'auto', 'cute', 'cool', 'emotional', 'sad', 'energetic', 'intimate',
] as const;

let activePreset: VocalDirectorPreset = 'auto';

const CONTROLS: Record<Exclude<VocalDirectorPreset, 'auto'>, Omit<VocalDirectorControl, 'resolvedPreset'>> = {
  cute: { airScale: 1.05, attackScale: 0.9, dynamicsScale: 1.02, articulationScale: 1.1, vibratoScale: 0.92, scoopCentsAdd: 1.8, fallCentsAdd: 0.2, jitterScale: 0.82, ensembleScale: 1.08, releaseScale: 0.96 },
  cool: { airScale: 0.94, attackScale: 0.88, dynamicsScale: 0.98, articulationScale: 1.08, vibratoScale: 0.82, scoopCentsAdd: 0.4, fallCentsAdd: 1.2, jitterScale: 0.72, ensembleScale: 1.04, releaseScale: 0.94 },
  emotional: { airScale: 1.08, attackScale: 1.02, dynamicsScale: 1.08, articulationScale: 1, vibratoScale: 1.14, scoopCentsAdd: 2.2, fallCentsAdd: 1.6, jitterScale: 0.9, ensembleScale: 1.12, releaseScale: 1.08 },
  sad: { airScale: 1.15, attackScale: 1.12, dynamicsScale: 0.96, articulationScale: 0.9, vibratoScale: 1.12, scoopCentsAdd: 1.1, fallCentsAdd: 2.1, jitterScale: 0.84, ensembleScale: 0.92, releaseScale: 1.14 },
  energetic: { airScale: 0.88, attackScale: 0.82, dynamicsScale: 1.1, articulationScale: 1.15, vibratoScale: 0.9, scoopCentsAdd: 1.2, fallCentsAdd: 0.5, jitterScale: 0.76, ensembleScale: 1.14, releaseScale: 0.9 },
  intimate: { airScale: 1.22, attackScale: 1.16, dynamicsScale: 0.92, articulationScale: 0.86, vibratoScale: 0.88, scoopCentsAdd: 0.4, fallCentsAdd: 1.1, jitterScale: 0.78, ensembleScale: 0.82, releaseScale: 1.12 },
};

const NEUTRAL: VocalDirectorControl = {
  resolvedPreset: 'emotional',
  airScale: 1,
  attackScale: 1,
  dynamicsScale: 1,
  articulationScale: 1,
  vibratoScale: 1,
  scoopCentsAdd: 0,
  fallCentsAdd: 0,
  jitterScale: 1,
  ensembleScale: 1,
  releaseScale: 1,
};

export function validVocalDirectorPreset(value: unknown): value is VocalDirectorPreset {
  return typeof value === 'string' && VOCAL_DIRECTOR_PRESETS.includes(value as VocalDirectorPreset);
}

export function setActiveVocalDirector(preset: VocalDirectorPreset): void {
  activePreset = validVocalDirectorPreset(preset) ? preset : 'auto';
}

export function currentVocalDirector(): VocalDirectorPreset {
  return activePreset;
}

export function autoVocalDirectorFor(profile: GenreStyleProfile): Exclude<VocalDirectorPreset, 'auto'> {
  if (profile.genre === 'j-pop') {
    if (profile.id === 'idol-pop' || profile.id === 'anime-pop') return 'cute';
    if (profile.id === 'ballad') return 'emotional';
    if (profile.id === 'city-pop') return 'intimate';
    return 'emotional';
  }
  if (profile.genre === 'rock') {
    if (profile.id === 'emo') return 'emotional';
    if (profile.id === 'indie' || profile.id === 'alternative') return 'cool';
    return 'energetic';
  }
  if (profile.genre === 'k-pop') {
    if (profile.id === 'ballad' || profile.id === 'rnb-pop') return 'intimate';
    return 'cool';
  }
  return profile.id === 'puzzle' ? 'intimate' : 'energetic';
}

export function vocalDirectorControlFor(profile?: GenreStyleProfile, preset: VocalDirectorPreset = activePreset): VocalDirectorControl {
  if (preset === 'auto' && !profile) return { ...NEUTRAL };
  const resolved = preset === 'auto' ? autoVocalDirectorFor(profile!) : preset;
  return { resolvedPreset: resolved, ...CONTROLS[resolved] };
}
