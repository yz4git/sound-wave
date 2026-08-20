import { pitchName, type Mode, type PitchClass } from '../core/music';
import {
  compositionLengthSteps,
  compositionStepMs,
  defaultComposeSettings,
  generateComposition,
  type AutoComposition,
  type AutoComposeSettings,
} from './AutoComposer';
import { ComposeAudio } from './ComposeAudio';
import {
  generateVocalLine,
  vocalSyllableAtStep,
  type VocalEvent,
  type VocalStyle,
} from './VocalGenerator';

const STORAGE_KEY = 'sound-wave-auto-compose-v1';
const VOCAL_STORAGE_KEY = 'sound-wave-auto-vocal-v1';
const MODES: readonly Mode[] = ['major', 'minor', 'dorian', 'phrygian', 'mixolydian'];
const PITCHES: readonly PitchClass[] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const VOCAL_STYLES: readonly VocalStyle[] = ['warm', 'bright', 'airy'];

export class AutoComposeMode {
  private readonly root: HTMLElement;
  private readonly audio = new ComposeAudio();
  private settings: AutoComposeSettings;
  private composition: AutoComposition;
  private vocalLine: VocalEvent[];
  private vocalEnabled: boolean;
  private vocalStyle: VocalStyle;
  private active = false;
  private playing = false;
  private nextStep = 0;
  private nextStepTime = 0;
  private schedulerId = 0;
  private visualStep = 0;

  constructor(root: HTMLElement) {
    this.root = root;
    this.settings = this.loadSettings();
    const vocal = this.loadVocalSettings();
    this.vocalEnabled = vocal.enabled;
    this.vocalStyle = vocal.style;
    this.composition = generateComposition(this.settings);
    this.vocalLine = generateVocalLine(this.composition);
    this.renderShell();
    this.bindEvents();
    this.renderComposition();
  }

  async activate(): Promise<void> {
    this.active = true;
    this.root.classList.add('active');
    this.root.setAttribute('aria-hidden', 'false');
    await this.audio.unlock();
    this.updateVisual(this.visualStep);
  }

  deactivate(): void {
    this.active = false;
    this.stop();
    this.audio.suspend();
    this.root.classList.remove('active');
    this.root.setAttribute('aria-hidden', 'true');
  }

  suspendAudio(): void {
    this.audio.suspend();
  }

  resumeAudio(): void {
    if (this.active) this.audio.resume();
  }

