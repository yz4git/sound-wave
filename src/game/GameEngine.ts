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
  timingWindows,
  updateSkill,
  type HitSample,
  type RhythmChallenge,
  type SkillModel,
} from '../core/rhythm';
import {
  calculateModifierBonus,
  chooseModifierOptions,
  modifierDefinition,
  type ModifierId,
} from './RunModifiers';
import {
  advancePressure,
  applyPressureIntent,
  createPressureState,
  spawnPressureForBar,
  type PressureState,
} from './PressureSystem';

export type InputJudgement = 'perfect' | 'good' | 'reframed' | 'miss' | 'echo';
export type PhraseGoalId =
  | 'peak-release'
  | 'hold-flow'
  | 'offbeat-control'
  | 'rising-pressure'
  | 'core-stability'
  | 'risk-release';

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

export interface PhraseGoal {
  id: PhraseGoalId;
  name: string;
  description: string;
  progress: number;
  target: number;
}

export interface PhraseResult {
  phrase: number;
  completed: boolean;
  name: string;
  bonus: number;
}

export interface GameState {
  running: boolean;
  collapsed: boolean;
  elapsedMs: number;
  phaseMs: number;
  bpm: number;
  bar: number;
  score: number;
  combo: number;
  maxCombo: number;
  flow: number;
  overplay: number;
  pressure: PressureState;
  music: MusicState;
  skill: SkillModel;
  challenge: RhythmChallenge;
  previousChallenge: RhythmChallenge | null;
  samplesThisBar: HitSample[];
  lastInput: InputResult | null;
  seed: number;
  activeModifiers: ModifierId[];
  pendingModifierChoices: ModifierId[];
  lastUnlock: string | null;
  consumedSteps: number[];
  phrase: number;
  phraseGoal: PhraseGoal;
  lastPhraseResult: PhraseResult | null;
}

const PHRASE_BARS = 8;
const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

const PHRASE_GOALS: readonly Omit<PhraseGoal, 'progress'>[] = [
  {
    id: 'peak-release',
    name: 'RELEASE THE PEAK',
    description: 'Resolve twice while TENSION is 65 or higher.',
    target: 2,
  },
  {
    id: 'hold-flow',
    name: 'HOLD THE CURRENT',
    description: 'Finish four bars with FLOW at 68% or higher.',
    target: 4,
  },
  {
    id: 'offbeat-control',
    name: 'OWN THE OFFBEAT',
    description: 'Land six syncopated rhythm targets.',
    target: 6,
  },
  {
    id: 'rising-pressure',
    name: 'BUILD THE WAVE',
    description: 'Land five INTENSIFY actions before tension peaks.',
    target: 5,
  },
  {
    id: 'core-stability',
    name: 'HOLD THE CORE',
    description: 'Finish four bars with STABILITY at 75% or higher.',
    target: 4,
  },
  {
    id: 'risk-release',
    name: 'AMPLIFY → RELEASE',
    description: 'Resolve two amplified waves before they reach the core.',
    target: 2,
  },
] as const;

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

function createPhraseGoal(seed: number, phrase: number): PhraseGoal {
  const mixed = Math.imul((seed ^ Math.imul(phrase, 0x9e3779b9)) >>> 0, 0x45d9f3b) >>> 0;
  const definition = PHRASE_GOALS[mixed % PHRASE_GOALS.length] ?? PHRASE_GOALS[0];
  if (!definition) throw new Error('Phrase goal definitions are missing');
  return { ...definition, progress: 0 };
}

function addPhraseProgress(goal: PhraseGoal, amount: number): PhraseGoal {
  if (amount <= 0 || goal.progress >= goal.target) return goal;
  return { ...goal, progress: Math.min(goal.target, goal.progress + amount) };
}

function amplifiedWavesResolvedBy(state: GameState): number {
  const count = state.music.tension >= 0.78 ? 3 : state.music.tension >= 0.62 ? 2 : 1;
  return [...state.pressure.waves]
    .sort((a, b) => a.etaMs - b.etaMs || b.pressure - a.pressure)
    .slice(0, count)
    .filter((wave) => wave.amplified)
    .length;
}

function updatePhraseGoalForInput(
  goal: PhraseGoal,
  state: GameState,
  intent: PlayerIntent,
  judgement: InputJudgement,
  syncopated: boolean,
): PhraseGoal {
  const hit = judgement !== 'miss' && judgement !== 'echo';
  if (!hit) return goal;
  switch (goal.id) {
    case 'peak-release':
      return intent === 'resolve' && state.music.tension >= 0.65 ? addPhraseProgress(goal, 1) : goal;
    case 'offbeat-control':
      return syncopated ? addPhraseProgress(goal, 1) : goal;
    case 'rising-pressure':
      return intent === 'intensify' && state.music.tension < 0.72 ? addPhraseProgress(goal, 1) : goal;
    case 'risk-release':
      return intent === 'resolve' ? addPhraseProgress(goal, amplifiedWavesResolvedBy(state)) : goal;
    case 'hold-flow':
    case 'core-stability':
      return goal;
  }
}

