import type { VoiceCharacterPreset } from '../compose/VoiceCharacter';
import { voiceExpressionControl, type VoiceExpressionSettings } from './VoiceExpression';

export type NeuralVoiceId =
  | 'jf_alpha'
  | 'jf_gongitsune'
  | 'jf_nezumi'
  | 'jf_tebukuro'
  | 'jm_kumo';

export interface NeuralVoicePlaybackOptions {
  character: VoiceCharacterPreset;
  rate: number;
  energy: number;
  expression: VoiceExpressionSettings;
  onStatus?: (message: string) => void;
  onStart?: (voiceId: NeuralVoiceId) => void;
  onEnd?: () => void;
}

interface KokoroRawAudio {
  audio: Float32Array;
  sampling_rate: number;
  toBlob(): Blob;
}

interface KokoroJPInstance {
  speak(text: string, voiceId?: string, speed?: number): Promise<KokoroRawAudio>;
}

interface KokoroJPModule {
  KokoroJP: {
    load(options?: {
      dtype?: 'fp32' | 'fp16' | 'q8' | 'q4' | 'q4f16';
      device?: 'wasm' | 'webgpu' | 'cpu';
    }): Promise<KokoroJPInstance>;
  };
}

export const KOKORO_JP_CDN =
  'https://cdn.jsdelivr.net/npm/kokoro-js-jp@0.2.0/dist/kokoro-jp.web.js';

export function neuralVoiceIdForCharacter(
  character: VoiceCharacterPreset,
): NeuralVoiceId {
  switch (character) {
    case 'soft':
      return 'jf_tebukuro';
    case 'clear':
      return 'jf_nezumi';
    case 'airy':
      return 'jf_gongitsune';
    case 'power':
      return 'jm_kumo';
    case 'natural':
    default:
      return 'jf_alpha';
  }
}

export function neuralSpeedForSettings(
  rate: number,
  expression: VoiceExpressionSettings,
): number {
  const control = voiceExpressionControl(expression);
  return Math.max(0.62, Math.min(1.55, rate / control.durationScale));
}

/**
 * Optional high-quality local neural renderer.
 *
 * The implementation is intentionally lazy:
 * - no model/network/memory cost until NEURAL HQ is actually spoken;
 * - q8 Kokoro-82M runs with the stable WASM backend;
 * - Japanese Open JTalk assets remain lazy inside kokoro-js-jp;
 * - Web Audio playback is unlocked before the first asynchronous model fetch,
 *   which keeps generated speech playable on iOS Safari.
 */
export class BrowserNeuralVoice {
  private modelPromise: Promise<KokoroJPInstance> | null = null;
  private context: AudioContext | null = null;
  private source: AudioBufferSourceNode | null = null;
  private gain: GainNode | null = null;
  private generation = 0;
  private finishPlayback: (() => void) | null = null;

  get loaded(): boolean {
    return this.modelPromise !== null;
  }

  private ensureContext(): AudioContext {
    if (!this.context) {
      this.context = new AudioContext({ latencyHint: 'interactive' });
    }
    return this.context;
  }

  private async loadModel(): Promise<KokoroJPInstance> {
    if (!this.modelPromise) {
      this.modelPromise = (async () => {
        const moduleUrl = KOKORO_JP_CDN;
        const module = await import(/* @vite-ignore */ moduleUrl) as unknown as KokoroJPModule;
        return module.KokoroJP.load({
          dtype: 'q8',
          device: 'wasm',
        });
      })().catch((error) => {
        this.modelPromise = null;
        throw error;
      });
    }
    return this.modelPromise;
  }

  private releaseSource(resolvePending: boolean): void {
    if (this.source) {
      this.source.onended = null;
      try { this.source.stop(); } catch { /* already ended */ }
      try { this.source.disconnect(); } catch { /* disconnected */ }
      this.source = null;
    }
    if (this.gain) {
      try { this.gain.disconnect(); } catch { /* disconnected */ }
      this.gain = null;
    }
    if (resolvePending && this.finishPlayback) {
      const finish = this.finishPlayback;
      this.finishPlayback = null;
      finish();
    }
  }

  stop(): void {
    this.generation += 1;
    this.releaseSource(true);
  }

  suspend(): void {
    this.stop();
    if (this.context?.state === 'running') void this.context.suspend();
  }

  async play(text: string, options: NeuralVoicePlaybackOptions): Promise<void> {
    this.stop();
    const generation = this.generation;
    const context = this.ensureContext();

    if (context.state !== 'running') await context.resume();
    if (generation !== this.generation) return;

    const wasLoaded = this.loaded;
    options.onStatus?.(
      wasLoaded
        ? 'NEURAL HQ · PREPARING JAPANESE'
        : 'NEURAL HQ · LOADING KOKORO 82M Q8 · FIRST USE',
    );

    const tts = await this.loadModel();
    if (generation !== this.generation) return;

    const voiceId = neuralVoiceIdForCharacter(options.character);
    const speed = neuralSpeedForSettings(options.rate, options.expression);
    options.onStatus?.(
      wasLoaded
        ? 'NEURAL HQ · GENERATING'
        : 'NEURAL HQ · OPEN JTALK + MODEL READY · GENERATING',
    );

    const rendered = await tts.speak(text, voiceId, speed);
    if (generation !== this.generation) return;
    if (!(rendered.audio instanceof Float32Array) || rendered.audio.length === 0) {
      throw new Error('Kokoro returned no PCM audio.');
    }

    const sampleRate = Number.isFinite(rendered.sampling_rate)
      ? Math.max(8_000, Math.min(96_000, rendered.sampling_rate))
      : 24_000;
    const buffer = context.createBuffer(1, rendered.audio.length, sampleRate);
    buffer.copyToChannel(rendered.audio, 0);

    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = buffer;
    gain.gain.value = Math.max(0.2, Math.min(1, options.energy));
    source.connect(gain);
    gain.connect(context.destination);
    this.source = source;
    this.gain = gain;

    await new Promise<void>((resolve) => {
      this.finishPlayback = resolve;
      source.onended = () => {
        if (generation !== this.generation) {
          this.releaseSource(false);
          this.finishPlayback = null;
          resolve();
          return;
        }
        this.releaseSource(false);
        this.finishPlayback = null;
        options.onEnd?.();
        resolve();
      };
      options.onStart?.(voiceId);
      source.start();
    });
  }
}
