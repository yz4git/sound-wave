import type { JapaneseG2PAnalysis } from './JapaneseG2P';

/**
 * Persist the result of Open JTalk phonetic/accent parsing, NOT ONNX weights
 * or audio samples. This is separate from NeuralRenderStore's 24 MiB PCM
 * budget; analysis objects are small JSON-like data.
 */
export const JAPANESE_ANALYSIS_CACHE_VERSION = 'open-jtalk-1.11-kokoro-0.2.0-voice-script-v1';
export const JAPANESE_ANALYSIS_CACHE_BYTES = 2 * 1024 * 1024;
export const JAPANESE_ANALYSIS_CACHE_ENTRIES = 64;
export const JAPANESE_ANALYSIS_MAX_ENTRY_BYTES = 200 * 1024;

interface StoredJapaneseAnalysis {
  key: string;
  analysis: JapaneseG2PAnalysis;
}

interface StoredJapaneseMeta {
  key: string;
  bytes: number;
  touchedAt: number;
}

function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function japaneseAnalysisCacheKey(text: string): string {
  return JSON.stringify([JAPANESE_ANALYSIS_CACHE_VERSION, text]);
}

export function validJapaneseAnalysis(
  value: unknown,
  maxBytes = JAPANESE_ANALYSIS_MAX_ENTRY_BYTES,
): value is JapaneseG2PAnalysis {
  if (!value || typeof value !== 'object') return false;
  const analysis = value as Partial<JapaneseG2PAnalysis>;
  if (
    analysis.source !== 'open-jtalk'
    || typeof analysis.reading !== 'string'
    || analysis.reading.length > 8000
    || !Array.isArray(analysis.nodes)
    || !Array.isArray(analysis.labels)
    || !Array.isArray(analysis.unitSourceRanges)
    || !Array.isArray(analysis.accentPhrases)
    || typeof analysis.fullContextMatched !== 'boolean'
    || !analysis.script
    || !Array.isArray(analysis.script.units)
    || !Array.isArray(analysis.script.events)
    || !Array.isArray(analysis.script.unsupported)
    || analysis.script.units.length > 2000
  ) return false;
  try {
    return JSON.stringify(analysis).length * 2 <= maxBytes;
  } catch {
    return false;
  }
}

/** In-memory LRU, safe to use when Safari disallows IndexedDB. */
export class JapaneseAnalysisMemoryCache {
  private entries = new Map<string, { value: JapaneseG2PAnalysis; bytes: number }>();
  private usedBytes = 0;

  constructor(
    private readonly maxBytes = 400 * 1024,
    private readonly maxEntries = 12,
  ) {}

  get(key: string): JapaneseG2PAnalysis | null {
    const found = this.entries.get(key);
    if (!found) return null;
    this.entries.delete(key);
    this.entries.set(key, found);
    return copy(found.value);
  }

  put(key: string, value: JapaneseG2PAnalysis): boolean {
    if (!validJapaneseAnalysis(value)) return false;
    const bytes = JSON.stringify(value).length * 2;
    if (bytes > this.maxBytes || this.maxEntries < 1) return false;
    const previous = this.entries.get(key);
    if (previous) {
      this.usedBytes -= previous.bytes;
      this.entries.delete(key);
    }
    this.entries.set(key, { value: copy(value), bytes });
    this.usedBytes += bytes;
    while (this.usedBytes > this.maxBytes || this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.usedBytes -= this.entries.get(oldest)!.bytes;
      this.entries.delete(oldest);
    }
    return true;
  }

  get size(): number { return this.entries.size; }
  get bytes(): number { return this.usedBytes; }
}

export class JapaneseAnalysisCache {
  private readonly memory = new JapaneseAnalysisMemoryCache();
  private database: Promise<IDBDatabase | null> | null = null;
  private writes: Promise<void> = Promise.resolve();

  constructor(
    private readonly factory: IDBFactory | null =
      typeof indexedDB === 'undefined' ? null : indexedDB,
    private readonly maxBytes = JAPANESE_ANALYSIS_CACHE_BYTES,
    private readonly maxEntries = JAPANESE_ANALYSIS_CACHE_ENTRIES,
  ) {}

