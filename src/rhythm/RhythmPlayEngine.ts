export type RhythmMiniGameId = 'beat-pop' | 'echo-pair' | 'hold-release';
export type RhythmInput = 'tap' | 'left' | 'right' | 'hold-start' | 'hold-end';
export type RhythmJudgement = 'perfect' | 'good' | 'okay' | 'miss';

export interface RhythmTarget {
  id: number;
  input: RhythmInput;
  timeMs: number;
  label: string;
  resolved: boolean;
  judgement: RhythmJudgement | null;
  errorMs: number | null;
}

export interface RhythmCue {
  id: number;
  timeMs: number;
  voice: 'kick' | 'snare' | 'hat' | 'clap' | 'tom-low' | 'tom-high' | 'bass' | 'stab';
  side: 'left' | 'right' | 'center';
  strength: number;
}

export interface RhythmMiniGameDefinition {
  id: RhythmMiniGameId;
  title: string;
  subtitle: string;
  instruction: string;
  bpm: number;
  durationBeats: number;
}

export interface RhythmPlayState {
  game: RhythmMiniGameDefinition;
  elapsedMs: number;
  score: number;
  combo: number;
  maxCombo: number;
  targets: RhythmTarget[];
  cues: RhythmCue[];
  finished: boolean;
  lastJudgement: RhythmJudgement | null;
  lastTargetId: number | null;
}

export interface RhythmInputResult {
  state: RhythmPlayState;
  judgement: RhythmJudgement;
  targetId: number | null;
  scoreDelta: number;
  errorMs: number;
}

const INPUT_WINDOW_MS = 190;
const MISS_LATE_MS = 205;

export const RHYTHM_MINIGAMES: readonly RhythmMiniGameDefinition[] = [
  {
    id: 'beat-pop',
    title: 'BEAT POP',
    subtitle: 'ONE BUTTON · FEEL THE BOUNCE',
    instruction: 'Tap when the pulse lands in the center.',
    bpm: 112,
    durationBeats: 18,
  },
  {
    id: 'echo-pair',
    title: 'ECHO PAIR',
    subtitle: 'LISTEN · THEN ANSWER',
    instruction: 'Listen to LEFT / RIGHT, then copy the four-beat phrase.',
    bpm: 104,
    durationBeats: 14,
  },
  {
    id: 'hold-release',
    title: 'HOLD & RELEASE',
    subtitle: 'PRESS · WAIT · LET GO',
    instruction: 'Press on HOLD. Release exactly when the wave flashes.',
    bpm: 96,
    durationBeats: 17,
  },
] as const;

const definitionFor = (id: RhythmMiniGameId): RhythmMiniGameDefinition => {
  const definition = RHYTHM_MINIGAMES.find((item) => item.id === id);
  if (!definition) throw new Error(`Unknown rhythm minigame: ${id}`);
  return definition;
};

export function rhythmBeatMs(bpm: number): number {
  return 60000 / Math.max(1, bpm);
}

export function rhythmJudgement(errorMs: number): RhythmJudgement {
  const error = Math.abs(errorMs);
  if (error <= 48) return 'perfect';
  if (error <= 92) return 'good';
  if (error <= INPUT_WINDOW_MS) return 'okay';
  return 'miss';
}

export function scoreForJudgement(judgement: RhythmJudgement): number {
  switch (judgement) {
    case 'perfect': return 100;
    case 'good': return 72;
    case 'okay': return 38;
    case 'miss': return 0;
  }
}

function seededPattern(seed: number): readonly ('left' | 'right')[] {
  let value = seed >>> 0;
  const output: ('left' | 'right')[] = [];
  for (let index = 0; index < 4; index += 1) {
    value = (Math.imul(value ^ 0x9e3779b9, 1664525) + 1013904223) >>> 0;
    output.push((value & 1) === 0 ? 'left' : 'right');
  }
  if (output.every((side) => side === output[0])) output[3] = output[0] === 'left' ? 'right' : 'left';
  return output;
}

function makeTarget(id: number, input: RhythmInput, timeMs: number, label: string): RhythmTarget {
  return { id, input, timeMs, label, resolved: false, judgement: null, errorMs: null };
}

function makeCue(
  id: number,
  timeMs: number,
  voice: RhythmCue['voice'],
  side: RhythmCue['side'],
  strength = 0.8,
): RhythmCue {
  return { id, timeMs, voice, side, strength };
}

function beatPopContent(beatMs: number): { targets: RhythmTarget[]; cues: RhythmCue[] } {
  const beats = [2, 3, 4, 6, 7, 8, 10, 11, 12, 14, 15, 16];
  return {
    targets: beats.map((beat, index) => makeTarget(index + 1, 'tap', beat * beatMs, 'POP')),
    cues: beats.map((beat, index) => makeCue(index + 1, beat * beatMs, index % 4 === 0 ? 'kick' : 'hat', 'center', index % 4 === 0 ? 1 : 0.72)),
  };
}

function echoPairContent(beatMs: number, seed: number): { targets: RhythmTarget[]; cues: RhythmCue[] } {
  const pattern = seededPattern(seed);
  const callStartBeat = 2;
  const responseStartBeat = 8;
  const cues: RhythmCue[] = [];
  const targets: RhythmTarget[] = [];
  pattern.forEach((side, index) => {
    const voice: RhythmCue['voice'] = side === 'left' ? 'tom-low' : 'tom-high';
    cues.push(makeCue(index + 1, (callStartBeat + index) * beatMs, voice, side, index === 0 ? 1 : 0.82));
    targets.push(makeTarget(index + 1, side, (responseStartBeat + index) * beatMs, side.toUpperCase()));
  });
  cues.push(makeCue(99, 7 * beatMs, 'clap', 'center', 0.9));
  return { targets, cues };
}