function updatePhraseGoalForBar(goal: PhraseGoal, state: GameState): PhraseGoal {
  if (goal.id === 'hold-flow') {
    return state.flow >= 0.68 ? addPhraseProgress(goal, 1) : goal;
  }
  if (goal.id === 'core-stability') {
    return state.pressure.stability >= 0.75 ? addPhraseProgress(goal, 1) : goal;
  }
  return goal;
}

export function phraseGoalProgress(goal: PhraseGoal): number {
  return clamp01(goal.progress / Math.max(1, goal.target));
}

export function createGameState(
  seed = Date.now(),
  tonality: Tonality = { tonic: 0, mode: 'minor' },
  initialSkill: SkillModel = createInitialSkill(),
): GameState {
  const skill = initialSkill;
  const challenge = generateRhythmChallenge(skill, seed);
  const pressure = spawnPressureForBar(createPressureState(), challenge, 112, seed);
  return {
    running: false,
    collapsed: false,
    elapsedMs: 0,
    phaseMs: 0,
    bpm: 112,
    bar: 0,
    score: 0,
    combo: 0,
    maxCombo: 0,
    flow: 0.5,
    overplay: 0,
    pressure,
    music: createInitialMusicState(tonality),
    skill,
    challenge,
    previousChallenge: null,
    samplesThisBar: [],
    lastInput: null,
    seed,
    activeModifiers: [],
    pendingModifierChoices: [],
    lastUnlock: null,
    consumedSteps: [],
    phrase: 1,
    phraseGoal: createPhraseGoal(seed, 1),
    lastPhraseResult: null,
  };
}

export function startGame(state: GameState): GameState {
  if (state.collapsed) return state;
  return { ...state, running: true };
}

export function selectModifier(state: GameState, id: ModifierId): GameState {
  if (!state.pendingModifierChoices.includes(id) || state.activeModifiers.includes(id)) return state;
  return {
    ...state,
    activeModifiers: [...state.activeModifiers, id],
    pendingModifierChoices: [],
    lastUnlock: modifierDefinition(id).name,
  };
}

function nextBar(state: GameState): GameState {
  const updatedSkill = updateSkill(state.skill, state.samplesThisBar);
  const nextSeed = (state.seed + 0x9e3779b9 + state.bar * 97) >>> 0;
  const challenge = generateRhythmChallenge(updatedSkill, nextSeed, state.challenge);
  const tempoLift = updatedSkill.stability > 0.7 && state.bar > 3 ? 0.35 : 0;
  const bpm = Math.min(156, state.bpm + tempoLift);
  const upcomingBar = state.bar + 1;
  const progressedGoal = updatePhraseGoalForBar(state.phraseGoal, state);
  const phraseFinished = upcomingBar % PHRASE_BARS === 0;
  const phraseCompleted = progressedGoal.progress >= progressedGoal.target;
  const phraseBonus = phraseFinished && phraseCompleted ? 700 + state.phrase * 150 : 0;
  const nextPhrase = phraseFinished ? state.phrase + 1 : state.phrase;
  const phraseGoal = phraseFinished ? createPhraseGoal(nextSeed, nextPhrase) : progressedGoal;
  const lastPhraseResult = phraseFinished
    ? { phrase: state.phrase, completed: phraseCompleted, name: progressedGoal.name, bonus: phraseBonus }
    : state.lastPhraseResult;
  const pendingModifierChoices = upcomingBar > 0 && upcomingBar % 4 === 0
    ? chooseModifierOptions(state.activeModifiers, nextSeed, 3)
    : [];
  let pressure = spawnPressureForBar(state.pressure, challenge, bpm, nextSeed);
  if (phraseFinished && phraseCompleted) {
    pressure = { ...pressure, stability: clamp01(pressure.stability + 0.08) };
  }

  return {
    ...state,
    bpm,
    bar: upcomingBar,
    score: state.score + phraseBonus,
    flow: phraseFinished && phraseCompleted ? clamp01(state.flow + 0.08) : state.flow,
    overplay: Math.max(0, state.overplay - 0.08),
    pressure,
    skill: updatedSkill,
    previousChallenge: state.challenge,
    challenge,
    samplesThisBar: [],
    seed: nextSeed,
    pendingModifierChoices,
    lastUnlock: null,
    consumedSteps: [],
    phrase: nextPhrase,
    phraseGoal,
    lastPhraseResult,
  };
}