  private open(): Promise<IDBDatabase | null> {
    if (!this.factory) return Promise.resolve(null);
    if (this.database) return this.database;
    this.database = new Promise((resolve) => {
      let request: IDBOpenDBRequest;
      try {
        request = this.factory!.open('sound-wave-open-jtalk-analysis-cache', 1);
      } catch {
        resolve(null);
        return;
      }
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('analyses')) {
          db.createObjectStore('analyses', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('metadata')) {
          db.createObjectStore('metadata', { keyPath: 'key' });
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          this.database = null;
        };
        resolve(db);
      };
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    });
    return this.database;
  }

  async get(text: string): Promise<JapaneseG2PAnalysis | null> {
    if (!text || text.length > 1500) return null;
    const key = japaneseAnalysisCacheKey(text);
    const inMemory = this.memory.get(key);
    if (inMemory) return inMemory;
    const db = await this.open();
    if (!db) return null;
    const saved = await new Promise<JapaneseG2PAnalysis | null>((resolve) => {
      try {
        const tx = db.transaction(['analyses', 'metadata'], 'readwrite');
        const req = tx.objectStore('analyses').get(key);
        req.onsuccess = () => {
          const record = req.result as StoredJapaneseAnalysis | undefined;
          if (!record || !validJapaneseAnalysis(record.analysis)) {
            resolve(null);
            return;
          }
          try {
            tx.objectStore('metadata').put({
              key,
              bytes: JSON.stringify(record.analysis).length * 2,
              touchedAt: Date.now(),
            } satisfies StoredJapaneseMeta);
          } catch { /* still a valid cached result */ }
          resolve(record.analysis);
        };
        req.onerror = () => resolve(null);
        tx.onabort = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
    if (saved) this.memory.put(key, saved);
    return saved ? copy(saved) : null;
  }

  async put(text: string, analysis: JapaneseG2PAnalysis): Promise<boolean> {
    if (!text || text.length > 1500 || !validJapaneseAnalysis(analysis)) return false;
    const key = japaneseAnalysisCacheKey(text);
    this.memory.put(key, analysis);
    const bytes = JSON.stringify(analysis).length * 2;
    if (bytes > this.maxBytes || this.maxEntries < 1) return false;

    let saved = false;
    const op = this.writes.then(async () => {
      const db = await this.open();
      if (!db) return;
      saved = await new Promise<boolean>((resolve) => {
        try {
          const tx = db.transaction(['analyses', 'metadata'], 'readwrite');
          tx.oncomplete = () => resolve(true);
          tx.onabort = () => resolve(false);
          tx.onerror = () => resolve(false);
          tx.objectStore('analyses').put({
            key, analysis: copy(analysis),
          } satisfies StoredJapaneseAnalysis);
          tx.objectStore('metadata').put({
            key, bytes, touchedAt: Date.now(),
          } satisfies StoredJapaneseMeta);
        } catch {
          resolve(false);
        }
      });
      if (saved) await this.prune(db);
    });
    this.writes = op.catch(() => {});
    try { await op; } catch { /* disk unavailable; RAM remains usable */ }
    return saved;
  }

  private async prune(db: IDBDatabase): Promise<void> {
    const metadata = await new Promise<StoredJapaneseMeta[]>((resolve) => {
      try {
        const tx = db.transaction('metadata', 'readonly');
        const req = tx.objectStore('metadata').getAll();
        req.onsuccess = () => resolve(req.result as StoredJapaneseMeta[]);
        req.onerror = () => resolve([]);
        tx.onabort = () => resolve([]);
      } catch { resolve([]); }
    });
    let bytes = metadata.reduce((sum, record) => sum + record.bytes, 0);
    let entries = metadata.length;
    if (bytes <= this.maxBytes && entries <= this.maxEntries) return;

    const remove: string[] = [];
    for (const record of metadata.sort((a, b) => a.touchedAt - b.touchedAt)) {
      if (bytes <= this.maxBytes && entries <= this.maxEntries) break;
      remove.push(record.key);
      bytes -= record.bytes;
      entries -= 1;
    }
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(['analyses', 'metadata'], 'readwrite');
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
        for (const key of remove) {
          tx.objectStore('analyses').delete(key);
          tx.objectStore('metadata').delete(key);
        }
      } catch { resolve(); }
    });
  }
}

const sharedJapaneseCache = new JapaneseAnalysisCache();

export function loadCachedJapaneseAnalysis(text: string): Promise<JapaneseG2PAnalysis | null> {
  return sharedJapaneseCache.get(text);
}

export function rememberJapaneseAnalysis(
  text: string,
  analysis: JapaneseG2PAnalysis,
): Promise<boolean> {
  return sharedJapaneseCache.put(text, analysis);
}
