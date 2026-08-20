import type { GenreStyleProfile } from './GenreStyle';

export type ArrangementSection =
  | 'verse'
  | 'pre'
  | 'chorus'
  | 'drop'
  | 'post'
  | 'riff'
  | 'break'
  | 'motif'
  | 'development'
  | 'climax'
  | 'turnaround'
  | 'loop';

export type ChordPattern = 'sustain' | 'pulse' | 'offbeat-stabs' | 'power-pulse' | 'arpeggio-pulse';
export type BassPattern = 'root-pulse' | 'root-fifth' | 'eighth-drive' | 'syncopated-808' | 'ostinato';

export interface ArrangementBar {
  bar: number;
  section: ArrangementSection;
  energy: number;
  melodyDensityScale: number;
  vocalDensityScale: number;
  registerShift: number;
  drumDensityScale: number;
  hookRepeat: number;
  motifKey: 'hook' | 'riff' | 'motif' | null;
  chordPattern: ChordPattern;
  bassPattern: BassPattern;
  transitionFill: boolean;
}

interface GrammarTemplate {
  sections: readonly ArrangementSection[];
  chordPatterns: readonly ChordPattern[];
  bassPatterns: readonly BassPattern[];
  energies: readonly number[];
  motifKeys: readonly ArrangementBar['motifKey'][];
  hookRepeat: readonly number[];
}

const JPOP: GrammarTemplate = {
  sections: ['verse', 'verse', 'pre', 'pre', 'chorus', 'chorus', 'chorus', 'turnaround'],
  chordPatterns: ['sustain', 'sustain', 'pulse', 'pulse', 'pulse', 'pulse', 'pulse', 'sustain'],
  bassPatterns: ['root-pulse', 'root-pulse', 'root-fifth', 'root-fifth', 'root-fifth', 'root-fifth', 'root-fifth', 'root-pulse'],
  energies: [0.72, 0.76, 0.84, 0.9, 1.04, 1.08, 1.1, 0.86],
  motifKeys: [null, null, null, null, 'hook', 'hook', 'hook', null],
  hookRepeat: [0, 0, 0, 0, 0, 0.68, 0.78, 0],
};

const ROCK: GrammarTemplate = {
  sections: ['riff', 'verse', 'verse', 'pre', 'chorus', 'chorus', 'break', 'chorus'],
  chordPatterns: ['power-pulse', 'power-pulse', 'power-pulse', 'power-pulse', 'power-pulse', 'power-pulse', 'offbeat-stabs', 'power-pulse'],
  bassPatterns: ['eighth-drive', 'eighth-drive', 'eighth-drive', 'root-fifth', 'eighth-drive', 'eighth-drive', 'root-fifth', 'eighth-drive'],
  energies: [0.96, 0.82, 0.86, 0.94, 1.08, 1.1, 0.76, 1.12],
  motifKeys: ['riff', null, null, null, 'riff', 'riff', null, 'riff'],
  hookRepeat: [0, 0, 0, 0, 0.58, 0.76, 0, 0.82],
};

const KPOP: GrammarTemplate = {
  sections: ['verse', 'verse', 'pre', 'pre', 'drop', 'post', 'break', 'drop'],
  chordPatterns: ['offbeat-stabs', 'offbeat-stabs', 'pulse', 'pulse', 'offbeat-stabs', 'offbeat-stabs', 'sustain', 'offbeat-stabs'],
  bassPatterns: ['syncopated-808', 'syncopated-808', 'root-pulse', 'root-pulse', 'syncopated-808', 'syncopated-808', 'root-pulse', 'syncopated-808'],
  energies: [0.76, 0.8, 0.86, 0.96, 1.12, 1.06, 0.7, 1.14],
  motifKeys: [null, null, null, 'hook', 'hook', 'hook', null, 'hook'],
  hookRepeat: [0, 0, 0, 0, 0, 0.82, 0, 0.9],
};

const KPOP_BALLAD: GrammarTemplate = {
  sections: ['verse', 'verse', 'pre', 'pre', 'chorus', 'chorus', 'break', 'chorus'],
  chordPatterns: ['sustain', 'sustain', 'pulse', 'pulse', 'sustain', 'sustain', 'sustain', 'sustain'],
  bassPatterns: ['root-pulse', 'root-pulse', 'root-fifth', 'root-fifth', 'root-pulse', 'root-pulse', 'root-pulse', 'root-pulse'],
  energies: [0.64, 0.68, 0.76, 0.84, 0.96, 1, 0.7, 1.02],
  motifKeys: [null, null, null, null, 'hook', 'hook', null, 'hook'],
  hookRepeat: [0, 0, 0, 0, 0, 0.58, 0, 0.7],
};

const GAME: GrammarTemplate = {
  sections: ['motif', 'motif', 'development', 'development', 'climax', 'climax', 'turnaround', 'loop'],
  chordPatterns: ['arpeggio-pulse', 'arpeggio-pulse', 'pulse', 'arpeggio-pulse', 'pulse', 'pulse', 'arpeggio-pulse', 'sustain'],
  bassPatterns: ['ostinato', 'ostinato', 'ostinato', 'root-fifth', 'ostinato', 'ostinato', 'root-fifth', 'root-pulse'],
  energies: [0.8, 0.84, 0.9, 0.96, 1.08, 1.12, 0.9, 0.82],
  motifKeys: ['motif', 'motif', 'motif', 'motif', 'motif', 'motif', null, 'motif'],
  hookRepeat: [0, 0.72, 0.52, 0.64, 0.58, 0.7, 0, 0.76],
};

