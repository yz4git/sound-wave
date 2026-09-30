import {
  applyVoiceContinuationBoundary,
  applyVoiceDiscourseMarker,
  applyVoicePreFocusPause,
  finalizeVoiceUnits,
  parseVoiceScript,
  type VoiceContinuationKind,
  type VoiceDiscourseRole,
  type VoicePitchAccent,
  type VoiceScript,
} from './VoiceScript';

const ASSET_BASE = 'https://cdn.jsdelivr.net/npm/kokoro-js-jp@0.2.0/dist';
const DICT_ARCHIVE_URL = `${ASSET_BASE}/open_jtalk_dic_utf_8-1.11.tar.gz`;
const VOICE_URL = `${ASSET_BASE}/openjtalk-voice.htsvoice`;
const WORKER_URL = `${ASSET_BASE}/browser/worker.js`;
const REQUEST_TIMEOUT_MS = 90_000;

export interface JapaneseFrontendNode {
  string: string;
  read: string;
  pron: string;
  acc: number;
  mora_size: number;
  chain_flag: number;
  pos?: string;
  pos_group1?: string;
  pos_group2?: string;
  pos_group3?: string;
  ctype?: string;
  cform?: string;
  orig?: string;
  chain_rule?: string;
}

export interface JapaneseUnitSourceRange {
  start: number;
  end: number;
}

export interface JapaneseFullContextMora {
  phonemes: string[];
  vowel: string | null;
  devoiced: boolean;
  geminateBefore: boolean;
  pauseAfter: boolean;
  accentA1: number | null;
  accentA2: number | null;
  accentA3: number | null;
}

export interface JapaneseAccentPhrase {
  start: number;
  end: number;
  nucleus: number;
}

export interface JapaneseG2PAnalysis {
  script: VoiceScript;
  reading: string;
  nodes: JapaneseFrontendNode[];
  unitSourceRanges: JapaneseUnitSourceRange[];
  labels: string[];
  fullContextMatched: boolean;
  accentPhrases: JapaneseAccentPhrase[];
  source: 'open-jtalk';
}

export type JapaneseG2PProgress = {
  stage: 'download' | 'initialize' | 'analyze' | 'ready';
  progress: number;
  message: string;
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timer: number;
};

let worker: Worker | null = null;
let workerFailure: Error | null = null;
let nextId = 1;
const pending = new Map<number, PendingRequest>();
let initializePromise: Promise<void> | null = null;
let initialized = false;

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

function kataToHira(value: string): string {
  return [...value].map((char) => {
    const code = char.charCodeAt(0);
    return code >= 0x30a1 && code <= 0x30f6
      ? String.fromCharCode(code - 0x60)
      : char;
  }).join('');
}

function hasKana(value: string): boolean {
  return /[ぁ-ゖァ-ヺー]/u.test(value);
}

function constructWorker(): Worker {
  const resolved = new URL(WORKER_URL, globalThis.location.href);
  if (resolved.origin === globalThis.location.origin) {
    return new Worker(resolved.href, { type: 'module' });
  }
  const bootstrap = URL.createObjectURL(new Blob(
    [`import ${JSON.stringify(resolved.href)};`],
    { type: 'text/javascript' },
  ));
  return new Worker(bootstrap, { type: 'module' });
}

function ensureWorker(): Worker {
  if (workerFailure) throw workerFailure;
  if (worker) return worker;

  worker = constructWorker();
  worker.addEventListener('error', (event) => {
    workerFailure = new Error(
      `Open JTalk worker failed: ${event.message || 'unknown error'}`,
    );
    for (const entry of pending.values()) {
      window.clearTimeout(entry.timer);
      entry.reject(workerFailure);
    }
    pending.clear();
  });
  worker.addEventListener('message', (event: MessageEvent<{
    id: number;
    ok: boolean;
    result?: unknown;
    error?: string;
  }>) => {
    const message = event.data;
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    window.clearTimeout(entry.timer);
    if (message.ok) entry.resolve(message.result);
    else entry.reject(new Error(message.error ?? 'Open JTalk request failed'));
  });
  return worker;
}

function callWorker<T>(method: string, args: unknown[]): Promise<T> {
  const activeWorker = ensureWorker();
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      if (!pending.has(id)) return;
      pending.delete(id);
      reject(new Error(`Open JTalk timed out while calling ${method}`));
    }, REQUEST_TIMEOUT_MS);
    pending.set(id, {
      resolve: (value) => resolve(value as T),
      reject,
      timer,
    });
    activeWorker.postMessage({ id, method, args });
  });
}

