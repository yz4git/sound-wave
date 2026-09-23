import type { VocalStyle } from '../compose/VocalGenerator';
import { downloadBlob } from '../compose/SongExport';
import { VOICE_CHARACTER_PRESETS, validVoiceCharacterPreset, type VoiceCharacterPreset } from '../compose/VoiceCharacter';
import { parseVoiceScript, type VoiceIntonation } from './VoiceScript';
import { VoiceSynth, type VoiceSynthSettings } from './VoiceSynth';

type VoiceEngine = 'local' | 'system';

interface VoiceLabSettings extends VoiceSynthSettings {
  engine: VoiceEngine;
}

const STORAGE_KEY = 'sound-wave-voice-lab-settings-v1';
const DEFAULT_TEXT = 'こんにちは。おんせい ごうせいの じっけんです。ことばの たかさと いきおいを かえてみましょう。';
const STYLES: readonly VocalStyle[] = ['warm', 'bright', 'airy'];
const INTONATIONS: readonly VoiceIntonation[] = ['natural', 'flat', 'rise', 'fall', 'question'];

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
          <div class="voice-engine" role="group" aria-label="Voice engine">
            <button type="button" data-voice-engine="local">SOUND WAVE DSP</button>
            <button type="button" data-voice-engine="system">SYSTEM TTS</button>
          </div>
          <p class="voice-engine-note" id="voice-engine-note"></p>

          <div class="voice-prosody-preview">
            <div class="voice-section-label compact"><span>02</span><b>PROSODY</b><em>pitch / timing / energy</em></div>
            <div id="voice-contour" class="voice-contour" aria-label="Prosody contour"></div>
            <div id="voice-units" class="voice-units" aria-label="Speech units"></div>
          </div>
        </section>

        <aside class="voice-controls-panel">
          <div class="voice-control-group">
            <div class="voice-section-label compact"><span>03</span><b>TIMBRE</b><em>voice character</em></div>
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
    text.addEventListener('input', () => this.refreshPlan());

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
    this.required<HTMLButtonElement>('#voice-export-wav').disabled = this.settings.engine !== 'local';
    this.syncLabels();
  }

  private syncLabels(): void {
    this.required<HTMLElement>('#voice-tone-label').textContent = `TONE ${this.settings.tone >= 0 ? '+' : ''}${Math.round(this.settings.tone * 100)}`;
    this.required<HTMLElement>('#voice-rate-label').textContent = `RATE ${this.settings.rate.toFixed(2)}×`;
    this.required<HTMLElement>('#voice-pitch-label').textContent = `PITCH ${Math.round(this.settings.pitch)}`;
    this.required<HTMLElement>('#voice-energy-label').textContent = `ENERGY ${Math.round(this.settings.energy * 100)}%`;
  }

  private refreshPlan(): void {
    const text = this.required<HTMLTextAreaElement>('#voice-text').value;
    const script = parseVoiceScript(text);
    const unitsEl = this.required<HTMLElement>('#voice-units');
    const contourEl = this.required<HTMLElement>('#voice-contour');
    unitsEl.replaceChildren();
    contourEl.replaceChildren();

    const plan = this.synth.plan(script, this.settings);
    const preview = plan.units.slice(0, 72);
    preview.forEach((timed, index) => {
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
      unitsEl.append(token);

      const point = document.createElement('i');
      const offset = timed.pitchMidi - this.settings.pitch;
      point.style.setProperty('--voice-pitch', String(clamp((offset + 3) / 6, 0.05, 0.95)));
      point.style.width = `${Math.max(1.2, timed.duration / Math.max(0.1, plan.duration) * 100)}%`;
      contourEl.append(point);
    });

    const note = this.required<HTMLElement>('#voice-engine-note');
    if (this.settings.engine === 'local') {
      note.textContent = script.unsupported.length > 0
        ? `LOCAL DSP · かな/カナ/ROMAJI対応 · 未対応文字: ${script.unsupported.slice(0, 8).join(' ')} · 漢字文はSYSTEM TTSへ`
        : `LOCAL DSP · ${script.units.length} morae · accent phrases + devoicing · audio stays in this page`;
      this.setStatus(script.units.length > 0 ? 'READY · LOCAL DSP' : 'ENTER KANA OR ROMAJI');
    } else {
      note.textContent = 'SYSTEM TTS · device/browser voice · kanji and general text supported · availability varies by OS';
      this.setStatus('READY · SYSTEM TTS');
    }
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

    if (this.settings.engine === 'system') {
      this.playSystem(text);
      return;
    }

    const script = parseVoiceScript(text);
    if (script.units.length === 0) {
      this.setStatus('LOCAL DSP NEEDS KANA OR ROMAJI');
      return;
    }

    try {
      this.setStatus('SCHEDULING · LOW-LATENCY STREAM');
      const plan = await this.synth.play(script, this.settings);
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

  private playSystem(text: string): void {
    if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
      this.setStatus('SYSTEM TTS UNAVAILABLE');
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    const voices = window.speechSynthesis.getVoices();
    utterance.voice = voices.find((voice) => voice.lang.toLowerCase().startsWith('ja'))
      ?? voices.find((voice) => voice.lang.toLowerCase().startsWith('en'))
      ?? null;
    utterance.lang = utterance.voice?.lang ?? 'ja-JP';
    utterance.rate = clamp(this.settings.rate, 0.6, 1.65);
    utterance.pitch = clamp(0.7 + (this.settings.pitch - 45) / 31 * 0.8 + this.settings.tone * 0.12, 0.5, 1.7);
    utterance.volume = clamp(this.settings.energy, 0.55, 1);
    utterance.onstart = () => {
      this.required<HTMLButtonElement>('#voice-play').textContent = '■ SPEAKING';
      this.setStatus(`SYSTEM TTS · ${utterance.voice?.name ?? 'DEFAULT VOICE'}`);
    };
    utterance.onend = () => {
      this.required<HTMLButtonElement>('#voice-play').textContent = '▶ SPEAK';
      this.setStatus('READY · SYSTEM TTS');
    };
    utterance.onerror = () => this.setStatus('SYSTEM TTS FAILED');
    window.speechSynthesis.speak(utterance);
  }

  private async exportWav(): Promise<void> {
    if (this.settings.engine !== 'local') return;
    const text = this.required<HTMLTextAreaElement>('#voice-text').value.trim();
    const script = parseVoiceScript(text);
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
      const blob = await this.synth.renderWav(script, this.settings);
      downloadBlob(blob, `${safeFilename(text)}.wav`);
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
