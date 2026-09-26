import type { VocalStyle } from '../compose/VocalGenerator';
import { downloadBlob } from '../compose/SongExport';
import { VOICE_CHARACTER_PRESETS, validVoiceCharacterPreset, type VoiceCharacterPreset } from '../compose/VoiceCharacter';
import { type VoiceIntonation } from './VoiceScript';
import { VoiceSynth, type VoiceProsodyEdits, type VoiceSynthSettings } from './VoiceSynth';
import { parseVoiceMarkup, removeVoiceMarkup, wrapVoiceSelection, type VoiceMarkupScript } from './VoiceMarkup';
import {
  analyzeJapaneseText,
  containsKanji,
  type JapaneseG2PAnalysis,
} from './JapaneseG2P';
import type { VoiceScript } from './VoiceScript';
import { getVoiceProsodyWindow } from './VoiceProsodyWindow';
import {
  VOICE_EXPRESSION_PRESETS,
  validVoiceExpressionPreset,
  voiceExpressionControl,
  type VoiceExpressionSettings,
} from './VoiceExpression';

type VoiceEngine = 'local' | 'system';
type ProsodyLane = 'pitch' | 'energy' | 'duration';

interface VoiceLabSettings extends VoiceSynthSettings {
  engine: VoiceEngine;
  expression: VoiceExpressionSettings;
}

const STORAGE_KEY = 'sound-wave-voice-lab-settings-v1';
const DEFAULT_TEXT = 'こんにちは。おんせい ごうせいの じっけんです。ことばの たかさと いきおいを かえてみましょう。';
const STYLES: readonly VocalStyle[] = ['warm', 'bright', 'airy'];
const INTONATIONS: readonly VoiceIntonation[] = ['natural', 'flat', 'rise', 'fall', 'question'];
const LOCAL_DELIVERY_PRESETS = ['calm', 'excited', 'serious', 'whisper', 'narration'] as const;

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

function validStyle(value: unknown): value is VocalStyle {
  return typeof value === 'string' && STYLES.includes(value as VocalStyle);
}

function validIntonation(value: unknown): value is VoiceIntonation {
  return typeof value === 'string' && INTONATIONS.includes(value as VoiceIntonation);
}

function validEngine(value: unknown): value is VoiceEngine {
  return value === 'local' || value === 'system';
}