async function drainWithProgress(
  url: string,
  onProgress?: (progress: number) => void,
): Promise<void> {
  const response = await fetch(url, { cache: 'force-cache' });
  if (!response.ok) throw new Error(`Failed to fetch Japanese G2P asset: HTTP ${response.status}`);

  const total = Number(response.headers.get('content-length')) || 0;
  const reader = response.body?.getReader();
  if (!reader) {
    await response.arrayBuffer();
    onProgress?.(1);
    return;
  }

  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    loaded += value.byteLength;
    if (total > 0) onProgress?.(clamp01(loaded / total));
  }
  onProgress?.(1);
}

export async function initializeJapaneseG2P(
  onProgress?: (progress: JapaneseG2PProgress) => void,
): Promise<void> {
  if (initialized) {
    onProgress?.({ stage: 'ready', progress: 1, message: 'JAPANESE G2P READY' });
    return;
  }
  if (!initializePromise) {
    initializePromise = (async () => {
      onProgress?.({
        stage: 'download',
        progress: 0,
        message: 'DOWNLOADING JAPANESE DICTIONARY · FIRST USE ONLY',
      });
      await drainWithProgress(DICT_ARCHIVE_URL, (progress) => {
        onProgress?.({
          stage: 'download',
          progress: progress * 0.82,
          message: `JAPANESE DICTIONARY · ${Math.round(progress * 100)}%`,
        });
      });
      await drainWithProgress(VOICE_URL);
      onProgress?.({
        stage: 'initialize',
        progress: 0.9,
        message: 'INITIALIZING OPEN JTALK',
      });
      await callWorker<void>('configure', [{
        dicArchiveUrl: DICT_ARCHIVE_URL,
        voiceUrl: VOICE_URL,
      }]);
      initialized = true;
      onProgress?.({ stage: 'ready', progress: 1, message: 'JAPANESE G2P READY' });
    })().catch((error) => {
      initializePromise = null;
      throw error;
    });
  }
  return initializePromise;
}

function fullContextPhone(label: string): string | null {
  const match = label.match(/-([^+]+)\+/);
  return match?.[1] ?? null;
}

function fullContextAccent(label: string): {
  a1: number | null;
  a2: number | null;
  a3: number | null;
} {
  const match = label.match(/\/A:([\d-]+)\+([\d-]+)\+([\d-]+)/);
  if (!match) return { a1: null, a2: null, a3: null };
  const parse = (value: string | undefined): number | null => {
    if (!value || value === 'xx') return null;
    const result = Number(value);
    return Number.isFinite(result) ? result : null;
  };
  return {
    a1: parse(match[1]),
    a2: parse(match[2]),
    a3: parse(match[3]),
  };
}

function isFullContextVowel(phone: string): boolean {
  return /^[aeiouAEIOU]$/.test(phone);
}

export function parseOpenJTalkFullContext(labels: readonly string[]): JapaneseFullContextMora[] {
  const moras: JapaneseFullContextMora[] = [];
  let pendingPhonemes: string[] = [];
  let pendingGeminate = false;

  for (const label of labels) {
    const phone = fullContextPhone(label);
    if (!phone || phone === 'sil') continue;

    if (phone === 'pau') {
      const previous = moras[moras.length - 1];
      if (previous) previous.pauseAfter = true;
      pendingPhonemes = [];
      continue;
    }

    if (phone === 'cl') {
      pendingGeminate = true;
      pendingPhonemes.push(phone);
      continue;
    }

    pendingPhonemes.push(phone);
    const closesMora = isFullContextVowel(phone) || phone === 'N';
    if (!closesMora) continue;

    const accent = fullContextAccent(label);
    moras.push({
      phonemes: pendingPhonemes,
      vowel: isFullContextVowel(phone) ? phone.toLowerCase() : null,
      devoiced: /^[AEIOU]$/.test(phone),
      geminateBefore: pendingGeminate,
      pauseAfter: false,
      accentA1: accent.a1,
      accentA2: accent.a2,
      accentA3: accent.a3,
    });
    pendingPhonemes = [];
    pendingGeminate = false;
  }

  return moras;
}

