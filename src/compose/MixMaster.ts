import type { ArrangementBar } from './GenreArrangement';
import type { GenreStyleProfile } from './GenreStyle';

export interface MixMasterControl {
  musicGain: number;
  bassGain: number;
  drumGain: number;
  vocalGain: number;
  stereoWidth: number;
  lowEndDuck: number;
  masterDrive: number;
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

export function mixMasterControlFor(
  profile: GenreStyleProfile,
  state: ArrangementBar | undefined,
  vocalActive: boolean,
  kickActive: boolean,
): MixMasterControl {
  const section = state?.section ?? 'verse';
  const energy = clamp(state?.energy ?? 1, 0.55, 1.2);
  const hook = section === 'chorus' || section === 'drop' || section === 'post' || section === 'climax';
  const sparse = section === 'break' || section === 'turnaround';
  const genreWidth = profile.genre === 'k-pop' ? 0.05 : profile.genre === 'rock' ? 0.02 : 0;

  const baseMusic = sparse ? 0.49 : hook ? 0.54 : 0.52;
  const vocalDuck = vocalActive ? 0.84 : 1;
  const drumBase = hook ? 0.73 : sparse ? 0.61 : 0.68;
  const bassBase = profile.genre === 'k-pop' ? 0.62 : profile.genre === 'rock' ? 0.64 : 0.6;

  return {
    musicGain: clamp(baseMusic * vocalDuck * (0.96 + (energy - 1) * 0.08), 0.4, 0.57),
    bassGain: clamp(bassBase * (kickActive ? 0.72 : 1) * (vocalActive ? 0.96 : 1), 0.4, 0.7),
    drumGain: clamp(drumBase * (vocalActive ? 0.97 : 1) * (0.98 + (energy - 1) * 0.08), 0.54, 0.77),
    vocalGain: clamp(0.96 + (hook ? 0.025 : 0) + (sparse ? 0.02 : 0), 0.94, 1.03),
    stereoWidth: clamp((hook ? 0.16 : sparse ? 0.045 : 0.08) + genreWidth, 0.035, 0.22),
    lowEndDuck: kickActive ? 0.72 : 1,
    masterDrive: clamp(hook ? 1.025 : sparse ? 0.985 : 1, 0.98, 1.035),
  };
}

export function mixMasterDbSummary(control: MixMasterControl): string {
  const musicDb = 20 * Math.log10(control.musicGain / 0.52);
  const width = Math.round(control.stereoWidth * 100);
  return `MIX ${musicDb >= 0 ? '+' : ''}${musicDb.toFixed(1)}dB · WIDTH ${width}%`;
}
