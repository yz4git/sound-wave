/**
 * Cache the *exact* Japanese phonemes passed to the Kokoro tokenizer.
 *
 * This is distinct from VOICE LAB's Open JTalk pitch/accent editor analysis:
 * kokoro-js-jp@0.2.0 has its own G2P and phoneme conversion. Reusing its own
 * string preserves the original Kokoro sound/word boundaries verbatim.
 *
 * Disk: <= 512 KiB / 128 entries. RAM: <= 96 KiB / 32 entries.
 * iPhone Safari storage failures gracefully return null.
 */
export const NEURAL_PHONEME_CACHE_VERSION = 'kokoro-js-jp-0.2.0-kokoro-1.2.1-phonemes-v1';
export const NEURAL_PHONEME_DISK_LIMIT = 512 * 1024;
export const NEURAL_PHONEME_DISK_ENTRIES = 128;
const MAX_TEXT_LENGTH = 1024;
const MAX_PHONEME_LENGTH = 4096;

interface PhonemeRecord {
  key: string;
  phonemes: string;
  bytes: number;
  touchedAt: number;
}

export function neuralPhonemeKey(text: string): string {
  return JSON.stringify([NEURAL_PHONEME_CACHE_VERSION, text]);
}

export function validNeuralPhonemes(text: string, phonemes: unknown): phonemes is string {
  return text.length > 0
    && text.length <= MAX_TEXT_LENGTH
    && typeof phonemes === 'string'
    && phonemes.length > 0
    && phonemes.length <= MAX_PHONEME_LENGTH
    && !/[\\u0000-\\u001f\\u007f]/u.test(phonemes);
}

export class NeuralPhonemeMemoryCache {
  private readonly entries = new Map<string, string>();
  private bytesUsed = 0;

  constructor(
    private readonly maxBytes = 96 * 1024,
    private readonly maxEntries = 32,
  ) {}

  get(text: string): string | null {
    const key = neuralPhonemeKey(text);
    const value = this.entries.get(key);
    if (value === undefined) return null;
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  put(text: string, phonemes: string): boolean {
    if (!validNeuralPhonemes(text, phonemes)) return false;
    const key = neuralPhonemeKey(text);
    const bytes = 2 * (key.length + phonemes.length);
    if (bytes > this.maxBytes || this.maxEntries < 1) return false;
    const old = this.entries.get(key);
    if (old !== undefined) {
      this.bytesUsed -= 2 * (key.length + old.length);
      this.entries.delete(key);
    }
    this.entries.set(key, phonemes);
    this.bytesUsed += bytes;
    while (this.bytesUsed > this.maxBytes || this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      const value = this.entries.get(oldest)!;
      this.bytesUsed -= 2 * (oldest.length + value.length);
      this.entries.delete(oldest);
    }
    return true;
  }

  get size(): number { return this.entries.size; }
  get bytes(): number { return this.bytesUsed; }
}

export class NeuralPhonemeCache {
  private readonly memory = new NeuralPhonemeMemoryCache();
  private dbPromise: Promise<IDBDatabase | null> | null = null;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly factory: IDBFactory | null =
      typeof indexedDB === 'undefined' ? null : indexedDB,
    private readonly maxBytes = NEURAL_PHONEME_DISK_LIMIT,
    private readonly maxEntries = NEURAL_PHONEME_DISK_ENTRIES,
  ) {}