export function applyOpenJTalkFullContext(
  script: VoiceScript,
  labels: readonly string[],
): boolean {
  const moras = parseOpenJTalkFullContext(labels);
  if (moras.length !== script.units.length || moras.length === 0) return false;

  for (let index = 0; index < moras.length; index += 1) {
    const mora = moras[index]!;
    const unit = script.units[index]!;
    const next = moras[index + 1];

    if (mora.geminateBefore) unit.geminateBefore = true;

    // Long-vowel identity stays sourced from NJD pronunciation (pron),
    // where Open JTalk has already resolved ー versus a genuine vowel
    // sequence. Repeated full-context vowel phones alone are ambiguous.

    if (mora.pauseAfter && unit.boundaryAfter === 'none') {
      unit.boundaryAfter = 'accent';
      unit.pauseAfter = Math.max(unit.pauseAfter, 0.08);
    }

    const fullContextPhraseBoundary = mora.accentA2 !== null
      && mora.accentA3 !== null
      && mora.accentA2 === mora.accentA3
      && next?.accentA2 === 1;
    if (fullContextPhraseBoundary && unit.boundaryAfter === 'none') {
      unit.boundaryAfter = 'accent';
      unit.pauseAfter = Math.max(unit.pauseAfter, 0.012);
    }
  }

  finalizeVoiceUnits(script.units);

  // Open JTalk's uppercase vowel phones encode context-sensitive devoicing.
  // Apply these after finalizeVoiceUnits(), whose built-in heuristic is kept as
  // the fallback path for kana/romaji text that never goes through Open JTalk.
  for (let index = 0; index < moras.length; index += 1) {
    script.units[index]!.devoiced = moras[index]!.devoiced;
  }

  return true;
}

export function pitchAccentPattern(moraCount: number, accentNucleus: number): VoicePitchAccent[] {
  if (moraCount <= 0) return [];
  const nucleus = Math.max(0, Math.min(moraCount, Math.round(accentNucleus)));
  const result: VoicePitchAccent[] = new Array(moraCount).fill('low');

  if (nucleus === 0) {
    for (let index = 1; index < moraCount; index += 1) result[index] = 'high';
    return result;
  }
  if (nucleus === 1) {
    result[0] = 'high';
    return result;
  }

  for (let index = 1; index < Math.min(nucleus, moraCount); index += 1) {
    result[index] = 'high';
  }
  return result;
}

interface NodeSpan {
  start: number;
  end: number;
  node: JapaneseFrontendNode;
}

const JAPANESE_CONNECTIVE_SURFACES = new Map<string, Exclude<VoiceContinuationKind, 'none'>>([
  ['けど', 'contrast'],
  ['けれど', 'contrast'],
  ['けれども', 'contrast'],
  ['が', 'contrast'],
  ['ので', 'cause'],
  ['から', 'cause'],
  ['なら', 'condition'],
  ['たら', 'condition'],
  ['ても', 'concessive'],
  ['でも', 'concessive'],
  ['のに', 'concessive'],
  ['し', 'additive'],
]);

function connectiveKindForFrontendNode(
  node: JapaneseFrontendNode,
): Exclude<VoiceContinuationKind, 'none'> | null {
  const surface = kataToHira((node.string || '').normalize('NFKC'));
  const kind = JAPANESE_CONNECTIVE_SURFACES.get(surface);
  if (!kind) return null;

  // When Open JTalk exposes POS detail, reject case/subject particles that
  // happen to share the same surface as a connective (especially が / から).
  if (node.pos_group1) {
    if (node.pos_group1.includes('接続助詞')) return kind;
    if (surface === 'が' || surface === 'から' || surface === 'し') return null;
  }
  return kind;
}

function shouldSuppressFallbackContinuation(node: JapaneseFrontendNode): boolean {
  const surface = kataToHira((node.string || '').normalize('NFKC'));
  if (!node.pos_group1 || node.pos_group1.includes('接続助詞')) return false;
  return surface === 'が' || surface === 'から' || surface === 'し';
}

function discourseRoleForFrontendNode(
  node: JapaneseFrontendNode,
): Exclude<VoiceDiscourseRole, 'none'> | null {
  if (node.pos && node.pos !== '助詞') return null;
  const surface = kataToHira((node.string || '').normalize('NFKC'));
  const group1 = node.pos_group1 ?? '';
  const group2 = node.pos_group2 ?? '';

  if (surface === 'は' && group1.includes('係助詞')) return 'topic';
  if (surface === 'も' && (group1.includes('係助詞') || group1.includes('副助詞'))) return 'topic';
  if (surface === 'が' && group1.includes('格助詞')) return 'subject';
  if (surface === 'と' && group1.includes('格助詞') && group2.includes('引用')) return 'quote';
  if (surface === 'や' && group1.includes('並立助詞')) return 'list';
  if ((surface === 'とか' || surface === 'など')
    && (group1.includes('並立助詞') || group1.includes('副助詞'))) return 'list';
  if (['だけ', 'こそ', 'さえ', 'しか', 'まで', 'ばかり'].includes(surface)
    && (group1.includes('副助詞') || group1.includes('係助詞'))) return 'focus';
  return null;
}

