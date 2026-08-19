import { JamAudio } from './JamAudio';
import {
  FINGER_DRUM_VOICES,
  JAM_STEPS,
  SEQUENCER_VOICES,
  advanceJamStep,
  clearJamPattern,
  createJamState,
  cycleStepVelocity,
  jamStepDurationMs,
  randomizeJamPattern,
  restoreJamState,
  serializeJamState,
  setJamMode,
  setJamSwing,
  setJamTempo,
  stopJamTransport,
  swingDelayMs,
  toggleJamTransport,
  triggersForStep,
  type JamMode,
  type JamState,
  type JamVoice,
  type SequencerVoice,
} from './JamMachine';

const STORAGE_KEY = 'sound-wave-jam-v1';
const SAMPLE_DB = 'sound-wave-jam-samples';
const SAMPLE_STORE = 'samples';

interface StoredSample {
  slot: number;
  name: string;
  type: string;
  bytes: ArrayBuffer;
}

function required<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Jam Lab UI is missing: ${selector}`);
  return element;
}

function readSavedState(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function persistState(state: JamState): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, serializeJamState(state));
  } catch {
    // Jam Lab remains fully playable if storage is unavailable.
  }
}

function openSampleDatabase(): Promise<IDBDatabase | null> {
  if (!('indexedDB' in window)) return Promise.resolve(null);
  return new Promise((resolve) => {
    const request = indexedDB.open(SAMPLE_DB, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SAMPLE_STORE)) db.createObjectStore(SAMPLE_STORE, { keyPath: 'slot' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

async function saveStoredSample(sample: StoredSample): Promise<void> {
  const db = await openSampleDatabase();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const transaction = db.transaction(SAMPLE_STORE, 'readwrite');
    transaction.objectStore(SAMPLE_STORE).put(sample);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => resolve();
    transaction.onabort = () => resolve();
  });
  db.close();
}

async function readStoredSamples(): Promise<StoredSample[]> {
  const db = await openSampleDatabase();
  if (!db) return [];
  const result = await new Promise<StoredSample[]>((resolve) => {
    const request = db.transaction(SAMPLE_STORE, 'readonly').objectStore(SAMPLE_STORE).getAll();
    request.onsuccess = () => resolve((request.result as StoredSample[]) ?? []);
    request.onerror = () => resolve([]);
  });
  db.close();
  return result;
}

async function deleteStoredSample(slot: number): Promise<void> {
  const db = await openSampleDatabase();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const transaction = db.transaction(SAMPLE_STORE, 'readwrite');
    transaction.objectStore(SAMPLE_STORE).delete(slot);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => resolve();
    transaction.onabort = () => resolve();
  });
  db.close();
}

function shortName(name: string): string {
  const trimmed = name.replace(/\.[^/.]+$/, '').trim();
  if (!trimmed) return 'SAMPLE';
  return trimmed.length > 13 ? `${trimmed.slice(0, 12)}…` : trimmed;
}

function voiceLabel(voice: JamVoice): string {
  switch (voice) {
    case 'kick': return 'KICK';
    case 'snare': return 'SNARE';
    case 'hat': return 'HI-HAT';
    case 'clap': return 'CLAP';
    case 'tom-low': return 'LOW TOM';
    case 'tom-high': return 'HIGH TOM';
    case 'bass': return 'BASS';
    case 'stab': return 'STAB';
  }
}

export class JamLab {
  private readonly root: HTMLElement;
  private readonly audio = new JamAudio();
  private state: JamState = restoreJamState(readSavedState());
  private active = false;
  private schedulerId: number | null = null;
  private nextStepTime = 0;
  private scheduledStep = 0;
  private readonly pendingStoredSamples = new Map<number, StoredSample>();
  private pendingLoadSlot = 0;

  private readonly panels: Record<JamMode, HTMLElement>;
  private readonly modeButtons: HTMLButtonElement[];
  private readonly sequencerGrid: HTMLElement;
  private readonly playButton: HTMLButtonElement;
  private readonly bpmInput: HTMLInputElement;
  private readonly bpmValue: HTMLElement;
  private readonly swingInput: HTMLInputElement;
  private readonly swingValue: HTMLElement;
  private readonly fileInput: HTMLInputElement;
  private readonly sampleNameEls: HTMLElement[];

  constructor(root: HTMLElement) {
    this.root = root;
    this.panels = {
      'drum-machine': required(root, '[data-jam-panel="drum-machine"]'),
      'finger-drum': required(root, '[data-jam-panel="finger-drum"]'),
      sampler: required(root, '[data-jam-panel="sampler"]'),
    };
    this.modeButtons = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-jam-mode]'));
    this.sequencerGrid = required(root, '#jam-sequencer-grid');
    this.playButton = required(root, '#jam-play');
    this.bpmInput = required(root, '#jam-bpm');
    this.bpmValue = required(root, '#jam-bpm-value');
    this.swingInput = required(root, '#jam-swing');
    this.swingValue = required(root, '#jam-swing-value');
    this.fileInput = required(root, '#jam-sample-file');
    this.sampleNameEls = Array.from(root.querySelectorAll<HTMLElement>('[data-sample-name]'));
    this.buildSequencer();
    this.bindControls();
    this.syncAll();
    void this.prepareStoredSamples();
  }

  get mode(): JamMode {
    return this.state.mode;
  }

  async activate(): Promise<void> {
    this.active = true;
    this.root.classList.add('active');
    this.root.setAttribute('aria-hidden', 'false');
    await this.audio.unlock();
    await this.decodePendingSamples();
    if (this.state.playing) this.startScheduler();
  }

  deactivate(): void {
    this.active = false;
    this.stopScheduler();
    this.state = stopJamTransport(this.state);
    this.syncTransport();
    this.root.classList.remove('active');
    this.root.setAttribute('aria-hidden', 'true');
    this.audio.suspend();
  }

  resumeAudio(): void {
    if (this.active) this.audio.resume();
  }

  suspendAudio(): void {
    this.audio.suspend();
  }

  private async prepareStoredSamples(): Promise<void> {
    for (const sample of await readStoredSamples()) {
      if (sample.slot < 0 || sample.slot > 7 || !(sample.bytes instanceof ArrayBuffer)) continue;
      this.pendingStoredSamples.set(sample.slot, sample);
      this.setSampleLabel(sample.slot, `${shortName(sample.name)} · SAVED`);
    }
  }

  private async decodePendingSamples(): Promise<void> {
    const entries = [...this.pendingStoredSamples.entries()];
    for (const [slot, sample] of entries) {
      try {
        const duration = await this.audio.loadSample(slot, sample.bytes);
        this.setSampleLabel(slot, `${shortName(sample.name)} · ${duration.toFixed(1)}s`);
        this.pendingStoredSamples.delete(slot);
      } catch {
        this.setSampleLabel(slot, 'LOAD FAILED');
      }
    }
  }

  private buildSequencer(): void {
    this.sequencerGrid.replaceChildren();
    for (const voice of SEQUENCER_VOICES) {
      const row = document.createElement('div');
      row.className = 'seq-row';
      row.dataset.voice = voice;
      const label = document.createElement('span');
      label.className = 'seq-label';
      label.textContent = voiceLabel(voice);
      row.append(label);
      for (let step = 0; step < JAM_STEPS; step += 1) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'seq-step';
        button.dataset.voice = voice;
        button.dataset.step = String(step);
        button.setAttribute('aria-label', `${voiceLabel(voice)} step ${step + 1}`);
        button.addEventListener('pointerdown', (event) => {
          event.preventDefault();
          this.state = cycleStepVelocity(this.state, voice, step);
          persistState(this.state);
          this.syncSequencer();
          void this.audio.unlock().then(() => this.audio.playVoice(voice, this.state.pattern[voice][step] || 0.72));
        }, { passive: false });
        row.append(button);
      }
      this.sequencerGrid.append(row);
    }
  }

  private bindControls(): void {
    for (const button of this.modeButtons) {
      button.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        const mode = button.dataset.jamMode as JamMode | undefined;
        if (!mode) return;
        this.state = setJamMode(this.state, mode);
        this.syncMode();
      }, { passive: false });
    }

    this.playButton.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      void this.toggleTransport();
    }, { passive: false });

    required<HTMLButtonElement>(this.root, '#jam-clear').addEventListener('pointerdown', (event) => {
      event.preventDefault();
      this.state = clearJamPattern(this.state);
      persistState(this.state);
      this.syncSequencer();
    }, { passive: false });

    required<HTMLButtonElement>(this.root, '#jam-random').addEventListener('pointerdown', (event) => {
      event.preventDefault();
      this.state = randomizeJamPattern(this.state);
      persistState(this.state);
      this.syncSequencer();
    }, { passive: false });

    this.bpmInput.addEventListener('input', () => {
      this.state = setJamTempo(this.state, Number(this.bpmInput.value));
      persistState(this.state);
      this.syncTempo();
      if (this.state.playing) this.restartScheduler();
    });

    this.swingInput.addEventListener('input', () => {
      this.state = setJamSwing(this.state, Number(this.swingInput.value) / 100);
      persistState(this.state);
      this.syncTempo();
    });

    const fingerPads = Array.from(this.root.querySelectorAll<HTMLButtonElement>('[data-jam-voice]'));
    for (const pad of fingerPads) {
      pad.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        const voice = pad.dataset.jamVoice as JamVoice | undefined;
        if (!voice) return;
        void this.hitVoicePad(pad, voice, event.pressure > 0 ? 0.65 + event.pressure * 0.35 : 0.92);
      }, { passive: false });
      pad.addEventListener('contextmenu', (event) => event.preventDefault());
    }

    const samplePads = Array.from(this.root.querySelectorAll<HTMLButtonElement>('[data-sample-pad]'));
    for (const pad of samplePads) {
      pad.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        const slot = Number(pad.dataset.samplePad);
        if (!Number.isInteger(slot)) return;
        void this.hitSamplePad(pad, slot, event.pressure > 0 ? 0.68 + event.pressure * 0.32 : 0.95);
      }, { passive: false });
    }

    const loadButtons = Array.from(this.root.querySelectorAll<HTMLButtonElement>('[data-sample-load]'));
    for (const button of loadButtons) {
      button.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        this.pendingLoadSlot = Number(button.dataset.sampleLoad) || 0;
        this.fileInput.value = '';
        this.fileInput.click();
      }, { passive: false });
    }

    const clearButtons = Array.from(this.root.querySelectorAll<HTMLButtonElement>('[data-sample-clear]'));
    for (const button of clearButtons) {
      button.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        const slot = Number(button.dataset.sampleClear) || 0;
        this.audio.clearSample(slot);
        this.pendingStoredSamples.delete(slot);
        this.setSampleLabel(slot, 'EMPTY · LOAD AUDIO');
        void deleteStoredSample(slot);
      }, { passive: false });
    }

    this.fileInput.addEventListener('change', () => {
      const file = this.fileInput.files?.[0];
      if (!file) return;
      void this.loadFileIntoSlot(this.pendingLoadSlot, file);
    });

    window.addEventListener('keydown', (event) => {
      if (!this.active || event.repeat) return;
      const fingerKeys = ['q', 'w', 'e', 'r', 'a', 's', 'd', 'f'];
      const fingerIndex = fingerKeys.indexOf(event.key.toLowerCase());
      if (this.state.mode === 'finger-drum' && fingerIndex >= 0) {
        const voice = FINGER_DRUM_VOICES[fingerIndex];
        const pad = this.root.querySelector<HTMLButtonElement>(`[data-jam-voice="${voice}"]`);
        if (voice && pad) {
          event.preventDefault();
          void this.hitVoicePad(pad, voice, 0.92);
        }
      }
      if (this.state.mode === 'sampler') {
        const sampleIndex = Number.parseInt(event.key, 10) - 1;
        if (sampleIndex >= 0 && sampleIndex < 8) {
          const pad = this.root.querySelector<HTMLButtonElement>(`[data-sample-pad="${sampleIndex}"]`);
          if (pad) {
            event.preventDefault();
            void this.hitSamplePad(pad, sampleIndex, 0.95);
          }
        }
      }
      if (event.code === 'Space' && this.state.mode === 'drum-machine') {
        event.preventDefault();
        void this.toggleTransport();
      }
    });
  }

  private async toggleTransport(): Promise<void> {
    await this.audio.unlock();
    this.state = toggleJamTransport(this.state);
    if (this.state.playing) this.startScheduler();
    else this.stopScheduler();
    this.syncTransport();
  }

  private restartScheduler(): void {
    if (!this.state.playing) return;
    this.stopScheduler();
    this.startScheduler();
  }

  private startScheduler(): void {
    if (!this.active || !this.state.playing || this.schedulerId !== null) return;
    this.scheduledStep = this.state.step;
    this.nextStepTime = this.audio.currentTime + 0.045;
    this.schedulerId = window.setInterval(() => this.scheduleAhead(), 22);
    this.scheduleAhead();
  }

  private stopScheduler(): void {
    if (this.schedulerId !== null) window.clearInterval(this.schedulerId);
    this.schedulerId = null;
  }

  private scheduleAhead(): void {
    if (!this.active || !this.state.playing || !this.audio.isReady) return;
    const lookahead = this.audio.currentTime + 0.11;
    let guard = 0;
    while (this.nextStepTime < lookahead && guard < 8) {
      const step = this.scheduledStep;
      const swing = swingDelayMs(this.state, step) / 1000;
      const audibleTime = this.nextStepTime + swing;
      const scheduledState = { ...this.state, step };
      for (const trigger of triggersForStep(scheduledState, step)) {
        this.audio.playVoice(trigger.voice, trigger.velocity, audibleTime);
      }
      const delayMs = Math.max(0, (audibleTime - this.audio.currentTime) * 1000);
      window.setTimeout(() => {
        if (!this.active || !this.state.playing) return;
        this.state = { ...this.state, step };
        this.syncPlayhead();
      }, delayMs);
      this.scheduledStep = (this.scheduledStep + 1) % JAM_STEPS;
      this.nextStepTime += jamStepDurationMs(this.state.bpm) / 1000;
      guard += 1;
    }
  }

  private async hitVoicePad(pad: HTMLButtonElement, voice: JamVoice, velocity: number): Promise<void> {
    await this.audio.unlock();
    this.audio.playVoice(voice, velocity);
    this.flashPad(pad);
  }

  private async hitSamplePad(pad: HTMLButtonElement, slot: number, velocity: number): Promise<void> {
    await this.audio.unlock();
    if (!this.audio.playSample(slot, velocity)) {
      pad.classList.add('empty-hit');
      window.setTimeout(() => pad.classList.remove('empty-hit'), 180);
      return;
    }
    this.flashPad(pad);
  }

  private flashPad(pad: HTMLButtonElement): void {
    pad.classList.add('hit');
    window.setTimeout(() => pad.classList.remove('hit'), 95);
    if (navigator.vibrate) navigator.vibrate(5);
  }

  private async loadFileIntoSlot(slot: number, file: File): Promise<void> {
    if (!file.type.startsWith('audio/')) {
      this.setSampleLabel(slot, 'NOT AUDIO');
      return;
    }
    try {
      const bytes = await file.arrayBuffer();
      const duration = await this.audio.loadSample(slot, bytes);
      this.setSampleLabel(slot, `${shortName(file.name)} · ${duration.toFixed(1)}s`);
      await saveStoredSample({ slot, name: file.name, type: file.type, bytes });
      const pad = this.root.querySelector<HTMLButtonElement>(`[data-sample-pad="${slot}"]`);
      if (pad) this.flashPad(pad);
    } catch {
      this.setSampleLabel(slot, 'DECODE FAILED');
    }
  }

  private setSampleLabel(slot: number, text: string): void {
    const element = this.sampleNameEls.find((candidate) => Number(candidate.dataset.sampleName) === slot);
    if (element) element.textContent = text;
  }

  private syncAll(): void {
    this.syncMode();
    this.syncSequencer();
    this.syncTransport();
    this.syncTempo();
  }

  private syncMode(): void {
    for (const [mode, panel] of Object.entries(this.panels) as [JamMode, HTMLElement][]) {
      panel.classList.toggle('active', this.state.mode === mode);
      panel.setAttribute('aria-hidden', this.state.mode === mode ? 'false' : 'true');
    }
    for (const button of this.modeButtons) {
      button.classList.toggle('active', button.dataset.jamMode === this.state.mode);
    }
  }

  private syncSequencer(): void {
    const cells = this.sequencerGrid.querySelectorAll<HTMLButtonElement>('.seq-step');
    for (const cell of cells) {
      const voice = cell.dataset.voice as SequencerVoice | undefined;
      const step = Number(cell.dataset.step);
      if (!voice || !Number.isInteger(step)) continue;
      const velocity = this.state.pattern[voice][step] ?? 0;
      cell.classList.toggle('on', velocity > 0);
      cell.classList.toggle('accent', velocity >= 0.95);
      cell.setAttribute('aria-pressed', velocity > 0 ? 'true' : 'false');
    }
    this.syncPlayhead();
  }

  private syncPlayhead(): void {
    const cells = this.sequencerGrid.querySelectorAll<HTMLButtonElement>('.seq-step');
    for (const cell of cells) {
      cell.classList.toggle('playhead', Number(cell.dataset.step) === this.state.step && this.state.playing);
    }
  }

  private syncTransport(): void {
    this.playButton.textContent = this.state.playing ? '■ STOP' : '▶ PLAY';
    this.playButton.classList.toggle('playing', this.state.playing);
    this.syncPlayhead();
  }

  private syncTempo(): void {
    this.bpmInput.value = String(this.state.bpm);
    this.bpmValue.textContent = `${this.state.bpm} BPM`;
    this.swingInput.value = String(Math.round(this.state.swing * 100));
    this.swingValue.textContent = `SWING ${Math.round(this.state.swing * 100)}%`;
  }
}