function templateFor(profile: GenreStyleProfile): GrammarTemplate {
  if (profile.genre === 'rock') return ROCK;
  if (profile.genre === 'k-pop') return profile.id === 'ballad' ? KPOP_BALLAD : KPOP;
  if (profile.genre === 'game-music') return GAME;
  return JPOP;
}

function subgenreEnergy(profile: GenreStyleProfile): number {
  if (profile.id === 'ballad') return 0.78;
  if (profile.id === 'punk' || profile.id === 'hard-rock') return 1.08;
  if (profile.id === 'battle' || profile.id === 'boss-battle' || profile.id === 'racing') return 1.08;
  if (profile.id === 'puzzle') return 0.76;
  if (profile.id === 'dance-pop' || profile.id === 'electro-pop') return 1.05;
  return 1;
}

function customizeSubgenre(profile: GenreStyleProfile, bar: ArrangementBar): ArrangementBar {
  if (profile.genre === 'j-pop' && profile.id === 'city-pop') {
    return {
      ...bar,
      chordPattern: bar.section === 'pre' ? 'pulse' : 'offbeat-stabs',
      bassPattern: 'root-fifth',
      drumDensityScale: bar.drumDensityScale * 0.9,
      vocalDensityScale: bar.vocalDensityScale * 0.92,
    };
  }
  if (profile.genre === 'j-pop' && profile.id === 'ballad') {
    return {
      ...bar,
      chordPattern: bar.section === 'pre' ? 'pulse' : 'sustain',
      bassPattern: 'root-pulse',
      drumDensityScale: bar.drumDensityScale * 0.56,
      melodyDensityScale: bar.melodyDensityScale * 0.78,
      hookRepeat: Math.min(bar.hookRepeat, 0.46),
    };
  }
  if (profile.genre === 'j-pop' && profile.id === 'anime-pop' && bar.section === 'chorus') {
    return { ...bar, energy: Math.min(1.2, bar.energy * 1.06), drumDensityScale: bar.drumDensityScale * 1.08, registerShift: 1 };
  }
  if (profile.genre === 'rock' && profile.id === 'punk') {
    return { ...bar, chordPattern: 'power-pulse', bassPattern: 'eighth-drive', drumDensityScale: Math.max(1.04, bar.drumDensityScale), hookRepeat: Math.min(0.62, bar.hookRepeat) };
  }
  if (profile.genre === 'rock' && profile.id === 'indie') {
    return { ...bar, chordPattern: bar.section === 'chorus' ? 'pulse' : 'sustain', bassPattern: 'root-fifth', drumDensityScale: bar.drumDensityScale * 0.82 };
  }
  if (profile.genre === 'k-pop' && profile.id === 'r&b-pop') {
    return { ...bar, chordPattern: 'offbeat-stabs', bassPattern: 'syncopated-808', drumDensityScale: bar.drumDensityScale * 0.82, melodyDensityScale: bar.melodyDensityScale * 0.9 };
  }
  if (profile.genre === 'game-music' && profile.id === 'puzzle') {
    return { ...bar, chordPattern: 'arpeggio-pulse', bassPattern: 'root-pulse', drumDensityScale: bar.drumDensityScale * 0.48, melodyDensityScale: bar.melodyDensityScale * 0.82, vocalDensityScale: bar.vocalDensityScale * 0.52 };
  }
  if (profile.genre === 'game-music' && profile.id === 'boss-battle') {
    return { ...bar, chordPattern: bar.section === 'turnaround' ? 'arpeggio-pulse' : 'power-pulse', bassPattern: 'ostinato', drumDensityScale: Math.max(1.08, bar.drumDensityScale), energy: Math.min(1.2, bar.energy * 1.06) };
  }
  if (profile.genre === 'game-music' && profile.id === 'racing') {
    return { ...bar, chordPattern: 'pulse', bassPattern: 'ostinato', drumDensityScale: Math.max(1.04, bar.drumDensityScale), melodyDensityScale: bar.melodyDensityScale * 1.08 };
  }
  return bar;
}

export function buildGenreArrangement(profile: GenreStyleProfile, bars: number): ArrangementBar[] {
  const template = templateFor(profile);
  const energyScale = subgenreEnergy(profile);
  const result: ArrangementBar[] = [];

  for (let bar = 0; bar < bars; bar += 1) {
    const index = bar % template.sections.length;
    const section = template.sections[index] ?? 'verse';
    const nextSection = template.sections[(index + 1) % template.sections.length] ?? section;
    const energy = Math.max(0.55, Math.min(1.2, (template.energies[index] ?? 0.9) * energyScale));
    const climax = section === 'chorus' || section === 'drop' || section === 'climax';
    const sparse = section === 'break' || (profile.id === 'ballad' && !climax);

    const base: ArrangementBar = {
      bar,
      section,
      energy,
      melodyDensityScale: sparse ? 0.72 : climax ? 1.12 : section === 'pre' ? 0.94 : 1,
      vocalDensityScale: sparse ? 0.68 : section === 'drop' ? 0.56 : climax ? 1.06 : 1,
      registerShift: climax ? 1 : 0,
      drumDensityScale: sparse ? 0.64 : section === 'pre' ? 0.86 : climax ? 1.12 : 1,
      hookRepeat: template.hookRepeat[index] ?? 0,
      motifKey: template.motifKeys[index] ?? null,
      chordPattern: template.chordPatterns[index] ?? 'sustain',
      bassPattern: template.bassPatterns[index] ?? 'root-pulse',
      transitionFill: nextSection !== section && (section === 'pre' || section === 'development' || section === 'break'),
    };
    result.push(customizeSubgenre(profile, base));
  }

  return result;
}

export function arrangementSectionLabel(section: ArrangementSection): string {
  return section.toUpperCase();
}
