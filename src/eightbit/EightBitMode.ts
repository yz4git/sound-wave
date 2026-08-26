import { downloadBlob } from '../compose/SongExport';
import { EightBitAudio } from './EightBitAudio';
import {
  EIGHT_BIT_BGM_PURPOSES,
  EIGHT_BIT_SFX_PURPOSES,
  defaultEightBitSettings,
  eightBitPurposeDescription,
  eightBitPurposeLabel,
  generateEightBitComposition,
  parseEightBitRequest,
  recommendedBpm,
  type EightBitComposition,
  type EightBitKind,
  type EightBitPurpose,
  type EightBitSettings,
} from './EightBitComposer';

const STORAGE_KEY = 'sound-wave-eight-bit-settings-v1';

function safeFilename(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || '8bit-audio';
}

function isKind(value: unknown): value is EightBitKind {
  return value === 'bgm' || value === 'sfx';
}

function purposeValidForKind(kind: EightBitKind, value: unknown): value is EightBitPurpose {
  if (typeof value !== 'string') return false;
  return kind === 'bgm'
    ? EIGHT_BIT_BGM_PURPOSES.includes(value as never)
    : EIGHT_BIT_SFX_PURPOSES.includes(value as never);
}

export class EightBitMode {
  private readonly root: HTMLElement;
  private readonly audio = new EightBitAudio();
  private settings: EightBitSettings;
  private composition: EightBitComposition;
  private active = false;
  private previewTimer = 0;

  constructor(root: HTMLElement) {
    this.root = root;
    this.settings = this.loadSettings();
    this.composition = generateEightBitComposition(this.settings);
    this.renderShell();
    this.bindEvents();
    this.syncAll();
  }

  async activate(): Promise<void> {
    this.active = true;
    this.root.classList.add('active');
    this.root.setAttribute('aria-hidden', 'false');
    await this.audio.unlock();
  }

  deactivate(): void {
    this.active = false;
    this.stopPreview();
    this.audio.suspend();
    this.root.classList.remove('active');
    this.root.setAttribute('aria-hidden', 'true');
  }

  get isActive(): boolean { return this.active; }

