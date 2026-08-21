import { buildGenreArrangement, type ArrangementBar, type ArrangementSection } from './GenreArrangement';
import type { GenreStyleProfile } from './GenreStyle';

export type FullSongSectionKind =
  | 'intro'
  | 'verse'
  | 'pre'
  | 'chorus'
  | 'drop'
  | 'post'
  | 'interlude'
  | 'bridge'
  | 'climax'
  | 'outro';

export interface FullSongSection {
  index: number;
  kind: FullSongSectionKind;
  label: string;
  startBar: number;
  bars: number;
  energyScale: number;
  melodyScale: number;
  vocalScale: number;
  drumScale: number;
  registerShift: number;
  keyShiftSemitones: number;
  hookStrength: number;
}

export interface FullSongPlan {
  sections: FullSongSection[];
  arrangement: ArrangementBar[];
}

interface SectionSpec {
  kind: FullSongSectionKind;
  bars: number;
  energy: number;
  melody?: number;
  vocal?: number;
  drums?: number;
  register?: number;
  keyShift?: number;
  hook?: number;
}

const LABELS: Record<FullSongSectionKind, string> = {
  intro: 'INTRO',
  verse: 'VERSE',
  pre: 'PRE-CHORUS',
  chorus: 'CHORUS',
  drop: 'DROP',
  post: 'POST-CHORUS',
  interlude: 'INTERLUDE',
  bridge: 'BRIDGE',
  climax: 'CLIMAX',
  outro: 'OUTRO',
};

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

function jpopSpecs(profile: GenreStyleProfile): readonly SectionSpec[] {
  const ballad = profile.id === 'ballad';
  const finalLift = !ballad && ['mainstream', 'idol-pop', 'anime-pop'].includes(profile.id) ? 2 : 0;
  return [
    { kind: 'intro', bars: 4, energy: ballad ? 0.62 : 0.72, melody: 0.72, vocal: 0 },
    { kind: 'verse', bars: 8, energy: ballad ? 0.7 : 0.78, melody: 0.9, vocal: 0.9 },
    { kind: 'pre', bars: 4, energy: ballad ? 0.8 : 0.9, melody: 0.96, vocal: 1.02 },
    { kind: 'chorus', bars: 8, energy: ballad ? 0.98 : 1.08, melody: 1.08, vocal: 1.08, drums: 1.08, register: 1, hook: 0.82 },
    { kind: 'interlude', bars: 4, energy: 0.74, melody: 0.82, vocal: 0.22, drums: 0.78 },
    { kind: 'verse', bars: 8, energy: ballad ? 0.74 : 0.82, melody: 0.94, vocal: 0.94 },
    { kind: 'pre', bars: 4, energy: ballad ? 0.84 : 0.94, melody: 1, vocal: 1.04 },
    { kind: 'bridge', bars: 4, energy: ballad ? 0.82 : 0.86, melody: 0.86, vocal: 0.9, drums: 0.72 },
    { kind: 'chorus', bars: 8, energy: ballad ? 1.04 : 1.16, melody: 1.12, vocal: 1.14, drums: 1.14, register: 1, keyShift: finalLift, hook: 0.92 },
    { kind: 'outro', bars: 4, energy: 0.7, melody: 0.72, vocal: 0.38, drums: 0.7, keyShift: finalLift },
  ];
}

function rockSpecs(profile: GenreStyleProfile): readonly SectionSpec[] {
  const punk = profile.id === 'punk';
  return [
    { kind: 'intro', bars: 4, energy: 0.94, melody: 0.82, vocal: 0.12, drums: 1.02, hook: 0.7 },
    { kind: 'verse', bars: 8, energy: punk ? 0.94 : 0.84, vocal: 0.94 },
    { kind: 'pre', bars: 4, energy: 0.96, vocal: 1.02 },
    { kind: 'chorus', bars: 8, energy: 1.1, melody: 1.06, vocal: 1.08, drums: 1.08, register: 1, hook: 0.84 },
    { kind: 'interlude', bars: 4, energy: 0.98, melody: 0.92, vocal: 0.16, drums: 1.02, hook: 0.72 },
    { kind: 'verse', bars: 8, energy: punk ? 0.98 : 0.88, vocal: 0.98 },
    { kind: 'pre', bars: 4, energy: 1, vocal: 1.04 },
    { kind: 'bridge', bars: 4, energy: 0.78, melody: 0.78, vocal: 0.88, drums: 0.68 },
    { kind: 'chorus', bars: 8, energy: 1.16, melody: 1.1, vocal: 1.12, drums: 1.14, register: 1, hook: 0.94 },
    { kind: 'outro', bars: 4, energy: 0.92, melody: 0.8, vocal: 0.22, drums: 0.94, hook: 0.78 },
  ];
}

