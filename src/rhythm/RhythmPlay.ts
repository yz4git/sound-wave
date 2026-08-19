import { JamAudio } from '../jam/JamAudio';
import {
  RHYTHM_MINIGAMES,
  advanceRhythmPlay,
  createRhythmPlayState,
  rhythmAccuracy,
  rhythmBeatMs,
  rhythmRank,
  submitRhythmInput,
  type RhythmInput,
  type RhythmJudgement,
  type RhythmMiniGameId,
  type RhythmPlayState,
} from './RhythmPlayEngine';

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
  })[character] ?? character);
}

export class RhythmPlay {
  private readonly root: HTMLElement;
  private readonly audio = new JamAudio();
  private active = false;
  private state: RhythmPlayState | null = null;
  private startedAt = 0;
  private frameId = 0;
  private seed = 0x51f15e;
  private readonly scheduledCueIds = new Set<number>();
  private holding = false;

  constructor(root: HTMLElement) {
    this.root = root;
    this.renderShell();
    this.bindEvents();
    this.showMenu();
  }

  async activate(): Promise<void> {
    this.active = true;
    this.root.classList.add('active');
    this.root.setAttribute('aria-hidden', 'false');
    await this.audio.unlock();
    this.startedAt = performance.now() - (this.state?.elapsedMs ?? 0);
    this.startLoop();
  }

  deactivate(): void {
    this.active = false;
    this.audio.suspend();
    if (this.frameId) cancelAnimationFrame(this.frameId);
    this.frameId = 0;
    this.root.classList.remove('active');
    this.root.setAttribute('aria-hidden', 'true');
  }

  suspendAudio(): void {
    this.audio.suspend();
  }

  resumeAudio(): void {
    if (!this.active) return;
    this.audio.resume();
    this.startedAt = performance.now() - (this.state?.elapsedMs ?? 0);
  }

