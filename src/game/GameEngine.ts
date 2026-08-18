import {
  applyHarmonicIntent,
  createInitialMusicState,
  type MusicState,
  type PlayerIntent,
  type Tonality,
} from '../core/music';
import {
  createInitialSkill,
  generateRhythmChallenge,
  judgeTiming,
  nearestActiveStep,
  stepDurationMs,
  updateSkill,
  type HitSample,
  type RhythmChallenge,
  type SkillModel,
} from '../core/rhythm';
import { calculateModifierBonus, chooseModifier, modifierDefinition, type ModifierId } from './RunModifiers';

export type InputJudgement = 'perfect' | 'good' | 'reframed' | 'miss' | 'echo';

export interface InputResult {
  judgement: InputJudgement;
  intent: PlayerIntent;
  errorMs: number;
  timing: number;
  coherence: number;
  flow: number;
  scoreDelta: number;
  targetIndex: number;
  message: string;
}

export interface GameState {
  running: boolean;
  elapsedMs: number;
  phaseMs: number;
  bpm: number;
  bar: number;
  score: number;
  combo: number;
  maxCombo: number;
  flow: number;
  music: MusicState;
  skill: SkillModel;
  challenge: RhythmChallenge;
  previousChallenge: RhythmChallenge | null;
  samplesThisBar: HitSample[];
  lastInput: InputResult | null;
  seed: number;
  activeModifiers: ModifierId[];
  lastUnlock: string | null;
  consumedSteps: number[];
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

export function barDurationMs(bpm: number): number {
  return (60000 / bpm) * 4;
}

export function phaseInBar(state: Pick<GameState, 'phaseMs' | 'bpm'>): number {
  const duration = barDurationMs(state.bpm);
  return ((state.phaseMs % duration) + duration) % duration / duration;
}

export function coherenceForIntent(music: MusicState, intent: PlayerIntent): number {
  const tension = music.tension;
  switch (intent) {
    case 'resolve':
      return clamp01(0.22 + tension * 0.88);
    case 'delay':
      return clamp01(0.36 + (1 - Math.abs(tension - 0.72) / 0.72) * 0.58);
    case 'diverge':
      return clamp01(0.42 + (1 - Math.abs(tension - 0.5) / 0.5) * 0.46);
    case 'intensify':
      return clamp01(0.3 + (1 - tension) * 0.72);
  }
}

function flowValue(timing: number, coherence: number, surprise: number, resolution: number): number {
  const floor = 0.08;
  const product =
    Math.pow(Math.max(floor, timing), 0.36) *
    Math.pow(Math.max(floor, coherence), 0.27) *
    Math.pow(Math.max(floor, surprise), 0.16) *
    Math.pow(Math.max(floor, resolution), 0.21);
  return clamp01(product);
}

function surpriseFor(challenge: RhythmChallenge, previous: RhythmChallenge | null): number {
  if (!previous) return 0.55;
  const length = Math.max(challenge.steps.length, previous.steps.length);
  let changes = 0;
  for (let i = 0; i < length; i += 1) {
    if (Boolean(challenge.steps[i]) !== Boolean(previous.steps[i])) changes += 1;
  }
  const structuralChange = changes / Math.max(1, length);
  return clamp01(0.28 + structuralChange * 0.65 + challenge.complexity * 0.16);
}

export function createGameState(
  seed = Date.now(),
  tonality: Tonality = { tonic: 0, mode: 'minor' },
  initialSkill: SkillModel = createInitialSkill(),
): GameState {
  const skill = initialSkill;
  const challenge = generateRhythmChallenge(skill, seed);
  return {
    running: false,
    elapsedMs: 0,
    phaseMs: 0,
    bpm: 112,
    bar: 0,
    score: 0,
    combo: 0,
    maxCombo: 0,
    flow: 0.5,
    music: createInitialMusicState(tonality),
    skill,
    challenge,
    previousChallenge: null,
    samplesThisBar: [],
    lastInput: null,
    seed,
    activeModifiers: [],
    lastUnlock: null,
    consumedSteps: [],
  };
}

export function startGame(state: GameState): GameState {
  return { ...state, running: true };
}

function nextBar(state: GameState): GameState {
  const updatedSkill = updateSkill(state.skill, state.samplesThisBar);
  const nextSeed = (state.seed + 0x9e3779b9 + state.bar * 97) >>> 0;
  const challenge = generateRhythmChallenge(updatedSkill, nextSeed, state.challenge);
  const tempoLift = updatedSkill.stability > 0.7 && state.bar > 3 ? 0.35 : 0;
  const bpm = Math.min(156, state.bpm + tempoLift);
  const upcomingBar = state.bar + 1;
  const unlockId = upcomingBar > 0 && upcomingBar % 4 === 0
    ? chooseModifier(state.activeModifiers, nextSeed)
    : null;
  const activeModifiers = unlockId ? [...state.activeModifiers, unlockId] : state.activeModifiers;
  const lastUnlock = unlockId ? modifierDefinition(unlockId).name : null;
  return {
    ...state,
    bpm,
    bar: state.bar + 1,
    skill: updatedSkill,
    previousChallenge: state.challenge,
    challenge,
    samplesThisBar: [],
    seed: nextSeed,
    activeModifiers,
    lastUnlock,
    consumedSteps: [],
  };
}

export function advanceGame(state: GameState, deltaMs: number): GameState {
  if (!state.running) return state;
  const safeDelta = Math.max(0, Math.min(250, deltaMs));
  let next: GameState = {
    ...state,
    elapsedMs: state.elapsedMs + safeDelta,
    phaseMs: state.phaseMs + safeDelta,
  };
  let guard = 0;
  while (next.phaseMs >= barDurationMs(next.bpm) && guard < 4) {
    const duration = barDurationMs(next.bpm);
    next = nextBar({ ...next, phaseMs: next.phaseMs - duration });
    guard += 1;
  }
  return next;
}

export function handleIntent(state: GameState, intent: PlayerIntent): GameState {
  if (!state.running) return state;

  const phase = phaseInBar(state);
  const nearest = nearestActiveStep(state.challenge, phase);
  const stepMs = stepDurationMs({
    bpm: state.bpm,
    beatsPerBar: 4,
    subdivisionsPerBeat: state.challenge.subdivisions,
  });
  const errorMs = nearest.distanceInSteps * stepMs;
  const timing = judgeTiming(errorMs, stepMs);
  const coherence = coherenceForIntent(state.music, intent);
  const nextMusic = applyHarmonicIntent(state.music, intent);

  if (state.consumedSteps.includes(nearest.index)) {
    const result: InputResult = {
      judgement: 'echo',
      intent,
      errorMs,
      timing,
      coherence,
      flow: state.flow,
      scoreDelta: 0,
      targetIndex: nearest.index,
      message: 'ECHO',
    };
    return { ...state, music: nextMusic, lastInput: result };
  }

  const reframed = timing <= 0.36 && nearest.distanceInSteps <= 1.05;
  const hit = timing > 0.36 || reframed;
  const surprise = surpriseFor(state.challenge, state.previousChallenge);
  const resolution = intent === 'resolve'
    ? Math.max(nextMusic.resolution, 0.24)
    : clamp01(0.38 + nextMusic.tension * 0.42);
  const control = reframed ? timing * 0.72 + 0.18 : timing;
  const flow = flowValue(control, coherence, surprise, resolution);

  let judgement: InputJudgement;
  if (timing >= 0.82) judgement = 'perfect';
  else if (timing > 0.36) judgement = 'good';
  else if (reframed) judgement = 'reframed';
  else judgement = 'miss';

  const combo = hit ? state.combo + 1 : 0;
  const comboMultiplier = 1 + Math.min(combo, 24) * 0.035;
  const musicality = coherence * 0.42 + flow * 0.34 + timing * 0.24;
  const index = nearest.index;
  const syncopated = index % state.challenge.subdivisions !== 0;
  const polyrhythmic = state.challenge.polyrhythm !== 1;
  const modifierBonus = calculateModifierBonus(state.activeModifiers, {
    intent,
    judgement,
    tension: state.music.tension,
    syncopated,
    polyrhythm: state.challenge.polyrhythm,
  });
  const scoreDelta = hit
    ? Math.round(120 * musicality * comboMultiplier * modifierBonus.scoreMultiplier)
    : 0;
  const sample: HitSample = {
    errorMs,
    hit,
    syncopated,
    polyrhythmic,
  };

  const message = judgement === 'perfect'
    ? 'LOCKED'
    : judgement === 'good'
      ? 'IN FLOW'
      : judgement === 'reframed'
        ? 'SYNCOPATED'
        : 'DRIFT';

  const result: InputResult = {
    judgement,
    intent,
    errorMs,
    timing,
    coherence,
    flow,
    scoreDelta,
    targetIndex: index,
    message,
  };

  return {
    ...state,
    music: nextMusic,
    score: state.score + scoreDelta,
    combo,
    maxCombo: Math.max(state.maxCombo, combo),
    flow: clamp01(state.flow * 0.72 + flow * 0.28 + modifierBonus.flowBonus),
    samplesThisBar: [...state.samplesThisBar, sample],
    consumedSteps: hit ? [...state.consumedSteps, index] : state.consumedSteps,
    lastInput: result,
  };
}