function focusStrengthForFrontendNode(node: JapaneseFrontendNode): number {
  const surface = kataToHira((node.string || '').normalize('NFKC'));
  if (surface === 'こそ') return 1;
  if (surface === 'さえ') return 0.92;
  if (surface === 'しか') return 0.88;
  if (surface === 'だけ') return 0.78;
  if (surface === 'まで') return 0.68;
  if (surface === 'ばかり') return 0.64;
  return 0.72;
}

export function buildScriptFromJapaneseFrontend(
  nodes: JapaneseFrontendNode[],
  sourceText = '',
): {
  script: VoiceScript;
  reading: string;
  unitSourceRanges: JapaneseUnitSourceRange[];
  accentPhrases: JapaneseAccentPhrase[];
} {
  const readingParts: string[] = [];
  const spans: NodeSpan[] = [];
  const unitSourceRanges: JapaneseUnitSourceRange[] = [];
  const accentPhrases: JapaneseAccentPhrase[] = [];
  let unitCursor = 0;
  let sourceCursor = 0;

  for (const node of nodes) {
    const surface = node.string || '';
    let sourceStart = sourceCursor;
    let sourceEnd = sourceCursor;
    if (sourceText && surface) {
      const found = sourceText.indexOf(surface, sourceCursor);
      sourceStart = found >= 0 ? found : sourceCursor;
      sourceEnd = Math.min(sourceText.length, sourceStart + surface.length);
      sourceCursor = sourceEnd;
    }

    const pronunciation = node.pron || node.read || '';
    if (pronunciation && hasKana(pronunciation)) {
      const hira = kataToHira(pronunciation);
      readingParts.push(hira);
      const count = parseVoiceScript(hira).units.length;
      if (count > 0) {
        spans.push({
          start: unitCursor,
          end: unitCursor + count - 1,
          node,
        });

        const surfaceLength = Math.max(1, sourceEnd - sourceStart);
        for (let localIndex = 0; localIndex < count; localIndex += 1) {
          const start = sourceText
            ? sourceStart + Math.floor(localIndex * surfaceLength / count)
            : unitCursor + localIndex;
          const end = sourceText
            ? sourceStart + Math.max(
                Math.floor((localIndex + 1) * surfaceLength / count),
                Math.floor(localIndex * surfaceLength / count) + 1,
              )
            : unitCursor + localIndex + 1;
          unitSourceRanges.push({
            start,
            end: sourceText ? Math.min(sourceEnd, end) : end,
          });
        }
        unitCursor += count;
      }
    } else if (surface) {
      readingParts.push(surface);
    }
  }

  const reading = readingParts.join('');
  const script = parseVoiceScript(reading);
  if (script.units.length === 0 || spans.length === 0) {
    return { script, reading, unitSourceRanges, accentPhrases };
  }

  const phraseGroups: NodeSpan[][] = [];
  let current: NodeSpan[] = [];
  for (const span of spans) {
    if (current.length === 0 || span.node.chain_flag <= 0) {
      if (current.length > 0) phraseGroups.push(current);
      current = [span];
    } else {
      current.push(span);
    }
  }
  if (current.length > 0) phraseGroups.push(current);

  for (const group of phraseGroups) {
    const start = group[0]!.start;
    const end = group[group.length - 1]!.end;
    const count = Math.max(1, end - start + 1);
    const accentNucleus = Math.max(0, group[0]!.node.acc || 0);
    accentPhrases.push({
      start,
      end,
      nucleus: Math.min(count, accentNucleus),
    });
    const pattern = pitchAccentPattern(count, accentNucleus);

    for (let offset = 0; offset < count; offset += 1) {
      const unit = script.units[start + offset];
      if (unit) unit.pitchAccent = pattern[offset] ?? 'auto';
    }

    const endUnit = script.units[end];
    if (endUnit && endUnit.boundaryAfter === 'none') {
      endUnit.boundaryAfter = 'accent';
      endUnit.pauseAfter = Math.max(endUnit.pauseAfter, 0.012);
    }
  }

  for (const span of spans) {
    if (span.node.pos && span.node.pos !== '助詞') {
      for (let cursor = span.start; cursor <= span.end; cursor += 1) {
        const unit = script.units[cursor];
        if (unit) unit.suppressAttitudeInference = true;
      }
    }
  }

  for (const span of spans) {
    if (span.end >= script.units.length - 1) continue;
    const kind = connectiveKindForFrontendNode(span.node);
    if (kind) {
      applyVoiceContinuationBoundary(script.units, span.end, kind);
      continue;
    }
    if (shouldSuppressFallbackContinuation(span.node)) {
      const endUnit = script.units[span.end];
      if (endUnit) endUnit.suppressContinuationInference = true;
    }
  }

  for (let index = 0; index < spans.length; index += 1) {
    const span = spans[index]!;
    if (span.end >= script.units.length - 1) continue;
    const role = discourseRoleForFrontendNode(span.node);
    if (!role) continue;
    const previous = spans[index - 1];
    const focusStart = previous?.start ?? span.start;
    const focusEnd = previous?.end ?? span.end;

    if (role === 'topic') {
      applyVoiceDiscourseMarker(script.units, span.end, role, {
        boundary: true,
        pause: 0.035,
        focusStart,
        focusEnd,
        focusStrength: 0.24,
      });
    } else if (role === 'subject') {
      applyVoiceDiscourseMarker(script.units, span.end, role, {
        focusStart,
        focusEnd,
        focusStrength: 0.82,
      });
    } else if (role === 'quote') {
      applyVoiceDiscourseMarker(script.units, span.end, role, {
        boundary: true,
        pause: 0.035,
      });
    } else if (role === 'focus') {
      const focusStrength = focusStrengthForFrontendNode(span.node);
      applyVoiceDiscourseMarker(script.units, span.end, role, {
        focusStart,
        focusEnd,
        focusStrength,
      });
      applyVoicePreFocusPause(script.units, focusStart, focusStrength);
    } else {
      applyVoiceDiscourseMarker(script.units, span.end, role, {
        boundary: true,
        pause: 0.055,
        focusStart,
        focusEnd,
        focusStrength: 0.34,
      });
    }
  }

  finalizeVoiceUnits(script.units);
  return { script, reading, unitSourceRanges, accentPhrases };
}

