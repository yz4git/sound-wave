/**
 * VoxCPM2's 2B model runs in a Python inference service, not inside Safari.
 * This adapter only sends requests to an endpoint explicitly supplied by the user.
 * It never silently substitutes browser TTS for VoxCPM.
 */
export interface VoxCpmSpeechRequest {
  text: string;
  voiceDescription: string;
  inferenceTimesteps: number;
}

export interface VoxCpmRemoteOptions extends VoxCpmSpeechRequest {
  endpoint: string;
  token?: string;
}

export function voxCpmApiBase(input: string): string {
  const raw = input.trim();
  if (!raw) throw new Error('SET VOXCPM2 SERVER URL FIRST');
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('VOXCPM2 SERVER URL IS INVALID');
  }
  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error('VOXCPM2 REQUIRES HTTPS (LOCALHOST MAY USE HTTP)');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('USE A SERVER URL WITHOUT CREDENTIALS OR QUERY');
  }
  return url.href.replace(/\/+$/, '');
}

export function voxCpmSpeechUrl(input: string): string {
  const base = voxCpmApiBase(input);
  return base.endsWith('/v1/speech') ? base : base.replace(/\/v1$/, '') + '/v1/speech';
}

export function voxCpmSpeechPayload(input: VoxCpmSpeechRequest): {
  text: string;
  voice_description: string;
  inference_timesteps: number;
} {
  const text = input.text.trim();
  if (!text || text.length > 420) throw new Error('VOXCPM2 TEXT MUST BE 1–420 CHARACTERS');
  return {
    text,
    voice_description: input.voiceDescription.trim().slice(0, 240),
    inference_timesteps: Math.max(4, Math.min(24, Math.round(input.inferenceTimesteps))),
  };
}

/** Human-readable instructions are a soft prompt, not precise pitch automation. */
export function voxCpmVoicePrompt(input: {
  description: string;
  rate: number;
  pitch: number;
  energy: number;
  expression: string;
  character: string;
}): string {
  const description = input.description.trim() || 'A clear, natural Japanese speaking voice';
  const adjustments = [
    input.character !== 'natural' ? `voice character: ${input.character}` : '',
    input.rate < 0.9 ? 'speaking slowly' : input.rate > 1.1 ? 'speaking briskly' : '',
    input.pitch < 55 ? 'with a relatively low pitch' : input.pitch > 66 ? 'with a relatively high pitch' : '',
    input.energy < 0.8 ? 'speaking softly' : input.energy > 1.05 ? 'speaking with emphasis' : '',
    input.expression !== 'neutral' ? `with a ${input.expression} delivery` : '',
  ].filter(Boolean);
  return [description, ...adjustments].join(', ').slice(0, 240);
}

export function isVoxCpmWav(bytes: ArrayBuffer): boolean {
  if (bytes.byteLength < 44) return false;
  const header = new Uint8Array(bytes, 0, 12);
  const ascii = (from: number, len: number) =>
    String.fromCharCode(...header.slice(from, from + len));
  return ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WAVE';
}

export class VoxCpmRemoteVoice {
  private context: AudioContext | null = null;
  private source: AudioBufferSourceNode | null = null;
  private controller: AbortController | null = null;
  private generation = 0;
  private lastKey = '';
  private lastWav: Blob | null = null;

  /** Call from the user's pointer event to unlock WebAudio on iOS. */
  unlock(): void {
    if (!this.context) this.context = new AudioContext();
    void this.context.resume().catch(() => {});
  }

  stop(): void {
    this.generation++;
    this.controller?.abort();
    this.controller = null;
    const previous = this.source;
    this.source = null;
    if (previous) {
      previous.onended = null;
      try { previous.stop(); } catch { /* already stopped */ }
      previous.disconnect();
    }
  }

  private cacheKey(options: VoxCpmRemoteOptions): string {
    return JSON.stringify([
      voxCpmSpeechUrl(options.endpoint),
      voxCpmSpeechPayload(options),
    ]);
  }

  cachedWav(options: VoxCpmRemoteOptions): Blob | null {
    return this.cacheKey(options) === this.lastKey ? this.lastWav : null;
  }

  private async generate(options: VoxCpmRemoteOptions, onStatus: (message: string) => void): Promise<Blob> {
    const key = this.cacheKey(options);
    if (key === this.lastKey && this.lastWav) {
      onStatus('VOXCPM2 · REPLAYING SAVED TAKE');
      return this.lastWav;
    }
    const controller = new AbortController();
    this.controller = controller;
    const timeout = setTimeout(() => controller.abort(), 180_000);
    try {
      onStatus('VOXCPM2 · REQUESTING 48kHz WAV FROM SERVER');
      const response = await fetch(voxCpmSpeechUrl(options.endpoint), {
        method: 'POST',
        mode: 'cors',
        cache: 'no-store',
        credentials: 'omit',
        headers: {
          'Content-Type': 'application/json',
          ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        },
        body: JSON.stringify(voxCpmSpeechPayload(options)),
        signal: controller.signal,
      });
      if (!response.ok) {
        let detail = '';
        try {
          const body = await response.json() as { detail?: unknown };
          if (typeof body.detail === 'string') detail = body.detail.slice(0, 120);
        } catch { /* non-JSON server */ }
        throw new Error(`VOXCPM2 SERVER HTTP ${response.status}${detail ? ` · ${detail}` : ''}`);
      }
      const array = await response.arrayBuffer();
      if (!isVoxCpmWav(array)) throw new Error('VOXCPM2 SERVER DID NOT RETURN A VALID WAV');
      if (array.byteLength > 80 * 1024 * 1024) throw new Error('VOXCPM2 WAV TOO LARGE');
      const wav = new Blob([array], { type: 'audio/wav' });
      if (!controller.signal.aborted) {
        this.lastKey = key;
        this.lastWav = wav;
      }
      return wav;
    } finally {
      clearTimeout(timeout);
      if (this.controller === controller) this.controller = null;
    }
  }

  async play(
    options: VoxCpmRemoteOptions,
    onStatus: (message: string) => void,
    onEnd: () => void,
  ): Promise<void> {
    this.stop();
    const epoch = this.generation;
    this.unlock();
    const wav = await this.generate(options, onStatus);
    if (this.generation !== epoch) return;
    const context = this.context;
    if (!context) throw new Error('VOXCPM2 AUDIO DEVICE UNAVAILABLE');
    const decoded = await context.decodeAudioData(await wav.arrayBuffer());
    if (this.generation !== epoch) return;
    await context.resume();
    if (this.generation !== epoch) return;
    const source = context.createBufferSource();
    source.buffer = decoded;
    source.connect(context.destination);
    source.onended = () => {
      if (this.generation !== epoch) return;
      this.source = null;
      source.disconnect();
      onEnd();
    };
    this.source = source;
    onStatus(`VOXCPM2 · PLAYING ${decoded.duration.toFixed(1)}s · ${decoded.sampleRate}Hz`);
    source.start();
  }
}
