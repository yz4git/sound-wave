import type { VocalStyle } from '../compose/VocalGenerator';
import { downloadBlob } from '../compose/SongExport';
import { VOICE_CHARACTER_PRESETS, validVoiceCharacterPreset, type VoiceCharacterPreset } from '../compose/VoiceCharacter';
import { type VoiceIntonation } from './VoiceScript';
import {
  applyAccentNucleus,
  cloneVoiceScript,
  collectAccentPhrases,
} from './VoiceAccentEditor';
import {
  loadVoiceAccentOverrides,
  saveVoiceAccentOverrides,
  type VoiceAccentOverride,
} from './VoiceAccentStore';
import {
  applyPhraseBoundaryOverrides,
  buildPhraseControlArrays,
  phraseCurveAtProgress,
  phraseCurvePointFromDrag,
  phraseEmphasisPreset,
  phrasePitchFromDrag,
  updatePhraseBoundaryOverride,
  updatePhraseShapeOverride,
  type VoiceEmphasisPreset,
  type VoicePhraseBoundaryOverride,
  type VoicePhraseShapeOverride,
} from './VoicePhraseEditor';
import {
  loadVoicePhraseEdits,
  saveVoicePhraseEdits,
} from './VoicePhraseStore';
import {
  VoiceSynth,
  type VoiceProsodyEdits,
  type VoiceRenderQuality,
  type VoiceSynthSettings,
} from './VoiceSynth';
import {
  mapLocalExpressionsToRanges,
  parseVoiceMarkup,
  removeVoiceMarkup,
  wrapVoiceSelection,
  type VoiceMarkupScript,
} from './VoiceMarkup';
import {
  analyzeJapaneseText,
  containsKanji,
  japaneseFirstUsePlaybackStrategy,
  needsJapanesePronunciationAnalysis,
  type JapaneseG2PAnalysis,
} from './JapaneseG2P';
import { remapVoiceSpeechEvents, type VoiceScript } from './VoiceScript';
import { getVoiceProsodyWindow } from './VoiceProsodyWindow';
import {
  clearVoiceProsodySnapshot,
  loadVoiceProsodySnapshot,
  saveVoiceProsodySnapshot,
  voiceProsodyKey,
} from './VoiceProsodyStore';
import {
  VOICE_EXPRESSION_PRESETS,
  validVoiceExpressionPreset,
  voiceExpressionControl,
  type VoiceExpressionSettings,
} from './VoiceExpression';
import {
  analyzeVoiceImprint,
  resampleVoiceReference,
  validVoiceIdentityImprint,
  type VoiceIdentityImprint,
} from './VoiceImprint';
import { BrowserNeuralVoice } from './NeuralVoice';

type VoiceEngine = 'local' | 'neural' | 'system';
type ProsodyLane = 'pitch' | 'energy' | 'duration';

interface VoiceLabSettings extends VoiceSynthSettings {
  engine: VoiceEngine;
  quality: VoiceRenderQuality;
  expression: VoiceExpressionSettings;
}

interface VoiceImprintCacheEntry {
  digest: string;
  savedAt: number;
  imprint: VoiceIdentityImprint;
}

const STORAGE_KEY = 'sound-wave-voice-lab-settings-v1';
const VOICE_IMPRINT_CACHE_KEY = 'sound-wave-voice-imprint-cache-v1';
const VOICE_IMPRINT_CACHE_LIMIT = 6;
const DEFAULT_TEXT = 'こんにちは。おんせい ごうせいの じっけんです。ことばの たかさと いきおいを かえてみましょう。';
const STYLES: readonly VocalStyle[] = ['warm', 'bright', 'airy'];
const INTONATIONS: readonly VoiceIntonation[] = ['auto', 'natural', 'flat', 'rise', 'fall', 'question'];
const LOCAL_DELIVERY_PRESETS = ['calm', 'excited', 'serious', 'whisper', 'narration'] as const;

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

function validStyle(value: unknown): value is VocalStyle {
  return typeof value === 'string' && STYLES.includes(value as VocalStyle);
}

function validIntonation(value: unknown): value is VoiceIntonation {
  return typeof value === 'string' && INTONATIONS.includes(value as VoiceIntonation);
}

function validEngine(value: unknown): value is VoiceEngine {
  return value === 'local' || value === 'neural' || value === 'system';
}

function validQuality(value: unknown): value is VoiceRenderQuality {
  return value === 'fast' || value === 'hq';
}