export async function analyzeJapaneseText(
  text: string,
  onProgress?: (progress: JapaneseG2PProgress) => void,
): Promise<JapaneseG2PAnalysis> {
  await initializeJapaneseG2P(onProgress);
  onProgress?.({ stage: 'analyze', progress: 0.96, message: 'ANALYZING READING + PITCH ACCENT' });
  const nodes = await callWorker<JapaneseFrontendNode[]>('runFrontend', [text]);
  const { script, reading, unitSourceRanges, accentPhrases } = buildScriptFromJapaneseFrontend(nodes, text);
  const labels = await callWorker<string[]>('extractFullContext', [text, {}]);
  const fullContextMatched = applyOpenJTalkFullContext(script, labels);
  onProgress?.({
    stage: 'ready',
    progress: 1,
    message: fullContextMatched
      ? 'JAPANESE G2P + FULL CONTEXT READY'
      : 'JAPANESE G2P READY',
  });
  return {
    script,
    reading,
    nodes,
    unitSourceRanges,
    labels,
    fullContextMatched,
    accentPhrases,
    source: 'open-jtalk',
  };
}

export function containsKanji(text: string): boolean {
  return /\p{Script=Han}/u.test(text);
}

export function containsAmbiguousJapaneseLongVowel(text: string): boolean {
  const hira = [...text.normalize('NFKC')].map((char) => {
    const code = char.charCodeAt(0);
    return code >= 0x30a1 && code <= 0x30f6
      ? String.fromCharCode(code - 0x60)
      : char;
  }).join('');

  return /(?:[えけげせぜてでねへべぺめれ]|[きしちにひみりぎじびぴ]ぇ)い/u.test(hira)
    || /(?:[おこごそぞとどのほぼぽもよろ]|[きしちにひみりぎじびぴ]ょ)う/u.test(hira);
}

export function needsJapanesePronunciationAnalysis(text: string): boolean {
  return containsKanji(text) || containsAmbiguousJapaneseLongVowel(text);
}

export type JapaneseFirstUsePlaybackStrategy =
  | 'precise-local'
  | 'quick-local'
  | 'quick-system';

export function japaneseFirstUsePlaybackStrategy(
  text: string,
  analyzed: boolean,
): JapaneseFirstUsePlaybackStrategy {
  if (analyzed || !needsJapanesePronunciationAnalysis(text)) return 'precise-local';
  return containsKanji(text) ? 'quick-system' : 'quick-local';
}

export function isJapaneseG2PReady(): boolean {
  return initialized;
}
