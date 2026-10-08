/**
 * Persist only speech PCM, never heavy ONNX runtime/model instances.
 * IndexedDB is optional: disabled/private Safari storage transparently falls
 * back to the existing in-memory waveform cache.
 */
export interface NeuralStoredPCM {
  audio: Float32Array;
  sampleRate: number;
}

interface StoredWaveform {
  key: string;
  pcm: ArrayBuffer;
  sampleRate: number;
}

interface WaveformMeta {
  key: string;
  bytes: number;
  touchedAt: number;
}

export const NEURAL_PERSISTENT_CACHE_VERSION = 'kokoro-voice-pcm-v1';
export const NEURAL_PERSISTENT_CACHE_LIMIT_BYTES = 24 * 1024 * 1024;
export const NEURAL_PERSISTENT_CACHE_MAX_ENTRIES = 24;
export const NEURAL_PERSISTENT_MAX_CLIP_BYTES = 8 * 1024 * 1024;

export function neuralPersistentKey(kind: 'segment' | 'final', identity: string): string {
  return JSON.stringify([NEURAL_PERSISTENT_CACHE_VERSION, kind, identity]);
}

export function validNeuralStoredPCM(
  pcm: NeuralStoredPCM,
  maxBytes = NEURAL_PERSISTENT_MAX_CLIP_BYTES,
): boolean {
  return pcm.audio instanceof Float32Array
    && pcm.audio.length > 0
    && pcm.audio.byteLength <= maxBytes
    && Number.isFinite(pcm.sampleRate)
    && pcm.sampleRate >= 8_000
    && pcm.sampleRate <= 96_000;
}

export class NeuralRenderStore {
  private connection: Promise<IDBDatabase | null> | null = null;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly maxBytes = NEURAL_PERSISTENT_CACHE_LIMIT_BYTES,
    private readonly maxEntries = NEURAL_PERSISTENT_CACHE_MAX_ENTRIES,
    private readonly factory: IDBFactory | undefined =
      typeof indexedDB === 'undefined' ? undefined : indexedDB,
  ) {}

  get available(): boolean {
    return Boolean(this.factory);
  }

  private open(): Promise<IDBDatabase | null> {
    if (!this.factory) return Promise.resolve(null);
    if (this.connection) return this.connection;
    this.connection = new Promise<IDBDatabase | null>((resolve) => {
      let request: IDBOpenDBRequest;
      try {
        request = this.factory!.open('sound-wave-neural-render-cache', 1);
      } catch {
        resolve(null);
        return;
      }
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('waveforms')) {
          db.createObjectStore('waveforms', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('metadata')) {
          db.createObjectStore('metadata', { keyPath: 'key' });
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          this.connection = null;
        };
        resolve(db);
      };
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    });
    return this.connection;
  }

  async get(key: string): Promise<NeuralStoredPCM | null> {
    const db = await this.open();
    if (!db) return null;
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value: NeuralStoredPCM | null): void => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      try {
        const tx = db.transaction(['waveforms', 'metadata'], 'readwrite');
        tx.onerror = () => finish(null);
        tx.onabort = () => finish(null);
        const request = tx.objectStore('waveforms').get(key);
        request.onerror = () => finish(null);
        request.onsuccess = () => {
          const item = request.result as StoredWaveform | undefined;
          if (!item || !(item.pcm instanceof ArrayBuffer) || item.pcm.byteLength % 4 !== 0) {
            finish(null);
            return;
          }
          const pcm = { audio: new Float32Array(item.pcm), sampleRate: item.sampleRate };
          if (!validNeuralStoredPCM(pcm, this.maxBytes)) {
            finish(null);
            return;
          }
          // Refresh disk LRU without re-writing the large audio buffer.
          try {
            tx.objectStore('metadata').put({
              key, bytes: item.pcm.byteLength, touchedAt: Date.now(),
            } satisfies WaveformMeta);
          } catch { /* read remains usable */ }
          finish(pcm);
        };
      } catch {
        finish(null);
      }
    });
  }

  /** Non-blocking persistence on the caller's side; serialized for stable LRU. */
  async put(key: string, pcm: NeuralStoredPCM): Promise<boolean> {
    if (!this.factory || !validNeuralStoredPCM(pcm, Math.min(this.maxBytes, NEURAL_PERSISTENT_MAX_CLIP_BYTES))) {
      return false;
    }
    let success = false;
    const operation = this.writeQueue.then(async () => {
      success = await this.write(key, pcm);
      if (success) await this.prune();
    });
    this.writeQueue = operation.catch(() => { /* allow later writes */ });
    try {
      await operation;
    } catch { return false; }
    return success;
  }

  private async write(key: string, pcm: NeuralStoredPCM): Promise<boolean> {
    const db = await this.open();
    if (!db) return false;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(['waveforms', 'metadata'], 'readwrite');
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
        tx.onabort = () => resolve(false);
        // Typed arrays are stored as compact binary Float32 PCM. Clone only
        // when the source is a view into a larger underlying allocation.
        const exactBuffer = pcm.audio.byteOffset === 0
          && pcm.audio.byteLength === pcm.audio.buffer.byteLength
          && pcm.audio.buffer instanceof ArrayBuffer;
        const buffer = exactBuffer
          ? pcm.audio.buffer as ArrayBuffer
          : pcm.audio.slice().buffer;
        tx.objectStore('waveforms').put({
          key, pcm: buffer, sampleRate: pcm.sampleRate,
        } satisfies StoredWaveform);
        tx.objectStore('metadata').put({
          key, bytes: pcm.audio.byteLength, touchedAt: Date.now(),
        } satisfies WaveformMeta);
      } catch {
        resolve(false);
      }
    });
  }

  private async prune(): Promise<void> {
    const db = await this.open();
    if (!db) return;
    const items = await new Promise<WaveformMeta[]>((resolve) => {
      try {
        const tx = db.transaction('metadata', 'readonly');
        const request = tx.objectStore('metadata').getAll();
        request.onsuccess = () => resolve(request.result as WaveformMeta[]);
        request.onerror = () => resolve([]);
        tx.onabort = () => resolve([]);
      } catch { resolve([]); }
    });
    let bytes = items.reduce((total, item) => total + item.bytes, 0);
    let count = items.length;
    if (bytes <= this.maxBytes && count <= this.maxEntries) return;
    const victims = [...items].sort((a, b) => a.touchedAt - b.touchedAt);
    const keys: string[] = [];
    for (const victim of victims) {
      if (bytes <= this.maxBytes && count <= this.maxEntries) break;
      keys.push(victim.key);
      bytes -= victim.bytes;
      count -= 1;
    }
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(['waveforms', 'metadata'], 'readwrite');
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
        for (const key of keys) {
          tx.objectStore('waveforms').delete(key);
          tx.objectStore('metadata').delete(key);
        }
      } catch { resolve(); }
    });
  }
}