  private loadSettings(): AutoComposeSettings {
    const fallback = defaultComposeSettings();
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw) as Partial<AutoComposeSettings>;
      const tonic = PITCHES.includes(parsed.tonic as PitchClass) ? parsed.tonic as PitchClass : fallback.tonic;
      const mode = MODES.includes(parsed.mode as Mode) ? parsed.mode as Mode : fallback.mode;
      return {
        tonic,
        mode,
        bpm: Math.max(60, Math.min(180, Number(parsed.bpm) || fallback.bpm)),
        density: Math.max(0.15, Math.min(1, Number(parsed.density) || fallback.density)),
        bars: 8,
        seed: Number(parsed.seed) >>> 0 || fallback.seed,
      };
    } catch {
      return fallback;
    }
  }

  private loadVocalSettings(): { enabled: boolean; style: VocalStyle } {
    try {
      const raw = localStorage.getItem(VOCAL_STORAGE_KEY);
      if (!raw) return { enabled: true, style: 'warm' };
      const parsed = JSON.parse(raw) as { enabled?: unknown; style?: unknown };
      const style = VOCAL_STYLES.includes(parsed.style as VocalStyle) ? parsed.style as VocalStyle : 'warm';
      return { enabled: parsed.enabled !== false, style };
    } catch {
      return { enabled: true, style: 'warm' };
    }
  }

  private saveSettings(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
    } catch {
      // Storage may be unavailable in private/restricted Safari contexts.
    }
  }

  private saveVocalSettings(): void {
    try {
      localStorage.setItem(VOCAL_STORAGE_KEY, JSON.stringify({ enabled: this.vocalEnabled, style: this.vocalStyle }));
    } catch {
      // Storage may be unavailable in private/restricted Safari contexts.
    }
  }

  private renderShell(): void {
    const keyOptions = PITCHES.map((pitch) => `<option value="${pitch}">${pitchName(pitch)}</option>`).join('');
    const modeOptions = MODES.map((mode) => `<option value="${mode}">${mode.toUpperCase()}</option>`).join('');
    const vocalOptions = VOCAL_STYLES.map((style) => `<option value="${style}">${style.toUpperCase()}</option>`).join('');
    this.root.innerHTML = `
      <header class="compose-header">
        <div>
          <span class="compose-kicker">100% LOCAL · THEORY + CONTINUOUS VOCAL WORKLET</span>
          <h1>AUTO COMPOSE</h1>
          <p>No cloud model. Harmony, melody, bass, rhythm and a continuous synthesized singer are generated on this device.</p>
        </div>
        <div class="compose-transport">
          <button type="button" id="compose-play">▶ PLAY</button>
          <button type="button" id="compose-regenerate">↻ REGENERATE</button>
        </div>
      </header>
      <section class="compose-controls" aria-label="Composition settings">
        <label><span>KEY</span><select id="compose-key">${keyOptions}</select></label>
        <label><span>MODE</span><select id="compose-mode">${modeOptions}</select></label>
        <label><span id="compose-bpm-label">108 BPM</span><input id="compose-bpm" type="range" min="60" max="180" step="1" /></label>
        <label><span id="compose-density-label">DENSITY 55%</span><input id="compose-density" type="range" min="15" max="100" step="1" /></label>
        <label class="compose-vocal-toggle"><span>VOCAL</span><button type="button" id="compose-vocal-toggle">ON</button></label>
        <label><span>VOICE</span><select id="compose-vocal-style">${vocalOptions}</select></label>
      </section>
      <section class="compose-stage">
        <div class="compose-now">
          <span id="compose-title">MINOR CURRENT</span>
          <strong id="compose-chord">C · TONIC</strong>
          <small id="compose-theory">TONIC → BUILD → DOMINANT → RESOLVE</small>
        </div>
        <div class="compose-vocal-strip"><b>VOCAL</b><span id="compose-vocal-now">AUDIOWORKLET SINGER · INITIALIZING</span></div>
        <div class="compose-progress"><i id="compose-progress-fill"></i></div>
        <div id="compose-chords" class="compose-chords" aria-label="Generated chord progression"></div>
        <div class="compose-roll-wrap">
          <span class="compose-roll-label">MELODY + VOCAL</span>
          <div id="compose-roll" class="compose-roll"></div>
        </div>
        <div class="compose-explain">
          <b>WHY IT WORKS</b>
          <span>Strong beats prefer chord tones · one continuous glottal stream keeps phase and vocal-tract state across notes · formants and pitch glide shape the phrase.</span>
        </div>
      </section>
    `;

    this.required<HTMLSelectElement>('#compose-key').value = String(this.settings.tonic);
    this.required<HTMLSelectElement>('#compose-mode').value = this.settings.mode;
    this.required<HTMLInputElement>('#compose-bpm').value = String(this.settings.bpm);
    this.required<HTMLInputElement>('#compose-density').value = String(Math.round(this.settings.density * 100));
    this.required<HTMLSelectElement>('#compose-vocal-style').value = this.vocalStyle;
    this.syncControlLabels();
    this.syncVocalControl();
  }

  private required<T extends Element>(selector: string): T {
    const element = this.root.querySelector<T>(selector);
    if (!element) throw new Error(`Auto Compose UI is missing: ${selector}`);
    return element;
  }

  private bindEvents(): void {
    this.required<HTMLButtonElement>('#compose-play').addEventListener('pointerdown', (event) => {
      event.preventDefault();
      if (this.playing) this.stop();
      else void this.play();
    }, { passive: false });

    this.required<HTMLButtonElement>('#compose-regenerate').addEventListener('pointerdown', (event) => {
      event.preventDefault();
      this.regenerate();
    }, { passive: false });

    this.required<HTMLButtonElement>('#compose-vocal-toggle').addEventListener('pointerdown', (event) => {
      event.preventDefault();
      this.vocalEnabled = !this.vocalEnabled;
      if (!this.vocalEnabled) this.audio.clearVocalStream();
      this.saveVocalSettings();
      this.syncVocalControl();
      this.updateVisual(this.visualStep);
    }, { passive: false });

    this.required<HTMLSelectElement>('#compose-vocal-style').addEventListener('change', (event) => {
      this.vocalStyle = (event.target as HTMLSelectElement).value as VocalStyle;
      this.audio.clearVocalStream();
      this.saveVocalSettings();
      this.updateVisual(this.visualStep);
    });

    this.required<HTMLSelectElement>('#compose-key').addEventListener('change', (event) => {
      this.settings = { ...this.settings, tonic: Number((event.target as HTMLSelectElement).value) as PitchClass };
      this.rebuildFromControls();
    });
    this.required<HTMLSelectElement>('#compose-mode').addEventListener('change', (event) => {
      this.settings = { ...this.settings, mode: (event.target as HTMLSelectElement).value as Mode };
      this.rebuildFromControls();
    });
    this.required<HTMLInputElement>('#compose-bpm').addEventListener('input', (event) => {
      this.settings = { ...this.settings, bpm: Number((event.target as HTMLInputElement).value) };
      this.syncControlLabels();
    });
    this.required<HTMLInputElement>('#compose-bpm').addEventListener('change', () => this.rebuildFromControls());
    this.required<HTMLInputElement>('#compose-density').addEventListener('input', (event) => {
      this.settings = { ...this.settings, density: Number((event.target as HTMLInputElement).value) / 100 };
      this.syncControlLabels();
    });
    this.required<HTMLInputElement>('#compose-density').addEventListener('change', () => this.rebuildFromControls());
    this.root.addEventListener('contextmenu', (event) => event.preventDefault());
  }

  private syncControlLabels(): void {
    this.required<HTMLElement>('#compose-bpm-label').textContent = `${Math.round(this.settings.bpm)} BPM`;
    this.required<HTMLElement>('#compose-density-label').textContent = `DENSITY ${Math.round(this.settings.density * 100)}%`;
  }

  private syncVocalControl(): void {
    const button = this.required<HTMLButtonElement>('#compose-vocal-toggle');
    button.textContent = this.vocalEnabled ? 'ON' : 'OFF';
    button.classList.toggle('active', this.vocalEnabled);
  }

  private rebuildFromControls(): void {
    const wasPlaying = this.playing;
    this.stop();
    this.composition = generateComposition(this.settings);
    this.vocalLine = generateVocalLine(this.composition);
    this.saveSettings();
    this.renderComposition();
    if (wasPlaying && this.active) void this.play();
  }

  private regenerate(): void {
    this.settings = { ...this.settings, seed: (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0 };
    this.rebuildFromControls();
  }

  private renderComposition(): void {
    this.required<HTMLElement>('#compose-title').textContent = this.composition.title;
    const chords = this.required<HTMLElement>('#compose-chords');
    chords.replaceChildren();
    for (const item of this.composition.chords) {
      const cell = document.createElement('div');
      cell.className = 'compose-chord-cell';
      cell.dataset.composeBar = String(item.bar);
      cell.innerHTML = `<span>BAR ${item.bar + 1}</span><b>${item.chord.label.replace(' · ', '<br>')}</b><em>${item.chord.function.toUpperCase()}</em>`;
      chords.append(cell);
    }

    const roll = this.required<HTMLElement>('#compose-roll');
    roll.replaceChildren();
    const length = compositionLengthSteps(this.composition);
    for (const note of this.composition.melody) {
      const dot = document.createElement('i');
      dot.className = 'compose-note';
      dot.style.left = `${note.step / length * 100}%`;
      dot.style.bottom = `${12 + (note.pitch / 11) * 72}%`;
      dot.style.width = `${Math.max(0.6, note.durationSteps / length * 100)}%`;
      dot.dataset.step = String(note.step);
      roll.append(dot);
    }
    for (const vocal of this.vocalLine) {
      const marker = document.createElement('i');
      marker.className = 'compose-vocal-note';
      marker.style.left = `${vocal.step / length * 100}%`;
      marker.style.bottom = `${12 + (vocal.pitch / 11) * 72}%`;
      marker.style.width = `${Math.max(0.8, vocal.durationSteps / length * 100)}%`;
      marker.dataset.vocalStep = String(vocal.step);
      marker.title = vocal.syllable;
      roll.append(marker);
    }
    this.updateVisual(0);
  }

  private async play(): Promise<void> {
    await this.audio.unlock();
    if (!this.active) return;
    this.audio.clearVocalStream();
    this.playing = true;
    this.nextStep = 0;
    this.visualStep = 0;
    this.nextStepTime = this.audio.currentTime + 0.07;
    this.required<HTMLButtonElement>('#compose-play').textContent = '■ STOP';
    this.required<HTMLButtonElement>('#compose-play').classList.add('playing');
    this.startScheduler();
  }

  private stop(): void {
    this.playing = false;
    if (this.schedulerId) window.clearInterval(this.schedulerId);
    this.schedulerId = 0;
    this.audio.clearVocalStream();
    const playButton = this.root.querySelector<HTMLButtonElement>('#compose-play');
    if (playButton) {
      playButton.textContent = '▶ PLAY';
      playButton.classList.remove('playing');
    }
    this.updateVisual(0);
  }

  private startScheduler(): void {
    if (this.schedulerId) window.clearInterval(this.schedulerId);
    this.schedulerId = window.setInterval(() => this.scheduleAhead(), 25);
    this.scheduleAhead();
  }

  private scheduleAhead(): void {
    if (!this.playing || !this.audio.isReady) return;
    const stepSeconds = compositionStepMs(this.composition) / 1000;
    const length = compositionLengthSteps(this.composition);
    const horizon = this.audio.currentTime + 0.12;
    while (this.nextStepTime <= horizon) {
      const scheduledStep = this.nextStep;
      const when = this.nextStepTime;
      this.audio.scheduleStep(
        this.composition,
        scheduledStep,
        when,
        this.vocalEnabled ? this.vocalLine : [],
        this.vocalStyle,
      );
      const visualDelay = Math.max(0, (when - this.audio.currentTime) * 1000);
      window.setTimeout(() => {
        if (this.playing) this.updateVisual(scheduledStep);
      }, visualDelay);
      this.nextStep = (this.nextStep + 1) % length;
      this.nextStepTime += stepSeconds;
    }
  }

  private updateVisual(step: number): void {
    this.visualStep = step;
    const length = compositionLengthSteps(this.composition);
    const bar = Math.floor(step / 16);
    const chord = this.composition.chords[bar]?.chord ?? this.composition.chords[0]?.chord;
    if (chord) this.required<HTMLElement>('#compose-chord').textContent = chord.label.toUpperCase();
    this.required<HTMLElement>('#compose-progress-fill').style.width = `${step / Math.max(1, length - 1) * 100}%`;
    for (const cell of this.root.querySelectorAll<HTMLElement>('[data-compose-bar]')) {
      cell.classList.toggle('active', Number(cell.dataset.composeBar) === bar && this.playing);
    }
    for (const note of this.root.querySelectorAll<HTMLElement>('.compose-note')) {
      const noteStep = Number(note.dataset.step);
      note.classList.toggle('active', this.playing && Math.abs(noteStep - this.visualStep) <= 1);
    }
    for (const vocal of this.root.querySelectorAll<HTMLElement>('.compose-vocal-note')) {
      const vocalStep = Number(vocal.dataset.vocalStep);
      vocal.classList.toggle('active', this.vocalEnabled && this.playing && Math.abs(vocalStep - this.visualStep) <= 1);
      vocal.classList.toggle('muted', !this.vocalEnabled);
    }

    const vocalStatus = this.audio.vocalEngineStatus;
    const syllable = this.vocalEnabled && this.playing ? vocalSyllableAtStep(this.vocalLine, step) : '';
    this.required<HTMLElement>('#compose-vocal-now').textContent = !this.vocalEnabled
      ? 'OFF · INSTRUMENTAL ONLY'
      : vocalStatus === 'unavailable'
        ? 'AUDIOWORKLET UNAVAILABLE · INSTRUMENTAL FALLBACK'
        : vocalStatus !== 'ready'
          ? 'AUDIOWORKLET SINGER · INITIALIZING'
          : syllable
            ? `${this.vocalStyle.toUpperCase()} · STREAMING “${syllable.toUpperCase()}”`
            : `${this.vocalStyle.toUpperCase()} · CONTINUOUS AUDIOWORKLET SINGER`;
  }
}
