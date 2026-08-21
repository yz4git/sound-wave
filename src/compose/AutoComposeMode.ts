import { pitchName, type Mode, type PitchClass } from '../core/music';
import type { AutoComposeSettings } from './AutoComposer';
import { ComposeAudio } from './ComposeAudio';
import {
  compositionLengthSteps,
  compositionStepMs,
  defaultFullSongSettings,
  fullSongSectionAtStep,
  generateFullSongComposition,
  normalizeFullSongBars,
  type FullSongComposition,
} from './FullSongComposer';
import {
  GENRE_DEFINITIONS,
  defaultSubgenreFor,
  genreDefinition,
  genreStyle,
  validGenre,
  validSubgenre,
  type GenreId,
} from './GenreStyle';
import type { JapaneseLyricsTheme, JapaneseLyricVocalEvent } from './JapaneseLyrics';
import { applyJapaneseLyricsV2 } from './JapaneseLyricsV2';
import { generateVocalLine, type VocalStyle } from './VocalGenerator';
import {
  activeVocalEnsembleFor,
  setActiveVocalEnsembleComposition,
} from './VocalEnsemble';
import {
  VOICE_CHARACTER_PRESETS,
  setActiveVoiceCharacter,
  validVoiceCharacterPreset,
  type VoiceCharacterPreset,
} from './VoiceCharacter';
import {
  VOCAL_DIRECTOR_PRESETS,
  setActiveVocalDirector,
  validVocalDirectorPreset,
  vocalDirectorControlFor,
  type VocalDirectorPreset,
} from './VocalDirector';
import {
  createSongProjectSnapshot,
  downloadBlob,
  exportLyricsText,
  exportProjectJson,
  generatedSongTitle,
  saveFavoriteSong,
} from './SongExport';
import { arrangementInstrumentLabel } from './ArrangementInstruments';
import { mixMasterControlFor, mixMasterDbSummary } from './MixMaster';

const STORAGE_KEY = 'sound-wave-auto-compose-v1';
const VOCAL_STORAGE_KEY = 'sound-wave-auto-vocal-v1';
const MODES: readonly Mode[] = ['major', 'minor', 'dorian', 'phrygian', 'mixolydian'];
const PITCHES: readonly PitchClass[] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const VOCAL_STYLES: readonly VocalStyle[] = ['warm', 'bright', 'airy'];
const VOICE_CHARACTER_LABELS: Record<VoiceCharacterPreset, string> = {
  soft: 'SOFT', natural: 'NATURAL', clear: 'CLEAR', airy: 'AIRY', power: 'POWER',
};
const VOCAL_DIRECTOR_LABELS: Record<VocalDirectorPreset, string> = {
  auto: 'AUTO', cute: 'CUTE', cool: 'COOL', emotional: 'EMOTIONAL', sad: 'SAD', energetic: 'ENERGETIC', intimate: 'INTIMATE',
};

export class AutoComposeMode {
  private readonly root: HTMLElement;
  private readonly audio = new ComposeAudio();
  private settings: AutoComposeSettings;
  private composition: FullSongComposition;
  private vocalLine: JapaneseLyricVocalEvent[] = [];
  private lyricsTheme: JapaneseLyricsTheme = 'youth';
  private vocalEnabled: boolean;
  private vocalStyle: VocalStyle;
  private voiceCharacter: VoiceCharacterPreset;
  private voiceTone: number;
  private vocalDirector: VocalDirectorPreset;
  private active = false;
  private playing = false;
  private nextStep = 0;
  private nextStepTime = 0;
  private schedulerId = 0;
  private visualStep = 0;
  private scheduledStepCount = 0;
  private wavRecording = false;
  private wavStopTimer = 0;

