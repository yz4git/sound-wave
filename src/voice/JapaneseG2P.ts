import {
  finalizeVoiceUnits,
  parseVoiceScript,
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
}

export interface JapaneseG2PAnalysis {
  script: VoiceScript;
  reading: string;
  nodes: JapaneseFrontendNode[];
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

export function buildScriptFromJapaneseFrontend(nodes: JapaneseFrontendNode[]): {
  script: VoiceScript;
  reading: string;
} {
  const readingParts: string[] = [];
  const spans: NodeSpan[] = [];
  let unitCursor = 0;

  for (const node of nodes) {
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
        unitCursor += count;
      }
    } else if (node.string) {
      readingParts.push(node.string);
    }
  }

  const reading = readingParts.join('');
  const script = parseVoiceScript(reading);
  if (script.units.length === 0 || spans.length === 0) {
    return { script, reading };
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

  finalizeVoiceUnits(script.units);
  return { script, reading };
}

export async function analyzeJapaneseText(
  text: string,
  onProgress?: (progress: JapaneseG2PProgress) => void,
): Promise<JapaneseG2PAnalysis> {
  await initializeJapaneseG2P(onProgress);
  onProgress?.({ stage: 'analyze', progress: 0.96, message: 'ANALYZING READING + PITCH ACCENT' });
  const nodes = await callWorker<JapaneseFrontendNode[]>('runFrontend', [text]);
  const { script, reading } = buildScriptFromJapaneseFrontend(nodes);
  onProgress?.({ stage: 'ready', progress: 1, message: 'KANJI G2P READY' });
  return {
    script,
    reading,
    nodes,
    source: 'open-jtalk',
  };
}

export function containsKanji(text: string): boolean {
  return /\p{Script=Han}/u.test(text);
}

export function isJapaneseG2PReady(): boolean {
  return initialized;
}