function safeFilename(text: string): string {
  const normalized = text.trim().slice(0, 28).replace(/[\\/:*?"<>|\s]+/g, '-').replace(/-+/g, '-');
  return normalized || 'sound-wave-voice';
}

export class VoiceMode {
  private readonly root: HTMLElement;
  private readonly synth = new VoiceSynth();
  private readonly neural = new BrowserNeuralVoice();
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
  private prosodyLoadedSignature = '';
  private accentOverrides: VoiceAccentOverride[] = [];
  private accentOverrideSource = '';
  private phraseBoundaries: VoicePhraseBoundaryOverride[] = [];
  private phraseShapes: VoicePhraseShapeOverride[] = [];
  private phraseEditSource = '';
  private phrasePitchDrag: {
    pointerId: number;
    start: number;
    end: number;
    startY: number;
    startPitch: number;
    currentPitch: number;
    handle: HTMLElement;
  } | null = null;
  private phraseCurveDrag: {
    pointerId: number;
    start: number;
    end: number;
    point: 'start' | 'peak' | 'end';
    startY: number;
    startValue: number;
    currentValue: number;
    handle: SVGCircleElement;
    valueLabel: HTMLElement;
  } | null = null;

  private readonly syncVisualViewport = (): void => {
    const viewport = window.visualViewport;
    const width = viewport?.width ?? window.innerWidth;
    const height = viewport?.height ?? window.innerHeight;
    const left = viewport?.offsetLeft ?? 0;
    const top = viewport?.offsetTop ?? 0;
    this.root.style.setProperty('--voice-viewport-width', `${Math.round(width)}px`);
    this.root.style.setProperty('--voice-viewport-height', `${Math.round(height)}px`);
    this.root.style.setProperty('--voice-viewport-left', `${Math.round(left)}px`);
    this.root.style.setProperty('--voice-viewport-top', `${Math.round(top)}px`);
  };

  constructor(root: HTMLElement) {
    this.root = root;
    // Escape #app's game-only overflow:hidden boundary. iOS Safari can clip
    // fixed descendants to a fixed/overflow-hidden ancestor even when the
    // child itself is scrollable.
    if (this.root.parentElement !== document.body) document.body.append(this.root);
    this.settings = this.loadSettings();
    this.renderShell();
    this.bindEvents();
    this.syncControls();
    this.refreshPlan();
  }

  get isActive(): boolean { return this.active; }

  async activate(): Promise<void> {
    this.active = true;
    document.documentElement.classList.add('voice-lab-open');
    document.body.classList.add('voice-lab-open');
    this.syncVisualViewport();
    window.addEventListener('resize', this.syncVisualViewport);
    window.visualViewport?.addEventListener('resize', this.syncVisualViewport);
    window.visualViewport?.addEventListener('scroll', this.syncVisualViewport);
    this.root.classList.add('active');
    this.root.setAttribute('aria-hidden', 'false');
    this.root.scrollTop = 0;
    if (this.settings.engine === 'local') await this.synth.unlock();
    this.refreshPlan();
  }

  deactivate(): void {
    this.active = false;
    this.stop();
    this.synth.suspend();
    this.root.classList.remove('active');
    this.root.setAttribute('aria-hidden', 'true');
    window.removeEventListener('resize', this.syncVisualViewport);
    window.visualViewport?.removeEventListener('resize', this.syncVisualViewport);
    window.visualViewport?.removeEventListener('scroll', this.syncVisualViewport);
    document.documentElement.classList.remove('voice-lab-open');
    document.body.classList.remove('voice-lab-open');
  }

  private loadSettings(): VoiceLabSettings {
    const fallback: VoiceLabSettings = {
      engine: 'local',
      quality: 'hq',
      style: 'warm',
      character: 'natural',
      tone: 0,
      tractLength: 0,
      identityImprint: null,
      rate: 1,
      pitch: 60,
      energy: 0.92,
      intonation: 'auto',
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
        quality: validQuality(parsed.quality) ? parsed.quality : fallback.quality,
        style: validStyle(parsed.style) ? parsed.style : fallback.style,
        character: validVoiceCharacterPreset(parsed.character) ? parsed.character : fallback.character,
        tone: clamp(Number(parsed.tone) || 0, -1, 1),
        tractLength: clamp(Number(parsed.tractLength) || 0, -1, 1),
        identityImprint: validVoiceIdentityImprint(parsed.identityImprint)
          ? parsed.identityImprint
          : null,
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
          <div class="voice-engine voice-engine-source" role="group" aria-label="Voice engine">
            <button type="button" data-voice-engine="local">SOUND WAVE DSP</button>
            <button type="button" data-voice-engine="neural">NEURAL HQ</button>
            <button type="button" data-voice-engine="system">SYSTEM TTS</button>
          </div>
          <div class="voice-engine" role="group" aria-label="Local render quality">
            <button type="button" data-voice-quality="fast">FAST DSP</button>
            <button type="button" data-voice-quality="hq">HQ REFINE</button>
          </div>
          <p class="voice-engine-note">DSP HQ · editable source/filter renderer · NEURAL HQ · Kokoro 82M q8 + Open JTalk, loaded only on first use</p>
          <div class="voice-japanese-tools">
            <button type="button" id="voice-analyze-japanese">JAPANESE G2P</button>
            <span id="voice-japanese-status">Open JTalk reading + pitch accent · kanji / おう / えい · first use ~24MB dictionary</span>
          </div>
          <p class="voice-engine-note">SPEECH EVENTS · （笑） （ため息） （息） （言い直し） （思い直し）</p>
          <div id="voice-accent-editor" class="voice-accent-editor" hidden aria-label="Japanese accent phrase editor"></div>
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
            <label><span id="voice-vtl-label">VTL 0</span><input id="voice-vtl" type="range" min="-100" max="100" step="1" /></label>
            <div class="voice-imprint">
              <input id="voice-imprint-file" type="file" accept="audio/*" hidden />
              <div class="voice-imprint-actions">
                <button type="button" id="voice-imprint-load">VOICE IMPRINT</button>
                <button type="button" id="voice-imprint-clear">CLEAR</button>
              </div>
              <span id="voice-imprint-status">NO IMPRINT · 3–10 s clear single voice recommended</span>
            </div>
          </div>

          <div class="voice-control-group">
            <label><span>INTONATION</span><select id="voice-intonation">
              <option value="auto">AUTO · JAPANESE CONTEXT</option>
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
      this.prosodyLoadedSignature = '';
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
      this.persistProsodyEdits();
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

    const accentEditor = this.required<HTMLElement>('#voice-accent-editor');
    accentEditor.addEventListener('pointerdown', (event) => {
      const curveHandle = (event.target as Element).closest<SVGCircleElement>('[data-phrase-curve]');
      if (curveHandle) {
        const start = Number(curveHandle.dataset.phraseStart);
        const end = Number(curveHandle.dataset.phraseEnd);
        const point = curveHandle.dataset.phraseCurve;
        if (
          !Number.isInteger(start)
          || !Number.isInteger(end)
          || (point !== 'start' && point !== 'peak' && point !== 'end')
        ) return;
        event.preventDefault();

        const existing = this.phraseShapes.find((shape) => (
          shape.start === start && shape.end === end
        ));
        const startValue = point === 'start'
          ? existing?.curveStart ?? 0
          : point === 'peak'
            ? existing?.curvePeak ?? 0
            : existing?.curveEnd ?? 0;
        const valueLabel = curveHandle
          .closest<HTMLElement>('.voice-phrase-curve')
          ?.querySelector<HTMLElement>('.voice-phrase-curve-value');
        if (!valueLabel) return;

        this.phraseCurveDrag = {
          pointerId: event.pointerId,
          start,
          end,
          point,
          startY: event.clientY,
          startValue,
          currentValue: startValue,
          handle: curveHandle,
          valueLabel,
        };
        accentEditor.setPointerCapture(event.pointerId);
        curveHandle.classList.add('dragging');
        return;
      }

      const dragHandle = (event.target as Element).closest<HTMLElement>('[data-phrase-drag]');
      if (dragHandle) {
        const start = Number(dragHandle.dataset.phraseStart);
        const end = Number(dragHandle.dataset.phraseEnd);
        if (!Number.isInteger(start) || !Number.isInteger(end)) return;
        event.preventDefault();

        const existing = this.phraseShapes.find((shape) => (
          shape.start === start && shape.end === end
        ));
        const startPitch = existing?.pitchOffset ?? 0;
        this.phrasePitchDrag = {
          pointerId: event.pointerId,
          start,
          end,
          startY: event.clientY,
          startPitch,
          currentPitch: startPitch,
          handle: dragHandle,
        };
        accentEditor.setPointerCapture(event.pointerId);
        dragHandle.classList.add('dragging');
        return;
      }

      const target = (event.target as HTMLElement).closest<HTMLButtonElement>(
        'button[data-accent-action],button[data-phrase-action]',
      );
      if (!target) return;
      event.preventDefault();

      const phraseAction = target.dataset.phraseAction;
      if (phraseAction) {
        if (phraseAction === 'reset-all') {
          this.phraseBoundaries = [];
          this.phraseShapes = [];
          this.savePhraseEdits();
          this.refreshPlan();
          this.setStatus('PHRASE EDITS RESET · OPEN JTALK BOUNDARIES');
          return;
        }

        const after = Number(target.dataset.phraseAfter);
        if (phraseAction === 'split' || phraseAction === 'join') {
          if (!Number.isInteger(after)) return;
          this.setPhraseBoundary(after, phraseAction === 'split' ? 'accent' : 'none');
          return;
        }

        const start = Number(target.dataset.phraseStart);
        const end = Number(target.dataset.phraseEnd);
        if (!Number.isInteger(start) || !Number.isInteger(end)) return;

        if (phraseAction === 'pitch-down') this.adjustPhraseShape(start, end, -0.25, 0, 0, 0);
        else if (phraseAction === 'pitch-up') this.adjustPhraseShape(start, end, 0.25, 0, 0, 0);
        else if (phraseAction === 'rate-down') this.adjustPhraseShape(start, end, 0, -0.05, 0, 0);
        else if (phraseAction === 'rate-up') this.adjustPhraseShape(start, end, 0, 0.05, 0, 0);
        else if (phraseAction === 'energy-down') this.adjustPhraseShape(start, end, 0, 0, -0.05, 0);
        else if (phraseAction === 'energy-up') this.adjustPhraseShape(start, end, 0, 0, 0.05, 0);
        else if (phraseAction === 'emphasis-down') this.adjustPhraseShape(start, end, 0, 0, 0, -0.25);
        else if (phraseAction === 'emphasis-up') this.adjustPhraseShape(start, end, 0, 0, 0, 0.25);
        else if (phraseAction === 'emphasis-weak') this.applyPhraseEmphasisPreset(start, end, 'weak');
        else if (phraseAction === 'emphasis-normal') this.applyPhraseEmphasisPreset(start, end, 'normal');
        else if (phraseAction === 'emphasis-strong') this.applyPhraseEmphasisPreset(start, end, 'strong');
        else if (phraseAction === 'emphasis-critical') this.applyPhraseEmphasisPreset(start, end, 'critical');
        else if (phraseAction === 'pause-down') this.adjustPhrasePause(end, -0.025);
        else if (phraseAction === 'pause-up') this.adjustPhrasePause(end, 0.025);
        return;
      }

      const action = target.dataset.accentAction;
      if (action === 'reset-all') {
        this.accentOverrides = [];
        this.saveAccentOverrides();
        this.refreshPlan();
        this.setStatus('ACCENT EDITS RESET · OPEN JTALK AUTO');
        return;
      }

      const start = Number(target.dataset.accentStart);
      const end = Number(target.dataset.accentEnd);
      if (!Number.isInteger(start) || !Number.isInteger(end)) return;

      if (action === 'auto') {
        this.setAccentOverride(start, end, null);
        return;
      }

      const nucleus = Number(target.dataset.accentNucleus);
      if (!Number.isInteger(nucleus)) return;
      this.setAccentOverride(start, end, nucleus);
    }, { passive: false });

    accentEditor.addEventListener('pointermove', (event) => {
      const curveDrag = this.phraseCurveDrag;
      if (curveDrag && curveDrag.pointerId === event.pointerId) {
        event.preventDefault();
        const nextValue = phraseCurvePointFromDrag(
          curveDrag.startValue,
          event.clientY - curveDrag.startY,
        );
        if (Math.abs(nextValue - curveDrag.currentValue) < 0.001) return;

        curveDrag.currentValue = nextValue;
        this.setPhraseCurvePointWithoutRefresh(
          curveDrag.start,
          curveDrag.end,
          curveDrag.point,
          nextValue,
        );
        curveDrag.handle.setAttribute('cy', String(24 - nextValue * 6.4));
        curveDrag.valueLabel.textContent =
          `${curveDrag.point.toUpperCase()} ${nextValue >= 0 ? '+' : ''}${nextValue.toFixed(1)}st`;
        return;
      }

      const drag = this.phrasePitchDrag;
      if (!drag || drag.pointerId !== event.pointerId) return;
      event.preventDefault();

      const nextPitch = phrasePitchFromDrag(
        drag.startPitch,
        event.clientY - drag.startY,
      );
      if (Math.abs(nextPitch - drag.currentPitch) < 0.001) return;

      drag.currentPitch = nextPitch;
      this.setPhrasePitchWithoutRefresh(drag.start, drag.end, nextPitch);
      drag.handle.textContent = `↕ F0 ${nextPitch >= 0 ? '+' : ''}${nextPitch.toFixed(1)}st`;
    }, { passive: false });

    const finishPhraseDrag = (event: PointerEvent): void => {
      const curveDrag = this.phraseCurveDrag;
      if (curveDrag && curveDrag.pointerId === event.pointerId) {
        event.preventDefault();
        curveDrag.handle.classList.remove('dragging');
        this.phraseCurveDrag = null;
        if (accentEditor.hasPointerCapture(event.pointerId)) {
          accentEditor.releasePointerCapture(event.pointerId);
        }
        this.savePhraseEdits();
        this.refreshPlan();
        this.setStatus(
          `PHRASE CURVE ${curveDrag.point.toUpperCase()} · ${curveDrag.currentValue >= 0 ? '+' : ''}${curveDrag.currentValue.toFixed(1)} ST`,
        );
        return;
      }

      const drag = this.phrasePitchDrag;
      if (!drag || drag.pointerId !== event.pointerId) return;
      event.preventDefault();

      drag.handle.classList.remove('dragging');
      if (accentEditor.hasPointerCapture(event.pointerId)) {
        accentEditor.releasePointerCapture(event.pointerId);
      }
      this.phrasePitchDrag = null;
      this.savePhraseEdits();
      this.refreshPlan();
      this.setStatus(`PHRASE F0 · ${drag.currentPitch >= 0 ? '+' : ''}${drag.currentPitch.toFixed(1)} ST`);
    };
    accentEditor.addEventListener('pointerup', finishPhraseDrag, { passive: false });
    accentEditor.addEventListener('pointercancel', finishPhraseDrag, { passive: false });

    this.required<HTMLButtonElement>('#voice-reset-prosody').addEventListener('pointerdown', (event) => {
      event.preventDefault();
      this.resetProsodyEdits();
      this.clearPersistedProsodyEdits();
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

    const imprintFile = this.required<HTMLInputElement>('#voice-imprint-file');
    this.required<HTMLButtonElement>('#voice-imprint-load').addEventListener('pointerdown', (event) => {
      event.preventDefault();
      if (this.settings.engine !== 'local') return;
      imprintFile.click();
    }, { passive: false });
    imprintFile.addEventListener('change', () => {
      const file = imprintFile.files?.[0];
      imprintFile.value = '';
      if (file) void this.loadVoiceImprint(file);
    });
    this.required<HTMLButtonElement>('#voice-imprint-clear').addEventListener('pointerdown', (event) => {
      event.preventDefault();
      if (!this.settings.identityImprint) return;
      this.settings.identityImprint = null;
      this.saveSettings();
      this.stop();
      this.syncControls();
      this.refreshPlan();
      this.setStatus('VOICE IMPRINT CLEARED');
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

    for (const button of this.root.querySelectorAll<HTMLButtonElement>('[data-voice-quality]')) {
      button.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        const quality = button.dataset.voiceQuality;
        if (!validQuality(quality)) return;
        this.settings.quality = quality;
        this.saveSettings();
        this.stop();
        this.syncControls();
        this.refreshPlan();
        this.setStatus(
          quality === 'hq'
            ? 'READY · HQ REFINE · 2× SOURCE + RESIDUAL'
            : 'READY · FAST DSP',
        );
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
    this.required<HTMLInputElement>('#voice-vtl').addEventListener('input', (event) => {
      this.settings.tractLength = Number((event.target as HTMLInputElement).value) / 100;
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
    this.required<HTMLInputElement>('#voice-vtl').value = String(Math.round((this.settings.tractLength ?? 0) * 100));
    this.required<HTMLInputElement>('#voice-rate').value = String(Math.round(this.settings.rate * 100));
    this.required<HTMLInputElement>('#voice-pitch').value = String(Math.round(this.settings.pitch));
    this.required<HTMLInputElement>('#voice-energy').value = String(Math.round(this.settings.energy * 100));

    for (const button of this.root.querySelectorAll<HTMLButtonElement>('[data-voice-engine]')) {
      button.classList.toggle('active', button.dataset.voiceEngine === this.settings.engine);
    }
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('[data-voice-quality]')) {
      button.classList.toggle('active', button.dataset.voiceQuality === this.settings.quality);
      button.disabled = this.settings.engine !== 'local';
    }
    this.required<HTMLButtonElement>('#voice-analyze-japanese').disabled =
      this.settings.engine !== 'local' || this.japaneseAnalyzing;
    this.required<HTMLButtonElement>('#voice-export-wav').disabled = this.settings.engine !== 'local';
    this.required<HTMLButtonElement>('#voice-imprint-load').disabled = this.settings.engine !== 'local';
    this.required<HTMLButtonElement>('#voice-imprint-clear').disabled =
      this.settings.engine !== 'local' || !this.settings.identityImprint;
    const imprintStatus = this.required<HTMLElement>('#voice-imprint-status');
    const imprint = this.settings.identityImprint;
    imprintStatus.textContent = imprint
      ? `IMPRINT · ${imprint.quality?.label.toUpperCase() ?? 'LEGACY'} · ${imprint.medianF0Hz.toFixed(0)} Hz · CONF ${Math.round(imprint.confidence * 100)}% · ${imprint.analyzedSeconds.toFixed(1)} s`
      : 'NO IMPRINT · 3–10 s clear single voice · normalized to 48 kHz mono';
    this.required<HTMLButtonElement>('#voice-reset-prosody').disabled = this.settings.engine !== 'local';
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('[data-prosody-lane]')) {
      button.disabled = this.settings.engine !== 'local';
    }
    this.required<HTMLElement>('#voice-contour').classList.toggle('disabled', this.settings.engine !== 'local');
    this.syncProsodyLaneUi();
    this.syncLabels();
  }

  private loadVoiceImprintCache(): VoiceImprintCacheEntry[] {
    try {
      const raw = localStorage.getItem(VOICE_IMPRINT_CACHE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((entry): entry is VoiceImprintCacheEntry => {
        if (!entry || typeof entry !== 'object') return false;
        const candidate = entry as Partial<VoiceImprintCacheEntry>;
        return typeof candidate.digest === 'string'
          && /^[0-9a-f]{64}$/.test(candidate.digest)
          && typeof candidate.savedAt === 'number'
          && Number.isFinite(candidate.savedAt)
          && validVoiceIdentityImprint(candidate.imprint);
      });
    } catch {
      return [];
    }
  }

  private saveVoiceImprintCache(digest: string, imprint: VoiceIdentityImprint): void {
    try {
      const next = [
        { digest, savedAt: Date.now(), imprint },
        ...this.loadVoiceImprintCache().filter((entry) => entry.digest !== digest),
      ].slice(0, VOICE_IMPRINT_CACHE_LIMIT);
      localStorage.setItem(VOICE_IMPRINT_CACHE_KEY, JSON.stringify(next));
    } catch {
      // Restricted storage should never block local analysis.
    }
  }

  private async normalizedReferenceDigest(samples: Float32Array): Promise<string | null> {
    try {
      if (!globalThis.crypto?.subtle) return null;
      const bytes = new ArrayBuffer(samples.byteLength);
      new Uint8Array(bytes).set(
        new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength),
      );
      const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
      return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    } catch {
      return null;
    }
  }

  private applyVoiceImprint(imprint: VoiceIdentityImprint): void {
    this.settings.identityImprint = imprint;
    if (imprint.confidence >= 0.5) {
      this.settings.pitch = clamp(imprint.suggestedPitchMidi, 45, 76);
    }
    this.saveSettings();
    this.stop();
    this.syncControls();
    this.refreshPlan();
  }

  private async loadVoiceImprint(file: File): Promise<void> {
    const loadButton = this.required<HTMLButtonElement>('#voice-imprint-load');
    if (file.size > 48 * 1024 * 1024) {
      this.setStatus('VOICE IMPRINT · FILE TOO LARGE');
      return;
    }

    loadButton.disabled = true;
    loadButton.textContent = 'ANALYZING…';
    this.setStatus('VOICE IMPRINT · ANALYZING LOCAL AUDIO');
    let context: AudioContext | null = null;
    try {
      context = new AudioContext();
      const encoded = await file.arrayBuffer();
      const audio = await context.decodeAudioData(encoded.slice(0));
      const seconds = audio.duration;
      if (seconds < 0.5 || seconds > 120) {
        throw new Error('Reference audio must be between 0.5 and 120 seconds');
      }

      const maxFrames = Math.min(audio.length, Math.floor(audio.sampleRate * 20));
      const mono = new Float32Array(maxFrames);
      for (let channel = 0; channel < audio.numberOfChannels; channel += 1) {
        const source = audio.getChannelData(channel);
        const scale = 1 / audio.numberOfChannels;
        for (let i = 0; i < maxFrames; i += 1) {
          mono[i] = (mono[i] ?? 0) + (source[i] ?? 0) * scale;
        }
      }

      // Irodori normalizes reference audio to 48 kHz mono before speaker
      // conditioning. Do the same for deterministic browser-side statistics.
      const normalized = resampleVoiceReference(mono, audio.sampleRate, 48_000);
      const digest = await this.normalizedReferenceDigest(normalized);
      if (digest) {
        const cached = this.loadVoiceImprintCache().find((entry) => entry.digest === digest);
        if (cached) {
          this.applyVoiceImprint(cached.imprint);
          this.setStatus(
            `VOICE IMPRINT READY · CACHE HIT · ${cached.imprint.quality?.label.toUpperCase() ?? 'OK'} · ${cached.imprint.medianF0Hz.toFixed(0)} Hz`,
          );
          return;
        }
      }

      const analysis = analyzeVoiceImprint(normalized, 48_000);
      this.applyVoiceImprint(analysis.imprint);
      if (digest) this.saveVoiceImprintCache(digest, analysis.imprint);
      this.setStatus(
        `VOICE IMPRINT READY · ${analysis.quality.label.toUpperCase()} · 48 kHz · F0 ${analysis.imprint.medianF0Hz.toFixed(0)} Hz · ${Math.round(analysis.imprint.confidence * 100)}%`,
      );
    } catch (error) {
      console.warn('VOICE LAB imprint analysis failed.', error);
      this.setStatus('VOICE IMPRINT FAILED · USE CLEAR SOLO SPEECH');
    } finally {
      if (context) void context.close();
      loadButton.textContent = 'VOICE IMPRINT';
      loadButton.disabled = this.settings.engine !== 'local';
    }
  }

  private syncLabels(): void {
    this.required<HTMLElement>('#voice-expression-label').textContent =
      `STYLE INTENSITY ${Math.round(this.settings.expression.intensity * 100)}%`;
    this.required<HTMLElement>('#voice-tone-label').textContent = `TONE ${this.settings.tone >= 0 ? '+' : ''}${Math.round(this.settings.tone * 100)}`;
    const tractLength = this.settings.tractLength ?? 0;
    this.required<HTMLElement>('#voice-vtl-label').textContent =
      `VTL ${tractLength >= 0 ? '+' : ''}${Math.round(tractLength * 100)}`;
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
    this.prosodyLoadedSignature = '';
    this.accentOverrides = [];
    this.accentOverrideSource = '';
    this.phraseBoundaries = [];
    this.phraseShapes = [];
    this.phraseEditSource = '';
    const status = this.root.querySelector<HTMLElement>('#voice-japanese-status');
    if (status) {
      status.textContent = 'Open JTalk reading + pitch accent · kanji / おう / えい · first use ~24MB dictionary';
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
      && this.japaneseAnalysisSource === text;
    const localExpressions = analyzed
      ? mapLocalExpressionsToRanges(
          markup.speechSegments,
          this.japaneseAnalysis!.unitSourceRanges,
        )
      : markup.localExpressions;

    let script: VoiceScript = markup;
    if (analyzed) {
      script = cloneVoiceScript(this.japaneseAnalysis!.script);
      script.events = remapVoiceSpeechEvents(
        markup.events,
        this.japaneseAnalysis!.unitSourceRanges,
      );
      this.ensurePhraseEdits(markup.plainText);
      applyPhraseBoundaryOverrides(script, this.phraseBoundaries);

      this.ensureAccentOverrides(markup.plainText);
      const phrases = collectAccentPhrases(script);
      for (const override of this.accentOverrides) {
        const phrase = phrases.find((candidate) => (
          candidate.start === override.start && candidate.end === override.end
        ));
        if (!phrase) continue;
        applyAccentNucleus(script, override.start, override.end, override.nucleus);
      }
    }

    return {
      script,
      markup,
      localExpressions,
      analyzed,
    };
  }

  private async analyzeJapanese(interruptPlayback = true): Promise<boolean> {
    if (this.japaneseAnalyzing) {
      if (interruptPlayback) this.setStatus('JAPANESE G2P · ANALYSIS ALREADY RUNNING');
      return false;
    }
    const textarea = this.required<HTMLTextAreaElement>('#voice-text');
    const text = textarea.value.trim();
    if (!text) {
      if (interruptPlayback) this.setStatus('ENTER JAPANESE TEXT');
      return false;
    }

    const markup = parseVoiceMarkup(text);
    if (!needsJapanesePronunciationAnalysis(markup.plainText)) {
      if (interruptPlayback) this.setStatus('JAPANESE G2P · NO AMBIGUOUS READING TO ANALYZE');
      return false;
    }

    const button = this.required<HTMLButtonElement>('#voice-analyze-japanese');
    const detail = this.required<HTMLElement>('#voice-japanese-status');
    this.japaneseAnalyzing = true;
    button.disabled = true;
    button.textContent = interruptPlayback ? 'ANALYZING…' : 'G2P LOADING…';
    if (interruptPlayback) this.stop();

    try {
      const analysis = await analyzeJapaneseText(markup.plainText, (progress) => {
        detail.textContent = progress.message;
        if (interruptPlayback) this.setStatus(progress.message);
      });
      if (textarea.value.trim() !== text) return false;

      this.japaneseAnalysis = analysis;
      this.japaneseAnalysisSource = text;
      this.accentOverrideSource = '';
      this.phraseEditSource = '';
      this.resetProsodyEdits();
      this.prosodyLoadedSignature = '';
      this.refreshPlan();
      detail.textContent = `OPEN JTALK · ${analysis.script.units.length} morae · ${analysis.fullContextMatched ? 'FULL CONTEXT · ' : ''}${analysis.reading.slice(0, 48)}${analysis.reading.length > 48 ? '…' : ''}`;
      if (interruptPlayback) {
        this.setStatus(
          markup.markupUsed
            ? `JAPANESE G2P READY · ${analysis.fullContextMatched ? 'FULL CONTEXT + ' : ''}PITCH ACCENT + LOCAL DELIVERY`
            : `JAPANESE G2P READY · ${analysis.fullContextMatched ? 'FULL CONTEXT + ' : ''}READING + PITCH ACCENT`,
        );
      }
      return true;
    } catch (error) {
      console.warn('VOICE LAB Japanese G2P failed.', error);
      if (textarea.value.trim() === text) {
        this.clearJapaneseAnalysis();
        detail.textContent = 'Open JTalk failed · quick kana and SYSTEM TTS remain available';
        if (interruptPlayback) this.setStatus('JAPANESE G2P UNAVAILABLE');
      }
      return false;
    } finally {
      this.japaneseAnalyzing = false;
      button.disabled = false;
      button.textContent = 'JAPANESE G2P';
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

    this.restoreProsodyEdits(text, script.units.length);
    this.ensureProsodyEditLength(script.units.length);
    const plan = this.synth.plan(script, this.settings, this.getProsodyEdits(script, localExpressions));
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

    this.renderAccentEditor(script, markup.plainText, analyzed);

    const note = this.required<HTMLElement>('#voice-engine-note');
    if (this.settings.engine === 'local') {
      note.textContent = analyzed
        ? `LOCAL DSP · OPEN JTALK G2P · ${script.units.length} morae · ${script.events.length > 0 ? `${script.events.length} speech events · ` : ''}${this.japaneseAnalysis?.fullContextMatched ? 'full-context phonology + ' : ''}lexical pitch accent${markup.markupUsed ? ' + local delivery' : ''} + saved draw controls`
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
    } else if (this.settings.engine === 'neural') {
      note.textContent = 'NEURAL HQ · Kokoro 82M q8 · Japanese Open JTalk · client-side after download · first Japanese use also loads dictionary assets · VOICE maps to five Kokoro Japanese speakers · RATE / DELIVERY / ENERGY applied';
      this.setStatus(this.neural.loaded ? 'READY · NEURAL HQ · MODEL CACHED IN SESSION' : 'READY · NEURAL HQ · MODEL LOADS ON FIRST SPEAK');
    } else {
      note.textContent = 'SYSTEM TTS · device/browser voice · kanji and general text supported · availability varies by OS';
      this.setStatus('READY · SYSTEM TTS');
    }
  }

  private ensurePhraseEdits(plainText: string): void {
    if (this.phraseEditSource === plainText) return;
    this.phraseEditSource = plainText;
    try {
      const saved = loadVoicePhraseEdits(localStorage, plainText);
      this.phraseBoundaries = saved.boundaries;
      this.phraseShapes = saved.shapes;
    } catch {
      this.phraseBoundaries = [];
      this.phraseShapes = [];
    }
  }

  private savePhraseEdits(): void {
    const text = this.required<HTMLTextAreaElement>('#voice-text').value;
    const plainText = parseVoiceMarkup(text).plainText;
    try {
      saveVoicePhraseEdits(
        localStorage,
        plainText,
        this.phraseBoundaries,
        this.phraseShapes,
      );
      this.phraseEditSource = plainText;
    } catch {
      // Restricted storage: keep the current-session phrase edits.
    }
  }

  private clearRangeEditsAtBoundary(after: number): void {
    const touchesBoundary = (start: number, end: number): boolean => (
      (start <= after && end >= after + 1)
      || end === after
      || start === after + 1
    );
    this.accentOverrides = this.accentOverrides.filter((override) => (
      !touchesBoundary(override.start, override.end)
    ));
    this.phraseShapes = this.phraseShapes.filter((shape) => (
      !touchesBoundary(shape.start, shape.end)
    ));
    this.saveAccentOverrides();
  }

  private setPhraseBoundary(after: number, boundary: 'none' | 'accent'): void {
    const text = this.required<HTMLTextAreaElement>('#voice-text').value;
    const plainText = parseVoiceMarkup(text).plainText;
    this.ensurePhraseEdits(plainText);
    this.clearRangeEditsAtBoundary(after);

    this.phraseBoundaries = updatePhraseBoundaryOverride(
      this.phraseBoundaries,
      {
        after,
        boundary,
        pauseSeconds: boundary === 'accent' ? 0.045 : 0,
      },
    );
    this.savePhraseEdits();
    this.refreshPlan();
    this.setStatus(
      boundary === 'accent'
        ? 'ACCENT PHRASE SPLIT'
        : 'ACCENT PHRASES JOINED',
    );
  }

  private adjustPhraseShape(
    start: number,
    end: number,
    pitchDelta: number,
    rateDelta: number,
    energyDelta: number,
    emphasisDelta: number,
  ): void {
    const text = this.required<HTMLTextAreaElement>('#voice-text').value;
    const plainText = parseVoiceMarkup(text).plainText;
    this.ensurePhraseEdits(plainText);
    const existing = this.phraseShapes.find((shape) => (
      shape.start === start && shape.end === end
    ));
    this.phraseShapes = updatePhraseShapeOverride(
      this.phraseShapes,
      {
        start,
        end,
        pitchOffset: (existing?.pitchOffset ?? 0) + pitchDelta,
        rateScale: (existing?.rateScale ?? 1) + rateDelta,
        energyScale: (existing?.energyScale ?? 1) + energyDelta,
        emphasis: (existing?.emphasis ?? 0) + emphasisDelta,
        curveStart: existing?.curveStart ?? 0,
        curvePeak: existing?.curvePeak ?? 0,
        curveEnd: existing?.curveEnd ?? 0,
      },
    );
    this.savePhraseEdits();
    this.refreshPlan();
    this.setStatus('PHRASE PITCH / RATE / ENERGY / EMPHASIS UPDATED');
  }

  private setPhrasePitchWithoutRefresh(
    start: number,
    end: number,
    pitchOffset: number,
  ): void {
    const existing = this.phraseShapes.find((shape) => (
      shape.start === start && shape.end === end
    ));
    this.phraseShapes = updatePhraseShapeOverride(
      this.phraseShapes,
      {
        start,
        end,
        pitchOffset,
        rateScale: existing?.rateScale ?? 1,
        energyScale: existing?.energyScale ?? 1,
        emphasis: existing?.emphasis ?? 0,
        curveStart: existing?.curveStart ?? 0,
        curvePeak: existing?.curvePeak ?? 0,
        curveEnd: existing?.curveEnd ?? 0,
      },
    );
  }

  private applyPhraseEmphasisPreset(
    start: number,
    end: number,
    preset: VoiceEmphasisPreset,
  ): void {
    const text = this.required<HTMLTextAreaElement>('#voice-text').value;
    const plainText = parseVoiceMarkup(text).plainText;
    this.ensurePhraseEdits(plainText);
    const existing = this.phraseShapes.find((shape) => (
      shape.start === start && shape.end === end
    ));
    const values = phraseEmphasisPreset(preset);
    this.phraseShapes = updatePhraseShapeOverride(
      this.phraseShapes,
      {
        start,
        end,
        pitchOffset: existing?.pitchOffset ?? 0,
        rateScale: existing?.rateScale ?? 1,
        energyScale: values.energyScale,
        emphasis: values.emphasis,
        curveStart: existing?.curveStart ?? 0,
        curvePeak: existing?.curvePeak ?? 0,
        curveEnd: existing?.curveEnd ?? 0,
      },
    );
    this.savePhraseEdits();
    this.refreshPlan();
    this.setStatus(`PHRASE EMPHASIS · ${preset.toUpperCase()}`);
  }

  private setPhraseCurvePointWithoutRefresh(
    start: number,
    end: number,
    point: 'start' | 'peak' | 'end',
    value: number,
  ): void {
    const existing = this.phraseShapes.find((shape) => (
      shape.start === start && shape.end === end
    ));
    const next: VoicePhraseShapeOverride = {
      start,
      end,
      pitchOffset: existing?.pitchOffset ?? 0,
      rateScale: existing?.rateScale ?? 1,
      energyScale: existing?.energyScale ?? 1,
      emphasis: existing?.emphasis ?? 0,
      curveStart: existing?.curveStart ?? 0,
      curvePeak: existing?.curvePeak ?? 0,
      curveEnd: existing?.curveEnd ?? 0,
    };
    if (point === 'start') next.curveStart = value;
    else if (point === 'peak') next.curvePeak = value;
    else next.curveEnd = value;
    this.phraseShapes = updatePhraseShapeOverride(this.phraseShapes, next);
  }

  private adjustPhrasePause(after: number, delta: number): void {
    const text = this.required<HTMLTextAreaElement>('#voice-text').value;
    const plainText = parseVoiceMarkup(text).plainText;
    this.ensurePhraseEdits(plainText);

    const resolved = this.resolveLocalScript(text);
    const unit = resolved.script.units[after];
    if (!unit) return;
    const existing = this.phraseBoundaries.find((item) => item.after === after);
    const current = existing?.pauseSeconds ?? unit.pauseAfter;
    const pauseSeconds = clamp(current + delta, 0, 0.36);
    this.phraseBoundaries = updatePhraseBoundaryOverride(
      this.phraseBoundaries,
      {
        after,
        boundary: unit.boundaryAfter === 'sentence' ? 'accent' : unit.boundaryAfter === 'none' ? 'accent' : 'accent',
        pauseSeconds,
      },
    );
    this.savePhraseEdits();
    this.refreshPlan();
    this.setStatus(`PHRASE PAUSE · ${Math.round(pauseSeconds * 1000)} ms`);
  }

  private ensureAccentOverrides(plainText: string): void {
    if (this.accentOverrideSource === plainText) return;
    this.accentOverrideSource = plainText;
    try {
      this.accentOverrides = loadVoiceAccentOverrides(localStorage, plainText);
    } catch {
      this.accentOverrides = [];
    }
  }

  private saveAccentOverrides(): void {
    const text = this.required<HTMLTextAreaElement>('#voice-text').value;
    const plainText = parseVoiceMarkup(text).plainText;
    try {
      saveVoiceAccentOverrides(localStorage, plainText, this.accentOverrides);
      this.accentOverrideSource = plainText;
    } catch {
      // Restricted storage: keep the current session edits.
    }
  }

  private setAccentOverride(
    start: number,
    end: number,
    nucleus: number | null,
  ): void {
    const text = this.required<HTMLTextAreaElement>('#voice-text').value;
    const plainText = parseVoiceMarkup(text).plainText;
    this.ensureAccentOverrides(plainText);
    this.accentOverrides = this.accentOverrides.filter((override) => (
      override.start !== start || override.end !== end
    ));
    if (nucleus !== null) this.accentOverrides.push({ start, end, nucleus });
    this.saveAccentOverrides();
    this.refreshPlan();
    this.setStatus(
      nucleus === null
        ? 'ACCENT PHRASE · OPEN JTALK AUTO'
        : nucleus === 0
          ? 'ACCENT PHRASE · HEIBAN'
          : `ACCENT NUCLEUS · MORA ${nucleus}`,
    );
  }

  private renderAccentEditor(
    script: VoiceScript,
    plainText: string,
    analyzed: boolean,
  ): void {
    const editor = this.required<HTMLElement>('#voice-accent-editor');
    editor.replaceChildren();
    editor.hidden = !analyzed || this.settings.engine !== 'local';
    if (editor.hidden) return;

    this.ensureAccentOverrides(plainText);
    this.ensurePhraseEdits(plainText);
    const currentPhrases = collectAccentPhrases(script);
    const autoPhrases = this.japaneseAnalysis?.accentPhrases ?? [];

    const header = document.createElement('div');
    header.className = 'voice-accent-header';
    const title = document.createElement('span');
    title.textContent = 'ACCENT PHRASES · tap mora = nucleus';
    const resetGroup = document.createElement('div');
    resetGroup.className = 'voice-accent-reset-group';

    const reset = document.createElement('button');
    reset.type = 'button';
    reset.dataset.accentAction = 'reset-all';
    reset.textContent = 'RESET ACCENT';
    reset.disabled = this.accentOverrides.length === 0;

    const resetPhrase = document.createElement('button');
    resetPhrase.type = 'button';
    resetPhrase.dataset.phraseAction = 'reset-all';
    resetPhrase.textContent = 'RESET PHRASE';
    resetPhrase.disabled = this.phraseBoundaries.length === 0 && this.phraseShapes.length === 0;

    resetGroup.append(reset, resetPhrase);
    header.append(title, resetGroup);
    editor.append(header);

    const scroller = document.createElement('div');
    scroller.className = 'voice-accent-scroll';

    currentPhrases.forEach((phrase, phraseIndex) => {
      const autoPhrase = autoPhrases.find((candidate) => (
        candidate.start === phrase.start && candidate.end === phrase.end
      ));
      const override = this.accentOverrides.find((candidate) => (
        candidate.start === phrase.start && candidate.end === phrase.end
      ));

      const group = document.createElement('div');
      group.className = 'voice-accent-phrase';
      if (override) group.classList.add('edited');

      const label = document.createElement('span');
      label.className = 'voice-accent-phrase-label';
      label.textContent = `P${phraseIndex + 1}`;

      const auto = document.createElement('button');
      auto.type = 'button';
      auto.dataset.accentAction = 'auto';
      auto.dataset.accentStart = String(phrase.start);
      auto.dataset.accentEnd = String(phrase.end);
      auto.textContent = `AUTO ${autoPhrase?.nucleus ?? '–'}`;
      auto.classList.toggle('active', !override);

      const heiban = document.createElement('button');
      heiban.type = 'button';
      heiban.dataset.accentAction = 'set';
      heiban.dataset.accentStart = String(phrase.start);
      heiban.dataset.accentEnd = String(phrase.end);
      heiban.dataset.accentNucleus = '0';
      heiban.textContent = '○';
      heiban.title = 'HEIBAN';
      heiban.classList.toggle('active', override?.nucleus === 0);

      group.append(label, auto, heiban);

      for (let index = phrase.start; index <= phrase.end; index += 1) {
        const unit = script.units[index]!;
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.accentAction = 'set';
        button.dataset.accentStart = String(phrase.start);
        button.dataset.accentEnd = String(phrase.end);
        button.dataset.accentNucleus = String(index - phrase.start + 1);
        button.textContent = unit.display;
        button.classList.add(unit.pitchAccent === 'high' ? 'high' : 'low');
        if (override?.nucleus === index - phrase.start + 1) {
          button.classList.add('active', 'nucleus');
        }
        group.append(button);

        if (index < phrase.end) {
          const split = document.createElement('button');
          split.type = 'button';
          split.className = 'voice-phrase-split';
          split.dataset.phraseAction = 'split';
          split.dataset.phraseAfter = String(index);
          split.textContent = '│';
          split.title = 'SPLIT ACCENT PHRASE HERE';
          group.append(split);
        }
      }

      const shape = this.phraseShapes.find((candidate) => (
        candidate.start === phrase.start && candidate.end === phrase.end
      ));
      const presetRow = document.createElement('div');
      presetRow.className = 'voice-phrase-presets';
      const presetSpecs: readonly [VoiceEmphasisPreset, string][] = [
        ['weak', '弱調'],
        ['normal', '通常'],
        ['strong', '強調'],
        ['critical', '最重要'],
      ];
      for (const [preset, labelText] of presetSpecs) {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.phraseAction = `emphasis-${preset}`;
        button.dataset.phraseStart = String(phrase.start);
        button.dataset.phraseEnd = String(phrase.end);
        button.textContent = labelText;
        const expected = phraseEmphasisPreset(preset);
        const currentEnergy = shape?.energyScale ?? 1;
        const currentEmphasis = shape?.emphasis ?? 0;
        button.classList.toggle(
          'active',
          Math.abs(currentEnergy - expected.energyScale) < 0.011
            && Math.abs(currentEmphasis - expected.emphasis) < 0.011,
        );
        presetRow.append(button);
      }
      group.append(presetRow);

      const curve = document.createElement('div');
      curve.className = 'voice-phrase-curve';
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 120 48');
      svg.setAttribute('aria-label', 'Phrase F0 curve');
      const baseline = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      baseline.setAttribute('x1', '8');
      baseline.setAttribute('x2', '112');
      baseline.setAttribute('y1', '24');
      baseline.setAttribute('y2', '24');
      baseline.setAttribute('class', 'voice-phrase-curve-baseline');
      svg.append(baseline);

      const curveStart = shape?.curveStart ?? 0;
      const curvePeak = shape?.curvePeak ?? 0;
      const curveEnd = shape?.curveEnd ?? 0;
      const points: readonly [string, number, number][] = [
        ['start', 10, curveStart],
        ['peak', 60, curvePeak],
        ['end', 110, curveEnd],
      ];
      const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
      const curveSamples = Array.from({ length: 17 }, (_, index) => {
        const progress = index / 16;
        const x = 10 + progress * 100;
        const value = phraseCurveAtProgress(curveStart, curvePeak, curveEnd, progress);
        return `${x},${24 - value * 6.4}`;
      });
      polyline.setAttribute('points', curveSamples.join(' '));
      polyline.setAttribute('class', 'voice-phrase-curve-line');
      svg.append(polyline);

      for (const [point, x, value] of points) {
        const handle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        handle.setAttribute('cx', String(x));
        handle.setAttribute('cy', String(24 - value * 6.4));
        handle.setAttribute('r', '5.5');
        handle.setAttribute('class', 'voice-phrase-curve-handle');
        handle.dataset.phraseCurve = point;
        handle.dataset.phraseStart = String(phrase.start);
        handle.dataset.phraseEnd = String(phrase.end);
        svg.append(handle);
      }

      const curveValue = document.createElement('span');
      curveValue.className = 'voice-phrase-curve-value';
      curveValue.textContent =
        `CURVE S${curveStart >= 0 ? '+' : ''}${curveStart.toFixed(1)} · P${curvePeak >= 0 ? '+' : ''}${curvePeak.toFixed(1)} · E${curveEnd >= 0 ? '+' : ''}${curveEnd.toFixed(1)}`;
      curve.append(svg, curveValue);
      group.append(curve);

      const controls = document.createElement('div');
      controls.className = 'voice-phrase-controls';

      const addControl = (
        labelText: string,
        action: string,
        titleText: string,
      ): void => {
        const control = document.createElement('button');
        control.type = 'button';
        control.dataset.phraseAction = action;
        control.dataset.phraseStart = String(phrase.start);
        control.dataset.phraseEnd = String(phrase.end);
        control.textContent = labelText;
        control.title = titleText;
        controls.append(control);
      };

      const drag = document.createElement('button');
      drag.type = 'button';
      drag.className = 'voice-phrase-f0-drag';
      drag.dataset.phraseDrag = 'pitch';
      drag.dataset.phraseStart = String(phrase.start);
      drag.dataset.phraseEnd = String(phrase.end);
      const pitchValue = shape?.pitchOffset ?? 0;
      drag.textContent = `↕ F0 ${pitchValue >= 0 ? '+' : ''}${pitchValue.toFixed(1)}st`;
      drag.title = 'DRAG UP / DOWN TO MOVE PHRASE F0';
      controls.append(drag);

      addControl('P−', 'pitch-down', 'PHRASE PITCH -0.25 ST');
      addControl('P+', 'pitch-up', 'PHRASE PITCH +0.25 ST');
      addControl('R−', 'rate-down', 'PHRASE RATE SLOWER');
      addControl('R+', 'rate-up', 'PHRASE RATE FASTER');
      addControl('E−', 'energy-down', 'PHRASE ENERGY -5%');
      addControl('E+', 'energy-up', 'PHRASE ENERGY +5%');
      addControl('EM−', 'emphasis-down', 'LESS PHRASE EMPHASIS');
      addControl('EM+', 'emphasis-up', 'MORE PHRASE EMPHASIS');
      addControl('PA−', 'pause-down', 'SHORTER PAUSE AFTER PHRASE');
      addControl('PA+', 'pause-up', 'LONGER PAUSE AFTER PHRASE');

      const summary = document.createElement('span');
      summary.className = 'voice-phrase-summary';
      summary.textContent = `${(shape?.rateScale ?? 1).toFixed(2)}× · E${(shape?.energyScale ?? 1).toFixed(2)} · M${(shape?.emphasis ?? 0).toFixed(2)}`;
      controls.append(summary);
      group.append(controls);

      const endUnit = script.units[phrase.end]!;
      if (phrase.end < script.units.length - 1 && endUnit.boundaryAfter !== 'sentence') {
        const join = document.createElement('button');
        join.type = 'button';
        join.className = 'voice-phrase-join';
        join.dataset.phraseAction = 'join';
        join.dataset.phraseAfter = String(phrase.end);
        join.textContent = 'JOIN →';
        join.title = 'JOIN WITH NEXT ACCENT PHRASE';
        group.append(join);
      }

      scroller.append(group);
    });

    editor.append(scroller);
  }

  private resetProsodyEdits(): void {
    this.pitchEdits = [];
    this.energyEdits = [];
    this.durationEdits = [];
    this.lastDrawIndex = null;
  }

  private restoreProsodyEdits(text: string, unitCount: number): void {
    const signature = `${voiceProsodyKey(text)}:${unitCount}`;
    if (this.prosodyLoadedSignature === signature) return;
    this.prosodyLoadedSignature = signature;

    try {
      const snapshot = loadVoiceProsodySnapshot(localStorage, text, unitCount);
      if (!snapshot) {
        this.resetProsodyEdits();
        return;
      }
      this.pitchEdits = snapshot.pitch;
      this.energyEdits = snapshot.energy;
      this.durationEdits = snapshot.duration;
      this.lastDrawIndex = null;
    } catch {
      this.resetProsodyEdits();
    }
  }

  private persistProsodyEdits(): void {
    const text = this.required<HTMLTextAreaElement>('#voice-text').value;
    const { script } = this.resolveLocalScript(text);
    if (script.units.length === 0) return;
    this.ensureProsodyEditLength(script.units.length);

    try {
      saveVoiceProsodySnapshot(
        localStorage,
        text,
        script.units.length,
        this.pitchEdits,
        this.energyEdits,
        this.durationEdits,
      );
      this.prosodyLoadedSignature = `${voiceProsodyKey(text)}:${script.units.length}`;
    } catch {
      // Private browsing / restricted storage: keep session edits only.
    }
  }

  private clearPersistedProsodyEdits(): void {
    const text = this.required<HTMLTextAreaElement>('#voice-text').value;
    try {
      clearVoiceProsodySnapshot(localStorage, text);
    } catch {
      // Ignore restricted storage.
    }
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
    script: VoiceScript,
    localExpressions: readonly (VoiceExpressionSettings | null)[] = [],
  ): VoiceProsodyEdits {
    const phrase = buildPhraseControlArrays(
      script,
      this.phraseShapes,
      this.phraseBoundaries,
    );
    return {
      pitchOffsets: this.pitchEdits,
      energyScales: this.energyEdits,
      durationScales: this.durationEdits,
      localExpressions,
      phrasePitchOffsets: phrase.pitchOffsets,
      phraseRateScales: phrase.rateScales,
      phraseEnergyScales: phrase.energyScales,
      phraseEmphasisScales: phrase.emphasisScales,
      pauseOverrides: phrase.pauseOverrides,
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

    const plan = this.synth.plan(script, this.settings, this.getProsodyEdits(script, localExpressions));
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
    this.neural.stop();
    this.systemSpeechGeneration += 1;
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    this.required<HTMLButtonElement>('#voice-play').textContent = '▶ SPEAK';
    if (this.active) {
      this.setStatus(
        this.settings.engine === 'local'
          ? this.settings.quality === 'hq'
            ? 'READY · HQ REFINE'
            : 'READY · FAST DSP'
          : this.settings.engine === 'neural'
            ? 'READY · NEURAL HQ'
            : 'READY · SYSTEM TTS',
      );
    }
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
    if (this.settings.engine === 'neural') {
      await this.playNeural(markup);
      return;
    }

    let resolved = this.resolveLocalScript(text);
    const playbackStrategy = japaneseFirstUsePlaybackStrategy(
      markup.plainText,
      resolved.analyzed,
    );
    const quickKanaWhileLoading = playbackStrategy === 'quick-local';
    if (playbackStrategy !== 'precise-local') {
      if (playbackStrategy === 'quick-system') {
        this.required<HTMLElement>('#voice-japanese-status').textContent =
          'OPEN JTALK LOADING IN BACKGROUND · SYSTEM TTS PLAYS NOW';
        void this.analyzeJapanese(false);
        this.playSystem(markup);
        return;
      }

      this.required<HTMLElement>('#voice-japanese-status').textContent =
        'QUICK KANA NOW · OPEN JTALK UPGRADES THE NEXT TAKE';
      void this.analyzeJapanese(false);
      resolved = this.resolveLocalScript(text);
    }

    const { script, localExpressions } = resolved;
    if (script.units.length === 0) {
      this.setStatus('LOCAL DSP NEEDS KANA OR ROMAJI');
      return;
    }

    try {
      this.setStatus(
        this.settings.quality === 'hq'
          ? 'SCHEDULING · HQ REFINE'
          : 'SCHEDULING · FAST DSP',
      );
      const plan = await this.synth.play(
        script,
        this.settings,
        this.getProsodyEdits(script, localExpressions),
      );
      const strategyLabel = plan.strategy.kind === 'long-single'
        ? 'LONG·4STEP'
        : plan.strategy.kind === 'multi-sentence'
          ? 'MULTI'
          : plan.strategy.kind.toUpperCase();
      this.required<HTMLButtonElement>('#voice-play').textContent = '■ SPEAKING';
      this.setStatus(
        quickKanaWhileLoading
          ? `SPEAKING · QUICK KANA · ${script.units.length} UNITS · G2P PREPARING`
          : `SPEAKING · ${this.settings.quality === 'hq' ? 'HQ' : 'FAST'} · ${strategyLabel}${plan.chunks.length > 1 ? ` · ${plan.chunks.length} CHUNKS` : ''} · ${script.units.length} UNITS · ${plan.duration.toFixed(1)}s`,
      );
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
        this.setStatus(this.settings.quality === 'hq' ? 'READY · HQ REFINE' : 'READY · FAST DSP');
      }, Math.ceil((plan.duration + 0.1) * 1000));
    } catch (error) {
      console.warn('VOICE LAB local synthesis failed.', error);
      this.setStatus('LOCAL VOICE ENGINE UNAVAILABLE');
    }
  }

  private async playNeural(script: VoiceMarkupScript): Promise<void> {
    const plainText = script.plainText.trim();
    if (!plainText) {
      this.setStatus('ENTER TEXT');
      return;
    }

    try {
      await this.neural.play(plainText, {
        character: this.settings.character,
        rate: this.settings.rate,
        energy: this.settings.energy,
        expression: this.settings.expression,
        onStatus: (message) => {
          if (!this.active || this.settings.engine !== 'neural') return;
          this.setStatus(message);
          this.required<HTMLButtonElement>('#voice-play').textContent = '… NEURAL HQ';
        },
        onStart: (voiceId) => {
          if (!this.active || this.settings.engine !== 'neural') return;
          this.required<HTMLButtonElement>('#voice-play').textContent = '■ SPEAKING';
          this.setStatus(`NEURAL HQ · ${voiceId.toUpperCase()} · LOCAL ONNX`);
        },
        onEnd: () => {
          if (!this.active || this.settings.engine !== 'neural') return;
          this.required<HTMLButtonElement>('#voice-play').textContent = '▶ SPEAK';
          this.setStatus('READY · NEURAL HQ');
        },
      });
    } catch (error) {
      console.warn('VOICE LAB Neural HQ synthesis failed.', error);
      this.required<HTMLButtonElement>('#voice-play').textContent = '▶ SPEAK';
      this.setStatus('NEURAL HQ FAILED · DSP / SYSTEM TTS STILL AVAILABLE');
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
    const voiceScore = (candidate: SpeechSynthesisVoice): number => {
      const lang = candidate.lang.toLowerCase();
      const name = candidate.name.toLowerCase();
      let score = lang === 'ja-jp' ? 100 : lang.startsWith('ja') ? 80 : lang.startsWith('en') ? 20 : 0;
      if (candidate.localService) score += 12;
      if (/premium|enhanced|siri/.test(name)) score += 16;
      if (/compact/.test(name)) score -= 12;
      if (candidate.default) score += 4;
      return score;
    };
    const voice = [...voices]
      .filter((candidate) => candidate.lang.toLowerCase().startsWith('ja') || candidate.lang.toLowerCase().startsWith('en'))
      .sort((a, b) => voiceScore(b) - voiceScore(a))[0] ?? null;
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
    if (needsJapanesePronunciationAnalysis(markup.plainText) && !resolved.analyzed) {
      this.setStatus(containsKanji(markup.plainText)
        ? 'KANJI DETECTED · AUTO G2P FOR WAV'
        : 'おう / えい DETECTED · AUTO G2P FOR WAV');
      const analyzed = await this.analyzeJapanese();
      if (!analyzed) {
        this.setStatus('WAV EXPORT NEEDS JAPANESE G2P · USE SYSTEM TTS TO LISTEN');
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
    this.setStatus(
      this.settings.quality === 'hq'
        ? 'RENDERING WAV · HQ REFINE'
        : 'RENDERING WAV · FAST DSP',
    );
    try {
      const blob = await this.synth.renderWav(script, this.settings, this.getProsodyEdits(script, localExpressions));
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
