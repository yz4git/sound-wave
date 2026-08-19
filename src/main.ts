import './styles.css';
import { SoundEngine } from './audio/SoundEngine';
import type { PlayerIntent } from './core/music';
import {
  advanceGame,
  createGameState,
  handleIntent,
  phaseInBar,
  phraseGoalProgress,
  selectModifier,
  startGame,
} from './game/GameEngine';
import { modifierDefinition, type ModifierId } from './game/RunModifiers';
import { pressureDanger, type PressureEvent } from './game/PressureSystem';
import { Renderer } from './ui/Renderer';
import { loadProfile, saveProfile, updateProfile } from './game/Profile';

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Required game UI is missing: ${selector}`);
  return element;
}

const canvas = required<HTMLCanvasElement>('#game');
const startButton = required<HTMLButtonElement>('#start');
const startKickerEl = required<HTMLElement>('#start .start-kicker');
const startTitleEl = required<HTMLElement>('#start strong');
const startHelpEl = required<HTMLElement>('#start small');
const scoreEl = required<HTMLElement>('#score');
const comboEl = required<HTMLElement>('#combo');
const flowEl = required<HTMLElement>('#flow');
const stabilityEl = required<HTMLElement>('#stability');
const bpmEl = required<HTMLElement>('#bpm');
const phraseEl = required<HTMLElement>('#phrase');
const objectiveEl = required<HTMLElement>('#objective');
const pressureStatusEl = required<HTMLElement>('#pressure-status');
const chordEl = required<HTMLElement>('#chord');
const judgementEl = required<HTMLElement>('#judgement');
const controlsEl = required<HTMLElement>('#controls');
const intentFeedbackEl = required<HTMLElement>('#intent-feedback');
const intentFeedbackActionEl = required<HTMLElement>('#intent-feedback-action');
const intentFeedbackPrimaryEl = required<HTMLElement>('#intent-feedback-primary');
const intentFeedbackShiftEl = required<HTMLElement>('#intent-feedback-shift');
const mutationEl = required<HTMLElement>('#mutation');
const mutationOptionsEl = required<HTMLElement>('#mutation-options');
const intentButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-intent]'));

const renderer = new Renderer(canvas);
const sound = new SoundEngine({ tempo: 112 });
let profile = loadProfile();
let state = createGameState(Date.now(), { tonic: 0, mode: 'minor' }, profile.skill);
let lastFrame = performance.now();
let lastIntentAtMs = performance.now();
let previousStep = -1;
let flashTimer = 0;
let previousBar = -1;
let unlockTimer = 0;
let phraseTimer = 0;
let intentFeedbackTimer = 0;
let pressureAlertTimer = 0;
let renderedMutationKey = '';
let startRequested = false;
let collapseShown = false;
let audioUnavailable = false;

function pressureEventToken(event: PressureEvent | null): string {
  if (!event) return '';
  return `${event.type}:${event.waveIds.join(',')}:${event.message}:${event.scoreBonus}:${Math.round(event.stabilityDelta * 1000)}`;
}

let lastPressureEventToken = pressureEventToken(state.pressure.lastEvent);

function chooseMutation(id: ModifierId): void {
  if (!state.pendingModifierChoices.includes(id)) return;
  state = selectModifier(state, id);
  unlockTimer = 2.4;
  lastFrame = performance.now();
  lastIntentAtMs = lastFrame;
  sound.playIntentAccent('diverge', state.music.chord.root, 0.95);
  sound.playPercussion('accent', 0.95);
  renderer.impact(0.95);
  syncHud();
}

function syncMutationOverlay(): void {
  const choices = state.pendingModifierChoices;
  if (choices.length === 0) {
    mutationEl.classList.add('hidden');
    mutationEl.setAttribute('aria-hidden', 'true');
    renderedMutationKey = '';
    return;
  }

  mutationEl.classList.remove('hidden');
  mutationEl.setAttribute('aria-hidden', 'false');
  const key = choices.join('|');
  if (key === renderedMutationKey) return;
  renderedMutationKey = key;
  mutationOptionsEl.replaceChildren();

  for (const id of choices) {
    const definition = modifierDefinition(id);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'mutation-option';
    button.innerHTML = `<b>${definition.name}</b><span>${definition.description}</span>`;
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      chooseMutation(id);
    }, { passive: false });
    button.addEventListener('contextmenu', (event) => event.preventDefault());
    mutationOptionsEl.append(button);
  }
}

function recommendedIntents(): readonly PlayerIntent[] {
  const danger = pressureDanger(state.pressure);
  const priority = [...state.pressure.waves].sort((a, b) => a.etaMs - b.etaMs)[0];

  if (priority && (danger >= 0.72 || state.pressure.stability <= 0.38)) {
    if (state.music.tension >= 0.62) return ['resolve'];
    return priority.amplified ? ['delay', 'diverge'] : ['delay'];
  }
  if (priority?.amplified && danger >= 0.46) return ['resolve', 'delay'];

  switch (state.phraseGoal.id) {
    case 'peak-release':
      return state.music.tension >= 0.65 ? ['resolve'] : ['intensify'];
    case 'rising-pressure':
      return danger < 0.52 ? ['intensify'] : ['delay', 'diverge'];
    case 'hold-flow':
      if (state.music.tension >= 0.72) return ['resolve', 'delay'];
      if (state.music.tension <= 0.3 && danger < 0.48) return ['intensify'];
      return ['diverge'];
    case 'offbeat-control':
      if (state.music.tension >= 0.72) return ['resolve'];
      if (state.music.tension <= 0.3 && danger < 0.48) return ['intensify'];
      return ['diverge'];
    case 'core-stability':
      if (state.pressure.stability < 0.75 || danger >= 0.48) {
        return state.music.tension >= 0.62 ? ['resolve'] : ['delay', 'diverge'];
      }
      return danger < 0.28 ? ['intensify'] : ['resolve'];
    case 'risk-release':
      if (priority?.amplified) {
        return state.music.tension >= 0.62 ? ['resolve'] : ['delay'];
      }
      if (danger >= 0.52) return ['delay', 'diverge'];
      return ['intensify'];
  }
}

function shouldShowGuidance(): boolean {
  const idleMs = performance.now() - lastIntentAtMs;
  const danger = pressureDanger(state.pressure);
  if (danger >= 0.72 || state.pressure.stability <= 0.35) return true;
  if (state.phrase <= 1) return true;
  if (state.phrase === 2) {
    return idleMs >= 1800 || state.flow < 0.48 || state.overplay >= 0.32;
  }
  return idleMs >= 4200 && (state.flow < 0.58 || state.combo === 0 || state.overplay >= 0.24);
}

function syncIntentGuidance(): void {
  const showGuidance = !state.collapsed && shouldShowGuidance();
  const recommended = showGuidance ? recommendedIntents() : [];
  controlsEl.classList.toggle('learned', state.phrase >= 3);
  for (const button of intentButtons) {
    const intent = button.dataset.intent as PlayerIntent | undefined;
    button.classList.toggle('suggested', Boolean(intent && recommended.includes(intent)));
  }
}

function syncIntentFeedback(): void {
  if (intentFeedbackTimer > 0 && !state.collapsed) {
    intentFeedbackEl.classList.add('visible');
    intentFeedbackEl.setAttribute('aria-hidden', 'false');
  } else {
    intentFeedbackEl.classList.remove('visible');
    intentFeedbackEl.setAttribute('aria-hidden', 'true');
  }
}

function syncPressureHud(): void {
  const stability = state.pressure.stability;
  const danger = pressureDanger(state.pressure);
  const waveCount = state.pressure.waves.length;
  stabilityEl.textContent = `${Math.round(stability * 100)}%`;
  stabilityEl.classList.toggle('warning', stability < 0.55 && stability >= 0.3);
  stabilityEl.classList.toggle('critical', stability < 0.3);

  const dangerLabel = danger >= 0.78
    ? 'CORE CRITICAL'
    : danger >= 0.55
      ? 'DANGER'
      : danger >= 0.28
        ? 'BUILDING'
        : 'CORE SAFE';
  pressureStatusEl.textContent = state.collapsed
    ? 'PRESSURE · CORE COLLAPSED'
    : waveCount > 0
      ? `PRESSURE · ${waveCount} WAVE${waveCount === 1 ? '' : 'S'} INBOUND · ${dangerLabel}`
      : 'PRESSURE · FIELD CLEAR · CORE SAFE';
  pressureStatusEl.className = state.collapsed || danger >= 0.78 ? 'critical' : danger >= 0.55 ? 'danger' : danger >= 0.28 ? 'building' : '';
}

function syncHud(): void {
  scoreEl.textContent = state.score.toLocaleString();
  comboEl.textContent = String(state.combo);
  flowEl.textContent = `${Math.round(state.flow * 100)}%`;
  bpmEl.textContent = String(Math.round(state.bpm));
  syncPressureHud();
  const phraseBar = (state.bar % 8) + 1;
  phraseEl.textContent = `PHRASE ${state.phrase} · BAR ${phraseBar}/8`;
  const goalPercent = Math.round(phraseGoalProgress(state.phraseGoal) * 100);
  objectiveEl.textContent = state.phrase <= 2
    ? `${state.phraseGoal.name} · ${state.phraseGoal.description} · ${state.phraseGoal.progress}/${state.phraseGoal.target} · ${goalPercent}%`
    : `${state.phraseGoal.name} · ${state.phraseGoal.progress}/${state.phraseGoal.target} · ${goalPercent}%`;
  const modifierTag = state.activeModifiers.length > 0 ? `  ·  MOD ×${state.activeModifiers.length}` : '';
  chordEl.textContent = `${state.music.chord.label}  ·  ${state.challenge.polyrhythm === 1 ? 'STRAIGHT' : `${state.challenge.polyrhythm}:4 POLY`}${modifierTag}`;

  if (state.collapsed) {
    judgementEl.textContent = 'CORE COLLAPSED — RUN OVER';
    judgementEl.classList.add('danger');
    judgementEl.classList.remove('flash');
  } else if (pressureAlertTimer > 0 && state.pressure.lastEvent?.type === 'breach') {
    const lost = Math.abs(Math.round(state.pressure.lastEvent.stabilityDelta * 100));
    judgementEl.textContent = `${state.pressure.lastEvent.message} — STABILITY -${lost}%`;
    judgementEl.classList.add('danger');
    judgementEl.classList.remove('flash');
  } else if (phraseTimer > 0 && state.lastPhraseResult) {
    const result = state.lastPhraseResult;
    judgementEl.textContent = result.completed
      ? `PHRASE CLEAR — ${result.name}  +${result.bonus}`
      : `PHRASE MISSED — ${result.name}`;
    judgementEl.classList.toggle('flash', result.completed);
    judgementEl.classList.remove('danger');
  } else if (state.lastUnlock && unlockTimer > 0) {
    judgementEl.textContent = `MUTATION ACQUIRED — ${state.lastUnlock}`;
    judgementEl.classList.add('flash');
    judgementEl.classList.remove('danger');
  } else if (state.lastInput && flashTimer > 0) {
    judgementEl.textContent = `${state.lastInput.message}  +${state.lastInput.scoreDelta}`;
    judgementEl.classList.add('flash');
    judgementEl.classList.remove('danger');
  } else if (audioUnavailable) {
    judgementEl.textContent = 'AUDIO UNAVAILABLE — GAMEPLAY CONTINUES';
    judgementEl.classList.remove('flash', 'danger');
  } else if (state.overplay >= 0.55) {
    judgementEl.textContent = 'OVERPLAY — LEAVE SPACE BETWEEN TARGETS';
    judgementEl.classList.remove('flash', 'danger');
  } else {
    const danger = pressureDanger(state.pressure);
    judgementEl.textContent = danger >= 0.72
      ? state.music.tension >= 0.62
        ? 'CORE PRESSURE — RESOLVE THE BUILDUP'
        : 'CORE PRESSURE — DELAY OR REROUTE'
      : state.music.tension > 0.68
        ? 'TENSION HIGH — CASH OUT OR HOLD THE EDGE'
        : state.music.tension < 0.32
          ? 'SPACE OPEN — BUILD RISK FOR MORE REWARD'
          : 'READ THE PULSE — SHAPE THE PRESSURE';
    judgementEl.classList.remove('flash', 'danger');
  }
  syncIntentFeedback();
  syncIntentGuidance();
  syncMutationOverlay();
}

function pulseMetronome(): void {
  if (state.pendingModifierChoices.length > 0 || state.collapsed) return;
  const count = state.challenge.steps.length;
  const phase = phaseInBar(state);
  const stepIndex = Math.floor(phase * count) % count;
  if (stepIndex === previousStep && state.bar === previousBar) return;
  previousStep = stepIndex;
  previousBar = state.bar;
  const active = Boolean(state.challenge.steps[stepIndex]);
  const accent = state.challenge.accents[stepIndex] ?? 0.25;
  const downbeat = stepIndex % state.challenge.subdivisions === 0;

  if (active) {
    sound.playPercussion(downbeat ? 'kick' : 'tick', accent);
    if (downbeat) sound.playBass(state.music.chord.root, accent);
    sound.playEnergyPulse(state.music.chord.root, state.flow, state.music.tension, accent);
    if (state.flow >= 0.82 && downbeat) sound.playPercussion('accent', accent * 0.45);
    renderer.impact(0.22 + accent * 0.34 + Math.max(0, state.flow - 0.58) * 0.22);
  }
}

function processPressureFeedback(): void {
  const event = state.pressure.lastEvent;
  const token = pressureEventToken(event);
  if (!event || token === lastPressureEventToken) return;
  lastPressureEventToken = token;

  if (event.type === 'breach') {
    pressureAlertTimer = 1.15;
    sound.playPercussion('miss', 1);
    renderer.impact(0.82);
    if (navigator.vibrate) navigator.vibrate([18, 22, 18]);
  }
}

function processTransportTransition(oldBar: number, oldPhrase: number): void {
  if (state.bar !== oldBar) {
    profile = updateProfile(profile, state.skill, state.score, state.maxCombo);
    saveProfile(profile);
    sound.setTempo(state.bpm);
    sound.playChord(state.music.chord, state.music.tension);
  }
  if (state.phrase !== oldPhrase && state.lastPhraseResult) {
    phraseTimer = 2.8;
    if (state.lastPhraseResult.completed) {
      sound.playDrop(state.music.chord.root);
      renderer.celebratePhrase(state.flow);
      renderer.impact(1);
      if (navigator.vibrate) navigator.vibrate([16, 25, 28]);
    } else {
      sound.playPercussion('miss', 0.55);
    }
  }
}

function advanceTransport(deltaMs: number): void {
  const oldBar = state.bar;
  const oldPhrase = state.phrase;
  state = advanceGame(state, deltaMs);
  processPressureFeedback();
  processTransportTransition(oldBar, oldPhrase);
}

function syncStateToInputTime(): void {
  if (!state.running || state.collapsed || state.pendingModifierChoices.length > 0) return;
  const now = performance.now();
  const deltaMs = Math.min(60, Math.max(0, now - lastFrame));
  if (deltaMs > 0) advanceTransport(deltaMs);
  lastFrame = now;
}

function pressureEventMatchesIntent(event: PressureEvent | null, intent: PlayerIntent): boolean {
  if (!event) return false;
  return (
    (intent === 'resolve' && event.type === 'resolve') ||
    (intent === 'delay' && event.type === 'delay') ||
    (intent === 'diverge' && event.type === 'diverge') ||
    (intent === 'intensify' && event.type === 'intensify')
  );
}

function showIntentResult(intent: PlayerIntent, beforeTension: number, beforeChord: string, strength: number): void {
  const afterTension = state.music.tension;
  const beforePercent = Math.round(beforeTension * 100);
  const afterPercent = Math.round(afterTension * 100);
  const delta = afterPercent - beforePercent;
  const deltaLabel = Math.abs(delta) < 2
    ? `TENSION HOLD · ${afterPercent}%`
    : `TENSION ${delta > 0 ? '▲' : '▼'}${Math.abs(delta)} · ${afterPercent}%`;
  const harmonyLabel = beforeChord === state.music.chord.label
    ? `HARMONY HELD · ${state.music.chord.label}`
    : `${beforeChord} → ${state.music.chord.label}`;
  const pressureEvent = state.pressure.lastEvent;
  const pressureLabel = pressureEventMatchesIntent(pressureEvent, intent)
    ? `${pressureEvent?.message ?? ''}${(pressureEvent?.scoreBonus ?? 0) > 0 ? ` +${pressureEvent?.scoreBonus}` : ''}`
    : '';

  intentFeedbackActionEl.textContent = intent.toUpperCase();
  intentFeedbackPrimaryEl.textContent = deltaLabel;
  intentFeedbackShiftEl.textContent = pressureLabel ? `${pressureLabel} · ${harmonyLabel}` : harmonyLabel;
  intentFeedbackEl.className = `intent-feedback visible ${intent}`;
  intentFeedbackEl.setAttribute('aria-hidden', 'false');
  intentFeedbackTimer = 0.82;
  renderer.showIntent(intent, beforeTension, afterTension, strength);
}

function applyIntent(intent: PlayerIntent, button?: HTMLButtonElement): void {
  if (!state.running || state.collapsed || state.pendingModifierChoices.length > 0) return;
  syncStateToInputTime();
  if (state.pendingModifierChoices.length > 0 || state.collapsed) {
    syncHud();
    return;
  }

  const beforeChord = state.music.chord.label;
  const beforeTension = state.music.tension;
  state = handleIntent(state, intent);
  processPressureFeedback();
  const result = state.lastInput;
  if (!result) return;
  lastIntentAtMs = performance.now();

  if (beforeChord !== state.music.chord.label) {
    sound.playChord(state.music.chord, state.music.tension);
  }
  sound.playIntentAccent(intent, state.music.chord.root, result.flow);
  const feedbackVoice = result.judgement === 'miss' ? 'miss' : result.judgement === 'echo' ? 'tick' : 'hit';
  sound.playPercussion(feedbackVoice, Math.max(0.3, result.flow));
  const visualStrength = result.judgement === 'miss' ? 0.28 : result.judgement === 'echo' ? 0.22 : result.flow;
  renderer.impact(result.judgement === 'miss' ? 0.18 : result.judgement === 'echo' ? 0.12 : result.flow);
  showIntentResult(intent, beforeTension, beforeChord, visualStrength);
  flashTimer = 0.55;

  if (navigator.vibrate && result.judgement !== 'miss' && result.judgement !== 'echo') {
    navigator.vibrate(result.judgement === 'perfect' ? 14 : 8);
  }
  if (button) {
    button.classList.add('active');
    window.setTimeout(() => button.classList.remove('active'), 90);
  }
  syncHud();
}

function prepareFreshRun(): void {
  state = createGameState(Date.now(), { tonic: 0, mode: 'minor' }, profile.skill);
  previousStep = -1;
  previousBar = -1;
  flashTimer = 0;
  unlockTimer = 0;
  phraseTimer = 0;
  intentFeedbackTimer = 0;
  pressureAlertTimer = 0;
  renderedMutationKey = '';
  collapseShown = false;
  lastPressureEventToken = pressureEventToken(state.pressure.lastEvent);
}

function begin(): void {
  if (state.running || startRequested) return;
  if (state.collapsed) prepareFreshRun();
  startRequested = true;

  profile = { ...profile, sessions: profile.sessions + 1 };
  saveProfile(profile);
  state = startGame(state);
  lastPressureEventToken = pressureEventToken(state.pressure.lastEvent);
  startButton.classList.remove('collapse');
  startButton.classList.add('hidden');
  startButton.setAttribute('aria-hidden', 'true');
  startButton.disabled = true;
  lastFrame = performance.now();
  lastIntentAtMs = lastFrame;
  syncHud();

  void sound.unlock()
    .then(() => {
      audioUnavailable = false;
      sound.playChord(state.music.chord, state.music.tension);
      syncHud();
    })
    .catch((error: unknown) => {
      audioUnavailable = true;
      console.warn('Sound Wave audio could not start; continuing silently.', error);
      syncHud();
    });
}

function showCollapseOverlay(): void {
  if (!state.collapsed || collapseShown) return;
  collapseShown = true;
  startRequested = false;
  profile = updateProfile(profile, state.skill, state.score, state.maxCombo);
  saveProfile(profile);
  startKickerEl.textContent = 'STABILITY LOST · RUN COMPLETE';
  startTitleEl.innerHTML = 'CORE<br />COLLAPSED';
  startHelpEl.textContent = `SCORE ${state.score.toLocaleString()} · PHRASE ${state.phrase} · TAP TO RESTART`;
  startButton.classList.add('collapse');
  startButton.classList.remove('hidden');
  startButton.setAttribute('aria-hidden', 'false');
  startButton.disabled = false;
  sound.playPercussion('miss', 1);
  renderer.impact(1);
  if (navigator.vibrate) navigator.vibrate([28, 38, 42]);
}

function handleStartGesture(event: Event): void {
  event.preventDefault();
  begin();
}

startButton.addEventListener('pointerdown', handleStartGesture, { passive: false });
startButton.addEventListener('click', handleStartGesture, { passive: false });

for (const button of intentButtons) {
  button.addEventListener('pointerdown', (event: PointerEvent) => {
    event.preventDefault();
    const intent = button.dataset.intent as PlayerIntent | undefined;
    if (intent) applyIntent(intent, button);
  }, { passive: false });
  button.addEventListener('contextmenu', (event: MouseEvent) => event.preventDefault());
}

const keyMap: Record<string, PlayerIntent> = {
  ArrowLeft: 'resolve',
  ArrowDown: 'delay',
  ArrowUp: 'diverge',
  ArrowRight: 'intensify',
  a: 'resolve',
  s: 'delay',
  d: 'diverge',
  f: 'intensify',
};

window.addEventListener('keydown', (event) => {
  if (state.collapsed && (event.key === 'Enter' || event.key === ' ')) {
    event.preventDefault();
    begin();
    return;
  }
  if (state.pendingModifierChoices.length > 0) {
    const index = Number.parseInt(event.key, 10) - 1;
    const choice = Number.isInteger(index) ? state.pendingModifierChoices[index] : undefined;
    if (choice) {
      event.preventDefault();
      chooseMutation(choice);
    }
    return;
  }

  const intent = keyMap[event.key];
  if (!intent || event.repeat) return;
  event.preventDefault();
  const button = intentButtons.find((candidate) => candidate.dataset.intent === intent);
  applyIntent(intent, button);
});

window.addEventListener('resize', () => renderer.resize());
window.addEventListener('orientationchange', () => window.setTimeout(() => renderer.resize(), 120));
document.addEventListener('visibilitychange', () => {
  if (document.hidden) sound.suspend();
  else {
    sound.resume();
    lastFrame = performance.now();
    lastIntentAtMs = lastFrame;
  }
});
document.addEventListener('touchmove', (event) => event.preventDefault(), { passive: false });

function frame(now: number): void {
  const deltaMs = Math.min(100, Math.max(0, now - lastFrame));
  lastFrame = now;
  if (state.running) {
    advanceTransport(deltaMs);
    pulseMetronome();
  }
  if (state.collapsed) showCollapseOverlay();
  flashTimer = Math.max(0, flashTimer - deltaMs / 1000);
  unlockTimer = Math.max(0, unlockTimer - deltaMs / 1000);
  phraseTimer = Math.max(0, phraseTimer - deltaMs / 1000);
  intentFeedbackTimer = Math.max(0, intentFeedbackTimer - deltaMs / 1000);
  pressureAlertTimer = Math.max(0, pressureAlertTimer - deltaMs / 1000);
  renderer.render(state, deltaMs / 1000);
  syncHud();
  requestAnimationFrame(frame);
}

syncHud();
requestAnimationFrame(frame);

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('./service-worker.js', { updateViaCache: 'none' })
      .then((registration) => registration.update())
      .catch((error: unknown) => console.warn('Service worker registration failed.', error));
  });
}