function kpopSpecs(profile: GenreStyleProfile): readonly SectionSpec[] {
  if (profile.id === 'ballad') return jpopSpecs(profile);
  return [
    { kind: 'intro', bars: 4, energy: 0.7, melody: 0.7, vocal: 0.18, drums: 0.74 },
    { kind: 'verse', bars: 8, energy: 0.78, melody: 0.92, vocal: 0.92 },
    { kind: 'pre', bars: 4, energy: 0.92, melody: 0.94, vocal: 1.04, drums: 0.8 },
    { kind: 'drop', bars: 8, energy: 1.14, melody: 1.04, vocal: 0.72, drums: 1.16, register: 1, hook: 0.92 },
    { kind: 'post', bars: 4, energy: 1.04, melody: 0.92, vocal: 0.82, drums: 1.06, hook: 0.96 },
    { kind: 'verse', bars: 8, energy: 0.82, melody: 0.94, vocal: 0.94 },
    { kind: 'pre', bars: 4, energy: 0.96, melody: 0.98, vocal: 1.06, drums: 0.84 },
    { kind: 'bridge', bars: 4, energy: 0.72, melody: 0.74, vocal: 0.94, drums: 0.54 },
    { kind: 'drop', bars: 8, energy: 1.18, melody: 1.08, vocal: 0.8, drums: 1.18, register: 1, hook: 0.98 },
    { kind: 'outro', bars: 4, energy: 0.78, melody: 0.66, vocal: 0.24, drums: 0.72 },
  ];
}

function gameSpecs(profile: GenreStyleProfile): readonly SectionSpec[] {
  const intense = ['battle', 'boss-battle', 'racing'].includes(profile.id);
  return [
    { kind: 'intro', bars: 4, energy: intense ? 0.88 : 0.72, melody: 0.8, vocal: 0.12 },
    { kind: 'verse', bars: 8, energy: intense ? 0.96 : 0.82, melody: 1.02, vocal: 0.68, hook: 0.72 },
    { kind: 'interlude', bars: 4, energy: 0.9, melody: 1.08, vocal: 0.16 },
    { kind: 'climax', bars: 8, energy: intense ? 1.16 : 1.04, melody: 1.12, vocal: 0.78, drums: 1.12, register: 1, hook: 0.88 },
    { kind: 'verse', bars: 8, energy: intense ? 1.0 : 0.86, melody: 1.06, vocal: 0.7 },
    { kind: 'bridge', bars: 4, energy: 0.78, melody: 0.84, vocal: 0.56, drums: 0.66 },
    { kind: 'climax', bars: 8, energy: intense ? 1.18 : 1.08, melody: 1.16, vocal: 0.82, drums: 1.16, register: 1, hook: 0.96 },
    { kind: 'interlude', bars: 4, energy: 0.92, melody: 1.06, vocal: 0.16 },
    { kind: 'climax', bars: 4, energy: intense ? 1.18 : 1.1, melody: 1.18, vocal: 0.76, drums: 1.18, register: 1, hook: 0.98 },
    { kind: 'outro', bars: 4, energy: 0.76, melody: 0.82, vocal: 0.18, drums: 0.7 },
  ];
}

function specsFor(profile: GenreStyleProfile): readonly SectionSpec[] {
  if (profile.genre === 'rock') return rockSpecs(profile);
  if (profile.genre === 'k-pop') return kpopSpecs(profile);
  if (profile.genre === 'game-music') return gameSpecs(profile);
  return jpopSpecs(profile);
}

function arrangementSectionFor(kind: FullSongSectionKind, profile: GenreStyleProfile): ArrangementSection {
  if (kind === 'intro') return profile.genre === 'rock' ? 'riff' : profile.genre === 'game-music' ? 'motif' : 'verse';
  if (kind === 'verse') return profile.genre === 'game-music' ? 'development' : 'verse';
  if (kind === 'pre') return 'pre';
  if (kind === 'chorus') return 'chorus';
  if (kind === 'drop') return 'drop';
  if (kind === 'post') return 'post';
  if (kind === 'interlude') return profile.genre === 'rock' ? 'riff' : profile.genre === 'game-music' ? 'motif' : 'break';
  if (kind === 'bridge') return profile.genre === 'game-music' ? 'turnaround' : 'break';
  if (kind === 'climax') return 'climax';
  return profile.genre === 'game-music' ? 'loop' : 'turnaround';
}

