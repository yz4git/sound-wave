import type { VocalStyle } from '../compose/VocalGenerator';
import { VoxCpmRemoteVoice, voxCpmVoicePrompt, type VoxCpmRemoteOptions } from './VoxCpmRemote';
import { VoxLocalVoice, encodeVoxLocalWav, type VoxLocalDesign, type VoxLocalQuality } from './VoxLocalVoice';
import { randomBlindOrder, matchBlindConversationTakes, describeBlindVote, type BlindTakeOrder } from './VoxBlindAB';
import type { VoxConversationStyle } from './VoxConversation';
import { addPronunciationEntry, applyPronunciationLexicon, applyLexiconToNeuralPlan, lexiconFromStorage,
  storePronunciationLexicon, type VoicePronunciationEntry } from './VoicePronunciationLexicon';
import { auditCompareJapanese, parseHaasTranscript, validateHaasAuditEndpoint } from './HaasAudit';
import { isIPhoneBrowser, shouldUseDeviceSpeech, type PlaybackEnvironment } from './IPhoneSpeechPolicy';
import { speechWaitStageFromStatus, speechWaitView, type SpeechWaitEngine, type SpeechWaitStage } from './SpeechWaitStatus';
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
import { loadCachedJapaneseAnalysis } from './JapaneseAnalysisCache';
import {
  analyzeVoiceImprint,
  resampleVoiceReference,
  validVoiceIdentityImprint,
  type VoiceIdentityImprint,
} from './VoiceImprint';
import {
  BrowserNeuralVoice,
  buildNeuralProsodyPlan,
  type NeuralProsodyPlan,
  neuralGPUBlockReason,
} from './NeuralVoice';

type VoiceEngine = 'local' | 'neural' | 'neural-gpu' | 'system' | 'voxcpm2' | 'vox-local';
type ProsodyLane = 'pitch' | 'energy' | 'duration';