function safeFilename(text: string): string {
  const normalized = text.trim().slice(0, 28).replace(/[\\/:*?"<>|\s]+/g, '-').replace(/-+/g, '-');
  return normalized || 'sound-wave-voice';
}

export class VoiceMode {
  private readonly root: HTMLElement;
  private readonly synth = new VoiceSynth();
  private settings: VoiceLabSettings;
  private active = false;
  private playbackTimer = 0;
  private tokenTimers: number[] = [];
  private pitchEdits: number[] = [];
  private energyEdits: number[] = [];
  private durationEdits: number[] = [];
  private prosodyLane: ProsodyLane = 'pitch';
  private prosodyPage = 0;
  private drawingProsody = false;
  private lastDrawIndex: number | null = null;
  private lastDrawValue = 0;
  private systemSpeechGeneration = 0;
  private japaneseAnalysis: JapaneseG2PAnalysis | null = null;
  private japaneseAnalysisSource = '';
  private japaneseAnalyzing = false;

  constructor(root: HTMLElement) {
    this.root = root;
    this.settings = this.loadSettings();
    this.renderShell();
    this.bindEvents();
    this.syncControls();
    this.refreshPlan();
  }

  get isActive(): boolean { return this.active; }

  async activate(): Promise<void> {
    this.active = true;
    this.root.classList.add('active');
    this.root.setAttribute('aria-hidden', 'false');
    if (this.settings.engine === 'local') await this.synth.unlock();
    this.refreshPlan();
  }

  deactivate(): void {
    this.active = false;
    this.stop();
    this.synth.suspend();
    this.root.classList.remove('active');
    this.root.setAttribute('aria-hidden', 'true');
  }

  private loadSettings(): VoiceLabSettings {
    const fallback: VoiceLabSettings = {
      engine: 'local',
      style: 'warm',
      character: 'natural',
      tone: 0,
      rate: 1,
      pitch: 60,
      energy: 0.92,
      intonation: 'natural',
      expression: {
        preset: 'neutral',
        intensity: 1,
      },
    };
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw) as Partial<VoiceLabSettings>;
      return {
        engine: validEngine(parsed.engine) ? parsed.engine : fallback.engine,
        style: validStyle(parsed.style) ? parsed.style : fallback.style,
        character: validVoiceCharacterPreset(parsed.character) ? parsed.character : fallback.character,
        tone: clamp(Number(parsed.tone) || 0, -1, 1),
        rate: clamp(Number(parsed.rate) || 1, 0.6, 1.65),
        pitch: clamp(Number(parsed.pitch) || 60, 45, 76),
        energy: clamp(Number(parsed.energy) || 0.92, 0.55, 1.15),
        intonation: validIntonation(parsed.intonation) ? parsed.intonation : fallback.intonation,
        expression: {
          preset: validVoiceExpressionPreset(parsed.expression?.preset)
            ? parsed.expression.preset
            : fallback.expression.preset,
          intensity: clamp(Number(parsed.expression?.intensity) || 1, 0, 1.35),
        },
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
    if (!element) throw new Error(`VOICE LAB UI is missing: ${selector}`);
    return element;
  }

  private renderShell(): void {
    this.root.innerHTML = `
      <header class="voice-header">
        <div>
          <span class="voice-kicker">LOCAL SPEECH SYNTHESIS · CONTENT / PROSODY / TIMBRE</span>
          <h1>VOICE LAB</h1>
          <p>Shape a voice directly. Type kana or romaji for the Sound Wave engine, or use the device voice for unrestricted text.</p>
        </div>
        <div class="voice-transport">
          <button type="button" id="voice-play">▶ SPEAK</button>
          <button type="button" id="voice-stop">■ STOP</button>
        </div>
      </header>

      <div class="voice-layout">
        <section class="voice-content-panel">
          <div class="voice-section-label"><span>01</span><b>CONTENT</b><em>what is said</em></div>
          <textarea id="voice-text" rows="5" maxlength="420" spellcheck="false" aria-label="Speech text">${DEFAULT_TEXT}</textarea>
          <div class="voice-local-delivery">
            <span>SELECT TEXT → LOCAL DELIVERY</span>
            <div role="group" aria-label="Local speaking style">
              ${LOCAL_DELIVERY_PRESETS.map((preset) => `<button type="button" data-local-delivery="${preset}">${preset.toUpperCase()}</button>`).join('')}
              <button type="button" id="voice-clear-local">CLEAR TAGS</button>
            </div>
          </div>
          <div class="voice-engine" role="group" aria-label="Voice engine">
            <button type="button" data-voice-engine="local">SOUND WAVE DSP</button>
            <button type="button" data-voice-engine="system">SYSTEM TTS</button>
          </div>
          <div class="voice-japanese-tools">
            <button type="button" id="voice-analyze-japanese">KANJI G2P</button>
            <span id="voice-japanese-status">Open JTalk reading + pitch accent · first use downloads ~24MB dictionary</span>
          </div>
          <p class="voice-engine-note" id="voice-engine-note"></p>

          <div class="voice-prosody-preview">
            <div class="voice-section-label compact"><span>02</span><b>PROSODY DRAW</b><em>pitch / energy / duration</em></div>
            <div class="voice-prosody-tools">
              <div class="voice-prosody-lanes" role="group" aria-label="Prosody drawing lane">
                <button type="button" data-prosody-lane="pitch">PITCH</button>
                <button type="button" data-prosody-lane="energy">ENERGY</button>
                <button type="button" data-prosody-lane="duration">TIMING</button>
              </div>
              <div class="voice-prosody-page" aria-label="Prosody page">
                <button type="button" id="voice-prosody-prev" aria-label="Previous prosody page">‹</button>
                <span id="voice-prosody-page-label">1 / 1</span>
                <button type="button" id="voice-prosody-next" aria-label="Next prosody page">›</button>
              </div>
              <button type="button" id="voice-reset-prosody">RESET ALL</button>
              <span id="voice-prosody-hint">DRAW F0 · ±3 ST</span>
            </div>
            <div id="voice-contour" class="voice-contour pitch" aria-label="Drawable prosody contour"></div>
            <div id="voice-units" class="voice-units" aria-label="Speech units"></div>
          </div>
        </section>

        <aside class="voice-controls-panel">
          <div class="voice-control-group voice-expression-group">
            <div class="voice-section-label compact"><span>03</span><b>DELIVERY</b><em>speaking style</em></div>
            <div class="voice-expression-grid" role="group" aria-label="Speaking style">
              ${VOICE_EXPRESSION_PRESETS.map((preset) => `<button type="button" data-voice-expression="${preset}">${preset.toUpperCase()}</button>`).join('')}
            </div>
            <label><span id="voice-expression-label">STYLE INTENSITY 100%</span><input id="voice-expression-intensity" type="range" min="0" max="135" step="1" /></label>
          </div>

          <div class="voice-control-group">
            <div class="voice-section-label compact"><span>04</span><b>TIMBRE</b><em>voice character</em></div>
            <label><span>VOICE</span><select id="voice-character">
              ${VOICE_CHARACTER_PRESETS.map((preset) => `<option value="${preset}">${preset.toUpperCase()}</option>`).join('')}
            </select></label>
            <label><span>COLOR</span><select id="voice-style">
              ${STYLES.map((style) => `<option value="${style}">${style.toUpperCase()}</option>`).join('')}
            </select></label>
            <label><span id="voice-tone-label">TONE 0</span><input id="voice-tone" type="range" min="-100" max="100" step="1" /></label>
          </div>

          <div class="voice-control-group">
            <label><span>INTONATION</span><select id="voice-intonation">
              <option value="natural">NATURAL ARC</option>
              <option value="flat">FLAT</option>
              <option value="rise">RISING</option>
              <option value="fall">FALLING</option>
              <option value="question">QUESTION</option>
            </select></label>
            <label><span id="voice-rate-label">RATE 1.00×</span><input id="voice-rate" type="range" min="60" max="165" step="1" /></label>
            <label><span id="voice-pitch-label">PITCH 60</span><input id="voice-pitch" type="range" min="45" max="76" step="1" /></label>
            <label><span id="voice-energy-label">ENERGY 92%</span><input id="voice-energy" type="range" min="55" max="115" step="1" /></label>
          </div>

          <div class="voice-export">
            <div>
              <span>OUTPUT</span>
              <strong id="voice-status">READY · LOCAL DSP</strong>
            </div>
            <button type="button" id="voice-export-wav">EXPORT WAV</button>
          </div>

          <div class="voice-tech">
            <span>ENGINE MODEL</span>
            <div><i>C</i><b>CONTENT</b><em>mora / phoneme timing</em></div>
            <div><i>P</i><b>PROSODY</b><em>phrase contour / duration</em></div>
            <div><i>T</i><b>TIMBRE</b><em>source–filter / formants</em></div>
            <div><i>S</i><b>STREAM</b><em>AudioWorklet scheduling</em></div>
          </div>
        </aside>
      </div>
    `;
  }

  private bindEvents(): void {
    const text = this.required<HTMLTextAreaElement>('#voice-text');
    text.addEventListener('input', () => {
      this.resetProsodyEdits();
      this.clearJapaneseAnalysis();
      this.refreshPlan();
    });

    for (const button of this.root.querySelectorAll<HTMLButtonElement>('[data-local-delivery]')) {
      button.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        const preset = button.dataset.localDelivery;
        if (!validVoiceExpressionPreset(preset) || preset === 'neutral') return;
        this.applyLocalDelivery(preset);
      }, { passive: false });
    }
    this.required<HTMLButtonElement>('#voice-clear-local').addEventListener('pointerdown', (event) => {
      event.preventDefault();
      const cleaned = removeVoiceMarkup(text.value);
      if (cleaned === text.value) {
        this.setStatus('NO LOCAL DELIVERY TAGS');
        return;
      }
      text.value = cleaned;
      this.resetProsodyEdits();
      this.clearJapaneseAnalysis();
      this.refreshPlan();
      this.setStatus('LOCAL DELIVERY TAGS CLEARED');
    }, { passive: false });

    const contour = this.required<HTMLElement>('#voice-contour');
    contour.addEventListener('pointerdown', (event) => {
      if (this.settings.engine !== 'local') return;
      event.preventDefault();
      this.drawingProsody = true;
      this.lastDrawIndex = null;
      contour.setPointerCapture(event.pointerId);
      this.applyProsodyPointer(event);
    }, { passive: false });
    contour.addEventListener('pointermove', (event) => {
      if (!this.drawingProsody || this.settings.engine !== 'local') return;
      event.preventDefault();
      this.applyProsodyPointer(event);
    }, { passive: false });
    const finishProsodyDraw = (event: PointerEvent): void => {
      if (!this.drawingProsody) return;
      this.drawingProsody = false;
      this.lastDrawIndex = null;
      if (contour.hasPointerCapture(event.pointerId)) contour.releasePointerCapture(event.pointerId);
      this.refreshPlan();
    };
    contour.addEventListener('pointerup', finishProsodyDraw);
    contour.addEventListener('pointercancel', finishProsodyDraw);
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('[data-prosody-lane]')) {
      button.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        const lane = button.dataset.prosodyLane;
        if (lane !== 'pitch' && lane !== 'energy' && lane !== 'duration') return;
        this.prosodyLane = lane;
        this.syncProsodyLaneUi();
        this.refreshPlan();
      }, { passive: false });
    }

    this.required<HTMLButtonElement>('#voice-prosody-prev').addEventListener('pointerdown', (event) => {
      event.preventDefault();
      if (this.prosodyPage <= 0) return;
      this.prosodyPage -= 1;
      this.lastDrawIndex = null;
      this.refreshPlan();
    }, { passive: false });
    this.required<HTMLButtonElement>('#voice-prosody-next').addEventListener('pointerdown', (event) => {
      event.preventDefault();
      this.prosodyPage += 1;
      this.lastDrawIndex = null;
      this.refreshPlan();
    }, { passive: false });

    this.required<HTMLButtonElement>('#voice-analyze-japanese').addEventListener('pointerdown', (event) => {
      event.preventDefault();
      void this.analyzeJapanese();
    }, { passive: false });

    this.required<HTMLButtonElement>('#voice-reset-prosody').addEventListener('pointerdown', (event) => {
      event.preventDefault();
      this.resetProsodyEdits();
      this.refreshPlan();
      this.setStatus('PITCH / ENERGY / TIMING RESET');
    }, { passive: false });

    this.required<HTMLButtonElement>('#voice-play').addEventListener('pointerdown', (event) => {
      event.preventDefault();
      void this.play();
    }, { passive: false });
    this.required<HTMLButtonElement>('#voice-stop').addEventListener('pointerdown', (event) => {
      event.preventDefault();
      this.stop();
    }, { passive: false });
    this.required<HTMLButtonElement>('#voice-export-wav').addEventListener('pointerdown', (event) => {
      event.preventDefault();
      void this.exportWav();
    }, { passive: false });

    for (const button of this.root.querySelectorAll<HTMLButtonElement>('[data-voice-engine]')) {
      button.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        const engine = button.dataset.voiceEngine;
        if (!validEngine(engine)) return;
        this.settings.engine = engine;
        this.saveSettings();
        this.stop();
        this.syncControls();
        this.refreshPlan();
      }, { passive: false });
    }

    for (const button of this.root.querySelectorAll<HTMLButtonElement>('[data-voice-expression]')) {
      button.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        const preset = button.dataset.voiceExpression;
        if (!validVoiceExpressionPreset(preset)) return;
        this.settings.expression.preset = preset;
        this.changed();
      }, { passive: false });
    }

    this.required<HTMLInputElement>('#voice-expression-intensity').addEventListener('input', (event) => {
      this.settings.expression.intensity = Number((event.target as HTMLInputElement).value) / 100;
      this.changed(false);
    });

    this.required<HTMLSelectElement>('#voice-character').addEventListener('change', (event) => {
      const value = (event.target as HTMLSelectElement).value;
      if (!validVoiceCharacterPreset(value)) return;
      this.settings.character = value;
      this.changed();
    });
    this.required<HTMLSelectElement>('#voice-style').addEventListener('change', (event) => {
      const value = (event.target as HTMLSelectElement).value;
      if (!validStyle(value)) return;
      this.settings.style = value;
      this.changed();
    });
    this.required<HTMLSelectElement>('#voice-intonation').addEventListener('change', (event) => {
      const value = (event.target as HTMLSelectElement).value;
      if (!validIntonation(value)) return;
      this.settings.intonation = value;
      this.changed();
    });
    this.required<HTMLInputElement>('#voice-tone').addEventListener('input', (event) => {
      this.settings.tone = Number((event.target as HTMLInputElement).value) / 100;
      this.changed(false);
    });
    this.required<HTMLInputElement>('#voice-rate').addEventListener('input', (event) => {
      this.settings.rate = Number((event.target as HTMLInputElement).value) / 100;
      this.changed(false);
    });
    this.required<HTMLInputElement>('#voice-pitch').addEventListener('input', (event) => {
      this.settings.pitch = Number((event.target as HTMLInputElement).value);
      this.changed(false);
    });
    this.required<HTMLInputElement>('#voice-energy').addEventListener('input', (event) => {
      this.settings.energy = Number((event.target as HTMLInputElement).value) / 100;
      this.changed(false);
    });
  }

  private changed(refreshSelects = true): void {
    this.saveSettings();
    this.stop();
    if (refreshSelects) this.syncControls();
    else this.syncLabels();
    this.refreshPlan();
  }

  private syncControls(): void {
    this.required<HTMLInputElement>('#voice-expression-intensity').value = String(
      Math.round(this.settings.expression.intensity * 100),
    );
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('[data-voice-expression]')) {
      button.classList.toggle('active', button.dataset.voiceExpression === this.settings.expression.preset);
    }
    this.required<HTMLSelectElement>('#voice-character').value = this.settings.character;
    this.required<HTMLSelectElement>('#voice-style').value = this.settings.style;
    this.required<HTMLSelectElement>('#voice-intonation').value = this.settings.intonation;
    this.required<HTMLInputElement>('#voice-tone').value = String(Math.round(this.settings.tone * 100));
    this.required<HTMLInputElement>('#voice-rate').value = String(Math.round(this.settings.rate * 100));
    this.required<HTMLInputElement>('#voice-pitch').value = String(Math.round(this.settings.pitch));
    this.required<HTMLInputElement>('#voice-energy').value = String(Math.round(this.settings.energy * 100));

    for (const button of this.root.querySelectorAll<HTMLButtonElement>('[data-voice-engine]')) {
      button.classList.toggle('active', button.dataset.voiceEngine === this.settings.engine);
    }
    this.required<HTMLButtonElement>('#voice-analyze-japanese').disabled =
      this.settings.engine !== 'local' || this.japaneseAnalyzing;
    this.required<HTMLButtonElement>('#voice-export-wav').disabled = this.settings.engine !== 'local';
    this.required<HTMLButtonElement>('#voice-reset-prosody').disabled = this.settings.engine !== 'local';
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('[data-prosody-lane]')) {
      button.disabled = this.settings.engine !== 'local';
    }
    this.required<HTMLElement>('#voice-contour').classList.toggle('disabled', this.settings.engine !== 'local');
    this.syncProsodyLaneUi();
    this.syncLabels();
  }

  private syncLabels(): void {
    this.required<HTMLElement>('#voice-expression-label').textContent =
      `STYLE INTENSITY ${Math.round(this.settings.expression.intensity * 100)}%`;
    this.required<HTMLElement>('#voice-tone-label').textContent = `TONE ${this.settings.tone >= 0 ? '+' : ''}${Math.round(this.settings.tone * 100)}`;
    this.required<HTMLElement>('#voice-rate-label').textContent = `RATE ${this.settings.rate.toFixed(2)}×`;
    this.required<HTMLElement>('#voice-pitch-label').textContent = `PITCH ${Math.round(this.settings.pitch)}`;
    this.required<HTMLElement>('#voice-energy-label').textContent = `ENERGY ${Math.round(this.settings.energy * 100)}%`;
  }

  private applyLocalDelivery(preset: Exclude<VoiceExpressionSettings['preset'], 'neutral'>): void {
    const textarea = this.required<HTMLTextAreaElement>('#voice-text');
    const wrapped = wrapVoiceSelection(
      textarea.value,
      textarea.selectionStart ?? 0,
      textarea.selectionEnd ?? 0,
      {
        preset,
        intensity: this.settings.expression.intensity,
      },
    );
    if (!wrapped) {
      this.setStatus('SELECT TEXT FIRST · THEN CHOOSE LOCAL DELIVERY');
      textarea.focus();
      return;
    }

    textarea.value = wrapped.text;
    this.clearJapaneseAnalysis();
    textarea.focus();
    textarea.setSelectionRange(wrapped.selectionStart, wrapped.selectionEnd);
    this.resetProsodyEdits();
    this.refreshPlan();
    this.setStatus(`LOCAL ${preset.toUpperCase()} · ${Math.round(this.settings.expression.intensity * 100)}%`);
  }

  private clearJapaneseAnalysis(): void {
    this.japaneseAnalysis = null;
    this.japaneseAnalysisSource = '';
    const status = this.root.querySelector<HTMLElement>('#voice-japanese-status');
    if (status) {
      status.textContent = 'Open JTalk reading + pitch accent · first use downloads ~24MB dictionary';
    }
  }

  private resolveLocalScript(text: string): {
    script: VoiceScript;
    markup: VoiceMarkupScript;
    localExpressions: readonly (VoiceExpressionSettings | null)[];
    analyzed: boolean;
  } {
    const markup = parseVoiceMarkup(text);
    const analyzed = this.japaneseAnalysis !== null
      && this.japaneseAnalysisSource === text
      && !markup.markupUsed;
    return {
      script: analyzed ? this.japaneseAnalysis!.script : markup,
      markup,
      localExpressions: analyzed ? [] : markup.localExpressions,
      analyzed,
    };
  }

  private async analyzeJapanese(): Promise<boolean> {
    if (this.japaneseAnalyzing) {
      this.setStatus('KANJI G2P · ANALYSIS ALREADY RUNNING');
      return false;
    }
    const textarea = this.required<HTMLTextAreaElement>('#voice-text');
    const text = textarea.value.trim();
    if (!text) {
      this.setStatus('ENTER JAPANESE TEXT');
      return false;
    }

    const markup = parseVoiceMarkup(text);
    if (markup.markupUsed) {
      this.setStatus('KANJI G2P · CLEAR LOCAL DELIVERY TAGS FIRST');
      return false;
    }
    if (!containsKanji(markup.plainText)) {
      this.setStatus('KANJI G2P · NO KANJI TO ANALYZE');
      return false;
    }

    const button = this.required<HTMLButtonElement>('#voice-analyze-japanese');
    const detail = this.required<HTMLElement>('#voice-japanese-status');
    this.japaneseAnalyzing = true;
    button.disabled = true;
    button.textContent = 'ANALYZING…';
    this.stop();

    try {
      const analysis = await analyzeJapaneseText(markup.plainText, (progress) => {
        detail.textContent = progress.message;
        this.setStatus(progress.message);
      });
      this.japaneseAnalysis = analysis;
      this.japaneseAnalysisSource = text;
      this.resetProsodyEdits();
      this.refreshPlan();
      detail.textContent = `OPEN JTALK · ${analysis.script.units.length} morae · ${analysis.reading.slice(0, 48)}${analysis.reading.length > 48 ? '…' : ''}`;
      this.setStatus('KANJI G2P READY · READING + PITCH ACCENT');
      return true;
    } catch (error) {
      console.warn('VOICE LAB Japanese G2P failed.', error);
      this.clearJapaneseAnalysis();
      detail.textContent = 'Open JTalk failed · kana input and SYSTEM TTS remain available';
      this.setStatus('KANJI G2P UNAVAILABLE');
      return false;
    } finally {
      this.japaneseAnalyzing = false;
      button.disabled = false;
      button.textContent = 'KANJI G2P';
    }
  }

  private refreshPlan(): void {
    const text = this.required<HTMLTextAreaElement>('#voice-text').value;
    const resolved = this.resolveLocalScript(text);
    const { script, markup, localExpressions, analyzed } = resolved;
    const unitsEl = this.required<HTMLElement>('#voice-units');
    const contourEl = this.required<HTMLElement>('#voice-contour');
    unitsEl.replaceChildren();
    contourEl.replaceChildren();

    this.ensureProsodyEditLength(script.units.length);
    const plan = this.synth.plan(script, this.settings, this.getProsodyEdits(localExpressions));
    const window = getVoiceProsodyWindow(plan.units.length, this.prosodyPage);
    this.prosodyPage = window.page;
    const pageLabel = this.required<HTMLElement>('#voice-prosody-page-label');
    pageLabel.textContent = `${window.page + 1} / ${window.pageCount}`;
    const prevPage = this.required<HTMLButtonElement>('#voice-prosody-prev');
    const nextPage = this.required<HTMLButtonElement>('#voice-prosody-next');
    prevPage.disabled = this.settings.engine !== 'local' || window.page <= 0;
    nextPage.disabled = this.settings.engine !== 'local' || window.page >= window.pageCount - 1;
    const preview = plan.units.slice(window.start, window.end);
    const previewDuration = Math.max(
      0.1,
      preview.reduce((sum, timed) => sum + timed.duration, 0),
    );
    preview.forEach((timed) => {
      const index = timed.unit.index;
      const unit = timed.unit;
      const token = document.createElement('i');
      token.textContent = unit.display;
      token.dataset.voiceUnit = String(index);
      if (unit.phraseStart) token.classList.add('phrase-start');
      if (unit.phraseEnd) token.classList.add('phrase-end');
      if (unit.accentStart) token.classList.add('accent-start');
      if (unit.devoiced) token.classList.add('devoiced');
      if (unit.longVowel) token.classList.add('long-vowel');
      if (unit.geminateBefore) token.classList.add('geminate');
      if (unit.pitchAccent === 'high') token.classList.add('pitch-high');
      if (unit.pitchAccent === 'low') token.classList.add('pitch-low');
      const localExpression = localExpressions[index];
      if (localExpression) {
        token.classList.add('local-delivery');
        token.dataset.localDelivery = localExpression.preset;
        token.title = `${localExpression.preset.toUpperCase()} ${Math.round(localExpression.intensity * 100)}%`;
      }
      unitsEl.append(token);

      const point = document.createElement('i');
      point.dataset.voiceIndex = String(index);
      const pitchOffset = timed.pitchMidi - this.settings.pitch;
      const pitchValue = clamp((pitchOffset + 3) / 6, 0.05, 0.95);
      const energyValue = clamp((timed.manualEnergyScale - 0.45) / 1.1, 0.05, 0.95);
      const durationValue = clamp((timed.manualDurationScale - 0.6) / 1.05, 0.05, 0.95);
      const laneValue = this.prosodyLane === 'pitch'
        ? pitchValue
        : this.prosodyLane === 'energy'
          ? energyValue
          : durationValue;
      point.style.setProperty('--voice-pitch', String(pitchValue));
      point.style.setProperty('--voice-energy', String(energyValue));
      point.style.setProperty('--voice-duration', String(durationValue));
      point.style.setProperty('--voice-value', String(laneValue));
      point.style.width = `${Math.max(1.2, timed.duration / previewDuration * 100)}%`;
      if (
        (this.prosodyLane === 'pitch' && Math.abs(timed.manualPitchOffset) > 0.001)
        || (this.prosodyLane === 'energy' && Math.abs(timed.manualEnergyScale - 1) > 0.001)
        || (this.prosodyLane === 'duration' && Math.abs(timed.manualDurationScale - 1) > 0.001)
      ) point.classList.add('edited');
      contourEl.append(point);
    });

    const note = this.required<HTMLElement>('#voice-engine-note');
    if (this.settings.engine === 'local') {
      note.textContent = analyzed
        ? `LOCAL DSP · OPEN JTALK G2P · ${script.units.length} morae · lexical pitch accent + draw controls`
        : script.unsupported.length > 0
          ? `LOCAL DSP · KANJI DETECTED · SPEAK auto-runs reading + pitch accent`
          : `LOCAL DSP · ${script.units.length} morae · ${this.settings.expression.preset.toUpperCase()} delivery${markup.markupUsed ? ' + local spans' : ''} · draw pitch / energy / timing`;
      this.setStatus(
        analyzed
          ? 'READY · LOCAL DSP + OPEN JTALK'
          : script.unsupported.length > 0
            ? 'KANJI DETECTED · SPEAK TO AUTO-ANALYZE'
            : script.units.length > 0
              ? 'READY · LOCAL DSP'
              : 'ENTER KANA OR ROMAJI',
      );
    } else {
      note.textContent = 'SYSTEM TTS · device/browser voice · kanji and general text supported · availability varies by OS';
      this.setStatus('READY · SYSTEM TTS');
    }
  }

  private resetProsodyEdits(): void {
    this.pitchEdits = [];
    this.energyEdits = [];
    this.durationEdits = [];
    this.lastDrawIndex = null;
  }

  private ensureProsodyEditLength(count: number): void {
    const resize = (source: number[], fill: number): number[] => {
      if (source.length === count) return source;
      const next = new Array<number>(count).fill(fill);
      for (let index = 0; index < Math.min(source.length, count); index += 1) {
        next[index] = source[index] ?? fill;
      }
      return next;
    };
    this.pitchEdits = resize(this.pitchEdits, 0);
    this.energyEdits = resize(this.energyEdits, 1);
    this.durationEdits = resize(this.durationEdits, 1);
  }

  private getProsodyEdits(
    localExpressions: readonly (VoiceExpressionSettings | null)[] = [],
  ): VoiceProsodyEdits {
    return {
      pitchOffsets: this.pitchEdits,
      energyScales: this.energyEdits,
      durationScales: this.durationEdits,
      localExpressions,
    };
  }

  private syncProsodyLaneUi(): void {
    const contour = this.required<HTMLElement>('#voice-contour');
    contour.classList.remove('pitch', 'energy', 'duration');
    contour.classList.add(this.prosodyLane);
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('[data-prosody-lane]')) {
      button.classList.toggle('active', button.dataset.prosodyLane === this.prosodyLane);
    }
    const hint = this.required<HTMLElement>('#voice-prosody-hint');
    hint.textContent = this.prosodyLane === 'pitch'
      ? 'DRAW F0 · ±3 ST'
      : this.prosodyLane === 'energy'
        ? 'DRAW ENERGY · 45–155%'
        : 'DRAW TIMING · 60–165%';
  }

  private drawValueFromPointer(y: number): number {
    if (this.prosodyLane === 'pitch') return Math.round((0.5 - y) * 6 * 20) / 20;
    if (this.prosodyLane === 'energy') return Math.round((0.45 + (1 - y) * 1.1) * 20) / 20;
    return Math.round((0.6 + (1 - y) * 1.05) * 20) / 20;
  }

  private setProsodyValue(index: number, value: number): void {
    if (this.prosodyLane === 'pitch') this.pitchEdits[index] = clamp(value, -3, 3);
    else if (this.prosodyLane === 'energy') this.energyEdits[index] = clamp(value, 0.45, 1.55);
    else this.durationEdits[index] = clamp(value, 0.6, 1.65);
  }

  private applyProsodyPointer(event: PointerEvent): void {
    const contour = this.required<HTMLElement>('#voice-contour');
    const rect = contour.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const text = this.required<HTMLTextAreaElement>('#voice-text').value;
    const { script, localExpressions } = this.resolveLocalScript(text);
    if (script.units.length === 0) return;
    this.ensureProsodyEditLength(script.units.length);

    const window = getVoiceProsodyWindow(script.units.length, this.prosodyPage);
    this.prosodyPage = window.page;
    if (window.visibleCount <= 0) return;

    const y = clamp((event.clientY - rect.top) / rect.height, 0, 1);
    const points = [...contour.querySelectorAll<HTMLElement>('[data-voice-index]')];
    if (points.length === 0) return;

    let targetPoint = points[0]!;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const point of points) {
      const pointRect = point.getBoundingClientRect();
      const center = pointRect.left + pointRect.width * 0.5;
      const distance = Math.abs(event.clientX - center);
      if (distance < bestDistance) {
        bestDistance = distance;
        targetPoint = point;
      }
    }

    const parsedIndex = Number(targetPoint.dataset.voiceIndex);
    if (!Number.isInteger(parsedIndex)) return;
    const index = Math.max(window.start, Math.min(window.end - 1, parsedIndex));
    const value = this.drawValueFromPointer(y);

    if (this.lastDrawIndex !== null && this.lastDrawIndex !== index) {
      const from = this.lastDrawIndex;
      const to = index;
      const direction = to > from ? 1 : -1;
      const distance = Math.abs(to - from);
      for (let step = 1; step <= distance; step += 1) {
        const cursor = from + step * direction;
        const t = step / distance;
        this.setProsodyValue(cursor, this.lastDrawValue + (value - this.lastDrawValue) * t);
      }
    } else {
      this.setProsodyValue(index, value);
    }

    this.lastDrawIndex = index;
    this.lastDrawValue = value;

    const plan = this.synth.plan(script, this.settings, this.getProsodyEdits(localExpressions));
    const timed = plan.units[index];
    if (timed) {
      const point = contour.querySelector<HTMLElement>(`[data-voice-index="${index}"]`) ?? undefined;
      if (point) {
        const pitchValue = clamp((timed.pitchMidi - this.settings.pitch + 3) / 6, 0.05, 0.95);
        const energyValue = clamp((timed.manualEnergyScale - 0.45) / 1.1, 0.05, 0.95);
        const durationValue = clamp((timed.manualDurationScale - 0.6) / 1.05, 0.05, 0.95);
        point.style.setProperty('--voice-value', String(
          this.prosodyLane === 'pitch' ? pitchValue : this.prosodyLane === 'energy' ? energyValue : durationValue,
        ));
        point.classList.add('edited');
      }
    }

    const statusValue = this.prosodyLane === 'pitch'
      ? `${value >= 0 ? '+' : ''}${value.toFixed(2)} ST`
      : `${Math.round(value * 100)}%`;
    this.setStatus(`${this.prosodyLane.toUpperCase()} DRAW · MORA ${index + 1} · ${statusValue}`);
  }

  private clearPlaybackTimers(): void {
    if (this.playbackTimer) window.clearTimeout(this.playbackTimer);
    this.playbackTimer = 0;
    for (const timer of this.tokenTimers) window.clearTimeout(timer);
    this.tokenTimers = [];
    for (const unit of this.root.querySelectorAll<HTMLElement>('[data-voice-unit]')) unit.classList.remove('speaking');
  }

  private stop(): void {
    this.clearPlaybackTimers();
    this.synth.stop();
    this.systemSpeechGeneration += 1;
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    this.required<HTMLButtonElement>('#voice-play').textContent = '▶ SPEAK';
    if (this.active) this.setStatus(this.settings.engine === 'local' ? 'READY · LOCAL DSP' : 'READY · SYSTEM TTS');
  }

  private async play(): Promise<void> {
    this.stop();
    const text = this.required<HTMLTextAreaElement>('#voice-text').value.trim();
    if (!text) {
      this.setStatus('ENTER TEXT');
      return;
    }

    const markup = parseVoiceMarkup(text);
    if (this.settings.engine === 'system') {
      this.playSystem(markup);
      return;
    }

    let resolved = this.resolveLocalScript(text);
    if (containsKanji(markup.plainText) && !resolved.analyzed) {
      this.setStatus('KANJI DETECTED · AUTO G2P');
      const analyzed = await this.analyzeJapanese();
      if (!analyzed) {
        this.setStatus('KANJI G2P FAILED · FALLING BACK TO SYSTEM TTS');
        this.playSystem(markup);
        return;
      }
      resolved = this.resolveLocalScript(text);
    }

    const { script, localExpressions } = resolved;
    if (script.units.length === 0) {
      this.setStatus('LOCAL DSP NEEDS KANA OR ROMAJI');
      return;
    }

    try {
      this.setStatus('SCHEDULING · LOW-LATENCY STREAM');
      const plan = await this.synth.play(script, this.settings, this.getProsodyEdits(localExpressions));
      this.required<HTMLButtonElement>('#voice-play').textContent = '■ SPEAKING';
      this.setStatus(`SPEAKING · ${script.units.length} UNITS · ${plan.duration.toFixed(1)}s`);
      for (const timed of plan.units.slice(0, 72)) {
        const timer = window.setTimeout(() => {
          const unit = this.root.querySelector<HTMLElement>(`[data-voice-unit="${timed.unit.index}"]`);
          if (!unit) return;
          unit.classList.add('speaking');
          window.setTimeout(() => unit.classList.remove('speaking'), Math.max(80, timed.duration * 1000));
        }, Math.max(0, timed.start * 1000));
        this.tokenTimers.push(timer);
      }
      this.playbackTimer = window.setTimeout(() => {
        this.clearPlaybackTimers();
        this.required<HTMLButtonElement>('#voice-play').textContent = '▶ SPEAK';
        this.setStatus('READY · LOCAL DSP');
      }, Math.ceil((plan.duration + 0.1) * 1000));
    } catch (error) {
      console.warn('VOICE LAB local synthesis failed.', error);
      this.setStatus('LOCAL VOICE ENGINE UNAVAILABLE');
    }
  }

  private playSystem(script: VoiceMarkupScript): void {
    if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
      this.setStatus('SYSTEM TTS UNAVAILABLE');
      return;
    }

    const segments = script.speechSegments.filter((segment) => segment.text.trim().length > 0);
    if (segments.length === 0) {
      this.setStatus('ENTER TEXT');
      return;
    }

    const generation = ++this.systemSpeechGeneration;
    const voices = window.speechSynthesis.getVoices();
    const voice = voices.find((candidate) => candidate.lang.toLowerCase().startsWith('ja'))
      ?? voices.find((candidate) => candidate.lang.toLowerCase().startsWith('en'))
      ?? null;
    let segmentIndex = 0;

    const speakNext = (): void => {
      if (generation !== this.systemSpeechGeneration) return;
      const segment = segments[segmentIndex];
      if (!segment) {
        this.required<HTMLButtonElement>('#voice-play').textContent = '▶ SPEAK';
        this.setStatus('READY · SYSTEM TTS');
        return;
      }
      segmentIndex += 1;

      const expressionSettings = segment.expression ?? this.settings.expression;
      const expression = voiceExpressionControl(expressionSettings);
      const utterance = new SpeechSynthesisUtterance(segment.text);
      utterance.voice = voice;
      utterance.lang = voice?.lang ?? 'ja-JP';
      utterance.rate = clamp(
        this.settings.rate / expression.durationScale,
        0.55,
        1.75,
      );
      utterance.pitch = clamp(
        0.7
          + (this.settings.pitch - 45) / 31 * 0.8
          + (this.settings.tone + expression.toneOffset) * 0.12
          + expression.pitchShift * 0.06,
        0.5,
        1.75,
      );
      utterance.volume = clamp(this.settings.energy * expression.energyScale, 0.35, 1);
      utterance.onstart = () => {
        if (generation !== this.systemSpeechGeneration) return;
        this.required<HTMLButtonElement>('#voice-play').textContent = '■ SPEAKING';
        this.setStatus(
          `SYSTEM TTS · ${expressionSettings.preset.toUpperCase()} · ${voice?.name ?? 'DEFAULT VOICE'}`,
        );
      };
      utterance.onend = () => {
        if (generation !== this.systemSpeechGeneration) return;
        speakNext();
      };
      utterance.onerror = () => {
        if (generation !== this.systemSpeechGeneration) return;
        this.required<HTMLButtonElement>('#voice-play').textContent = '▶ SPEAK';
        this.setStatus('SYSTEM TTS FAILED');
      };
      window.speechSynthesis.speak(utterance);
    };

    speakNext();
  }

  private async exportWav(): Promise<void> {
    if (this.settings.engine !== 'local') return;
    const text = this.required<HTMLTextAreaElement>('#voice-text').value.trim();
    const markup = parseVoiceMarkup(text);
    let resolved = this.resolveLocalScript(text);
    if (containsKanji(markup.plainText) && !resolved.analyzed) {
      this.setStatus('KANJI DETECTED · AUTO G2P FOR WAV');
      const analyzed = await this.analyzeJapanese();
      if (!analyzed) {
        this.setStatus('WAV EXPORT NEEDS KANJI G2P · USE SYSTEM TTS TO LISTEN');
        return;
      }
      resolved = this.resolveLocalScript(text);
    }

    const { script, localExpressions } = resolved;
    if (script.units.length === 0) {
      this.setStatus('LOCAL DSP NEEDS KANA OR ROMAJI');
      return;
    }

    const button = this.required<HTMLButtonElement>('#voice-export-wav');
    this.stop();
    button.disabled = true;
    button.textContent = 'RENDERING…';
    this.setStatus('RENDERING WAV · REAL-TIME LOCAL CAPTURE');
    try {
      const blob = await this.synth.renderWav(script, this.settings, this.getProsodyEdits(localExpressions));
      downloadBlob(blob, `${safeFilename(markup.plainText)}.wav`);
      this.setStatus(`WAV EXPORTED · ${Math.round(blob.size / 1024)} KB`);
    } catch (error) {
      console.warn('VOICE LAB WAV export failed.', error);
      this.setStatus('WAV EXPORT FAILED');
    } finally {
      button.disabled = false;
      button.textContent = 'EXPORT WAV';
    }
  }

  private setStatus(message: string): void {
    this.required<HTMLElement>('#voice-status').textContent = message;
  }
}