  private open(): Promise<IDBDatabase | null> {
    if (!this.factory) return Promise.resolve(null);
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve) => {
        let request: IDBOpenDBRequest;
        try { request = this.factory!.open('sound-wave-kokoro-phonemes', 1); }
        catch { resolve(null); return; }
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains('entries')) {
            request.result.createObjectStore('entries', { keyPath: 'key' });
          }
        };
        request.onsuccess = () => {
          const db = request.result;
          db.onversionchange = () => { db.close(); this.dbPromise = null; };
          resolve(db);
        };
        request.onerror = () => resolve(null);
        request.onblocked = () => resolve(null);
      });
    }
    return this.dbPromise;
  }

  async get(text: string): Promise<string | null> {
    if (!text || text.length > MAX_TEXT_LENGTH) return null;
    const cached = this.memory.get(text);
    if (cached !== null) return cached;
    const db = await this.open();
    if (!db) return null;
    const key = neuralPhonemeKey(text);
    const result = await new Promise<string | null>((resolve) => {
      try {
        const transaction = db.transaction('entries', 'readwrite');
        const store = transaction.objectStore('entries');
        const request = store.get(key);
        request.onsuccess = () => {
          const record = request.result as PhonemeRecord | undefined;
          if (!record || !validNeuralPhonemes(text, record.phonemes)) {
            resolve(null);
            return;
          }
          try { store.put({ ...record, touchedAt: Date.now() } satisfies PhonemeRecord); }
          catch { /* valid read remains usable */ }
          resolve(record.phonemes);
        };
        request.onerror = () => resolve(null);
        transaction.onabort = () => resolve(null);
      } catch { resolve(null); }
    });
    if (result !== null) this.memory.put(text, result);
    return result;
  }

  async put(text: string, phonemes: string): Promise<boolean> {
    if (!validNeuralPhonemes(text, phonemes)) return false;
    this.memory.put(text, phonemes);
    const key = neuralPhonemeKey(text);
    const bytes = 2 * (key.length + phonemes.length);
    if (bytes > this.maxBytes || this.maxEntries < 1) return false;
    let saved = false;
    const operation = this.writeQueue.then(async () => {
      const db = await this.open();
      if (!db) return;
      saved = await new Promise<boolean>((resolve) => {
        try {
          const tx = db.transaction('entries', 'readwrite');
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => resolve(false);
          tx.onabort = () => resolve(false);
          tx.objectStore('entries').put({ key, phonemes, bytes, touchedAt: Date.now() } satisfies PhonemeRecord);
        } catch { resolve(false); }
      });
      if (saved) await this.prune(db);
    });
    this.writeQueue = operation.catch(() => {});
    try { await operation; } catch { return false; }
    return saved;
  }

  private async prune(db: IDBDatabase): Promise<void> {
    const all = await new Promise<PhonemeRecord[]>((resolve) => {
      try {
        const tx = db.transaction('entries', 'readonly');
        const request = tx.objectStore('entries').getAll();
        request.onsuccess = () => resolve(request.result as PhonemeRecord[]);
        request.onerror = () => resolve([]);
        tx.onabort = () => resolve([]);
      } catch { resolve([]); }
    });
    let bytes = all.reduce((sum, x) => sum + (x.bytes || 0), 0);
    let entries = all.length;
    if (bytes <= this.maxBytes && entries <= this.maxEntries) return;
    const victims: string[] = [];
    for (const record of all.sort((a, b) => a.touchedAt - b.touchedAt)) {
      if (bytes <= this.maxBytes && entries <= this.maxEntries) break;
      victims.push(record.key);
      bytes -= record.bytes || 0;
      entries -= 1;
    }
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction('entries', 'readwrite');
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
        const store = tx.objectStore('entries');
        for (const key of victims) store.delete(key);
      } catch { resolve(); }
    });
  }
}

/**
 * Access to the two stable interfaces used by kokoro-js-jp v0.2.0:
 * the KokoroTTS tokenizer and its public generate_from_ids() method.
 * The wrapper stores the KokoroTTS instance as an ordinary TS private property
 * `tts`; feature probing and a normal speak() fallback protect future updates.
 */
export interface KokoroLowLevel {
  tokenizer: (phonemes: string, settings: { truncation: boolean }) => { input_ids: unknown };
  generate_from_ids: (
    input_ids: unknown,
    options: { voice: string; speed: number },
  ) => Promise<{ audio: Float32Array; sampling_rate: number }>;
}

export interface KokoroSpeechClient {
  speak(text: string, voice: string, speed: number): Promise<{ audio: Float32Array; sampling_rate: number }>;
  tts?: unknown;
}

export function lowLevelKokoro(client: KokoroSpeechClient): KokoroLowLevel | null {
  const candidate = client.tts;
  if (!candidate || typeof candidate !== 'object') return null;
  const api = candidate as Partial<KokoroLowLevel>;
  return typeof api.tokenizer === 'function' && typeof api.generate_from_ids === 'function'
    ? api as KokoroLowLevel
    : null;
}