interface VoiceLabSettings extends VoiceSynthSettings {
  engine: VoiceEngine;
  quality: VoiceRenderQuality;
  expression: VoiceExpressionSettings;
  voxCpmEndpoint: string;
  voxCpmDescription: string;
  voxCpmSteps: number;
  voxLocalDescription: string;
  voxLocalQuality: VoxLocalQuality;
  voxConversationStyle: VoxConversationStyle;
  iphoneCompatibleSpeech: boolean;
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
  return value === 'local' || value === 'neural' || value === 'neural-gpu' || value === 'system' || value === 'voxcpm2' || value === 'vox-local';
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
  private readonly voxCpm = new VoxCpmRemoteVoice();
  private readonly voxLocal = new VoxLocalVoice(this.neural);
  private voxCpmToken = ''; // Kept in memory only; never saved to localStorage.
  private pronunciationLexicon: VoicePronunciationEntry[] = [];
  private voxCpmPlaybackEpoch = 0;
  private speechWaitTimer = 0;
  private speechWaitStartedAt = 0;
  private speechWaitEngine: SpeechWaitEngine = 'vox-local';
  private speechWaitStage: SpeechWaitStage = 'preparing';
  private voxLocalPreviewUrl: string | null = null;
  private blindUrls: string[] = [];
  private blindOrder: BlindTakeOrder | null = null;
  private blindEpoch = 0;
  private audioProbeContext: AudioContext | null = null;
  private haasAuditAbort: AbortController | null = null;
  private speechTrace: string[] = [];
  private lastSpeechError = '';
  private readonly playbackEnvironment: PlaybackEnvironment = {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
  };
  private lastNeuralMetric = '';
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
  private systemSpeechStartTimer = 0;
  private japaneseAnalysis: JapaneseG2PAnalysis | null = null;
  private japaneseAnalysisSource = '';
  private japaneseAnalyzing = false;
  private japaneseRestoreEpoch = 0;
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
    try { this.pronunciationLexicon = lexiconFromStorage(localStorage); } catch { /* Safari private mode */ }
    this.renderShell();
    this.bindEvents();
    this.syncControls();
    this.refreshPlan();
    this.renderPronunciationLexicon();
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
    void this.restoreCachedJapanese(
      this.required<HTMLTextAreaElement>('#voice-text').value.trim(),
    );
    if (this.settings.engine === 'neural') this.preloadNeuralModel();
  }

  deactivate(): void {
    this.active = false;
    this.clearNativeVoxPreview();
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
      voxCpmEndpoint: '',
      voxCpmDescription: 'A clear, warm and naturally expressive Japanese voice',
      voxCpmSteps: 10,
      voxLocalDescription: '落ち着いた、柔らかくて自然な日本語の声',
      voxLocalQuality: 'balanced',
      voxConversationStyle: 'natural',
      iphoneCompatibleSpeech: isIPhoneBrowser(this.playbackEnvironment),
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
        engine: parsed.engine === 'neural-gpu' && neuralGPUBlockReason()
          ? 'neural'
          : parsed.engine === 'voxcpm2' && !(typeof parsed.voxCpmEndpoint === 'string' && parsed.voxCpmEndpoint.trim())
            ? 'vox-local'
            : validEngine(parsed.engine) ? parsed.engine : fallback.engine,
        voxCpmEndpoint: typeof parsed.voxCpmEndpoint === 'string' ? parsed.voxCpmEndpoint.slice(0, 512) : fallback.voxCpmEndpoint,
        voxCpmDescription: typeof parsed.voxCpmDescription === 'string' ? parsed.voxCpmDescription.slice(0, 240) : fallback.voxCpmDescription,
        voxCpmSteps: [6, 10, 16].includes(Number(parsed.voxCpmSteps)) ? Number(parsed.voxCpmSteps) : 10,
        voxLocalDescription: typeof parsed.voxLocalDescription === 'string' ? parsed.voxLocalDescription.slice(0, 240) : fallback.voxLocalDescription,
        voxLocalQuality: parsed.voxLocalQuality === 'fast' || parsed.voxLocalQuality === 'balanced' || parsed.voxLocalQuality === 'studio' ? parsed.voxLocalQuality : 'balanced',
        voxConversationStyle: parsed.voxConversationStyle === 'off' || parsed.voxConversationStyle === 'relaxed' || parsed.voxConversationStyle === 'lively'
          ? parsed.voxConversationStyle : 'natural',
        iphoneCompatibleSpeech: typeof parsed.iphoneCompatibleSpeech === 'boolean'
          ? parsed.iphoneCompatibleSpeech : fallback.iphoneCompatibleSpeech,
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
          <button type="button" id="voice-audio-test" aria-label="Test sound output">🔊 TEST</button>
          <button type="button" id="voice-device-fallback" aria-label="Play with iPhone system voice">▶ iPhone音声</button>
        </div>
        <div class="voice-iphone-compat" id="voice-iphone-compat" hidden>
          <label><input type="checkbox" id="voice-iphone-compat-input" />
            iPhone互換 · SPEAKを端末標準音声で再生
          </label>
          <small>ON: iPhone標準TTS（Kokoro・VOX LOCALの声質加工は使いません）。OFF: 選択した実験的な音声モデルを実行。</small>
        </div>
        <div id="voice-speech-wait" class="voice-speech-wait" role="status" aria-live="off" hidden>
          <div class="voice-speech-wait-head">
            <span class="voice-speech-wait-spinner" aria-hidden="true"></span>
            <strong id="voice-speech-wait-headline">音声を準備しています · 0秒経過</strong>
          </div>
          <p id="voice-speech-wait-description">処理が終わると音声を再生します。</p>
          <div class="voice-speech-wait-bar" aria-hidden="true"><i></i></div>
        </div>
        <details id="voice-error-diagnostic" class="voice-error-diagnostic" hidden>
          <summary>エラー詳細・診断ログ</summary>
          <pre id="voice-error-diagnostic-text"></pre>
          <button type="button" id="voice-copy-diagnostic">診断情報をコピー</button>
        </details>
        <div id="voice-voxlocal-native" class="voice-voxlocal-native" hidden>
          <strong>🔊 音声データ生成完了 · iPhone標準プレーヤー</strong>
          <p>自動再生で音が出ない場合、この再生ボタンをタップしてください。</p>
          <audio id="voice-voxlocal-native-audio" controls preload="none" playsinline></audio>
          <details id="voice-signal-review" class="voice-signal-review">
            <summary>🎧 音声品質チェック（クリップ・音量・長い無音）</summary>
            <p id="voice-signal-overview">音声生成後に診断結果を表示します。</p>
            <div id="voice-signal-warnings"></div>
            <small>音量や無音の機械的検査であり、感情・発音・自然さの採点ではありません。音声は変更しません。</small>
          </details>
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
            <button type="button" data-voice-engine="neural-gpu">GPU BETA</button>
            <button type="button" data-voice-engine="system">SYSTEM TTS</button>
            <button type="button" data-voice-engine="vox-local">VOX LOCAL · NO SERVER</button>
            <button type="button" data-voice-engine="voxcpm2">VOXCPM2 · SERVER</button>
          </div>
          <div id="voice-voxlocal-config" class="voice-voxcpm-config" hidden>
            <strong>VOX LOCAL · ON-DEVICE VOICE DESIGN</strong>
            <p>Independent Sound Wave voice designer + neural acoustic reconstruction. Uses the existing lightweight Kokoro model locally, not VoxCPM2 weights. No Python, server URL or account needed. First use downloads model assets.</p>
            <label>DESCRIBE THE VOICE · 日本語 / ENGLISH
              <input type="text" id="voice-voxlocal-description" maxlength="240" placeholder="低めで温かい、落ち着いた男性の声" />
            </label>
            <label>LOCAL RECONSTRUCTION
              <select id="voice-voxlocal-quality">
                <option value="fast">FAST · 24kHz</option>
                <option value="balanced">BALANCED · 24kHz</option>
                <option value="studio">STUDIO · UPSAMPLED 48kHz</option>
              </select>
            </label>
            <label>CONVERSATION RHYTHM · 会話らしさ
              <select id="voice-voxlocal-conversation">
                <option value="natural">自然な会話 · 意味に沿った間と速度</option>
                <option value="relaxed">ゆったり会話 · やさしいテンポ</option>
                <option value="lively">明るい会話 · 軽快なテンポ</option>
                <option value="off">従来の読み上げ · 比較用</option>
              </select>
            </label>
            <p>Sentence-aware pauses and subtle pacing without adding words or synthetic filler. Keeps Kokoro's Japanese voice and existing model-native phonemes. This is not a retrained conversational model.</p>
            <p>Natural language selects a pretrained voice plus speed, pitch, breath and spectral shaping. This is not VoxCPM2 or full zero-shot generative voice cloning. Per-mora contour editing remains available through Neural HQ.</p>
            <details class="voice-lexicon" id="voice-lexicon">
              <summary>📖 日本語発音辞書 · 固有名詞の読みを修正</summary>
              <p>登録した単語だけKokoroへ渡す読みを変えます。原文やVOICE LABの編集内容は変更しません。VOX LOCAL / NEURAL HQに対応。辞書はこのブラウザ内に保存します。</p>
              <div class="voice-lexicon-add">
                <label>元の単語 <input id="voice-lexicon-word" type="text" maxlength="40" placeholder="例：生成AI" autocomplete="off" /></label>
                <label>発音（かな） <input id="voice-lexicon-reading" type="text" maxlength="80" placeholder="例：せいせいエーアイ" autocomplete="off" /></label>
                <button id="voice-lexicon-add" type="button">読みを登録</button>
              </div>
              <div id="voice-lexicon-list" class="voice-lexicon-list" aria-live="polite"></div>
              <p id="voice-lexicon-preview">登録した読みは音声生成時に反映されます。</p>
            </details>
            <div class="voice-voxlocal-ab" role="group" aria-label="Compare the same neural voice before and after Vox Local processing">
              <button type="button" id="voice-voxlocal-ab-a">A · NEURAL HQ BASE</button>
              <button type="button" id="voice-voxlocal-ab-b">B · VOX LOCAL</button>
            </div>
            <p id="voice-voxlocal-ab-report" class="voice-voxlocal-report" aria-live="polite">A/B generates ONE identical underlying neural take. A = untouched neural audio; B = sound-designed, level-matched audio. Compare by ear; measured difference is NOT a quality score.</p>
            <details id="voice-blind-test" class="voice-blind-test">
              <summary>🎧 会話の自然さをブラインドA/B比較</summary>
              <p>同じ文章・話者・声質で「従来版」と「文脈＋つなぎ目改善版」を作成し、音量をそろえてA/Bへランダムに配置します。回答後まで中身は表示しません。iPhoneでは短い文章（120文字以内）がおすすめです。</p>
              <button type="button" id="voice-blind-generate">A/B音声を作成</button>
              <p id="voice-blind-status" role="status" aria-live="polite">未作成</p>
              <div id="voice-blind-players" hidden>
                <label>音声 A <audio id="voice-blind-a" controls preload="none" playsinline></audio></label>
                <label>音声 B <audio id="voice-blind-b" controls preload="none" playsinline></audio></label>
                <div class="voice-blind-votes" role="group" aria-label="自然だと感じた音声を選ぶ">
                  <button type="button" data-voice-blind-vote="a">Aが自然</button>
                  <button type="button" data-voice-blind-vote="b">Bが自然</button>
                  <button type="button" data-voice-blind-vote="tie">同じくらい</button>
                </div>
                <p id="voice-blind-result" aria-live="polite">どちらが改善版かは回答後に表示されます。</p>
              </div>
            </details>
            <details id="voice-haas-audit" class="voice-haas-audit">
              <summary>🔍 日本語の聞き取り・間をチェック（Haas-ASR参考）</summary>
              <p>生成されたVOX LOCALの無音区間を端末内で診断。Haas-ASRのGPU認識結果を照合すると、漢字・かな表記差と文字誤りを確認できます。CERは読み取り精度の指標で、会話の自然さそのものを測る値ではありません。</p>
              <p id="voice-haas-silence">音声をSPEAKで生成すると、間の診断を表示します。</p>
              <label>認識された文章（Haasの結果を貼り付けても使えます）
                <textarea id="voice-haas-transcript" rows="3" maxlength="1000" placeholder="Haas-ASRの文字起こし結果"></textarea>
              </label>
              <button type="button" id="voice-haas-compare">元の文章と照合</button>
              <details class="voice-haas-remote">
                <summary>Haas GPUサーバーで自動認識（任意）</summary>
                <p>HaasはiPhone単体では実行できません。別途GPUサーバーにHTTPSのPOST /api/transcribeを用意した場合のみ利用可能です。ここで実行ボタンを押すと生成WAVが指定サーバーへ送信されます。</p>
                <label>認識API URL
                  <input type="url" id="voice-haas-endpoint" inputmode="url" maxlength="512" placeholder="https://your-gpu.example/api/transcribe" autocomplete="off" />
                </label>
                <label>APIトークン（画面上のみ・保存しません）
                  <input type="password" id="voice-haas-token" maxlength="256" autocomplete="off" />
                </label>
                <button type="button" id="voice-haas-request">この音声を送信して認識</button>
              </details>
              <p id="voice-haas-report" role="status" aria-live="polite">診断は音声を変更しません。</p>
            </details>

          </div>
          <div id="voice-voxcpm-config" class="voice-voxcpm-config" hidden>
            <strong>VOXCPM2 · REMOTE NEURAL MODEL</strong>
            <p>Japanese / 48kHz · Real VoxCPM2 requires a running Python/GPU server. No model is downloaded to the iPhone.</p>
            <label>SERVER BASE URL
              <input type="url" id="voice-voxcpm-endpoint" inputmode="url" autocomplete="url" placeholder="https://your-server.example" />
            </label>
            <label>VOICE DESIGN · NATURAL LANGUAGE
              <input type="text" id="voice-voxcpm-description" maxlength="240" placeholder="A warm, gentle Japanese narrator" />
            </label>
            <label>INFERENCE QUALITY
              <select id="voice-voxcpm-steps">
                <option value="6">FAST · 6 STEPS</option>
                <option value="10">BALANCED · 10 STEPS</option>
                <option value="16">QUALITY · 16 STEPS</option>
              </select>
            </label>
            <label>SERVER TOKEN (OPTIONAL, THIS SESSION ONLY)
              <input type="password" id="voice-voxcpm-token" autocomplete="off" spellcheck="false" placeholder="Bearer token" />
            </label>
            <p>RATE / PITCH / ENERGY / DELIVERY are soft voice-design suggestions. Per-mora drawn pitch edits are not supported by this model.</p>
            <p>Serve /v1/speech and allow this site's HTTPS origin with CORS. Export WAV is available after SPEAK.</p>
          </div>
          <div class="voice-engine" role="group" aria-label="Local render quality">
            <button type="button" data-voice-quality="fast">FAST DSP</button>
            <button type="button" data-voice-quality="hq">HQ REFINE</button>
          </div>
          <p class="voice-engine-note">NEURAL HQ: saved PCM + Japanese phonemes + token IDs · same phrase / new RATE or VOICE skips Japanese G2P · CPU q8 stays default · GPU BETA blocked on iPhone</p>
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
      this.clearNativeVoxPreview();
      if (this.settings.engine === 'vox-local') {
        this.stop();
        this.required<HTMLElement>('#voice-voxlocal-ab-report').textContent =
          'Text changed. Tap A or B to compare new matching takes.';
      }
      this.resetProsodyEdits();
      this.prosodyLoadedSignature = '';
      this.clearJapaneseAnalysis();
      this.refreshPlan();
      this.renderPronunciationLexicon();
      void this.restoreCachedJapanese(text.value.trim());
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
      if (this.settings.engine === 'system') return;
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

    // On iOS touch, transient user activation is reliable on the synthesized
    // click (after pointerup), not necessarily pointerdown.
    this.required<HTMLButtonElement>('#voice-play').addEventListener('click', (event) => {
      event.preventDefault();
      if (this.settings.engine === 'voxcpm2') this.voxCpm.unlock();
      if (this.settings.engine === 'vox-local') this.voxLocal.unlock();
      if (this.settings.engine === 'neural' || this.settings.engine === 'neural-gpu') this.neural.unlock();
      void this.play();
    }, { passive: false });
    this.required<HTMLButtonElement>('#voice-stop').addEventListener('pointerdown', (event) => {
      event.preventDefault();
      this.stop();
    }, { passive: false });
    this.required<HTMLButtonElement>('#voice-audio-test').addEventListener('pointerdown', (event) => {
      event.preventDefault();
      this.testAudioOutput();
    }, { passive: false });
    this.required<HTMLElement>('#voice-signal-warnings').addEventListener('click', (event) => {
      const element = event.target;
      if (!(element instanceof HTMLElement)) return;
      const button = element.closest<HTMLButtonElement>('[data-voice-signal-seek]');
      if (!button) return;
      const time = Number(button.dataset.voiceSignalSeek);
      const player = this.required<HTMLAudioElement>('#voice-voxlocal-native-audio');
      if (!Number.isFinite(time) || !player.src) return;
      const seek = (): void => {
        if (!Number.isFinite(player.duration)) {
          this.setStatus('音声の読み込み後に、標準プレーヤーで確認してください');
          return;
        }
        player.currentTime = Math.max(0, Math.min(player.duration, time));
        void player.play().catch(() => this.setStatus('標準プレーヤーの再生ボタンを押してください'));
      };
      if (player.readyState >= HTMLMediaElement.HAVE_METADATA) seek();
      else {
        player.addEventListener('loadedmetadata', seek, { once: true });
        player.preload = 'metadata';
        player.load();
      }
    });
    this.required<HTMLButtonElement>('#voice-device-fallback').addEventListener('click', (event) => {
      event.preventDefault();
      this.playWithDeviceVoice();
    });
    this.required<HTMLInputElement>('#voice-iphone-compat-input').addEventListener('change', (event) => {
      this.settings.iphoneCompatibleSpeech = (event.currentTarget as HTMLInputElement).checked;
      this.saveSettings();
      this.stop();
      this.refreshPlan();
    });
    this.required<HTMLButtonElement>('#voice-copy-diagnostic').addEventListener('pointerdown', (event) => {
      event.preventDefault();
      const diagnosis = this.required<HTMLElement>('#voice-error-diagnostic-text').textContent ?? '';
      void navigator.clipboard?.writeText(diagnosis).then(() => {
        this.setStatus('診断ログをコピーしました');
      }).catch(() => {
        this.setStatus('診断ログを選択してコピーしてください');
      });
    }, { passive: false });
    this.required<HTMLButtonElement>('#voice-export-wav').addEventListener('pointerdown', (event) => {
      event.preventDefault();
      void this.exportWav();
    }, { passive: false });

    const imprintFile = this.required<HTMLInputElement>('#voice-imprint-file');
    this.required<HTMLButtonElement>('#voice-imprint-load').addEventListener('pointerdown', (event) => {
      event.preventDefault();
      if (this.settings.engine === 'system') return;
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

    for (const side of ['a', 'b'] as const) {
      this.required<HTMLButtonElement>(`#voice-voxlocal-ab-${side}`).addEventListener('pointerdown', (event) => {
        event.preventDefault();
        if (this.settings.engine !== 'vox-local') return;
        this.voxLocal.unlock();
        this.stop();
        const rawText = this.required<HTMLTextAreaElement>('#voice-text').value.trim();
        if (!rawText) {
          this.setStatus('ENTER TEXT TO COMPARE');
          return;
        }
        void this.playVoxLocal(parseVoiceMarkup(rawText), rawText, side === 'a');
      }, { passive: false });
    }


    this.required<HTMLButtonElement>('#voice-lexicon-add').addEventListener('click', () => {
      const word = this.required<HTMLInputElement>('#voice-lexicon-word');
      const reading = this.required<HTMLInputElement>('#voice-lexicon-reading');
      try {
        this.pronunciationLexicon = addPronunciationEntry(this.pronunciationLexicon, word.value, reading.value);
        this.persistPronunciationLexicon();
        word.value = ''; reading.value = '';
        this.changed(false);
        this.renderPronunciationLexicon();
        this.setStatus('発音辞書を更新しました · 次のSPEAKから反映');
      } catch (error) {
        this.setStatus(error instanceof Error ? error.message : '発音辞書の登録に失敗しました');
      }
    });
    this.required<HTMLElement>('#voice-lexicon-list').addEventListener('click', (event) => {
      if (!(event.target instanceof HTMLElement)) return;
      const button = event.target.closest<HTMLButtonElement>('[data-voice-lexicon-delete]');
      if (!button) return;
      const index = Number(button.dataset.voiceLexiconDelete);
      if (!Number.isInteger(index) || index < 0 || index >= this.pronunciationLexicon.length) return;
      this.pronunciationLexicon = this.pronunciationLexicon.filter((_, i) => i !== index);
      this.persistPronunciationLexicon();
      this.changed(false);
      this.renderPronunciationLexicon();
      this.setStatus('発音辞書から削除しました');
    });
    this.required<HTMLButtonElement>('#voice-blind-generate').addEventListener('click', () => {
      void this.generateBlindConversationTest();
    });
    for (const side of ['a', 'b'] as const) {
      this.required<HTMLAudioElement>(`#voice-blind-${side}`).addEventListener('play', () => {
        const other = side === 'a' ? 'b' : 'a';
        this.required<HTMLAudioElement>(`#voice-blind-${other}`).pause();
        this.root.querySelector<HTMLAudioElement>('#voice-voxlocal-native-audio')?.pause();
        this.voxLocal.stop();
      });
    }
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('[data-voice-blind-vote]')) {
      button.addEventListener('click', () => {
        const vote = button.dataset.voiceBlindVote;
        if (this.blindOrder && (vote === 'a' || vote === 'b' || vote === 'tie')) {
          this.required<HTMLElement>('#voice-blind-result').textContent = describeBlindVote(this.blindOrder, vote);
        }
      });
    }
    const localDescription = this.required<HTMLInputElement>('#voice-voxlocal-description');
    localDescription.addEventListener('input', () => {
      this.settings.voxLocalDescription = localDescription.value.slice(0, 240);
      this.saveSettings();
      this.clearNativeVoxPreview();
      this.stop();
      this.required<HTMLElement>('#voice-voxlocal-ab-report').textContent = 'Voice description changed. Tap A/B to rebuild a matched comparison.';
    });
    this.required<HTMLSelectElement>('#voice-voxlocal-conversation').addEventListener('change', (event) => {
      const selected = (event.currentTarget as HTMLSelectElement).value;
      if (selected !== 'off' && selected !== 'natural' && selected !== 'relaxed' && selected !== 'lively') return;
      this.settings.voxConversationStyle = selected;
      this.changed();
      this.setStatus('VOX LOCAL · CONVERSATION RHYTHM · ' + selected.toUpperCase());
    });
    this.required<HTMLButtonElement>('#voice-haas-compare').addEventListener('click', () => {
      this.compareHaasTranscript();
    });
    this.required<HTMLButtonElement>('#voice-haas-request').addEventListener('click', () => {
      void this.requestHaasRecognition();
    });
    this.required<HTMLSelectElement>('#voice-voxlocal-quality').addEventListener('change', (event) => {
      const quality = (event.target as HTMLSelectElement).value;
      if (quality !== 'fast' && quality !== 'balanced' && quality !== 'studio') return;
      this.settings.voxLocalQuality = quality;
      this.changed(false);
    });

    const voxEndpoint = this.required<HTMLInputElement>('#voice-voxcpm-endpoint');
    voxEndpoint.addEventListener('input', () => {
      this.settings.voxCpmEndpoint = voxEndpoint.value.trim().slice(0, 512);
      this.saveSettings();
      this.voxCpm.stop();
    });
    const voxDescription = this.required<HTMLInputElement>('#voice-voxcpm-description');
    voxDescription.addEventListener('input', () => {
      this.settings.voxCpmDescription = voxDescription.value.slice(0, 240);
      this.saveSettings();
      this.voxCpm.stop();
    });
    this.required<HTMLSelectElement>('#voice-voxcpm-steps').addEventListener('change', (event) => {
      this.settings.voxCpmSteps = Number((event.target as HTMLSelectElement).value);
      this.changed(false);
    });
    this.required<HTMLInputElement>('#voice-voxcpm-token').addEventListener('input', (event) => {
      this.voxCpmToken = (event.target as HTMLInputElement).value;
      this.voxCpm.stop();
    });

    for (const button of this.root.querySelectorAll<HTMLButtonElement>('[data-voice-engine]')) {
      button.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        const engine = button.dataset.voiceEngine;
        if (!validEngine(engine)) return;
        if (engine === 'neural-gpu') {
          const blocked = neuralGPUBlockReason();
          if (blocked) {
            this.settings.engine = 'neural';
            this.saveSettings();
            this.stop();
            this.syncControls();
            this.refreshPlan();
            this.setStatus(blocked);
            this.preloadNeuralModel();
            return;
          }
        }
        this.settings.engine = engine;
        this.saveSettings();
        this.stop();
        this.syncControls();
        this.refreshPlan();
        if (engine === 'neural') this.preloadNeuralModel();
        // GPU Beta is deliberately not auto-preloaded: its first download
        // is much larger than the normal q8 model and must be opt-in at SPEAK.
        if (engine === 'neural-gpu') {
          this.setStatus('GPU BETA · ~326MB MODEL · TAP SPEAK TO TEST');
        }
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
    this.clearNativeVoxPreview();
    if (this.settings.engine === 'vox-local') {
      this.required<HTMLElement>('#voice-voxlocal-ab-report').textContent =
        'Voice settings changed. Tap A or B for a new matched A/B comparison.';
    }
    if (refreshSelects) this.syncControls();
    else this.syncLabels();
    this.refreshPlan();
  }

  private syncControls(): void {
    this.required<HTMLElement>('#voice-iphone-compat').hidden = !isIPhoneBrowser(this.playbackEnvironment);
    this.required<HTMLInputElement>('#voice-iphone-compat-input').checked = this.settings.iphoneCompatibleSpeech;
    this.required<HTMLInputElement>('#voice-expression-intensity').value = String(
      Math.round(this.settings.expression.intensity * 100),
    );
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('[data-voice-expression]')) {
      button.classList.toggle('active', button.dataset.voiceExpression === this.settings.expression.preset);
    }
    this.required<HTMLSelectElement>('#voice-character').value = this.settings.character;
    this.required<HTMLSelectElement>('#voice-style').value = this.settings.style;
    this.required<HTMLSelectElement>('#voice-intonation').value = this.settings.intonation;
    this.required<HTMLElement>('#voice-voxcpm-config').hidden = this.settings.engine !== 'voxcpm2';
    this.required<HTMLElement>('#voice-voxlocal-config').hidden = this.settings.engine !== 'vox-local';
    this.required<HTMLInputElement>('#voice-voxlocal-description').value = this.settings.voxLocalDescription;
    this.required<HTMLSelectElement>('#voice-voxlocal-conversation').value = this.settings.voxConversationStyle;
    this.required<HTMLSelectElement>('#voice-voxlocal-quality').value = this.settings.voxLocalQuality;
    this.required<HTMLInputElement>('#voice-voxcpm-endpoint').value = this.settings.voxCpmEndpoint;
    this.required<HTMLInputElement>('#voice-voxcpm-description').value = this.settings.voxCpmDescription;
    this.required<HTMLSelectElement>('#voice-voxcpm-steps').value = String(this.settings.voxCpmSteps);
    this.required<HTMLInputElement>('#voice-tone').value = String(Math.round(this.settings.tone * 100));
    this.required<HTMLInputElement>('#voice-vtl').value = String(Math.round((this.settings.tractLength ?? 0) * 100));
    this.required<HTMLInputElement>('#voice-rate').value = String(Math.round(this.settings.rate * 100));
    this.required<HTMLInputElement>('#voice-pitch').value = String(Math.round(this.settings.pitch));
    this.required<HTMLInputElement>('#voice-energy').value = String(Math.round(this.settings.energy * 100));

    for (const button of this.root.querySelectorAll<HTMLButtonElement>('[data-voice-engine]')) {
      button.classList.toggle('active', button.dataset.voiceEngine === this.settings.engine);
      if (button.dataset.voiceEngine === 'neural-gpu') {
        const blocked = neuralGPUBlockReason();
        button.disabled = Boolean(blocked);
        button.title = blocked ?? 'Experimental FP32 WebGPU, high memory requirement';
        button.setAttribute('aria-label', blocked ?? 'GPU Beta');
      }
    }
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('[data-voice-quality]')) {
      button.classList.toggle('active', button.dataset.voiceQuality === this.settings.quality);
      button.disabled = this.settings.engine !== 'local';
    }
    const editableEngine = this.settings.engine !== 'system' && this.settings.engine !== 'voxcpm2' && this.settings.engine !== 'vox-local';
    this.required<HTMLButtonElement>('#voice-analyze-japanese').disabled =
      !editableEngine || this.japaneseAnalyzing;
    this.required<HTMLButtonElement>('#voice-export-wav').disabled = this.settings.engine !== 'local' && this.settings.engine !== 'voxcpm2' && this.settings.engine !== 'vox-local';
    this.required<HTMLButtonElement>('#voice-imprint-load').disabled = this.settings.engine !== 'local';
    this.required<HTMLButtonElement>('#voice-imprint-clear').disabled =
      this.settings.engine !== 'local' || !this.settings.identityImprint;
    const imprintStatus = this.required<HTMLElement>('#voice-imprint-status');
    const imprint = this.settings.identityImprint;
    imprintStatus.textContent = imprint
      ? `IMPRINT · ${imprint.quality?.label.toUpperCase() ?? 'LEGACY'} · ${imprint.medianF0Hz.toFixed(0)} Hz · CONF ${Math.round(imprint.confidence * 100)}% · ${imprint.analyzedSeconds.toFixed(1)} s`
      : 'NO IMPRINT · 3–10 s clear single voice · normalized to 48 kHz mono';
    this.required<HTMLButtonElement>('#voice-reset-prosody').disabled = !editableEngine;
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('[data-prosody-lane]')) {
      button.disabled = !editableEngine;
    }
    this.required<HTMLElement>('#voice-contour').classList.toggle('disabled', !editableEngine);
    this.required<HTMLInputElement>('#voice-vtl').disabled =
      this.settings.engine === 'neural' || this.settings.engine === 'neural-gpu' || this.settings.engine === 'voxcpm2' || this.settings.engine === 'vox-local';
    this.required<HTMLSelectElement>('#voice-style').disabled =
      this.settings.engine === 'neural' || this.settings.engine === 'neural-gpu' || this.settings.engine === 'voxcpm2' || this.settings.engine === 'vox-local';
    this.required<HTMLInputElement>('#voice-tone').disabled = this.settings.engine === 'voxcpm2' || this.settings.engine === 'vox-local';
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
    this.japaneseRestoreEpoch += 1;
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

  /** Restore previously analyzed phonemes and accent without Open JTalk WASM.
   * Guards prevent stale async IndexedDB lookups replacing newer text edits. */
  private async restoreCachedJapanese(rawText: string): Promise<void> {
    if (!this.active || this.japaneseAnalyzing || !rawText) return;
    if (this.japaneseAnalysisSource === rawText && this.japaneseAnalysis) return;
    const markup = parseVoiceMarkup(rawText);
    if (!needsJapanesePronunciationAnalysis(markup.plainText)) return;
    const epoch = ++this.japaneseRestoreEpoch;
    try {
      const result = await loadCachedJapaneseAnalysis(markup.plainText);
      if (!result || epoch !== this.japaneseRestoreEpoch || !this.active || this.japaneseAnalyzing) return;
      const text = this.required<HTMLTextAreaElement>('#voice-text');
      if (text.value.trim() !== rawText) return;
      this.japaneseAnalysis = result;
      this.japaneseAnalysisSource = rawText;
      this.accentOverrideSource = '';
      this.phraseEditSource = '';
      this.prosodyLoadedSignature = '';
      this.refreshPlan();
      const status = this.required<HTMLElement>('#voice-japanese-status');
      status.textContent = `SAVED G2P · ${result.script.units.length} morae · ${result.fullContextMatched ? 'FULL CONTEXT · ' : ''}${result.reading.slice(0, 45)}`;
    } catch {
      // Storage denial must never prevent speaking or editing in Safari.
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
    const prosodyEditable = this.settings.engine !== 'system' && this.settings.engine !== 'voxcpm2' && this.settings.engine !== 'vox-local';
    prevPage.disabled = !prosodyEditable || window.page <= 0;
    nextPage.disabled = !prosodyEditable || window.page >= window.pageCount - 1;
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
    } else if (this.settings.engine === 'neural' || this.settings.engine === 'neural-gpu') {
      const gpu = this.settings.engine === 'neural-gpu';
      note.textContent = gpu
        ? 'GPU BETA · WebGPU patched Kokoro fp32 ~326MB · experimental on iPhone · audio output safety gate · automatic CPU q8 fallback · compare RTF to NEURAL HQ'
        : 'NEURAL HQ · CPU q8 · completed audio / phrase PCM persisted (24MB) · Kokoro-native phonemes persisted (512KB) · RATE / VOICE variants skip repeated Japanese G2P + tokens · ONNX still renders unsaved voices';
      const blocked = neuralGPUBlockReason();
      this.setStatus(gpu
        ? blocked ?? 'READY · GPU BETA · 326MB DOWNLOAD ON FIRST SPEAK'
        : this.neural.loaded ? 'READY · NEURAL HQ · MODEL CACHED IN SESSION' : 'READY · NEURAL HQ · MODEL LOADS ON FIRST SPEAK');
      if (!gpu && blocked) {
        note.textContent += ' · GPU BETA IS BLOCKED ON THIS DEVICE TO PREVENT MEMORY CRASHES';
      }
    } else if (this.settings.engine === 'vox-local') {
      note.textContent = 'VOX LOCAL · serverless Kokoro voice · iPhone q4 / desktop q8 · conversation-aware cadence + end-silence-aware pauses · without synthetic fillers · STUDIO 48kHz is upsampled, not native model resolution';
      this.setStatus('READY · VOX LOCAL · NO SERVER REQUIRED');
    } else if (this.settings.engine === 'voxcpm2') {
      note.textContent = 'VOXCPM2 · 2B · Japanese + 29 other languages · 48kHz WAV · remote inference · Voice Design; requires your own server. The browser does not host the model.';
      this.setStatus(this.settings.voxCpmEndpoint.trim() ? 'READY · VOXCPM2 · TAP SPEAK' : 'VOXCPM2 · SET SERVER URL TO ENABLE SPEECH');
    } else {
      note.textContent = 'SYSTEM TTS · device/browser voice · kanji and general text supported · availability varies by OS';
      this.setStatus('READY · SYSTEM TTS');
    }
    if (shouldUseDeviceSpeech(this.settings.engine, this.settings.iphoneCompatibleSpeech, this.playbackEnvironment)) {
      note.textContent = 'iPhone互換ON · SPEAKは端末標準TTSで即再生 · 選択したKokoro/VOX LOCAL/DSPモデルは使用しません · 高度な声質編集を試す場合は上部の互換設定をOFF';
      this.setStatus('READY · iPhone互換音声（端末標準） · TAP SPEAK');
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
    editor.hidden = !analyzed || this.settings.engine === 'system';
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

  /** Runs directly in the pointer gesture; no model or network required. */
  private testAudioOutput(): void {
    try {
      const context = this.audioProbeContext
        ?? new AudioContext({ latencyHint: 'interactive' });
      this.audioProbeContext = context;
      const osc = context.createOscillator();
      const amp = context.createGain();
      const now = context.currentTime;
      osc.type = 'sine';
      osc.frequency.setValueAtTime(660, now);
      amp.gain.setValueAtTime(0.0001, now);
      amp.gain.exponentialRampToValueAtTime(0.16, now + 0.025);
      amp.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
      osc.connect(amp);
      amp.connect(context.destination);
      osc.onended = () => { osc.disconnect(); amp.disconnect(); };
      // Start inside pointerdown, critical for WebKit's gesture policy.
      osc.start(now);
      osc.stop(now + 0.29);
      void context.resume().then(() => {
        this.setStatus(context.state === 'running'
          ? '🔊 テスト音を出力しました · 聞こえない場合は音量・消音設定とiPhone音声を確認'
          : '音声出力が停止状態です · iPhone音声を試してください');
      }).catch(() => this.setStatus('音声出力を開始できません · iPhone音声を試してください'));
    } catch (error) {
      console.warn('VOICE LAB audio output test failed.', error);
      this.setStatus('TEST AUDIO FAILED · iPhoneの音声出力を確認してください');
    }
  }

  /** Always available when the on-device neural model is slow or unavailable. */
  private playWithDeviceVoice(): void {
    const rawText = this.required<HTMLTextAreaElement>('#voice-text').value.trim();
    this.stop();
    if (!rawText) {
      this.setStatus('ENTER TEXT');
      return;
    }
    this.playSystem(parseVoiceMarkup(rawText));
  }

  private clearNativeVoxPreview(): void {
    this.haasAuditAbort?.abort();
    this.haasAuditAbort = null;
    const silencePanel = this.root.querySelector<HTMLElement>('#voice-haas-silence');
    if (silencePanel) silencePanel.textContent = '音声をSPEAKで生成すると、間の診断を表示します。';
    const audio = this.root.querySelector<HTMLAudioElement>('#voice-voxlocal-native-audio');
    if (audio) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
    if (this.voxLocalPreviewUrl) {
      URL.revokeObjectURL(this.voxLocalPreviewUrl);
      this.voxLocalPreviewUrl = null;
    }
    const panel = this.root.querySelector<HTMLElement>('#voice-voxlocal-native');
    if (panel) panel.hidden = true;
  }

  private showNativeVoxPreview(plan: NeuralProsodyPlan, design: VoxLocalDesign): void {
    const wav = this.voxLocal.cachedWav(plan, design);
    if (!wav) return;
    this.clearNativeVoxPreview();
    const audio = this.required<HTMLAudioElement>('#voice-voxlocal-native-audio');
    this.voxLocalPreviewUrl = URL.createObjectURL(wav);
    audio.src = this.voxLocalPreviewUrl;
    this.required<HTMLElement>('#voice-voxlocal-native').hidden = false;
    const quality = this.voxLocal.cachedSignalReport(plan, design);
    if (quality) {
      this.required<HTMLElement>('#voice-signal-overview').textContent =
        `長さ ${quality.durationSeconds.toFixed(1)}秒 · ピーク ${quality.peakDbfs.toFixed(1)}dBFS · 平均(RMS) ${quality.rmsDbfs.toFixed(1)}dBFS · 品質上の注意 ${quality.warnings.length}件`;
      const warnings = this.required<HTMLElement>('#voice-signal-warnings');
      warnings.replaceChildren();
      if (!quality.warnings.length) warnings.textContent = '問題の兆候は検出されませんでした。聴感評価は別途必要です。';
      for (const warning of quality.warnings) {
        const seek = document.createElement('button');
        seek.type = 'button';
        seek.dataset.voiceSignalSeek = String(warning.timeSeconds);
        seek.textContent = `${warning.timeSeconds.toFixed(2)}秒 · ${warning.message} ▶`;
        seek.setAttribute('aria-label', `${warning.timeSeconds.toFixed(2)}秒から確認 · ${warning.message}`);
        warnings.append(seek);
      }
    }
    const stats = this.voxLocal.cachedSilenceReport(plan, design);
    if (stats) {
      this.required<HTMLElement>('#voice-haas-silence').textContent =
        `音声 ${stats.durationSeconds.toFixed(1)}秒 · 無音 ${Math.round(stats.quietRatio * 100)}% · 0.42秒以上の静かな区間 ${stats.longGaps}か所（最大 ${stats.longestGapSeconds.toFixed(2)}秒）。参考値：音量で区間を判定し、正しい間かどうかまでは判断しません。`;
    }
  }

  private compareHaasTranscript(): void {
    const source = parseVoiceMarkup(this.required<HTMLTextAreaElement>('#voice-text').value.trim()).plainText;
    const hypothesis = this.required<HTMLTextAreaElement>('#voice-haas-transcript').value.trim();
    const result = this.required<HTMLElement>('#voice-haas-report');
    if (!source || !hypothesis) {
      result.textContent = '元の文章と、認識された文章の両方が必要です。';
      return;
    }
    try {
      const metric = auditCompareJapanese(source, hypothesis);
      const strict = metric.strict, flex = metric.kanaFlexible;
      result.textContent =
        `簡易CER ${(strict.cer * 100).toFixed(1)}%（${strict.errors}/${strict.characters}文字）· かな表記ゆれ吸収 ${(flex.cer * 100).toFixed(1)}% · 置換${strict.substitutions} / 脱落${strict.deletions} / 余計な文字${strict.insertions}。これは文字列比較であり、Haas公式のjacerスコアや発話の自然さとは異なります。`;
    } catch (error) {
      result.textContent = error instanceof Error ? error.message : 'テキスト比較に失敗しました。';
    }
  }

  private async requestHaasRecognition(): Promise<void> {
    const result = this.required<HTMLElement>('#voice-haas-report');
    if (this.settings.engine !== 'vox-local') { result.textContent = 'VOX LOCALを選んでください。'; return; }
    const text = this.required<HTMLTextAreaElement>('#voice-text').value.trim();
    if (!text) { result.textContent = '先に文章を入力してください。'; return; }
    const markup = parseVoiceMarkup(text);
    const plan = this.prepareNeuralPlan(markup, text);
    const wav = this.voxLocal.cachedWav(plan, this.voxLocalDesign());
    if (!wav) { result.textContent = 'SPEAKで音声を生成してから実行してください。'; return; }
    if (wav.size > 10 * 1024 * 1024) { result.textContent = '音声が10MBを超えています。短い文章で試してください。'; return; }
    let endpoint: URL;
    try {
      endpoint = validateHaasAuditEndpoint(this.required<HTMLInputElement>('#voice-haas-endpoint').value);
    } catch (error) { result.textContent = error instanceof Error ? error.message : 'HTTPS URLが必要です。'; return; }
    this.haasAuditAbort?.abort();
    const controller = new AbortController();
    this.haasAuditAbort = controller;
    const button = this.required<HTMLButtonElement>('#voice-haas-request');
    const timeout = window.setTimeout(() => controller.abort(), 60000);
    button.disabled = true;
    result.textContent = '明示的な操作により、生成した音声を指定サーバーへ送信しています…';
    try {
      const data = new FormData();
      data.append('audio', wav, 'sound-wave-vox-local.wav');
      const token = this.required<HTMLInputElement>('#voice-haas-token').value.trim();
      const response = await fetch(endpoint.toString(), {
        method: 'POST',
        mode: 'cors',
        credentials: 'omit',
        cache: 'no-store',
        ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
        body: data,
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Haas認識サーバーがHTTP ${response.status}を返しました`);
      if (Number(response.headers.get('content-length')) > 10000) throw new Error('認識応答が大きすぎます');
      const raw = await response.text();
      if (raw.length > 10000) throw new Error('認識応答が大きすぎます');
      const recognized = parseHaasTranscript(JSON.parse(raw) as unknown);
      if (controller.signal.aborted || !this.active) return;
      this.required<HTMLTextAreaElement>('#voice-haas-transcript').value = recognized;
      this.compareHaasTranscript();
    } catch (error) {
      if (controller.signal.aborted || !this.active) return;
      const reason = error instanceof Error ? error.message : '接続または認識に失敗しました';
      result.textContent = `${reason}。HTTPS・CORS・サーバー起動・認証を確認してください。音声は再生成されません。`;
    } finally {
      window.clearTimeout(timeout);
      if (this.haasAuditAbort === controller) this.haasAuditAbort = null;
      button.disabled = false;
    }
  }

  private startSpeechWait(engine: SpeechWaitEngine): void {
    this.endSpeechWait();
    this.speechTrace = [`0s ${engine} · started`];
    this.speechWaitEngine = engine;
    this.speechWaitStage = engine === 'voxcpm2' ? 'connecting' : 'preparing';
    this.speechWaitStartedAt = Date.now();
    this.required<HTMLElement>('#voice-speech-wait').hidden = false;
    this.updateSpeechWait();
    this.speechWaitTimer = window.setInterval(() => this.updateSpeechWait(), 1000);
  }

  private progressSpeechWait(message: string): void {
    if (!this.speechWaitTimer) return;
    const seconds = Math.round((Date.now() - this.speechWaitStartedAt) / 1000);
    const entry = `${seconds}s · ${message.slice(0, 140)}`;
    if (this.speechTrace.at(-1) !== entry) this.speechTrace.push(entry);
    if (this.speechTrace.length > 24) this.speechTrace.shift();
    this.speechWaitStage = speechWaitStageFromStatus(message, this.speechWaitStage);
    this.updateSpeechWait();
  }

  private updateSpeechWait(): void {
    if (this.required<HTMLElement>('#voice-speech-wait').hidden) return;
    const elapsed = Math.max(0, Math.floor((Date.now() - this.speechWaitStartedAt) / 1000));
    const view = speechWaitView(this.speechWaitEngine, this.speechWaitStage, elapsed);
    const panel = this.required<HTMLElement>('#voice-speech-wait');
    panel.classList.toggle('taking-long', view.attention);
    this.required<HTMLElement>('#voice-speech-wait-headline').textContent = view.headline;
    this.required<HTMLElement>('#voice-speech-wait-description').textContent = view.explanation;
    this.required<HTMLButtonElement>('#voice-play').textContent = `… ${elapsed}秒 · 準備中`;
  }

  private showSpeechFailure(detail: string): void {
    const elapsed = this.speechWaitStartedAt
      ? Math.round((Date.now() - this.speechWaitStartedAt) / 1000) : 0;
    this.lastSpeechError = detail;
    const diagnostics = [
      'Sound Wave speech failure',
      `Mode: ${this.settings.engine}`,
      `iOS: ${isIPhoneBrowser(this.playbackEnvironment)}`,
      `Compatibility mode: ${this.settings.iphoneCompatibleSpeech}`,
      `Stage: ${this.speechWaitStage}`,
      `Elapsed: ${elapsed}s`,
      `Error: ${detail}`,
      ...this.speechTrace,
    ].join('\n');
    const details = this.required<HTMLDetailsElement>('#voice-error-diagnostic');
    details.hidden = false;
    details.open = true;
    this.required<HTMLElement>('#voice-error-diagnostic-text').textContent = diagnostics;
    this.endSpeechWait();
    const panel = this.required<HTMLElement>('#voice-speech-wait');
    panel.hidden = false;
    panel.classList.add('taking-long');
    const message = detail.toLowerCase();
    const headline = /network|fetch|http|download|cdn|offline/.test(message)
      ? '音声モデルのダウンロードに失敗しました'
      : /memory|allocation|out.of.memory|oom|rangeerror/.test(message)
        ? '音声モデルの読み込みでメモリ不足の可能性'
        : /audio|suspend|notallowed|gesture/.test(message)
          ? '音声データの再生開始に失敗しました'
          : '音声の生成または再生に失敗しました';
    this.required<HTMLElement>('#voice-speech-wait-headline').textContent = headline;
    this.required<HTMLElement>('#voice-speech-wait-description').textContent =
      `詳細: ${detail.slice(0, 210)} · 下の「エラー詳細・診断ログ」で原因を確認できます。`;
    this.required<HTMLButtonElement>('#voice-play').textContent = '▶ RETRY';
  }

  private endSpeechWait(): void {
    if (this.speechWaitTimer) window.clearInterval(this.speechWaitTimer);
    this.speechWaitTimer = 0;
    const panel = this.root.querySelector<HTMLElement>('#voice-speech-wait');
    if (panel) {
      panel.hidden = true;
      panel.classList.remove('taking-long');
    }
  }

  private stop(): void {
    if (this.systemSpeechStartTimer) window.clearTimeout(this.systemSpeechStartTimer);
    this.systemSpeechStartTimer = 0;
    this.endSpeechWait();
    this.clearPlaybackTimers();
    this.synth.stop();
    this.neural.stop();
    this.voxCpm.stop();
    this.voxLocal.stop();
    this.clearBlindComparison();
    this.voxCpmPlaybackEpoch++;
    this.systemSpeechGeneration += 1;
    if ('speechSynthesis' in window &&
      (window.speechSynthesis.speaking || window.speechSynthesis.pending || window.speechSynthesis.paused)) {
      window.speechSynthesis.cancel();
    }
    this.required<HTMLButtonElement>('#voice-play').textContent = '▶ SPEAK';
    if (this.active) {
      this.setStatus(
        this.settings.engine === 'local'
          ? this.settings.quality === 'hq'
            ? 'READY · HQ REFINE'
            : 'READY · FAST DSP'
          : this.settings.engine === 'neural'
            ? 'READY · NEURAL HQ'
            : this.settings.engine === 'neural-gpu'
              ? 'READY · GPU BETA'
              : this.settings.engine === 'voxcpm2'
                ? 'READY · VOXCPM2'
                : this.settings.engine === 'vox-local'
                  ? 'READY · VOX LOCAL · NO SERVER'
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
    if (shouldUseDeviceSpeech(this.settings.engine, this.settings.iphoneCompatibleSpeech, this.playbackEnvironment)) {
      // Crucial: call system speech *synchronously* in the original pointer
      // gesture, before any awaited model download or failed async fallback.
      this.playSystem(markup, false, true);
      return;
    }
    if (this.settings.engine === 'system') {
      this.playSystem(markup);
      return;
    }
    if (this.settings.engine === 'vox-local') {
      await this.playVoxLocal(markup, text);
      return;
    }
    if (this.settings.engine === 'voxcpm2') {
      if (!this.settings.voxCpmEndpoint.trim()) {
        // Old versions persisted the server-only engine. Do not trap existing
        // iPhone users in a mode that is guaranteed to fail without a server.
        this.settings.engine = 'vox-local';
        this.saveSettings();
        this.syncControls();
        this.setStatus('サーバー設定がないため VOX LOCAL に切り替えました');
        this.voxLocal.unlock();
        await this.playVoxLocal(markup, text);
        return;
      }
      await this.playVoxCpm(markup);
      return;
    }
    if (this.settings.engine === 'neural' || this.settings.engine === 'neural-gpu') {
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
      const detail = error instanceof Error ? error.message : 'LOCAL DSP synthesis unavailable';
      this.showSpeechFailure(detail);
      this.setStatus('LOCAL DSP FAILED · TRYING iPhone VOICE');
      this.playSystem(markup, true);
    }
  }


  /** Free browser Blob URLs and cancel stale comparisons whenever settings change. */
  private clearBlindComparison(): void {
    this.blindEpoch++;
    this.blindOrder = null;
    for (const side of ['a', 'b'] as const) {
      const player = this.root.querySelector<HTMLAudioElement>(`#voice-blind-${side}`);
      if (!player) continue;
      player.pause();
      player.removeAttribute('src');
      player.load();
    }
    for (const url of this.blindUrls) URL.revokeObjectURL(url);
    this.blindUrls = [];
    const panel = this.root.querySelector<HTMLElement>('#voice-blind-players');
    if (panel) panel.hidden = true;
    const status = this.root.querySelector<HTMLElement>('#voice-blind-status');
    if (status) status.textContent = '文章や設定が変わりました。新しいA/B音声を作成してください。';
    const button = this.root.querySelector<HTMLButtonElement>('#voice-blind-generate');
    if (button) button.disabled = false;
  }

  private async generateBlindConversationTest(): Promise<void> {
    if (this.settings.engine !== 'vox-local') return;
    const rawText = this.required<HTMLTextAreaElement>('#voice-text').value.trim();
    const plain = parseVoiceMarkup(rawText).plainText.trim();
    const status = this.required<HTMLElement>('#voice-blind-status');
    if (!plain) { status.textContent = '比較する文章を入力してください。'; return; }
    if (Array.from(plain).length > 120) {
      status.textContent = 'iPhoneの負荷を抑えるため、120文字以内の文章にしてください。';
      return;
    }
    this.stop();
    const epoch = this.blindEpoch;
    const button = this.required<HTMLButtonElement>('#voice-blind-generate');
    button.disabled = true;
    status.textContent = '2種類の音声を準備中…（初回はモデルの読み込みが必要です）';
    try {
      // Safari must paint the busy state before expensive WASM inference.
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve())));
      if (epoch !== this.blindEpoch || !this.active) return;
      const plan = this.prepareNeuralPlan(parseVoiceMarkup(rawText), rawText);
      const design = this.voxLocalDesign();
      const style = !design.conversation || design.conversation === 'off' ? 'natural' : design.conversation;
      // ONNX inference MUST remain serial on iPhone. Voice/design/content
      // are identical; only the conversational processing differs.
      const old = await this.voxLocal.synthesize(
        plan, { ...design, conversation: 'off' },
        (message) => { if (epoch === this.blindEpoch) status.textContent = '1/2 生成中 · ' + message; },
      );
      if (epoch !== this.blindEpoch || !this.active || !old) return;
      const improved = await this.voxLocal.synthesize(
        plan, { ...design, conversation: style },
        (message) => { if (epoch === this.blindEpoch) status.textContent = '2/2 生成中 · ' + message; },
      );
      if (epoch !== this.blindEpoch || !this.active || !improved) return;
      if (!old.audio.length || !improved.audio.length
          || old.audio.length > 3_000_000 || improved.audio.length > 3_000_000
          || old.rate !== improved.rate) {
        throw new Error('音声が長すぎるか、2種類の音声フォーマットが一致しません');
      }
      const matched = matchBlindConversationTakes(old.audio, improved.audio);
      const originalUrl = URL.createObjectURL(encodeVoxLocalWav(matched.original, old.rate));
      const directedUrl = URL.createObjectURL(encodeVoxLocalWav(matched.directed, improved.rate));
      if (epoch !== this.blindEpoch || !this.active) {
        URL.revokeObjectURL(originalUrl); URL.revokeObjectURL(directedUrl);
        return;
      }
      this.blindUrls = [originalUrl, directedUrl];
      this.blindOrder = randomBlindOrder();
      for (const side of ['a', 'b'] as const) {
        const kind = this.blindOrder[side];
        this.required<HTMLAudioElement>(`#voice-blind-${side}`).src =
          kind === 'original' ? originalUrl : directedUrl;
      }
      this.required<HTMLElement>('#voice-blind-players').hidden = false;
      this.required<HTMLElement>('#voice-blind-result').textContent =
        'AとBを聴いてから選択してください。どちらが改善版かは回答後に表示します。';
      status.textContent =
        `準備完了 · 同じ声・文章 · 音量差 ${matched.levelDifferenceDb.toFixed(1)}dB · A/Bを聴き比べてください。`;
    } catch (error) {
      if (epoch === this.blindEpoch) {
        status.textContent = error instanceof Error ? error.message : 'A/B音声の生成に失敗しました。';
      }
    } finally {
      if (epoch === this.blindEpoch) button.disabled = false;
    }
  }

  private persistPronunciationLexicon(): void {
    try { storePronunciationLexicon(localStorage, this.pronunciationLexicon); }
    catch { this.setStatus('ブラウザ保存不可 · 発音辞書はこのセッションでのみ有効です'); }
  }

  private renderPronunciationLexicon(): void {
    const list = this.required<HTMLElement>('#voice-lexicon-list');
    list.replaceChildren();
    if (!this.pronunciationLexicon.length) {
      list.textContent = '未登録 · 読み間違える名前・用語だけ追加してください。';
    }
    this.pronunciationLexicon.forEach((item, index) => {
      const row = document.createElement('div');
      row.className = 'voice-lexicon-item';
      const term = document.createElement('span');
      term.textContent = `${item.word} → ${item.reading}`;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.dataset.voiceLexiconDelete = String(index);
      remove.setAttribute('aria-label', `${item.word} の登録を削除`);
      remove.textContent = '削除';
      row.append(term, remove);
      list.append(row);
    });
    const raw = this.required<HTMLTextAreaElement>('#voice-text').value.trim();
    const plain = parseVoiceMarkup(raw).plainText;
    const changed = applyPronunciationLexicon(plain, this.pronunciationLexicon);
    this.required<HTMLElement>('#voice-lexicon-preview').textContent = changed.replacements
      ? `今回の文章で${changed.replacements}箇所を修正：${changed.matchedWords.join('、')} · モデルへの入力だけに適用`
      : `登録${this.pronunciationLexicon.length}件 · この文章には適用箇所がありません`;
  }

  private voxLocalDesign(): VoxLocalDesign {
    return {
      description: this.settings.voxLocalDescription,
      quality: this.settings.voxLocalQuality,
      conversation: this.settings.voxConversationStyle,
      fallbackCharacter: this.settings.character,
      rate: this.settings.rate,
      pitch: this.settings.pitch,
      energy: this.settings.energy,
      tone: this.settings.tone,
      expression: { ...this.settings.expression },
    };
  }

  private async playVoxLocal(markup: VoiceMarkupScript, text: string, reference = false): Promise<void> {
    if (!markup.plainText.trim()) {
      this.setStatus('ENTER TEXT');
      return;
    }
    const epoch = this.voxCpmPlaybackEpoch;
    this.startSpeechWait('vox-local');
    try {
      // A browser frame must paint the busy state before CPU-heavy WebAssembly
      // inference starts, or iPhone Safari can appear frozen after tapping SPEAK.
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve())));
      if (epoch !== this.voxCpmPlaybackEpoch || !this.active) return;
      const plan = this.prepareNeuralPlan(markup, text);
      this.progressSpeechWait('ON DEVICE · RENDERING SPEECH');
      const playSide = reference
        ? this.voxLocal.playReference.bind(this.voxLocal)
        : this.voxLocal.play.bind(this.voxLocal);
      await playSide(
        plan, this.voxLocalDesign(),
        (message) => {
          if (!this.active || this.settings.engine !== 'vox-local' || epoch !== this.voxCpmPlaybackEpoch) return;
          if (message.includes('WAV READY')) {
            this.showNativeVoxPreview(plan, this.voxLocalDesign());
          }
          if (message.includes('PLAYING') || message.includes('SPEAKING')) {
            this.endSpeechWait();
            this.renderVoxLocalABReport(plan);
            this.required<HTMLButtonElement>('#voice-play').textContent = '■ SPEAKING';
          } else {
            this.progressSpeechWait(message);
          }
          this.setStatus(message.replace('NEURAL HQ', 'ON-DEVICE'));
        },
        () => {
          if (!this.active || this.settings.engine !== 'vox-local' || epoch !== this.voxCpmPlaybackEpoch) return;
          this.endSpeechWait();
          this.required<HTMLButtonElement>('#voice-play').textContent = '▶ SPEAK';
          this.setStatus(reference ? 'READY · NEURAL HQ BASE A/B' : 'VOX LOCAL · COMPLETE · WAV READY');
        },
      );
    } catch (error) {
      if (!this.active || epoch !== this.voxCpmPlaybackEpoch) return;
      const reason = error instanceof Error ? error.message : 'モデルの音声生成に失敗しました';
      console.warn('VOX LOCAL render failed.', error);
      this.showSpeechFailure(reason);
      this.setStatus('VOX LOCAL FAILED · ' + reason + ' · TRYING iPhone VOICE');
      this.playSystem(markup, true);
    }
  }

  private renderVoxLocalABReport(plan: NeuralProsodyPlan): void {
    const report = this.voxLocal.comparisonMetrics(plan, this.voxLocalDesign());
    if (!report) return;
    const delta = report.levelDifferenceDb;
    this.required<HTMLElement>('#voice-voxlocal-ab-report').textContent =
      `SAME NEURAL TAKE · RMS LEVEL MATCH ${delta >= 0 ? '+' : ''}${delta.toFixed(2)} dB · ` +
      `PEAK A ${report.reference.peakDbfs.toFixed(1)} / B ${report.local.peakDbfs.toFixed(1)} dBFS · ` +
      `WAVEFORM CHANGE ${report.waveformDifferencePercent.toFixed(1)}% (not a sound-quality rating)`;
  }

  private voxCpmOptions(markup: VoiceMarkupScript): VoxCpmRemoteOptions {
    return {
      endpoint: this.settings.voxCpmEndpoint,
      token: this.voxCpmToken,
      text: markup.plainText.trim(),
      voiceDescription: voxCpmVoicePrompt({
        description: this.settings.voxCpmDescription,
        character: this.settings.character,
        rate: this.settings.rate,
        pitch: this.settings.pitch,
        energy: this.settings.energy,
        expression: this.settings.expression.preset,
      }),
      inferenceTimesteps: this.settings.voxCpmSteps,
    };
  }

  private async playVoxCpm(markup: VoiceMarkupScript): Promise<void> {
    if (!markup.plainText.trim()) {
      this.setStatus('ENTER TEXT');
      return;
    }
    if (!this.settings.voxCpmEndpoint.trim()) {
      this.settings.engine = 'vox-local';
      this.saveSettings();
      this.syncControls();
      this.setStatus('VOXCPM2 はサーバーが必要なため、VOX LOCALへ切り替えました');
      const raw = this.required<HTMLTextAreaElement>('#voice-text').value.trim();
      this.voxLocal.unlock();
      await this.playVoxLocal(markup, raw);
      return;
    }
    const epoch = this.voxCpmPlaybackEpoch;
    this.startSpeechWait('voxcpm2');
    try {
      const options = this.voxCpmOptions(markup);
      this.required<HTMLButtonElement>('#voice-play').textContent = '… VOXCPM2';
      await this.voxCpm.play(
        options,
        (message) => {
          if (this.active && this.settings.engine === 'voxcpm2' && epoch === this.voxCpmPlaybackEpoch) {
            this.setStatus(message);
            if (message.startsWith('VOXCPM2 · PLAYING')) {
              this.endSpeechWait();
              this.required<HTMLButtonElement>('#voice-play').textContent = '■ SPEAKING';
            } else {
              this.progressSpeechWait(message);
            }
          }
        },
        () => {
          if (this.active && this.settings.engine === 'voxcpm2' && epoch === this.voxCpmPlaybackEpoch) {
            this.endSpeechWait();
            this.required<HTMLButtonElement>('#voice-play').textContent = '▶ SPEAK';
            this.setStatus('READY · VOXCPM2 · WAV AVAILABLE FOR EXPORT');
          }
        },
      );
    } catch (error) {
      if (epoch !== this.voxCpmPlaybackEpoch || !this.active) return;
      console.warn('VOICE LAB VoxCPM2 synthesis failed.', error);
      const reason = error instanceof Error ? error.message : 'VOXCPM2 SERVER UNAVAILABLE';
      this.showSpeechFailure(reason);
      this.setStatus(reason);
    }
  }

  private prepareNeuralPlan(markup: VoiceMarkupScript, rawText: string): NeuralProsodyPlan {
    const resolved = this.resolveLocalScript(rawText);
    const script = resolved.script;
    this.restoreProsodyEdits(rawText, script.units.length);
    this.ensureProsodyEditLength(script.units.length);
    const edits = this.getProsodyEdits(script, resolved.localExpressions);
    const localPlan = this.synth.plan(script, this.settings, edits);
    const plan = buildNeuralProsodyPlan({
      originalText: markup.plainText.trim(),
      script,
      timedUnits: localPlan.units,
      edits,
      phraseBoundaries: this.phraseBoundaries,
      hasPhraseEdits: this.phraseBoundaries.length > 0 || this.phraseShapes.length > 0,
      hasAccentEdits: this.accentOverrides.length > 0,
      markupUsed: markup.markupUsed,
      globalExpression: this.settings.expression,
    });
    if (this.pronunciationLexicon.length === 0
      || (this.settings.engine !== 'vox-local' && this.settings.engine !== 'neural' && this.settings.engine !== 'neural-gpu')) return plan;
    // Keep VOICE LAB script, phoneme-editor indices and ASR reference intact.
    // Cache keys include transformed text, and long expanded kana readings are
    // split before Kokoro can silently truncate them.
    return applyLexiconToNeuralPlan(plan, this.pronunciationLexicon);
  }

  private preloadNeuralModel(): void {
    if (this.neural.loaded) return;
    if (this.active && this.settings.engine === 'neural') {
      this.setStatus('NEURAL HQ · CHECKING SAVED AUDIO');
    }
    const rawText = this.required<HTMLTextAreaElement>('#voice-text').value.trim();
    const markup = parseVoiceMarkup(rawText);
    const plan = this.prepareNeuralPlan(markup, rawText);
    const options = {
      character: this.settings.character,
      rate: this.settings.rate,
      energy: this.settings.energy,
      pitch: this.settings.pitch,
      tone: this.settings.tone,
      expression: { ...this.settings.expression },
      backend: 'wasm' as const,
    };

    void this.neural.hasSavedTake(plan, options).then((saved) => {
      if (!this.active || this.settings.engine !== 'neural') return;
      if (this.required<HTMLTextAreaElement>('#voice-text').value.trim() !== rawText) return;
      const status = this.required<HTMLElement>('#voice-status').textContent ?? '';
      if (!status.includes('CHECKING SAVED AUDIO')) return;

      if (saved) {
        this.setStatus('NEURAL HQ · SAVED TAKE READY · NO MODEL LOAD');
        return;
      }

      this.setStatus('NEURAL HQ · PREPARING MODEL IN ADVANCE');
      void this.neural.preload().then((ready) => {
        if (!this.active || this.settings.engine !== 'neural') return;
        const current = this.required<HTMLElement>('#voice-status').textContent ?? '';
        if (!current.includes('PREPARING MODEL')) return;
        this.setStatus(ready
          ? 'NEURAL HQ · MODEL READY · SPEAK TO GENERATE'
          : 'NEURAL HQ · MODEL PRELOAD FAILED · RETRY ON SPEAK');
      });
    });
  }

  private async playNeural(markup: VoiceMarkupScript): Promise<void> {
    const rawText = this.required<HTMLTextAreaElement>('#voice-text').value.trim();
    if (!markup.plainText.trim()) {
      this.setStatus('ENTER TEXT');
      return;
    }
    const epoch = this.voxCpmPlaybackEpoch;
    this.startSpeechWait('neural');
    try {
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve())));
      if (!this.active || epoch !== this.voxCpmPlaybackEpoch) return;
      const neuralPlan = this.prepareNeuralPlan(markup, rawText);
      this.progressSpeechWait('ON DEVICE · RENDERING SPEECH');
      this.lastNeuralMetric = '';
      let speakingWhileRendering = false;
      let firstAudioLabel = '';
      const gpuBlocked = this.settings.engine === 'neural-gpu'
        ? neuralGPUBlockReason()
        : null;
      if (gpuBlocked) {
        this.settings.engine = 'neural';
        this.saveSettings();
        this.syncControls();
        this.setStatus(gpuBlocked);
      }
      await this.neural.playPlan(neuralPlan, {
        backend: this.settings.engine === 'neural-gpu' ? 'webgpu' : 'wasm',
        character: this.settings.character,
        rate: this.settings.rate,
        energy: this.settings.energy,
        pitch: this.settings.pitch,
        tone: this.settings.tone,
        expression: this.settings.expression,
        onFirstAudio: (elapsedMs) => {
          firstAudioLabel = `FIRST AUDIO ${(elapsedMs / 1000).toFixed(1)}s`;
        },
        onMetrics: (metric) => {
          this.lastNeuralMetric = metric.cached
            ? 'INSTANT CACHE'
            : `${metric.backend.toUpperCase()}${metric.fallback ? ' FALLBACK' : ''} · ${(metric.inferenceMs / 1000).toFixed(1)}s / ${metric.audioSeconds.toFixed(1)}s AUDIO · RTF ${metric.realTimeFactor.toFixed(2)}`
              + (metric.firstAudioMs !== undefined
                ? ` · FIRST AUDIO ${(metric.firstAudioMs / 1000).toFixed(1)}s`
                : '');
        },
        onStatus: (message) => {
          if (!this.active || epoch !== this.voxCpmPlaybackEpoch || (this.settings.engine !== 'neural' && this.settings.engine !== 'neural-gpu')) return;
          this.setStatus(speakingWhileRendering ? `SPEAKING · ${message}` : message);
          if (!speakingWhileRendering) this.progressSpeechWait(message);
        },
        onStart: (voiceId) => {
          if (!this.active || epoch !== this.voxCpmPlaybackEpoch || (this.settings.engine !== 'neural' && this.settings.engine !== 'neural-gpu')) return;
          speakingWhileRendering = true;
          this.endSpeechWait();
          this.required<HTMLButtonElement>('#voice-play').textContent = '■ SPEAKING';
          this.setStatus(
            `NEURAL · ${voiceId.toUpperCase()} · ${firstAudioLabel || this.lastNeuralMetric || 'PLAYING'} · ${neuralPlan.edited ? `${neuralPlan.segments.length} SEG` : 'MODEL-NATIVE'}`,
          );
        },
        onEnd: () => {
          if (!this.active || epoch !== this.voxCpmPlaybackEpoch || (this.settings.engine !== 'neural' && this.settings.engine !== 'neural-gpu')) return;
          this.endSpeechWait();
          this.required<HTMLButtonElement>('#voice-play').textContent = '▶ SPEAK';
          this.setStatus(`READY · ${this.lastNeuralMetric}`);
        },
      });
    } catch (error) {
      if (epoch !== this.voxCpmPlaybackEpoch || !this.active) return;
      console.warn('VOICE LAB Neural HQ synthesis failed.', error);
      const reason = error instanceof Error ? error.message : 'NEURAL HQ MODEL ERROR';
      this.showSpeechFailure(reason);
      this.setStatus('NEURAL HQ FAILED · ' + reason + ' · TRYING iPhone VOICE');
      this.playSystem(markup, true);
    }
  }

  private playSystem(script: VoiceMarkupScript, recovery = false, compatibility = false): void {
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
      if (this.systemSpeechStartTimer) window.clearTimeout(this.systemSpeechStartTimer);
      this.systemSpeechStartTimer = 0;
      if (generation !== this.systemSpeechGeneration) return;
      const segment = segments[segmentIndex];
      if (!segment) {
        this.required<HTMLButtonElement>('#voice-play').textContent = '▶ SPEAK';
        this.setStatus(recovery ? 'READY · iPhone音声での代替再生が終了しました'
          : compatibility ? 'READY · iPhone互換音声の再生が終了しました' : 'READY · SYSTEM TTS');
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
      let hasStarted = false;
      utterance.onstart = () => {
        if (generation !== this.systemSpeechGeneration) return;
        hasStarted = true;
        if (this.systemSpeechStartTimer) window.clearTimeout(this.systemSpeechStartTimer);
        this.systemSpeechStartTimer = 0;
        this.endSpeechWait();
        this.required<HTMLButtonElement>('#voice-play').textContent = '■ SPEAKING';
        this.setStatus(
          recovery
            ? `iPhone標準音声で代替再生中 · ${voice?.name ?? 'DEVICE VOICE'}`
            : compatibility
              ? `iPhone互換再生中（モデル推論なし） · ${voice?.name ?? 'DEVICE VOICE'}`
              : `SYSTEM TTS · ${expressionSettings.preset.toUpperCase()} · ${voice?.name ?? 'DEFAULT VOICE'}`,
        );
      };
      utterance.onend = () => {
        if (generation !== this.systemSpeechGeneration) return;
        speakNext();
      };
      utterance.onerror = (event) => {
        if (generation !== this.systemSpeechGeneration) return;
        if (this.systemSpeechStartTimer) window.clearTimeout(this.systemSpeechStartTimer);
        this.systemSpeechStartTimer = 0;
        this.required<HTMLButtonElement>('#voice-play').textContent = '▶ SPEAK';
        const detail = `iPhone標準音声も開始できませんでした · ${event.error ?? 'speech unavailable'}`;
        if (recovery || compatibility) this.showSpeechFailure(detail + ' · 標準音声の音源を確認してください');
        this.setStatus(detail);
      };
      try {
        this.setStatus(compatibility
          ? 'iPhone互換音声の開始待ち（モデル生成なし）'
          : recovery ? 'iPhone標準音声へ切り替えています' : 'SYSTEM TTS · STARTING');
        window.speechSynthesis.speak(utterance);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        this.showSpeechFailure(`iPhone音声APIがエラーを返しました: ${reason}`);
        this.setStatus('iPhone音声の開始に失敗しました');
        return;
      }
      this.systemSpeechStartTimer = window.setTimeout(() => {
        if (generation !== this.systemSpeechGeneration || hasStarted) return;
        this.systemSpeechStartTimer = 0;
        this.showSpeechFailure(
          `iPhoneのspeechSynthesisが8秒以内にonstartを返しませんでした（pending=${window.speechSynthesis.pending}, speaking=${window.speechSynthesis.speaking}）。`
        );
        this.setStatus('音声APIから再生開始の応答がありません');
      }, 8000);
    };

    speakNext();
  }

  private async exportWav(): Promise<void> {
    if (this.settings.engine === 'system') return;
    const text = this.required<HTMLTextAreaElement>('#voice-text').value.trim();
    const markup = parseVoiceMarkup(text);
    if (this.settings.engine === 'vox-local') {
      const plan = this.prepareNeuralPlan(markup, text);
      const wav = this.voxLocal.cachedWav(plan, this.voxLocalDesign());
      if (!wav) {
        this.setStatus('VOX LOCAL · TAP SPEAK BEFORE EXPORTING WAV');
        return;
      }
      downloadBlob(wav, `${safeFilename(markup.plainText)}-vox-local.wav`);
      this.setStatus(`VOX LOCAL · WAV EXPORTED · ${Math.round(wav.size / 1024)} KB`);
      return;
    }
    if (this.settings.engine === 'voxcpm2') {
      try {
        const wav = this.voxCpm.cachedWav(this.voxCpmOptions(markup));
        if (!wav) {
          this.setStatus('VOXCPM2 · TAP SPEAK TO GENERATE WAV FIRST');
          return;
        }
        downloadBlob(wav, `${safeFilename(markup.plainText)}-voxcpm2.wav`);
        this.setStatus(`VOXCPM2 WAV EXPORTED · ${Math.round(wav.size / 1024)} KB`);
      } catch (error) {
        this.setStatus(error instanceof Error ? error.message : 'VOXCPM2 EXPORT FAILED');
      }
      return;
    }
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