  constructor(root: HTMLElement) {
    this.root = root;
    this.settings = this.loadSettings();
    const vocal = this.loadVocalSettings();
    this.vocalEnabled = vocal.enabled;
    this.vocalStyle = vocal.style;
    this.voiceCharacter = vocal.character;
    this.voiceTone = vocal.tone;
    this.vocalDirector = vocal.director;
    setActiveVoiceCharacter({ preset: this.voiceCharacter, tone: this.voiceTone });
    setActiveVocalDirector(this.vocalDirector);
    this.composition = generateFullSongComposition(this.settings);
    this.settings = this.composition.settings;
    this.rebuildVocalLine();
    this.renderShell();
    this.bindEvents();
    this.renderComposition();
  }

  async activate(): Promise<void> {
    this.active = true;
    setActiveVocalEnsembleComposition(this.composition);
    this.root.classList.add('active');
    this.root.setAttribute('aria-hidden', 'false');
    await this.audio.unlock();
    this.updateVisual(this.visualStep);
  }

  deactivate(): void {
    this.active = false;
    this.stop();
    setActiveVocalEnsembleComposition(null);
    this.audio.suspend();
    this.root.classList.remove('active');
    this.root.setAttribute('aria-hidden', 'true');
  }

  suspendAudio(): void { this.audio.suspend(); }
  resumeAudio(): void { if (this.active) this.audio.resume(); }