/** In-memory token tensors are safe only for the KokoroTTS instance which
 * constructed them; never persist model/runtime-specific Tensor objects. */
const sessionTokenIDs = new WeakMap<object, Map<string, unknown>>();
const SESSION_TOKEN_LIMIT = 48;

function tokenMap(api: KokoroLowLevel): Map<string, unknown> {
  let map = sessionTokenIDs.get(api);
  if (!map) {
    map = new Map<string, unknown>();
    sessionTokenIDs.set(api, map);
  }
  return map;
}

function memoizeIDs(api: KokoroLowLevel, text: string, ids: unknown): void {
  if (ids === undefined || ids === null) return;
  const map = tokenMap(api);
  const key = neuralPhonemeKey(text);
  map.delete(key);
  map.set(key, ids);
  while (map.size > SESSION_TOKEN_LIMIT) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}

export interface FastJapaneseSpeechResult {
  audio: Float32Array;
  sampling_rate: number;
  reusedPhonemes: boolean;
  capturedPhonemes: boolean;
}

/** Must be called serially per Kokoro model instance: tokenizer interception
 * is only installed around one awaited speak() operation. */
export async function speakWithReusablePhonemes(
  client: KokoroSpeechClient,
  cache: Pick<NeuralPhonemeCache, 'get' | 'put'>,
  text: string,
  voice: string,
  speed: number,
  onReuse?: (source: 'token-ids' | 'phonemes') => void,
): Promise<FastJapaneseSpeechResult> {
  const lowLevel = lowLevelKokoro(client);
  if (!lowLevel) {
    const result = await client.speak(text, voice, speed);
    return { ...result, reusedPhonemes: false, capturedPhonemes: false };
  }

  const map = tokenMap(lowLevel);
  const cachedTokens = map.get(neuralPhonemeKey(text));
  if (cachedTokens) {
    try {
      onReuse?.('token-ids');
      const result = await lowLevel.generate_from_ids(cachedTokens, { voice, speed });
      return { ...result, reusedPhonemes: true, capturedPhonemes: false };
    } catch {
      map.delete(neuralPhonemeKey(text));
    }
  }

  const saved = await cache.get(text);
  if (saved !== null) {
    try {
      // Use Kokoro's own tokenizer, not a reimplementation of Japanese
      // phonemization. Subsequent speaking rates/voices reuse these IDs.
      const tokenized = lowLevel.tokenizer(saved, { truncation: true });
      if (!tokenized || !tokenized.input_ids) throw new Error('tokenizer returned no token IDs');
      onReuse?.('phonemes');
      const result = await lowLevel.generate_from_ids(tokenized.input_ids, { voice, speed });
      memoizeIDs(lowLevel, text, tokenized.input_ids);
      return { ...result, reusedPhonemes: true, capturedPhonemes: false };
    } catch {
      // A changed low-level contract must not break Neural HQ or its quality.
      // Continue through the package's original official Japanese speak().
    }
  }

  const tokenizer = lowLevel.tokenizer;
  let captured: string | null = null;
  let capturedIDs: unknown = null;
  let intercepted = false;
  try {
    lowLevel.tokenizer = (phonemes, settings) => {
      if (typeof phonemes === 'string') captured = phonemes;
      const tokens = tokenizer.call(lowLevel, phonemes, settings);
      capturedIDs = tokens?.input_ids;
      return tokens;
    };
    intercepted = lowLevel.tokenizer !== tokenizer;
  } catch { /* read-only version of tokenizer; use unmodified speak() */ }

  try {
    const result = await client.speak(text, voice, speed);
    if (intercepted && captured !== null && validNeuralPhonemes(text, captured)) {
      memoizeIDs(lowLevel, text, capturedIDs);
      // Do not delay speech playback with a nonessential IndexedDB write.
      void cache.put(text, captured);
    }
    return { ...result, reusedPhonemes: false, capturedPhonemes: intercepted && captured !== null };
  } finally {
    if (intercepted) {
      try { lowLevel.tokenizer = tokenizer; } catch { /* safe fallback next time */ }
    }
  }
}
