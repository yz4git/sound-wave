/**
 * Deduplicate overlapping identical inference requests.
 *
 * Kokoro cannot interrupt an already-dispatched ONNX inference. Sharing it
 * avoids running the same expensive model invocation twice when the user
 * retries SPEAK or changes playback state while rendering.
 * Only in-flight promises are retained; successful PCM belongs to bounded
 * NeuralAudioCache / IndexedDB and errors do not become sticky.
 */
export class NeuralInferenceSingleFlight<T> {
  private readonly pending = new Map<string, Promise<T>>();

  get size(): number { return this.pending.size; }
  has(key: string): boolean { return this.pending.has(key); }

  run(key: string, work: () => Promise<T>): Promise<T> {
    const existing = this.pending.get(key);
    if (existing) return existing;
    const request = Promise.resolve()
      .then(work)
      .finally(() => {
        if (this.pending.get(key) === request) this.pending.delete(key);
      });
    this.pending.set(key, request);
    return request;
  }
}