export function advanceGame(state: GameState, deltaMs: number): GameState {
  if (!state.running || state.collapsed || state.pendingModifierChoices.length > 0) return state;
  const safeDelta = Math.max(0, Math.min(250, deltaMs));
  const pressureAdvance = advancePressure(state.pressure, safeDelta, state.music.tension);
  const collapsed = pressureAdvance.pressure.stability <= 0;
  let next: GameState = {
    ...state,
    running: collapsed ? false : state.running,
    collapsed,
    elapsedMs: state.elapsedMs + safeDelta,
    phaseMs: state.phaseMs + safeDelta,
    pressure: pressureAdvance.pressure,
  };
  if (pressureAdvance.breached > 0) {
    next = {
      ...next,
      combo: 0,
      flow: collapsed ? 0 : clamp01(next.flow - 0.08 - pressureAdvance.damage * 0.45),
      overplay: clamp01(next.overplay + 0.08),
    };
  }
  if (collapsed) return next;

  let guard = 0;
  while (next.phaseMs >= barDurationMs(next.bpm) && guard < 4) {
    const duration = barDurationMs(next.bpm);
    next = nextBar({ ...next, phaseMs: next.phaseMs - duration });
    guard += 1;
    if (next.pendingModifierChoices.length > 0) break;
  }
  return next;
}

export function handleIntent(state: GameState, intent: PlayerIntent): GameState {
  if (!state.running || state.collapsed || state.pendingModifierChoices.length > 0) return state;

  const phase = phaseInBar(state);
  const nearest = nearestActiveStep(state.challenge, phase);
  const stepMs = stepDurationMs({
    bpm: state.bpm,
    beatsPerBar: 4,
    subdivisionsPerBeat: state.challenge.subdivisions,
  });
  const errorMs = nearest.distanceInSteps * stepMs;
  const timing = judgeTiming(errorMs, stepMs);
  const windows = timingWindows(stepMs);
  const coherence = coherenceForIntent(state.music, intent);
  const nextMusic = applyHarmonicIntent(state.music, intent);

  let judgement: InputJudgement;
  if (errorMs <= windows.perfectMs) judgement = 'perfect';
  else if (errorMs <= windows.goodMs) judgement = 'good';
  else if (errorMs <= windows.reframeMs) judgement = 'reframed';
  else judgement = 'miss';

  const targetAlreadyConsumed = state.consumedSteps.includes(nearest.index);
  if (judgement !== 'miss' && targetAlreadyConsumed) {
    const nextOverplay = clamp01(state.overplay + 0.16);
    const result: InputResult = {
      judgement: 'echo',
      intent,
      errorMs,
      timing,
      coherence,
      flow: state.flow,
      scoreDelta: 0,
      targetIndex: nearest.index,
      message: nextOverplay >= 0.55 ? 'OVERPLAY' : 'ECHO',
    };
    return {
      ...state,
      music: nextMusic,
      flow: clamp01(state.flow - 0.035 - nextOverplay * 0.025),
      overplay: nextOverplay,
      lastInput: result,
    };
  }

  const hit = judgement !== 'miss';
  const surprise = surpriseFor(state.challenge, state.previousChallenge);
  const resolution = intent === 'resolve'
    ? Math.max(nextMusic.resolution, 0.24)
    : clamp01(0.38 + nextMusic.tension * 0.42);
  const control = judgement === 'reframed' ? timing * 0.72 + 0.18 : timing;
  const flow = flowValue(control, coherence, surprise, resolution);
  const combo = hit ? state.combo + 1 : 0;
  const comboMultiplier = 1 + Math.min(combo, 24) * 0.035;
  const musicality = coherence * 0.42 + flow * 0.34 + timing * 0.24;
  const index = nearest.index;
  const syncopated = index % state.challenge.subdivisions !== 0;
  const modifierBonus = calculateModifierBonus(state.activeModifiers, {
    intent,
    judgement,
    tension: state.music.tension,
    syncopated,
    polyrhythm: state.challenge.polyrhythm,
  });
  const intentionality = Math.max(0.25, 1 - state.overplay * 0.82);
  const pressureResult = hit
    ? applyPressureIntent(state.pressure, intent, state.music.tension, control)
    : { pressure: state.pressure, scoreBonus: 0, affected: 0 };
  const baseScore = hit
    ? Math.round(120 * musicality * comboMultiplier * modifierBonus.scoreMultiplier * intentionality)
    : 0;
  const scoreDelta = baseScore + pressureResult.scoreBonus;
  const sample: HitSample = {
    errorMs,
    hit,
    syncopated,
    polyrhythmic: state.challenge.polyrhythm !== 1,
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
  const nextOverplay = hit
    ? Math.max(0, state.overplay - (judgement === 'perfect' ? 0.12 : judgement === 'good' ? 0.08 : 0.04))
    : clamp01(state.overplay + 0.24);
  const nextFlow = hit
    ? clamp01(state.flow * 0.72 + flow * 0.28 + modifierBonus.flowBonus - state.overplay * 0.05)
    : clamp01(state.flow * 0.9 - 0.045 - nextOverplay * 0.035);
  const phraseGoal = updatePhraseGoalForInput(state.phraseGoal, state, intent, judgement, syncopated);

  return {
    ...state,
    music: nextMusic,
    score: state.score + scoreDelta,
    combo,
    maxCombo: Math.max(state.maxCombo, combo),
    flow: nextFlow,
    overplay: nextOverplay,
    pressure: pressureResult.pressure,
    phraseGoal,
    samplesThisBar: [...state.samplesThisBar, sample],
    consumedSteps: hit ? [...state.consumedSteps, index] : state.consumedSteps,
    lastInput: result,
  };
}