  private loadSettings(): AutoComposeSettings {
    const fallback = defaultFullSongSettings();
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw) as Partial<AutoComposeSettings>;
      const tonic = PITCHES.includes(parsed.tonic as PitchClass) ? parsed.tonic as PitchClass : fallback.tonic;
      const mode = MODES.includes(parsed.mode as Mode) ? parsed.mode as Mode : fallback.mode;
      const genre: GenreId = validGenre(parsed.genre) ? parsed.genre : fallback.genre;
      const subgenre = validSubgenre(genre, parsed.subgenre) ? parsed.subgenre as string : defaultSubgenreFor(genre);
      return {
        tonic,
        mode,
        bpm: Math.max(60, Math.min(190, Number(parsed.bpm) || fallback.bpm)),
        density: Math.max(0.15, Math.min(1, Number(parsed.density) || fallback.density)),
        bars: normalizeFullSongBars(parsed.bars),
        seed: Number(parsed.seed) >>> 0 || fallback.seed,
        genre,
        subgenre,
      };
    } catch { return fallback; }
  }

  private loadVocalSettings(): {
    enabled: boolean;
    style: VocalStyle;
    character: VoiceCharacterPreset;
    tone: number;
    director: VocalDirectorPreset;
  } {
    const recommended = genreStyle(this.settings.genre, this.settings.subgenre).recommendedVocalStyle;
    try {
      const raw = localStorage.getItem(VOCAL_STORAGE_KEY);
      if (!raw) return { enabled: true, style: recommended, character: 'natural', tone: 0, director: 'auto' };
      const parsed = JSON.parse(raw) as { enabled?: unknown; style?: unknown; character?: unknown; tone?: unknown; director?: unknown };
      const style = VOCAL_STYLES.includes(parsed.style as VocalStyle) ? parsed.style as VocalStyle : recommended;
      const character = validVoiceCharacterPreset(parsed.character) ? parsed.character : 'natural';
      const tone = Math.max(-1, Math.min(1, Number(parsed.tone) || 0));
      const director = validVocalDirectorPreset(parsed.director) ? parsed.director : 'auto';
      return { enabled: parsed.enabled !== false, style, character, tone, director };
    } catch {
      return { enabled: true, style: recommended, character: 'natural', tone: 0, director: 'auto' };
    }
  }

  private saveSettings(): void {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings)); } catch { /* restricted Safari */ }
  }

  private saveVocalSettings(): void {
    try {
      localStorage.setItem(VOCAL_STORAGE_KEY, JSON.stringify({
        enabled: this.vocalEnabled,
        style: this.vocalStyle,
        character: this.voiceCharacter,
        tone: this.voiceTone,
        director: this.vocalDirector,
      }));
    } catch { /* restricted Safari */ }
  }

  private genreOptions(): string {
    return GENRE_DEFINITIONS.map((genre) => `<option value="${genre.id}">${genre.label}</option>`).join('');
  }

  private subgenreOptions(genre: GenreId): string {
    return genreDefinition(genre).subgenres.map((style) => `<option value="${style.id}">${style.label}</option>`).join('');
  }

  private characterOptions(): string {
    return VOICE_CHARACTER_PRESETS.map((preset) => `<option value="${preset}">${VOICE_CHARACTER_LABELS[preset]}</option>`).join('');
  }

  private directorOptions(): string {
    return VOCAL_DIRECTOR_PRESETS.map((preset) => `<option value="${preset}">${VOCAL_DIRECTOR_LABELS[preset]}</option>`).join('');
  }

  private rebuildVocalLine(): void {
    const profile = genreStyle(this.settings.genre, this.settings.subgenre);
    const rawVocal = generateVocalLine(this.composition);
    const lyrics = applyJapaneseLyricsV2(this.composition, profile, rawVocal);
    this.vocalLine = lyrics.events;
    this.lyricsTheme = lyrics.theme;
    setActiveVocalEnsembleComposition(this.composition);
  }

  private renderShell(): void {
    const keyOptions = PITCHES.map((pitch) => `<option value="${pitch}">${pitchName(pitch)}</option>`).join('');
    const modeOptions = MODES.map((mode) => `<option value="${mode}">${mode.toUpperCase()}</option>`).join('');
    this.root.innerHTML = `
      <header class="compose-header">
        <div>
          <span class="compose-kicker">AUTO COMPOSE v4 · MIX/MASTER · LYRICS v2 · INSTRUMENTS v2 · VOCAL DIRECTOR · EXPORT</span>
          <h1>AUTO COMPOSE</h1>
          <p>Generate, arrange, sing, mix and export a complete song on this device.</p>
        </div>
        <div class="compose-transport">
          <button type="button" id="compose-play">▶ PLAY</button>
          <button type="button" id="compose-regenerate">↻ REGENERATE</button>
        </div>
      </header>
      <section class="compose-controls" aria-label="Composition settings">
        <label class="compose-style-control"><span>GENRE</span><select id="compose-genre">${this.genreOptions()}</select></label>
        <label class="compose-style-control"><span>SUBGENRE</span><select id="compose-subgenre">${this.subgenreOptions(this.settings.genre)}</select></label>
        <label><span>KEY</span><select id="compose-key">${keyOptions}</select></label>
        <label><span>MODE</span><select id="compose-mode">${modeOptions}</select></label>
        <label><span id="compose-bpm-label">108 BPM</span><input id="compose-bpm" type="range" min="60" max="190" step="1" /></label>
        <label><span id="compose-density-label">DENSITY 55%</span><input id="compose-density" type="range" min="15" max="100" step="1" /></label>
        <label class="compose-vocal-control">
          <span>VOICE</span>
          <span class="compose-vocal-inline">
            <button type="button" id="compose-vocal-toggle">ON</button>
            <select id="compose-voice-character">${this.characterOptions()}</select>
            <select id="compose-vocal-director" aria-label="Vocal Director">${this.directorOptions()}</select>
          </span>
        </label>
        <label class="compose-tone-control"><span id="compose-tone-label">TONE 0</span><input id="compose-voice-tone" type="range" min="-50" max="50" step="1" /></label>
      </section>
      <section class="compose-stage">
        <div class="compose-now">
          <span id="compose-title">FULL SONG</span>
          <strong id="compose-chord">INTRO</strong>
          <small id="compose-theory">PRODUCTION SUITE</small>
        </div>
        <div class="compose-style-strip"><b id="compose-style-name">STYLE</b><span id="compose-style-description"></span></div>
        <div class="compose-vocal-strip"><b>VOCAL</b><span id="compose-vocal-now">AUDIOWORKLET SINGER · INITIALIZING</span></div>
        <div class="compose-progress"><i id="compose-progress-fill"></i></div>
        <div id="compose-chords" class="compose-chords compose-sections" aria-label="Full song sections"></div>
        <div class="compose-roll-wrap">
          <span class="compose-roll-label">FULL SONG · ARRANGEMENT + JAPANESE LYRICS v2</span>
          <div id="compose-roll" class="compose-roll"></div>
        </div>
        <div class="compose-explain compose-export-bar">
          <b id="compose-song-name">SONG</b>
          <span id="compose-export-status">READY TO EXPORT</span>
          <div class="compose-export-actions">
            <button type="button" id="compose-favorite">☆ SAVE</button>
            <button type="button" id="compose-export-json">JSON</button>
            <button type="button" id="compose-export-lyrics">LYRICS</button>
            <button type="button" id="compose-export-wav">WAV</button>
          </div>
        </div>
      </section>
    `;

    this.required<HTMLSelectElement>('#compose-genre').value = this.settings.genre;
    this.required<HTMLSelectElement>('#compose-subgenre').value = this.settings.subgenre;
    this.required<HTMLSelectElement>('#compose-key').value = String(this.settings.tonic);
    this.required<HTMLSelectElement>('#compose-mode').value = this.settings.mode;
    this.required<HTMLInputElement>('#compose-bpm').value = String(this.settings.bpm);
    this.required<HTMLInputElement>('#compose-density').value = String(Math.round(this.settings.density * 100));
    this.required<HTMLSelectElement>('#compose-voice-character').value = this.voiceCharacter;
    this.required<HTMLSelectElement>('#compose-vocal-director').value = this.vocalDirector;
    this.required<HTMLInputElement>('#compose-voice-tone').value = String(Math.round(this.voiceTone * 50));
    this.syncControlLabels();
    this.syncVocalControl();
    this.syncStyleInfo();
    this.syncExportSummary();
  }

  private required<T extends Element>(selector: string): T {
    const element = this.root.querySelector<T>(selector);
    if (!element) throw new Error(`Auto Compose UI is missing: ${selector}`);
    return element;
  }

  private bindEvents(): void {
    this.required<HTMLButtonElement>('#compose-play').addEventListener('pointerdown', (event) => {
      event.preventDefault();
      if (this.playing) this.stop(); else void this.play();
    }, { passive: false });
    this.required<HTMLButtonElement>('#compose-regenerate').addEventListener('pointerdown', (event) => {
      event.preventDefault(); this.regenerate();
    }, { passive: false });
    this.required<HTMLButtonElement>('#compose-vocal-toggle').addEventListener('pointerdown', (event) => {
      event.preventDefault();
      this.vocalEnabled = !this.vocalEnabled;
      if (!this.vocalEnabled) this.audio.clearVocalStream();
      this.saveVocalSettings(); this.syncVocalControl(); this.updateVisual(this.visualStep);
    }, { passive: false });

    this.required<HTMLSelectElement>('#compose-voice-character').addEventListener('change', (event) => {
      const value = (event.target as HTMLSelectElement).value;
      if (!validVoiceCharacterPreset(value)) return;
      this.voiceCharacter = value;
      setActiveVoiceCharacter({ preset: this.voiceCharacter, tone: this.voiceTone });
      this.saveVocalSettings(); this.syncExportSummary(); this.updateVisual(this.visualStep);
    });
    this.required<HTMLSelectElement>('#compose-vocal-director').addEventListener('change', (event) => {
      const value = (event.target as HTMLSelectElement).value;
      if (!validVocalDirectorPreset(value)) return;
      this.vocalDirector = value;
      setActiveVocalDirector(value);
      this.saveVocalSettings(); this.syncStyleInfo(); this.syncExportSummary(); this.updateVisual(this.visualStep);
    });
    this.required<HTMLInputElement>('#compose-voice-tone').addEventListener('input', (event) => {
      this.voiceTone = Math.max(-1, Math.min(1, Number((event.target as HTMLInputElement).value) / 50));
      setActiveVoiceCharacter({ preset: this.voiceCharacter, tone: this.voiceTone });
      this.syncControlLabels(); this.updateVisual(this.visualStep);
    });
    this.required<HTMLInputElement>('#compose-voice-tone').addEventListener('change', () => this.saveVocalSettings());

    this.required<HTMLSelectElement>('#compose-genre').addEventListener('change', (event) => {
      const value = (event.target as HTMLSelectElement).value;
      if (!validGenre(value)) return;
      const subgenre = defaultSubgenreFor(value);
      this.settings = { ...this.settings, genre: value, subgenre };
      this.syncSubgenreOptions(); this.applyStyleDefaults(); this.rebuildFromControls();
    });
    this.required<HTMLSelectElement>('#compose-subgenre').addEventListener('change', (event) => {
      const subgenre = (event.target as HTMLSelectElement).value;
      if (!validSubgenre(this.settings.genre, subgenre)) return;
      this.settings = { ...this.settings, subgenre };
      this.applyStyleDefaults(); this.rebuildFromControls();
    });
    this.required<HTMLSelectElement>('#compose-key').addEventListener('change', (event) => {
      this.settings = { ...this.settings, tonic: Number((event.target as HTMLSelectElement).value) as PitchClass }; this.rebuildFromControls();
    });
    this.required<HTMLSelectElement>('#compose-mode').addEventListener('change', (event) => {
      this.settings = { ...this.settings, mode: (event.target as HTMLSelectElement).value as Mode }; this.rebuildFromControls();
    });
    this.required<HTMLInputElement>('#compose-bpm').addEventListener('input', (event) => {
      this.settings = { ...this.settings, bpm: Number((event.target as HTMLInputElement).value) }; this.syncControlLabels();
    });
    this.required<HTMLInputElement>('#compose-bpm').addEventListener('change', () => this.rebuildFromControls());
    this.required<HTMLInputElement>('#compose-density').addEventListener('input', (event) => {
      this.settings = { ...this.settings, density: Number((event.target as HTMLInputElement).value) / 100 }; this.syncControlLabels();
    });
    this.required<HTMLInputElement>('#compose-density').addEventListener('change', () => this.rebuildFromControls());

    this.required<HTMLButtonElement>('#compose-favorite').addEventListener('pointerdown', (event) => {
      event.preventDefault();
      const count = saveFavoriteSong(this.songSnapshot());
      this.required<HTMLElement>('#compose-export-status').textContent = `SAVED · ${count} FAVORITE${count === 1 ? '' : 'S'}`;
    }, { passive: false });
    this.required<HTMLButtonElement>('#compose-export-json').addEventListener('pointerdown', (event) => {
      event.preventDefault(); exportProjectJson(this.songSnapshot());
      this.required<HTMLElement>('#compose-export-status').textContent = 'PROJECT JSON EXPORTED';
    }, { passive: false });
    this.required<HTMLButtonElement>('#compose-export-lyrics').addEventListener('pointerdown', (event) => {
      event.preventDefault(); exportLyricsText(this.songSnapshot());
      this.required<HTMLElement>('#compose-export-status').textContent = 'LYRICS TXT EXPORTED';
    }, { passive: false });
    this.required<HTMLButtonElement>('#compose-export-wav').addEventListener('pointerdown', (event) => {
      event.preventDefault(); void this.exportWav();
    }, { passive: false });
    this.root.addEventListener('contextmenu', (event) => event.preventDefault());
  }

  private songSnapshot() {
    return createSongProjectSnapshot(this.composition, this.vocalLine, this.lyricsTheme, {
      character: this.voiceCharacter,
      tone: this.voiceTone,
      director: this.vocalDirector,
    });
  }

  private syncSubgenreOptions(): void {
    const select = this.required<HTMLSelectElement>('#compose-subgenre');
    select.innerHTML = this.subgenreOptions(this.settings.genre); select.value = this.settings.subgenre;
  }

  private applyStyleDefaults(): void {
    const style = genreStyle(this.settings.genre, this.settings.subgenre);
    const [minimum, maximum] = style.bpmRange;
    const bpm = Math.round((minimum + maximum) / 2);
    this.settings = { ...this.settings, bpm };
    this.vocalStyle = style.recommendedVocalStyle;
    this.required<HTMLInputElement>('#compose-bpm').value = String(bpm);
    this.audio.clearVocalStream(); this.saveVocalSettings(); this.syncControlLabels(); this.syncStyleInfo();
  }

  private syncControlLabels(): void {
    const style = genreStyle(this.settings.genre, this.settings.subgenre);
    this.required<HTMLElement>('#compose-bpm-label').textContent = `${Math.round(this.settings.bpm)} BPM · ${style.bpmRange[0]}–${style.bpmRange[1]}`;
    this.required<HTMLElement>('#compose-density-label').textContent = `DENSITY ${Math.round(this.settings.density * 100)}%`;
    const tone = Math.round(this.voiceTone * 50);
    this.required<HTMLElement>('#compose-tone-label').textContent = `TONE ${tone > 0 ? '+' : ''}${tone}`;
  }

  private syncStyleInfo(): void {
    const style = genreStyle(this.settings.genre, this.settings.subgenre);
    const genre = genreDefinition(this.settings.genre);
    const director = vocalDirectorControlFor(style, this.vocalDirector).resolvedPreset.toUpperCase();
    this.required<HTMLElement>('#compose-style-name').textContent = `${genre.label} · ${style.label}`;
    this.required<HTMLElement>('#compose-style-description').textContent = `${style.description} · ${this.settings.bars} BAR FULL SONG · ${this.lyricsTheme.toUpperCase()} STORY LYRICS`;
    this.required<HTMLElement>('#compose-theory').textContent = `MIX/MASTER · INSTRUMENTS v2 · DIRECTOR ${director}`;
  }

  private syncVocalControl(): void {
    const button = this.required<HTMLButtonElement>('#compose-vocal-toggle');
    const character = this.required<HTMLSelectElement>('#compose-voice-character');
    const director = this.required<HTMLSelectElement>('#compose-vocal-director');
    const tone = this.required<HTMLInputElement>('#compose-voice-tone');
    button.textContent = this.vocalEnabled ? 'ON' : 'OFF'; button.classList.toggle('active', this.vocalEnabled);
    character.disabled = !this.vocalEnabled; director.disabled = !this.vocalEnabled; tone.disabled = !this.vocalEnabled;
  }

  private syncExportSummary(): void {
    const title = generatedSongTitle(this.lyricsTheme, this.settings.seed);
    const titleElement = this.root.querySelector<HTMLElement>('#compose-song-name');
    if (titleElement) titleElement.textContent = title;
    const status = this.root.querySelector<HTMLElement>('#compose-export-status');
    if (status && !this.wavRecording) status.textContent = `SEED ${this.settings.seed >>> 0} · JSON / LYRICS / WAV`;
  }

  private rebuildFromControls(): void {
    const wasPlaying = this.playing;
    this.stop();
    this.composition = generateFullSongComposition(this.settings);
    this.settings = this.composition.settings;
    this.rebuildVocalLine(); this.saveSettings(); this.syncStyleInfo(); this.renderComposition(); this.syncExportSummary();
    if (wasPlaying && this.active) void this.play();
  }

  private regenerate(): void {
    this.settings = { ...this.settings, seed: (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0 };
    this.rebuildFromControls();
  }

  private renderComposition(): void {
    this.required<HTMLElement>('#compose-title').textContent = generatedSongTitle(this.lyricsTheme, this.settings.seed);
    this.syncStyleInfo();
    const sections = this.required<HTMLElement>('#compose-chords');
    sections.replaceChildren();
    for (const section of this.composition.songSections) {
      const cell = document.createElement('div');
      cell.className = 'compose-chord-cell compose-section-cell'; cell.dataset.composeSection = String(section.index);
      const shift = section.keyShiftSemitones > 0 ? ` · +${section.keyShiftSemitones} KEY` : '';
      cell.innerHTML = `<span>${section.label}</span><b>${section.bars} BARS</b><em>${Math.round(section.energyScale * 100)}%${shift}</em>`;
      sections.append(cell);
    }
    const roll = this.required<HTMLElement>('#compose-roll');
    roll.replaceChildren();
    const length = compositionLengthSteps(this.composition);
    for (const note of this.composition.melody) {
      const dot = document.createElement('i');
      dot.className = 'compose-note'; dot.style.left = `${note.step / length * 100}%`;
      dot.style.bottom = `${12 + (note.pitch / 11) * 72}%`; dot.style.width = `${Math.max(0.25, note.durationSteps / length * 100)}%`;
      dot.dataset.step = String(note.step); roll.append(dot);
    }
    for (const vocal of this.vocalLine) {
      const marker = document.createElement('i');
      marker.className = 'compose-vocal-note'; marker.style.left = `${vocal.step / length * 100}%`;
      marker.style.bottom = `${12 + (vocal.pitch / 11) * 72}%`; marker.style.width = `${Math.max(0.3, vocal.durationSteps / length * 100)}%`;
      marker.dataset.vocalStep = String(vocal.step); marker.title = `${vocal.lyric} · ${vocal.lyricLine}`; roll.append(marker);
    }
    this.updateVisual(0);
  }

  private async play(): Promise<void> {
    await this.audio.unlock();
    if (!this.active) return;
    setActiveVocalEnsembleComposition(this.composition); setActiveVocalDirector(this.vocalDirector);
    this.audio.clearVocalStream(); this.playing = true; this.nextStep = 0; this.visualStep = 0; this.scheduledStepCount = 0;
    this.nextStepTime = this.audio.currentTime + 0.07;
    this.required<HTMLButtonElement>('#compose-play').textContent = '■ STOP';
    this.required<HTMLButtonElement>('#compose-play').classList.add('playing'); this.startScheduler();
  }

  private stop(): void {
    this.playing = false;
    if (this.schedulerId) window.clearInterval(this.schedulerId); this.schedulerId = 0;
    if (this.wavStopTimer) window.clearTimeout(this.wavStopTimer); this.wavStopTimer = 0;
    if (this.wavRecording) { this.audio.cancelWavCapture(); this.wavRecording = false; }
    this.audio.clearVocalStream();
    const playButton = this.root.querySelector<HTMLButtonElement>('#compose-play');
    if (playButton) { playButton.textContent = '▶ PLAY'; playButton.classList.remove('playing'); }
    const wavButton = this.root.querySelector<HTMLButtonElement>('#compose-export-wav');
    if (wavButton) wavButton.textContent = 'WAV';
    this.updateVisual(0);
  }

  private startScheduler(): void {
    if (this.schedulerId) window.clearInterval(this.schedulerId);
    this.schedulerId = window.setInterval(() => this.scheduleAhead(), 25); this.scheduleAhead();
  }

  private scheduleAhead(): void {
    if (!this.playing || !this.audio.isReady) return;
    const stepSeconds = compositionStepMs(this.composition) / 1000;
    const length = compositionLengthSteps(this.composition);
    const horizon = this.audio.currentTime + 0.12;
    while (this.nextStepTime <= horizon) {
      if (this.wavRecording && this.scheduledStepCount >= length) break;
      const scheduledStep = this.nextStep;
      const when = this.nextStepTime;
      this.audio.scheduleStep(this.composition, scheduledStep, when, this.vocalEnabled ? this.vocalLine : [], this.vocalStyle);
      const visualDelay = Math.max(0, (when - this.audio.currentTime) * 1000);
      window.setTimeout(() => { if (this.playing) this.updateVisual(scheduledStep); }, visualDelay);
      this.scheduledStepCount += 1;
      this.nextStep = (this.nextStep + 1) % length;
      this.nextStepTime += stepSeconds;
    }
  }

  private async exportWav(): Promise<void> {
    await this.audio.unlock();
    if (!this.active) return;
    this.stop();
    if (!this.audio.beginWavCapture()) {
      this.required<HTMLElement>('#compose-export-status').textContent = 'WAV CAPTURE UNAVAILABLE'; return;
    }
    this.wavRecording = true;
    this.required<HTMLButtonElement>('#compose-export-wav').textContent = '● REC';
    this.required<HTMLElement>('#compose-export-status').textContent = 'RECORDING FULL SONG · KEEP APP ACTIVE';
    await this.play();
    const durationMs = compositionLengthSteps(this.composition) * compositionStepMs(this.composition) + 1200;
    this.wavStopTimer = window.setTimeout(() => this.finishWavExport(), durationMs);
  }

  private finishWavExport(): void {
    if (!this.wavRecording) return;
    const blob = this.audio.finishWavCapture();
    this.wavRecording = false;
    if (this.wavStopTimer) window.clearTimeout(this.wavStopTimer); this.wavStopTimer = 0;
    this.stop();
    if (!blob) return;
    const title = generatedSongTitle(this.lyricsTheme, this.settings.seed);
    downloadBlob(blob, `${title}.wav`);
    this.required<HTMLElement>('#compose-export-status').textContent = '16-BIT WAV EXPORTED';
  }

  private updateVisual(step: number): void {
    this.visualStep = step;
    const length = compositionLengthSteps(this.composition);
    const bar = Math.floor(step / 16);
    const chord = this.composition.chords[bar]?.chord ?? this.composition.chords[0]?.chord;
    const section = fullSongSectionAtStep(this.composition, step);
    const sectionLabel = section?.label ?? 'FULL SONG';
    if (chord) this.required<HTMLElement>('#compose-chord').textContent = `${sectionLabel} · ${chord.label.toUpperCase()}`;
    this.required<HTMLElement>('#compose-progress-fill').style.width = `${step / Math.max(1, length - 1) * 100}%`;
    for (const cell of this.root.querySelectorAll<HTMLElement>('[data-compose-section]')) {
      cell.classList.toggle('active', Number(cell.dataset.composeSection) === section?.index && this.playing);
    }
    for (const note of this.root.querySelectorAll<HTMLElement>('.compose-note')) {
      const noteStep = Number(note.dataset.step); note.classList.toggle('active', this.playing && Math.abs(noteStep - this.visualStep) <= 1);
    }
    for (const vocal of this.root.querySelectorAll<HTMLElement>('.compose-vocal-note')) {
      const vocalStep = Number(vocal.dataset.vocalStep);
      vocal.classList.toggle('active', this.vocalEnabled && this.playing && Math.abs(vocalStep - this.visualStep) <= 1);
      vocal.classList.toggle('muted', !this.vocalEnabled);
    }

    const vocalStatus = this.audio.vocalEngineStatus;
    const lyricEvent = this.vocalEnabled && this.playing ? this.vocalLine.find((event) => event.step === step) : undefined;
    const style = genreStyle(this.settings.genre, this.settings.subgenre);
    const state = this.composition.arrangement[bar] ?? this.composition.arrangement[0];
    const tone = Math.round(this.voiceTone * 50);
    const toneText = `TONE ${tone > 0 ? '+' : ''}${tone}`;
    const characterText = this.voiceCharacter.toUpperCase();
    const ensemble = lyricEvent ? activeVocalEnsembleFor(lyricEvent).label : 'LEAD';
    const director = vocalDirectorControlFor(style, this.vocalDirector).resolvedPreset.toUpperCase();
    this.required<HTMLElement>('#compose-vocal-now').textContent = !this.vocalEnabled
      ? 'OFF · INSTRUMENTAL ONLY'
      : vocalStatus === 'unavailable'
        ? 'AUDIOWORKLET UNAVAILABLE · INSTRUMENTAL FALLBACK'
        : vocalStatus !== 'ready'
          ? 'AUDIOWORKLET SINGER · INITIALIZING'
          : lyricEvent
            ? `${characterText} · ${director} · ${ensemble} · “${lyricEvent.lyric}” · ${lyricEvent.lyricLine}`
            : `${characterText} · ${toneText} · ${director} · ${sectionLabel}`;

    const vocalActive = this.vocalLine.some((event) => step >= event.step && step < event.step + event.durationSteps);
    const kickActive = this.composition.drums.some((drum) => drum.step === step && drum.voice === 'kick');
    const mix = mixMasterControlFor(style, state, vocalActive, kickActive);
    this.required<HTMLElement>('#compose-theory').textContent = `${mixMasterDbSummary(mix)} · ${arrangementInstrumentLabel(style, state)} · ${director}`;
  }
}
