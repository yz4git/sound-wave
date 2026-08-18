import './styles.css';
import { SoundEngine } from './audio/SoundEngine';
import type { PlayerIntent } from './core/music';
import { advanceGame, createGameState, handleIntent, phaseInBar, startGame } from './game/GameEngine';
import { Renderer } from './ui/Renderer';

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
const chordEl = required<HTMLElement>('#chord');
const judgementEl = required<HTMLElement>('#judgement');
const intentButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-intent]'));

const renderer = new Renderer(canvas);
const sound = new SoundEngine({ tempo: 112 });
let state = createGameState();
let lastFrame = performance.now();
let previousStep = -1;
let flashTimer = 0;
let previousBar = -1;

function syncHud(): void {
  scoreEl.textContent = state.score.toLocaleString();
  comboEl.textContent = String(state.combo);
  flowEl.textContent = `${Math.round(state.flow * 100)}%`;
  bpmEl.textContent = String(Math.round(state.bpm));
  chordEl.textContent = `${state.music.chord.label}  ·  ${state.challenge.polyrhythm === 1 ? 'STRAIGHT' : `${state.challenge.polyrhythm}:4 POLY`}`;
  if (state.lastInput && flashTimer > 0) {
    judgementEl.textContent = `${state.lastInput.message}  +${state.lastInput.scoreDelta}`;
    judgementEl.classList.add('flash');
  } else {
    judgementEl.textContent = state.music.tension > 0.68
      ? 'TENSION HIGH — RESOLVE, DELAY OR BREAK IT'
      : state.music.tension < 0.32
        ? 'SPACE OPEN — BUILD TENSION'
        : 'READ THE PULSE — SHAPE THE NEXT STATE';
    judgementEl.classList.remove('flash');
  }
}

function pulseMetronome(): void {
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
    renderer.impact(0.22 + accent * 0.34);
  }
}

function applyIntent(intent: PlayerIntent, button?: HTMLButtonElement): void {
  if (!state.running) return;
  const beforeChord = state.music.chord.label;
  state = handleIntent(state, intent);
  const result = state.lastInput;
  if (!result) return;

  if (beforeChord !== state.music.chord.label) {
    sound.playChord(state.music.chord, state.music.tension);
  }
  sound.playIntentAccent(state.music.chord.root, result.flow);
  sound.playPercussion(result.judgement === 'miss' ? 'miss' : 'hit', Math.max(0.3, result.flow));
  renderer.impact(result.judgement === 'miss' ? 0.18 : result.flow);
  flashTimer = 0.55;

  if (navigator.vibrate && result.judgement !== 'miss') navigator.vibrate(result.judgement === 'perfect' ? 14 : 8);
  if (button) {
    button.classList.add('active');
    window.setTimeout(() => button.classList.remove('active'), 90);
  }
  syncHud();
}

async function begin(): Promise<void> {
  await sound.unlock();
  state = startGame(state);
  sound.playChord(state.music.chord, state.music.tension);
  startButton.classList.add('hidden');
  lastFrame = performance.now();
}

startButton.addEventListener('pointerdown', (event: PointerEvent) => {
  event.preventDefault();
  void begin();
}, { passive: false });

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
    const oldBar = state.bar;
    state = advanceGame(state, deltaMs);
    if (state.bar !== oldBar) {
      sound.setTempo(state.bpm);
      sound.playChord(state.music.chord, state.music.tension);
    }
    pulseMetronome();
  }
  flashTimer = Math.max(0, flashTimer - deltaMs / 1000);
  renderer.render(state, deltaMs / 1000);
  syncHud();
  requestAnimationFrame(frame);
}

syncHud();
requestAnimationFrame(frame);