function holdReleaseContent(beatMs: number): { targets: RhythmTarget[]; cues: RhythmCue[] } {
  const rounds = [
    { start: 2, end: 4 },
    { start: 6, end: 9 },
    { start: 11, end: 14 },
  ];
  const targets: RhythmTarget[] = [];
  const cues: RhythmCue[] = [];
  let id = 1;
  for (const round of rounds) {
    targets.push(makeTarget(id, 'hold-start', round.start * beatMs, 'HOLD'));
    cues.push(makeCue(id, round.start * beatMs, 'bass', 'center', 0.9));
    id += 1;
    targets.push(makeTarget(id, 'hold-end', round.end * beatMs, 'RELEASE'));
    cues.push(makeCue(id, round.end * beatMs, 'stab', 'center', 1));
    id += 1;
  }
  return { targets, cues };
}

export function createRhythmPlayState(id: RhythmMiniGameId, seed = 1): RhythmPlayState {
  const game = definitionFor(id);
  const beatMs = rhythmBeatMs(game.bpm);
  const content = id === 'beat-pop'
    ? beatPopContent(beatMs)
    : id === 'echo-pair'
      ? echoPairContent(beatMs, seed)
      : holdReleaseContent(beatMs);
  return {
    game,
    elapsedMs: 0,
    score: 0,
    combo: 0,
    maxCombo: 0,
    targets: content.targets,
    cues: content.cues,
    finished: false,
    lastJudgement: null,
    lastTargetId: null,
  };
}

function finishIfNeeded(state: RhythmPlayState): RhythmPlayState {
  const durationMs = state.game.durationBeats * rhythmBeatMs(state.game.bpm);
  const allResolved = state.targets.every((target) => target.resolved);
  return {
    ...state,
    finished: state.finished || allResolved || state.elapsedMs >= durationMs,
  };
}

export function advanceRhythmPlay(state: RhythmPlayState, elapsedMs: number): RhythmPlayState {
  if (state.finished) return state;
  const nextElapsed = Math.max(state.elapsedMs, elapsedMs);
  let combo = state.combo;
  let lastJudgement = state.lastJudgement;
  let lastTargetId = state.lastTargetId;
  const targets = state.targets.map((target) => {
    if (target.resolved || nextElapsed <= target.timeMs + MISS_LATE_MS) return target;
    combo = 0;
    lastJudgement = 'miss';
    lastTargetId = target.id;
    return { ...target, resolved: true, judgement: 'miss' as const, errorMs: nextElapsed - target.timeMs };
  });
  return finishIfNeeded({ ...state, elapsedMs: nextElapsed, combo, targets, lastJudgement, lastTargetId });
}

export function submitRhythmInput(
  state: RhythmPlayState,
  input: RhythmInput,
  atMs: number,
): RhythmInputResult {
  if (state.finished) return { state, judgement: 'miss', targetId: null, scoreDelta: 0, errorMs: 999 };

  const unresolved = state.targets.filter((target) => !target.resolved);
  const nearest = unresolved.reduce<RhythmTarget | null>((best, target) => {
    const distance = Math.abs(target.timeMs - atMs);
    if (distance > INPUT_WINDOW_MS) return best;
    if (!best || distance < Math.abs(best.timeMs - atMs)) return target;
    return best;
  }, null);

  if (!nearest) {
    const missState = finishIfNeeded({
      ...state,
      elapsedMs: Math.max(state.elapsedMs, atMs),
      combo: 0,
      lastJudgement: 'miss',
      lastTargetId: null,
    });
    return { state: missState, judgement: 'miss', targetId: null, scoreDelta: 0, errorMs: 999 };
  }

  const errorMs = atMs - nearest.timeMs;
  const timingJudgement = rhythmJudgement(errorMs);
  const judgement: RhythmJudgement = nearest.input === input ? timingJudgement : 'miss';
  const scoreDelta = scoreForJudgement(judgement);
  const combo = judgement === 'miss' ? 0 : state.combo + 1;
  const targets = state.targets.map((target) => target.id === nearest.id
    ? { ...target, resolved: true, judgement, errorMs }
    : target);
  const nextState = finishIfNeeded({
    ...state,
    elapsedMs: Math.max(state.elapsedMs, atMs),
    score: state.score + scoreDelta,
    combo,
    maxCombo: Math.max(state.maxCombo, combo),
    targets,
    lastJudgement: judgement,
    lastTargetId: nearest.id,
  });
  return { state: nextState, judgement, targetId: nearest.id, scoreDelta, errorMs };
}

export function rhythmAccuracy(state: RhythmPlayState): number {
  if (state.targets.length === 0) return 0;
  return state.score / (state.targets.length * 100);
}

export function rhythmRank(state: RhythmPlayState): 'SUPERB' | 'GREAT' | 'OK' | 'TRY AGAIN' {
  const accuracy = rhythmAccuracy(state);
  if (accuracy >= 0.88) return 'SUPERB';
  if (accuracy >= 0.7) return 'GREAT';
  if (accuracy >= 0.48) return 'OK';
  return 'TRY AGAIN';
}