function prototypeFor(
  prototypes: readonly ArrangementBar[],
  targetSection: ArrangementSection,
  localBar: number,
): ArrangementBar {
  const matches = prototypes.filter((bar) => bar.section === targetSection);
  if (matches.length > 0) return matches[localBar % matches.length] ?? matches[0]!;
  return prototypes[localBar % prototypes.length] ?? prototypes[0]!;
}

function fitSpecsToBars(specs: readonly SectionSpec[], bars: number): SectionSpec[] {
  const baseTotal = specs.reduce((sum, spec) => sum + spec.bars, 0);
  if (bars === baseTotal) return specs.map((spec) => ({ ...spec }));
  if (bars < 24) {
    return [{ kind: 'verse', bars, energy: 1, melody: 1, vocal: 1, drums: 1 }];
  }

  const scale = bars / baseTotal;
  const fitted = specs.map((spec) => ({ ...spec, bars: Math.max(2, Math.round(spec.bars * scale)) }));
  let delta = bars - fitted.reduce((sum, spec) => sum + spec.bars, 0);
  const growOrder = fitted
    .map((spec, index) => ({ index, priority: spec.kind === 'chorus' || spec.kind === 'drop' || spec.kind === 'climax' ? 3 : spec.kind === 'verse' ? 2 : 1 }))
    .sort((a, b) => b.priority - a.priority);
  let cursor = 0;
  while (delta !== 0 && growOrder.length > 0) {
    const target = growOrder[cursor % growOrder.length]!;
    const spec = fitted[target.index]!;
    if (delta > 0) {
      spec.bars += 1;
      delta -= 1;
    } else if (spec.bars > 2) {
      spec.bars -= 1;
      delta += 1;
    }
    cursor += 1;
    if (cursor > 500) break;
  }
  return fitted;
}

export function buildFullSongPlan(profile: GenreStyleProfile, bars: number): FullSongPlan {
  const normalizedBars = Math.max(4, Math.min(72, Math.round(bars)));
  const specs = fitSpecsToBars(specsFor(profile), normalizedBars);
  const prototypes = buildGenreArrangement(profile, 8);
  const sections: FullSongSection[] = [];
  const arrangement: ArrangementBar[] = [];
  let startBar = 0;

  for (let index = 0; index < specs.length; index += 1) {
    const spec = specs[index]!;
    const section: FullSongSection = {
      index,
      kind: spec.kind,
      label: LABELS[spec.kind],
      startBar,
      bars: spec.bars,
      energyScale: spec.energy,
      melodyScale: spec.melody ?? 1,
      vocalScale: spec.vocal ?? 1,
      drumScale: spec.drums ?? 1,
      registerShift: spec.register ?? 0,
      keyShiftSemitones: spec.keyShift ?? 0,
      hookStrength: spec.hook ?? 0,
    };
    sections.push(section);

    const targetSection = arrangementSectionFor(spec.kind, profile);
    for (let localBar = 0; localBar < spec.bars; localBar += 1) {
      const source = prototypeFor(prototypes, targetSection, localBar);
      const bar = startBar + localBar;
      const finalBar = localBar === spec.bars - 1;
      const nextKind = specs[index + 1]?.kind;
      const base: ArrangementBar = {
        ...source,
        bar,
        section: targetSection,
        energy: clamp(source.energy * section.energyScale, 0.5, 1.2),
        melodyDensityScale: clamp(source.melodyDensityScale * section.melodyScale, 0.35, 1.35),
        vocalDensityScale: clamp(source.vocalDensityScale * section.vocalScale, 0, 1.32),
        registerShift: source.registerShift + section.registerShift,
        drumDensityScale: clamp(source.drumDensityScale * section.drumScale, 0.2, 1.35),
        hookRepeat: Math.max(source.hookRepeat, section.hookStrength),
        transitionFill: source.transitionFill || (finalBar && nextKind !== undefined && nextKind !== spec.kind),
      };
      arrangement.push(base);
    }
    startBar += spec.bars;
  }

  return { sections, arrangement };
}

export function fullSongSectionAtBar(sections: readonly FullSongSection[], bar: number): FullSongSection | undefined {
  return sections.find((section) => bar >= section.startBar && bar < section.startBar + section.bars);
}

export function keyShiftForBar(sections: readonly FullSongSection[], bar: number): number {
  return fullSongSectionAtBar(sections, bar)?.keyShiftSemitones ?? 0;
}