  private renderShell(): void {
    this.root.innerHTML = `
      <header class="rhythm-header">
        <div>
          <span class="rhythm-kicker">QUICK RHYTHM GAMES</span>
          <h1>RHYTHM PLAY</h1>
          <p>Listen. React. Smile. Every game uses only one or two simple actions.</p>
        </div>
        <div class="rhythm-session-metric"><span>BEST COMBO</span><b id="rhythm-best">0</b></div>
      </header>
      <section class="rhythm-menu" id="rhythm-menu" aria-label="Choose a rhythm minigame"></section>
      <section class="rhythm-stage" id="rhythm-stage" aria-hidden="true">
        <div class="rhythm-stage-top">
          <button type="button" id="rhythm-back">‹ GAMES</button>
          <div class="rhythm-stage-copy">
            <span id="rhythm-subtitle">ONE BUTTON</span>
            <strong id="rhythm-title">BEAT POP</strong>
            <small id="rhythm-instruction">Tap on the beat.</small>
          </div>
          <div class="rhythm-score"><span>SCORE</span><b id="rhythm-score">0</b></div>
          <div class="rhythm-score"><span>COMBO</span><b id="rhythm-combo">0</b></div>
        </div>
        <div class="rhythm-progress"><i id="rhythm-progress-fill"></i></div>
        <div class="rhythm-playfield" id="rhythm-playfield">
          <div class="rhythm-orbit" aria-hidden="true"><i></i><span></span></div>
          <div class="rhythm-character" id="rhythm-character" aria-hidden="true"><span>♪</span></div>
          <div class="echo-display" id="echo-display" aria-hidden="true"><span>L</span><b>LISTEN</b><span>R</span></div>
          <div class="hold-display" id="hold-display" aria-hidden="true"><span></span><b>READY</b></div>
          <div class="rhythm-feedback" id="rhythm-feedback">GET READY</div>
          <div class="rhythm-actions" id="rhythm-actions"></div>
          <div class="rhythm-result" id="rhythm-result" aria-hidden="true">
            <span id="rhythm-result-kicker">FINISH</span>
            <strong id="rhythm-rank">SUPERB</strong>
            <p id="rhythm-result-copy">100% timing</p>
            <div><button type="button" id="rhythm-retry">RETRY</button><button type="button" id="rhythm-next">NEXT GAME</button></div>
          </div>
        </div>
      </section>
    `;

    const menu = this.required<HTMLElement>('#rhythm-menu');
    for (const game of RHYTHM_MINIGAMES) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `rhythm-game-card ${game.id}`;
      button.dataset.rhythmGame = game.id;
      const icon = game.id === 'beat-pop' ? '●' : game.id === 'echo-pair' ? 'L↔R' : '▰';
      button.innerHTML = `<i>${icon}</i><span>${escapeHtml(game.subtitle)}</span><b>${escapeHtml(game.title)}</b><small>${escapeHtml(game.instruction)}</small><em>${game.bpm} BPM · 10–20 SEC</em>`;
      menu.append(button);
    }
  }

  private required<T extends Element>(selector: string): T {
    const element = this.root.querySelector<T>(selector);
    if (!element) throw new Error(`Rhythm Play UI is missing: ${selector}`);
    return element;
  }

  private bindEvents(): void {
    this.root.addEventListener('pointerdown', (event) => {
      const target = event.target as HTMLElement;
      const gameButton = target.closest<HTMLButtonElement>('[data-rhythm-game]');
      if (gameButton?.dataset.rhythmGame) {
        event.preventDefault();
        this.startGame(gameButton.dataset.rhythmGame as RhythmMiniGameId);
        return;
      }

      const inputButton = target.closest<HTMLButtonElement>('[data-rhythm-input]');
      if (inputButton?.dataset.rhythmInput) {
        event.preventDefault();
        const input = inputButton.dataset.rhythmInput as RhythmInput;
        if (input === 'hold-start') this.holding = true;
        this.submit(input);
        inputButton.classList.add('pressed');
        window.setTimeout(() => inputButton.classList.remove('pressed'), 90);
      }
    }, { passive: false });

    this.root.addEventListener('pointerup', (event) => {
      if (!this.holding) return;
      const target = event.target as HTMLElement;
      const holdButton = target.closest<HTMLButtonElement>('[data-rhythm-input="hold-start"]');
      if (!holdButton) return;
      event.preventDefault();
      this.holding = false;
      this.submit('hold-end');
    }, { passive: false });

    this.root.addEventListener('pointercancel', () => {
      if (!this.holding) return;
      this.holding = false;
      this.submit('hold-end');
    });

    this.required<HTMLButtonElement>('#rhythm-back').addEventListener('pointerdown', (event) => {
      event.preventDefault();
      this.showMenu();
    }, { passive: false });

    this.required<HTMLButtonElement>('#rhythm-retry').addEventListener('pointerdown', (event) => {
      event.preventDefault();
      if (this.state) this.startGame(this.state.game.id);
    }, { passive: false });

    this.required<HTMLButtonElement>('#rhythm-next').addEventListener('pointerdown', (event) => {
      event.preventDefault();
      if (!this.state) return;
      const index = RHYTHM_MINIGAMES.findIndex((game) => game.id === this.state?.game.id);
      const next = RHYTHM_MINIGAMES[(index + 1) % RHYTHM_MINIGAMES.length];
      if (next) this.startGame(next.id);
    }, { passive: false });

    this.root.addEventListener('contextmenu', (event) => event.preventDefault());
  }

  private showMenu(): void {
    this.state = null;
    this.holding = false;
    this.scheduledCueIds.clear();
    this.required<HTMLElement>('#rhythm-menu').classList.add('active');
    const stage = this.required<HTMLElement>('#rhythm-stage');
    stage.classList.remove('active');
    stage.setAttribute('aria-hidden', 'true');
  }

  private startGame(id: RhythmMiniGameId): void {
    this.seed = (Math.imul(this.seed ^ Date.now(), 1664525) + 1013904223) >>> 0;
    this.state = createRhythmPlayState(id, this.seed);
    this.startedAt = performance.now();
    this.scheduledCueIds.clear();
    this.holding = false;
    this.required<HTMLElement>('#rhythm-menu').classList.remove('active');
    const stage = this.required<HTMLElement>('#rhythm-stage');
    stage.className = `rhythm-stage active ${id}`;
    stage.setAttribute('aria-hidden', 'false');
    this.required<HTMLElement>('#rhythm-title').textContent = this.state.game.title;
    this.required<HTMLElement>('#rhythm-subtitle').textContent = this.state.game.subtitle;
    this.required<HTMLElement>('#rhythm-instruction').textContent = this.state.game.instruction;
    this.required<HTMLElement>('#rhythm-feedback').textContent = 'GET READY';
    this.required<HTMLElement>('#rhythm-result').setAttribute('aria-hidden', 'true');
    this.required<HTMLElement>('#rhythm-result').classList.remove('visible');
    this.buildActions(id);
    void this.audio.unlock();
    this.renderState();
    this.startLoop();
  }

  private buildActions(id: RhythmMiniGameId): void {
    const actions = this.required<HTMLElement>('#rhythm-actions');
    actions.replaceChildren();
    if (id === 'beat-pop') {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'rhythm-big-button beat-button';
      button.dataset.rhythmInput = 'tap';
      button.innerHTML = '<b>TAP</b><span>ON THE BOUNCE</span>';
      actions.append(button);
      return;
    }
    if (id === 'echo-pair') {
      for (const side of ['left', 'right'] as const) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `rhythm-side-button ${side}`;
        button.dataset.rhythmInput = side;
        button.innerHTML = `<b>${side === 'left' ? 'L' : 'R'}</b><span>${side.toUpperCase()}</span>`;
        actions.append(button);
      }
      return;
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'rhythm-big-button hold-button';
    button.dataset.rhythmInput = 'hold-start';
    button.innerHTML = '<b>HOLD</b><span>PRESS · WAIT · RELEASE</span>';
    actions.append(button);
  }

  private startLoop(): void {
    if (!this.active || this.frameId) return;
    const loop = (): void => {
      this.frameId = 0;
      if (!this.active) return;
      this.tick();
      this.frameId = requestAnimationFrame(loop);
    };
    this.frameId = requestAnimationFrame(loop);
  }

  private tick(): void {
    if (!this.state || this.state.finished) return;
    const elapsedMs = performance.now() - this.startedAt;
    this.state = advanceRhythmPlay(this.state, elapsedMs);
    this.scheduleCues(elapsedMs);
    this.renderState();
    if (this.state.finished) this.finishGame();
  }

  private scheduleCues(elapsedMs: number): void {
    if (!this.state || !this.audio.isReady) return;
    const lookaheadMs = 90;
    for (const cue of this.state.cues) {
      if (this.scheduledCueIds.has(cue.id)) continue;
      if (cue.timeMs > elapsedMs + lookaheadMs) continue;
      const delaySeconds = Math.max(0, cue.timeMs - elapsedMs) / 1000;
      this.audio.playVoice(cue.voice, cue.strength, this.audio.currentTime + delaySeconds);
      this.scheduledCueIds.add(cue.id);
    }
  }

  private submit(input: RhythmInput): void {
    if (!this.state || this.state.finished) return;
    const elapsedMs = performance.now() - this.startedAt;
    const result = submitRhythmInput(this.state, input, elapsedMs);
    this.state = result.state;
    this.playJudgement(result.judgement);
    this.renderState();
    if (navigator.vibrate && result.judgement !== 'miss') {
      navigator.vibrate(result.judgement === 'perfect' ? 11 : 6);
    }
    if (this.state.finished) this.finishGame();
  }

  private playJudgement(judgement: RhythmJudgement): void {
    if (judgement === 'perfect') this.audio.playVoice('clap', 0.9);
    else if (judgement === 'good') this.audio.playVoice('hat', 0.75);
    else if (judgement === 'okay') this.audio.playVoice('tom-high', 0.62);
    else this.audio.playVoice('snare', 0.38);
  }

  private renderState(): void {
    if (!this.state) return;
    const state = this.state;
    const beatMs = rhythmBeatMs(state.game.bpm);
    const beatPhase = ((state.elapsedMs % beatMs) + beatMs) % beatMs / beatMs;
    const durationMs = state.game.durationBeats * beatMs;
    const progress = clamp01(state.elapsedMs / durationMs);
    const playfield = this.required<HTMLElement>('#rhythm-playfield');
    playfield.style.setProperty('--rhythm-phase', beatPhase.toFixed(4));
    playfield.style.setProperty('--rhythm-progress', progress.toFixed(4));
    playfield.classList.toggle('holding', this.holding);
    this.required<HTMLElement>('#rhythm-score').textContent = state.score.toLocaleString();
    this.required<HTMLElement>('#rhythm-combo').textContent = String(state.combo);
    this.required<HTMLElement>('#rhythm-best').textContent = String(state.maxCombo);
    this.required<HTMLElement>('#rhythm-progress-fill').style.width = `${Math.round(progress * 100)}%`;

    const feedback = this.required<HTMLElement>('#rhythm-feedback');
    feedback.className = `rhythm-feedback ${state.lastJudgement ?? ''}`;
    feedback.textContent = state.lastJudgement
      ? state.lastJudgement === 'perfect' ? 'PERFECT!'
        : state.lastJudgement === 'good' ? 'GOOD!'
          : state.lastJudgement === 'okay' ? 'OK!'
            : 'MISS'
      : 'GET READY';

    this.renderGameSpecific();
  }

  private renderGameSpecific(): void {
    if (!this.state) return;
    const state = this.state;
    const beatMs = rhythmBeatMs(state.game.bpm);
    const echo = this.required<HTMLElement>('#echo-display');
    const hold = this.required<HTMLElement>('#hold-display');
    echo.classList.toggle('visible', state.game.id === 'echo-pair');
    hold.classList.toggle('visible', state.game.id === 'hold-release');

    if (state.game.id === 'echo-pair') {
      const callEnd = 6 * beatMs;
      const responseStart = 7 * beatMs;
      const label = echo.querySelector<HTMLElement>('b');
      if (label) label.textContent = state.elapsedMs < callEnd ? 'LISTEN' : state.elapsedMs < responseStart ? 'YOUR TURN…' : 'ANSWER';
      const nearestCue = state.cues
        .filter((cue) => cue.side !== 'center')
        .reduce<{ side: 'left' | 'right'; distance: number } | null>((best, cue) => {
          const distance = Math.abs(cue.timeMs - state.elapsedMs);
          if (distance > 180) return best;
          if (!best || distance < best.distance) return { side: cue.side as 'left' | 'right', distance };
          return best;
        }, null);
      echo.classList.toggle('cue-left', nearestCue?.side === 'left');
      echo.classList.toggle('cue-right', nearestCue?.side === 'right');
    }

    if (state.game.id === 'hold-release') {
      const label = hold.querySelector<HTMLElement>('b');
      if (label) label.textContent = this.holding ? 'HOLD…' : 'READY';
      const next = state.targets.find((target) => !target.resolved);
      hold.classList.toggle('release-soon', Boolean(next && next.input === 'hold-end' && next.timeMs - state.elapsedMs < 420));
    }
  }

  private finishGame(): void {
    if (!this.state) return;
    const result = this.required<HTMLElement>('#rhythm-result');
    const rank = rhythmRank(this.state);
    const accuracy = Math.round(rhythmAccuracy(this.state) * 100);
    this.required<HTMLElement>('#rhythm-rank').textContent = rank;
    this.required<HTMLElement>('#rhythm-result-kicker').textContent = rank === 'SUPERB' ? 'THAT FELT GOOD' : 'MINIGAME COMPLETE';
    this.required<HTMLElement>('#rhythm-result-copy').textContent = `${accuracy}% TIMING · SCORE ${this.state.score.toLocaleString()} · MAX COMBO ${this.state.maxCombo}`;
    result.classList.add('visible');
    result.setAttribute('aria-hidden', 'false');
    if (rank === 'SUPERB') {
      this.audio.playVoice('stab', 1);
      window.setTimeout(() => this.audio.playVoice('clap', 0.95), 90);
    } else if (rank === 'GREAT') this.audio.playVoice('stab', 0.8);
  }
}
