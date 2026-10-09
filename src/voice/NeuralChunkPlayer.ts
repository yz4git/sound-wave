/**
 * Low-allocation progressive playback for long Kokoro utterances.
 *
 * ONNX inference remains serial on iPhone. As soon as a natural sentence
 * has been synthesized, schedule its buffer while the next one renders.
 * No concatenated multi-minute AudioBuffer is required to begin speaking.
 */
export interface NeuralStreamingChunk {
  audio: Float32Array;
  sampleRate: number;
  gain: number;
  pauseAfter: number;
}

const CROSSFADE_SECONDS = 0.008;
const EDGE_FADE_SECONDS = 0.006;
const START_LEAD_SECONDS = 0.012;

export function streamingChunkGain(chunk: NeuralStreamingChunk): number {
  if (chunk.audio.length === 0 || !Number.isFinite(chunk.gain)) return 0;
  let peak = 0;
  for (let i = 0; i < chunk.audio.length; i += 1) {
    const value = chunk.audio[i]!;
    if (!Number.isFinite(value)) return 0;
    peak = Math.max(peak, Math.abs(value));
  }
  const requested = Math.max(0, chunk.gain);
  return peak * requested > 0.985
    ? 0.985 / peak
    : requested;
}

/** Only crossfade if a previous chunk has been scheduled and the previous
 * segment did not have an intentional pause. */
export function nextNeuralChunkTime(
  now: number,
  previousEnd: number | null,
  previousPause: number,
): number {
  const earliest = now + START_LEAD_SECONDS;
  if (previousEnd === null) return earliest;
  const overlap = previousPause > 0 ? 0 : CROSSFADE_SECONDS;
  return Math.max(earliest, previousEnd + previousPause - overlap);
}

export class NeuralChunkPlayer {
  private readonly sources = new Set<AudioBufferSourceNode>();
  private readonly gains = new Map<AudioBufferSourceNode, GainNode>();
  private previousEnd: number | null = null;
  private previousPause = 0;
  private closed = false;
  private sealed = false;
  private finishResolve: (() => void) | null = null;
  private finishPromise: Promise<void> | null = null;

  constructor(private readonly context: AudioContext) {}

  get started(): boolean { return this.previousEnd !== null; }

  enqueue(chunk: NeuralStreamingChunk): boolean {
    if (this.closed || this.sealed || chunk.audio.length === 0) return false;
    const { context } = this;
    const buffer = context.createBuffer(1, chunk.audio.length, chunk.sampleRate);
    buffer.getChannelData(0).set(chunk.audio);
    const source = context.createBufferSource();
    const gain = context.createGain();
    const startAt = nextNeuralChunkTime(
      context.currentTime,
      this.previousEnd,
      this.previousPause,
    );
    const duration = chunk.audio.length / chunk.sampleRate;
    const endAt = startAt + duration;
    const targetGain = streamingChunkGain(chunk);
    const fade = Math.min(EDGE_FADE_SECONDS, duration / 3);
    const wasScheduled = this.previousEnd !== null;
    const crossfade = wasScheduled && this.previousPause === 0
      && startAt < this.previousEnd!;
    const fadeIn = crossfade ? CROSSFADE_SECONDS : fade;

    source.buffer = buffer;
    source.connect(gain);
    gain.connect(context.destination);

    // These ramps avoid clicks and keep adjacent sentence boundaries smooth
    // without changing the Kokoro-generated PCM, speed or pitch.
    gain.gain.setValueAtTime(0, startAt);
    gain.gain.linearRampToValueAtTime(targetGain, startAt + Math.min(fadeIn, duration / 3));
    gain.gain.setValueAtTime(targetGain, Math.max(startAt + fade, endAt - fade));
    gain.gain.linearRampToValueAtTime(0, endAt);

    source.onended = () => {
      source.onended = null;
      this.sources.delete(source);
      const oldGain = this.gains.get(source);
      this.gains.delete(source);
      try { source.disconnect(); } catch { /* already released */ }
      try { oldGain?.disconnect(); } catch { /* already released */ }
      this.resolveIfFinished();
    };
    this.sources.add(source);
    this.gains.set(source, gain);
    this.previousEnd = endAt;
    this.previousPause = Math.max(0, chunk.pauseAfter);
    source.start(startAt);
    return true;
  }

  finish(): Promise<void> {
    this.sealed = true;
    if (!this.finishPromise) {
      this.finishPromise = new Promise<void>((resolve) => {
        this.finishResolve = resolve;
      });
    }
    this.resolveIfFinished();
    return this.finishPromise;
  }

  stop(): void {
    if (this.closed) return;
    this.closed = true;
    this.sealed = true;
    for (const source of this.sources) {
      source.onended = null;
      try { source.stop(); } catch { /* already stopped */ }
      try { source.disconnect(); } catch { /* disconnected */ }
      try { this.gains.get(source)?.disconnect(); } catch { /* disconnected */ }
    }
    this.sources.clear();
    this.gains.clear();
    this.resolveIfFinished();
  }

  private resolveIfFinished(): void {
    if (!this.sealed || this.sources.size !== 0) return;
    const resolve = this.finishResolve;
    this.finishResolve = null;
    resolve?.();
  }
}
