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
import { Renderer } from './ui/Renderer';
import { loadProfile, saveProfile, updateProfile } from './game/Profile';

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Required game UI is missing: ${selector}`);
  return element;
}

const canvas = required<HTMLCanvasElement>('#game');
const startButton = required<HTMLButtonElement>('#start');
const scoreEl = required<HTMLElement>('#score');
const comboEl = required<HTMLElement>('#combo');
const flowEl = required<HTMLElement>('#flow');
const bpmEl = required<HTMLElement>('#bpm');
const phraseEl = required<HTMLElement>('#phrase');
const objectiveEl = required<HTMLElement>('#objective');
const chordEl = required<HTMLElement>('#chord');
const judgementEl = required<HTMLElement>('#judgement');
const mutationEl = required<HTMLElement>('#mutation');
const mutationOptionsEl = required<HTMLElement>('#mutation-options');
const intentButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-intent]'));

const renderer = new Renderer(canvas);
const sound = new SoundEngine({ tempo: 112 });
let profile = loadProfile();
let state = createGameState(Date.now(), { tonic: 0, mode: 'minor' }, profile.skill);
let lastFrame = performance.now();
let previousStep = -1;
let flashTimer = 0;
let previousBar = -1;
let unlockTimer = 0;
let phraseTimer = 0;
let renderedMutationKey = '';
let startRequested = false;
let audioUnavailable = false;

function chooseMutation(id: ModifierId): void {
  if (!state.pendingModifierChoices.includes(id)) return;
  state = selectModifier(state, id);
  unlockTimer = 2.4;
  lastFrame = performance.now();
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

function syncHud(): void {
  scoreEl.textContent = state.score.toLocaleString();
  comboEl.textContent = String(state.combo);
  flowEl.textContent = `${Math.round(state.flow * 100)}%`;
  bpmEl.textContent = String(Math.round(state.bpm));
  const phraseBar = (state.bar % 8) + 1;
  phraseEl.textContent = `PHRASE ${state.phrase} · BAR ${phraseBar}/8`;
  const goalPercent = Math.round(phraseGoalProgress(state.phraseGoal) * 100);
  objectiveEl.textContent = `${state.phraseGoal.name} · ${state.phraseGoal.description} · ${state.phraseGoal.progress}/${state.phraseGoal.target} · ${goalPercent}%`;
  const modifierTag = state.activeModifiers.length > 0 ? `  ·  MOD ×${state.activeModifiers.length}` : '';
  chordEl.textContent = `${state.music.chord.label}  ·  ${state.challenge.polyrhythm === 1 ? 'STRAIGHT' : `${state.challenge.polyrhythm}:4 POLY`}${modifierTag}`;

  if (phraseTimer > 0 && state.lastPhraseResult) {
    const result = state.lastPhraseResult;
    judgementEl.textContent = result.completed
      ? `PHRASE CLEAR — ${result.name}  +${result.bonus}`
      : `PHRASE MISSED — ${result.name}`;
    judgementEl.classList.toggle('flash', result.completed);
  } else if (state.lastUnlock && unlockTimer > 0) {
    judgementEl.textContent = `MUTATION ACQUIRED — ${state.lastUnlock}`;
    judgementEl.classList.add('flash');
  } else if (state.lastInput && flashTimer > 0) {
    judgementEl.textContent = `${state.lastInput.message}  +${state.lastInput.scoreDelta}`;
    judgementEl.classList.add('flash');
  } else if (audioUnavailable) {
    judgementEl.textContent = 'AUDIO UNAVAILABLE — GAMEPLAY CONTINUES';
    judgementEl.classList.remove('flash');
  } else if (state.overplay >= 0.55) {
    judgementEl.textContent = 'OVERPLAY — LEAVE SPACE BETWEEN TARGETS';
    judgementEl.classList.remove('flash');
  } else {
    judgementEl.textContent = state.music.tension > 0.68
      ? 'TENSION HIGH — RESOLVE, DELAY OR BREAK IT'
      : state.music.tension < 0.32
        ? 'SPACE OPEN — BUILD TENSION'
        : 'READ THE PULSE — SHAPE THE NEXT STATE';
    judgementEl.classList.remove('flash');
  }
  syncMutationOverlay();
}

function pulseMetronome(): void {
  if (state.pendingModifierChoices.length > 0) return;
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
  processTransportTransition(oldBar, oldPhrase);
}

function syncStateToInputTime(): void {
  if (!state.running || state.pendingModifierChoices.length > 0) return;
  const now = performance.now();
  const deltaMs = Math.min(60, Math.max(0, now - lastFrame));
  if (deltaMs > 0) advanceTransport(deltaMs);
  lastFrame = now;
}

function applyIntent(intent: PlayerIntent, button?: HTMLButtonElement): void {
  if (!state.running || state.pendingModifierChoices.length > 0) return;
  syncStateToInputTime();
  if (state.pendingModifierChoices.length > 0) {
    syncHud();
    return;
  }

  const beforeChord = state.music.chord.label;
  state = handleIntent(state, intent);
  const result = state.lastInput;
  if (!result) return;

  if (beforeChord !== state.music.chord.label) {
    sound.playChord(state.music.chord, state.music.tension);
  }
  sound.playIntentAccent(intent, state.music.chord.root, result.flow);
  const feedbackVoice = result.judgement === 'miss' ? 'miss' : result.judgement === 'echo' ? 'tick' : 'hit';
  sound.playPercussion(feedbackVoice, Math.max(0.3, result.flow));
  renderer.impact(result.judgement === 'miss' ? 0.18 : result.judgement === 'echo' ? 0.12 : result.flow);
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

function begin(): void {
  if (startRequested || state.running) return;
  startRequested = true;

  profile = { ...profile, sessions: profile.sessions + 1 };
  saveProfile(profile);
  state = startGame(state);
  startButton.classList.add('hidden');
  startButton.setAttribute('aria-hidden', 'true');
  startButton.disabled = true;
  lastFrame = performance.now();
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
  flashTimer = Math.max(0, flashTimer - deltaMs / 1000);
  unlockTimer = Math.max(0, unlockTimer - deltaMs / 1000);
  phraseTimer = Math.max(0, phraseTimer - deltaMs / 1000);
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