  private loadSettings(): EightBitSettings {
    const fallback = defaultEightBitSettings();
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw) as Partial<EightBitSettings>;
      const kind = isKind(parsed.kind) ? parsed.kind : fallback.kind;
      const purpose = purposeValidForKind(kind, parsed.purpose) ? parsed.purpose : (kind === 'bgm' ? 'field' : 'attack');
      const bars = parsed.bars === 4 || parsed.bars === 8 || parsed.bars === 16 ? parsed.bars : fallback.bars;
      const bpm = kind === 'bgm' ? Math.max(70, Math.min(220, Number(parsed.bpm) || recommendedBpm(purpose))) : 0;
      return {
        kind,
        purpose,
        intensity: Math.max(0, Math.min(1, Number(parsed.intensity) || fallback.intensity)),
        seed: Number(parsed.seed) >>> 0 || fallback.seed,
        bpm,
        bars,
      };
    } catch {
      return fallback;
    }
  }

  private saveSettings(): void {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings)); } catch { /* restricted storage */ }
  }

  private required<T extends Element>(selector: string): T {
    const element = this.root.querySelector<T>(selector);
    if (!element) throw new Error(`8BIT Studio UI is missing: ${selector}`);
    return element;
  }

  private renderShell(): void {
    this.root.innerHTML = `
      <header class="eightbit-header">
        <div>
          <span class="eightbit-kicker">LOCAL GAME AUDIO GENERATOR · 4-CHANNEL CHIP CONSTRAINTS</span>
          <h1>8BIT STUDIO</h1>
          <p>Generate game-ready BGM loops and sound effects, preview them instantly, then export WAV.</p>
        </div>
        <div class="eightbit-transport">
          <button type="button" id="eightbit-play">▶ PLAY</button>
          <button type="button" id="eightbit-generate">↻ GENERATE</button>
        </div>
      </header>

      <div class="eightbit-layout">
        <aside class="eightbit-controls" aria-label="8-bit generation settings">
          <label class="eightbit-request">
            <span>REQUEST</span>
            <div><input id="eightbit-request" type="text" maxlength="80" placeholder="boss battle BGM / 攻撃音" /><button type="button" id="eightbit-apply-request">APPLY</button></div>
          </label>

          <div class="eightbit-kind" role="group" aria-label="Audio type">
            <button type="button" data-eightbit-kind="bgm">BGM</button>
            <button type="button" data-eightbit-kind="sfx">SFX</button>
          </div>

          <label><span>USE</span><select id="eightbit-purpose"></select></label>
          <label><span id="eightbit-energy-label">ENERGY 62%</span><input id="eightbit-energy" type="range" min="0" max="100" step="1" /></label>
          <label id="eightbit-bpm-control"><span id="eightbit-bpm-label">132 BPM</span><input id="eightbit-bpm" type="range" min="70" max="220" step="1" /></label>
          <label id="eightbit-bars-control"><span>LOOP LENGTH</span><select id="eightbit-bars"><option value="4">4 BARS</option><option value="8">8 BARS</option><option value="16">16 BARS</option></select></label>

          <div class="eightbit-chip-model">
            <span>CHANNEL MODEL</span>
            <div><i>P1</i><b>PULSE LEAD</b></div>
            <div><i>P2</i><b>PULSE HARMONY</b></div>
            <div><i>TRI</i><b>TRIANGLE BASS</b></div>
            <div><i>NOI</i><b>NOISE / DRUMS</b></div>
          </div>
        </aside>

        <section class="eightbit-stage">
          <div class="eightbit-now">
            <span id="eightbit-type">BGM · LOOP</span>
            <strong id="eightbit-title">FIELD BGM</strong>
            <p id="eightbit-description"></p>
          </div>

          <div class="eightbit-timeline" id="eightbit-timeline" aria-label="Generated channel timeline">
            <div class="eightbit-lane" data-lane="pulse1"><b>P1</b><div></div></div>
            <div class="eightbit-lane" data-lane="pulse2"><b>P2</b><div></div></div>
            <div class="eightbit-lane" data-lane="triangle"><b>TRI</b><div></div></div>
            <div class="eightbit-lane" data-lane="noise"><b>NOI</b><div></div></div>
          </div>

          <div class="eightbit-meta">
            <div><span>FORMAT</span><b id="eightbit-format">4CH BGM</b></div>
            <div><span>TEMPO</span><b id="eightbit-meta-bpm">132 BPM</b></div>
            <div><span>LENGTH</span><b id="eightbit-meta-length">8 BARS</b></div>
            <div><span>SEED</span><b id="eightbit-seed">00000000</b></div>
          </div>

          <div class="eightbit-export">
            <span id="eightbit-status">READY · LOCAL GENERATION</span>
            <div>
              <button type="button" id="eightbit-export-json">JSON</button>
              <button type="button" id="eightbit-export-wav">EXPORT WAV</button>
            </div>
          </div>
        </section>
      </div>
    `;
  }

  private bindEvents(): void {
    this.required<HTMLButtonElement>('#eightbit-play').addEventListener('pointerdown', (event) => {
      event.preventDefault();
      if (this.audio.isPlaying) this.stopPreview(); else void this.playPreview();
    }, { passive: false });

    this.required<HTMLButtonElement>('#eightbit-generate').addEventListener('pointerdown', (event) => {
      event.preventDefault();
      this.settings.seed = (Date.now() ^ Math.floor(performance.now() * 1000)) >>> 0;
      this.rebuild();
      this.setStatus('NEW VARIATION GENERATED');
    }, { passive: false });

    for (const button of this.root.querySelectorAll<HTMLButtonElement>('[data-eightbit-kind]')) {
      button.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        const kind = button.dataset.eightbitKind as EightBitKind;
        if (!isKind(kind) || kind === this.settings.kind) return;
        this.settings.kind = kind;
        this.settings.purpose = kind === 'bgm' ? 'field' : 'attack';
        this.settings.bpm = kind === 'bgm' ? recommendedBpm(this.settings.purpose) : 0;
        this.syncPurposeOptions();
        this.rebuild();
      }, { passive: false });
    }

    this.required<HTMLSelectElement>('#eightbit-purpose').addEventListener('change', (event) => {
      const value = (event.target as HTMLSelectElement).value;
      if (!purposeValidForKind(this.settings.kind, value)) return;
      this.settings.purpose = value;
      if (this.settings.kind === 'bgm') this.settings.bpm = recommendedBpm(value);
      this.rebuild();
    });

    this.required<HTMLInputElement>('#eightbit-energy').addEventListener('input', (event) => {
      this.settings.intensity = Number((event.target as HTMLInputElement).value) / 100;
      this.rebuild(false);
    });

    this.required<HTMLInputElement>('#eightbit-bpm').addEventListener('input', (event) => {
      if (this.settings.kind !== 'bgm') return;
      this.settings.bpm = Number((event.target as HTMLInputElement).value);
      this.rebuild(false);
    });

    this.required<HTMLSelectElement>('#eightbit-bars').addEventListener('change', (event) => {
      const value = Number((event.target as HTMLSelectElement).value);
      if (value === 4 || value === 8 || value === 16) {
        this.settings.bars = value;
        this.rebuild(false);
      }
    });

    const request = this.required<HTMLInputElement>('#eightbit-request');
    this.required<HTMLButtonElement>('#eightbit-apply-request').addEventListener('pointerdown', (event) => {
      event.preventDefault(); this.applyRequest(request.value);
    }, { passive: false });
    request.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault(); this.applyRequest(request.value);
    });

    this.required<HTMLButtonElement>('#eightbit-export-json').addEventListener('pointerdown', (event) => {
      event.preventDefault(); this.exportJson();
    }, { passive: false });
    this.required<HTMLButtonElement>('#eightbit-export-wav').addEventListener('pointerdown', (event) => {
      event.preventDefault(); void this.exportWav();
    }, { passive: false });
  }

  private applyRequest(text: string): void {
    const parsed = parseEightBitRequest(text, { kind: this.settings.kind, purpose: this.settings.purpose });
    this.settings.kind = parsed.kind;
    this.settings.purpose = parsed.purpose;
    this.settings.bpm = parsed.kind === 'bgm' ? recommendedBpm(parsed.purpose) : 0;
    this.settings.seed = (Date.now() ^ text.length * 2654435761) >>> 0;
    this.syncPurposeOptions();
    this.rebuild();
    this.setStatus(`${eightBitPurposeLabel(parsed.purpose)} · REQUEST APPLIED`);
  }

  private rebuild(syncControls = true): void {
    this.stopPreview();
    this.composition = generateEightBitComposition(this.settings);
    this.saveSettings();
    if (syncControls) this.syncControls(); else this.syncControlLabels();
    this.renderComposition();
  }

  private syncAll(): void {
    this.syncPurposeOptions();
    this.syncControls();
    this.renderComposition();
  }

  private syncPurposeOptions(): void {
    const select = this.required<HTMLSelectElement>('#eightbit-purpose');
    const purposes = this.settings.kind === 'bgm' ? EIGHT_BIT_BGM_PURPOSES : EIGHT_BIT_SFX_PURPOSES;
    select.innerHTML = purposes.map((purpose) => `<option value="${purpose}">${eightBitPurposeLabel(purpose)}</option>`).join('');
    select.value = this.settings.purpose;
  }

  private syncControls(): void {
    this.required<HTMLSelectElement>('#eightbit-purpose').value = this.settings.purpose;
    this.required<HTMLInputElement>('#eightbit-energy').value = String(Math.round(this.settings.intensity * 100));
    this.required<HTMLInputElement>('#eightbit-bpm').value = String(this.settings.kind === 'bgm' ? this.settings.bpm : 120);
    this.required<HTMLSelectElement>('#eightbit-bars').value = String(this.settings.bars);
    this.syncControlLabels();
  }

  private syncControlLabels(): void {
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('[data-eightbit-kind]')) {
      button.classList.toggle('active', button.dataset.eightbitKind === this.settings.kind);
    }
    this.required<HTMLElement>('#eightbit-energy-label').textContent = `ENERGY ${Math.round(this.settings.intensity * 100)}%`;
    this.required<HTMLElement>('#eightbit-bpm-label').textContent = this.settings.kind === 'bgm' ? `${Math.round(this.settings.bpm)} BPM` : 'TEMPO · SFX ENVELOPE';
    this.required<HTMLElement>('#eightbit-bpm-control').classList.toggle('disabled', this.settings.kind === 'sfx');
    this.required<HTMLElement>('#eightbit-bars-control').classList.toggle('disabled', this.settings.kind === 'sfx');
  }

  private renderComposition(): void {
    const composition = this.composition;
    this.required<HTMLElement>('#eightbit-type').textContent = composition.kind === 'bgm' ? 'BGM · SEAMLESS LOOP DESIGN' : 'SFX · ONE SHOT';
    this.required<HTMLElement>('#eightbit-title').textContent = composition.purposeLabel;
    this.required<HTMLElement>('#eightbit-description').textContent = composition.description;
    this.required<HTMLElement>('#eightbit-format').textContent = composition.kind === 'bgm' ? '4CH BGM' : '4CH SFX';
    this.required<HTMLElement>('#eightbit-meta-bpm').textContent = composition.kind === 'bgm' ? `${Math.round(composition.bpm)} BPM` : `${Math.round(composition.duration * 1000)} ms`;
    this.required<HTMLElement>('#eightbit-meta-length').textContent = composition.kind === 'bgm' ? `${composition.bars} BARS` : 'ONE SHOT';
    this.required<HTMLElement>('#eightbit-seed').textContent = composition.seed.toString(16).toUpperCase().padStart(8, '0');

    const duration = Math.max(0.001, composition.duration);
    for (const lane of ['pulse1', 'pulse2', 'triangle', 'noise'] as const) {
      const container = this.required<HTMLElement>(`.eightbit-lane[data-lane="${lane}"] > div`);
      container.replaceChildren();
      const events = composition.events.filter((event) => event.channel === lane).slice(0, 220);
      for (const event of events) {
        const block = document.createElement('i');
        block.style.left = `${Math.max(0, Math.min(100, event.start / duration * 100))}%`;
        block.style.width = `${Math.max(0.45, Math.min(100, event.duration / duration * 100))}%`;
        if (event.midi !== undefined) block.style.setProperty('--pitch', String(Math.max(0, Math.min(1, (event.midi - 24) / 72))));
        container.append(block);
      }
    }
  }

  private async playPreview(): Promise<void> {
    this.stopPreview();
    await this.audio.play(this.composition);
    this.required<HTMLButtonElement>('#eightbit-play').textContent = '■ STOP';
    this.setStatus(this.composition.kind === 'bgm' ? 'PREVIEWING LOOP' : 'PREVIEWING SFX');
    this.previewTimer = window.setTimeout(() => {
      this.required<HTMLButtonElement>('#eightbit-play').textContent = '▶ PLAY';
      this.setStatus('READY · LOCAL GENERATION');
      this.previewTimer = 0;
    }, Math.ceil((this.composition.duration + 0.1) * 1000));
  }

  private stopPreview(): void {
    if (this.previewTimer) window.clearTimeout(this.previewTimer);
    this.previewTimer = 0;
    this.audio.stop();
    const play = this.root.querySelector<HTMLButtonElement>('#eightbit-play');
    if (play) play.textContent = '▶ PLAY';
  }

  private exportJson(): void {
    const blob = new Blob([JSON.stringify(this.composition, null, 2)], { type: 'application/json;charset=utf-8' });
    downloadBlob(blob, `${safeFilename(this.composition.purposeLabel)}-${this.composition.seed.toString(16)}.8bit.json`);
    this.setStatus('JSON EXPORTED');
  }

  private async exportWav(): Promise<void> {
    this.stopPreview();
    const button = this.required<HTMLButtonElement>('#eightbit-export-wav');
    button.disabled = true;
    button.textContent = 'RENDERING…';
    this.setStatus('RENDERING WAV LOCALLY…');
    try {
      const blob = await this.audio.renderWav(this.composition);
      downloadBlob(blob, `${safeFilename(this.composition.purposeLabel)}-${this.composition.seed.toString(16)}.wav`);
      this.setStatus(`WAV EXPORTED · ${(blob.size / 1024).toFixed(0)} KB`);
    } catch (error) {
      console.warn('8BIT WAV export failed.', error);
      this.setStatus('WAV EXPORT FAILED');
    } finally {
      button.disabled = false;
      button.textContent = 'EXPORT WAV';
    }
  }

  private setStatus(message: string): void {
    this.required<HTMLElement>('#eightbit-status').textContent = message;
  }
}
