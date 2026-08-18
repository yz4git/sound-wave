export type PitchClass = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;
export type Mode = 'major' | 'minor' | 'dorian' | 'phrygian' | 'mixolydian';
export type HarmonicFunction = 'tonic' | 'predominant' | 'dominant' | 'color';
export type PlayerIntent = 'resolve' | 'delay' | 'diverge' | 'intensify';

export interface Tonality {
  tonic: PitchClass;
  mode: Mode;
}

export interface ChordState {
  root: PitchClass;
  tones: PitchClass[];
  function: HarmonicFunction;
  tension: number;
  label: string;
}

export interface MusicState {
  tonality: Tonality;
  chord: ChordState;
  previousChord: ChordState | null;
  tension: number;
  resolution: number;
  voiceLeading: number;
  energy: number;
}

const MODE_INTERVALS: Record<Mode, readonly number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
};

const PITCH_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'] as const;

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const mod12 = (value: number): PitchClass => ((value % 12 + 12) % 12) as PitchClass;

export function pitchName(pitch: PitchClass): string {
  return PITCH_NAMES[pitch];
}

export function scaleFor(tonality: Tonality): PitchClass[] {
  return MODE_INTERVALS[tonality.mode].map((interval) => mod12(tonality.tonic + interval));
}

function triadAtDegree(tonality: Tonality, degree: number): PitchClass[] {
  const scale = scaleFor(tonality);
  const index = ((degree % 7) + 7) % 7;
  const root = scale[index];
  const third = scale[(index + 2) % 7];
  const fifth = scale[(index + 4) % 7];
  if (root === undefined || third === undefined || fifth === undefined) {
    throw new Error('Invalid scale degree');
  }
  return [root, third, fifth];
}

function functionForDegree(degree: number): HarmonicFunction {
  const normalized = ((degree % 7) + 7) % 7;
  if (normalized === 0 || normalized === 2 || normalized === 5) return 'tonic';
  if (normalized === 1 || normalized === 3) return 'predominant';
  if (normalized === 4 || normalized === 6) return 'dominant';
  return 'color';
}

function tensionForFunction(fn: HarmonicFunction): number {
  switch (fn) {
    case 'tonic': return 0.15;
    case 'predominant': return 0.42;
    case 'dominant': return 0.82;
    case 'color': return 0.56;
  }
}

export function chordAtDegree(tonality: Tonality, degree: number): ChordState {
  const tones = triadAtDegree(tonality, degree);
  const fn = functionForDegree(degree);
  const root = tones[0];
  if (root === undefined) throw new Error('Chord has no root');
  return {
    root,
    tones,
    function: fn,
    tension: tensionForFunction(fn),
    label: `${pitchName(root)} · ${fn}`,
  };
}

export function circularPitchDistance(a: PitchClass, b: PitchClass): number {
  const d = Math.abs(a - b);
  return Math.min(d, 12 - d);
}

export function voiceLeadingDistance(from: ChordState, to: ChordState): number {
  if (from.tones.length === 0 || to.tones.length === 0) return 1;
  let total = 0;
  for (const source of from.tones) {
    let best = 6;
    for (const target of to.tones) {
      best = Math.min(best, circularPitchDistance(source, target));
    }
    total += best;
  }
  return clamp01(total / (from.tones.length * 4));
}

export function resolutionStrength(from: ChordState, to: ChordState): number {
  const functionDrop = from.tension - to.tension;
  const rootMotion = circularPitchDistance(from.root, to.root);
  const fifthMotionBonus = rootMotion === 5 ? 0.18 : 0;
  const tonicLandingBonus = to.function === 'tonic' ? 0.25 : 0;
  return clamp01(functionDrop * 0.7 + fifthMotionBonus + tonicLandingBonus);
}

export function createInitialMusicState(tonality: Tonality = { tonic: 0, mode: 'minor' }): MusicState {
  const chord = chordAtDegree(tonality, 0);
  return {
    tonality,
    chord,
    previousChord: null,
    tension: chord.tension,
    resolution: 0.5,
    voiceLeading: 0,
    energy: 0.35,
  };
}

function degreeForIntent(state: MusicState, intent: PlayerIntent): number {
  switch (intent) {
    case 'resolve': return 0;
    case 'delay': return state.chord.function === 'dominant' ? 4 : 3;
    case 'diverge': return state.tonality.mode === 'major' ? 5 : 2;
    case 'intensify': return 4;
  }
}

export function applyHarmonicIntent(state: MusicState, intent: PlayerIntent): MusicState {
  const target = chordAtDegree(state.tonality, degreeForIntent(state, intent));
  let chord = target;

  if (intent === 'delay') {
    chord = { ...target, tension: clamp01(target.tension + 0.12), label: `${target.label} · suspended` };
  } else if (intent === 'intensify') {
    const seventh = mod12(target.root + 10);
    chord = {
      ...target,
      tones: [...target.tones, seventh],
      tension: clamp01(target.tension + 0.15),
      label: `${pitchName(target.root)}7 · dominant`,
    };
  } else if (intent === 'diverge') {
    chord = { ...target, tension: clamp01(target.tension + 0.08), label: `${target.label} · deceptive` };
  }

  const resolution = resolutionStrength(state.chord, chord);
  const movement = voiceLeadingDistance(state.chord, chord);
  const tension = clamp01(chord.tension * 0.72 + movement * 0.28);
  const energyDelta = intent === 'intensify' ? 0.16 : intent === 'resolve' ? -0.1 : 0.04;

  return {
    ...state,
    previousChord: state.chord,
    chord,
    tension,
    resolution,
    voiceLeading: movement,
    energy: clamp01(state.energy + energyDelta),
  };
}

export function transposeTonality(tonality: Tonality, semitones: number): Tonality {
  return { ...tonality, tonic: mod12(tonality.tonic + semitones) };
}
