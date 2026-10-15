import type { VoiceCharacterPreset } from '../compose/VoiceCharacter';
import type { VoiceExpressionPreset, VoiceExpressionSettings } from './VoiceExpression';
import type { BrowserNeuralVoice, NeuralProsodyPlan } from './NeuralVoice';
import type { NeuralVoicePlaybackOptions } from './NeuralVoice';
import { analyzeVoxLocalAB, matchVoicePcmLevel, type VoxLocalABMetrics } from './VoxLocalCompare';

/**
 * Independent, on-device voice-design + acoustic reconstruction pipeline.
 * It reuses the *existing* 82M Kokoro voice model for intelligible Japanese
 * acoustic scaffolding. VoxCPM weights / diffusion are NOT implemented.
 * The language-conditioned design mapping, timbre shaping, enhancement,
 * replay and 48 kHz WAV encoder below are Sound Wave original code.
 */
export type VoxLocalQuality = 'fast' | 'balanced' | 'studio';

export interface VoxLocalDesign {
  description: string;
  quality: VoxLocalQuality;
  fallbackCharacter: VoiceCharacterPreset;
  rate: number;
  pitch: number;
  energy: number;
  tone: number;
  expression: VoiceExpressionSettings;
}

export interface VoxLocalProfile {
  character: VoiceCharacterPreset;
  voiceStyle: VoiceExpressionPreset;
  speed: number;
  pitch: number;
  warmth: number;
  clarity: number;
  air: number;
  breath: number;
  emphasis: number;
}

const bound = (v: number, lo: number, hi: number): number =>
  Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : lo;

const has = (s: string, terms: RegExp): boolean => terms.test(s);

/** Descriptive keywords influence the acoustic model and/or DSP controls. */
export function designVoxLocalVoice(design: VoxLocalDesign): VoxLocalProfile {
  const s = design.description.toLowerCase();
  let character = design.fallbackCharacter;
  if (has(s, /男性|男声|男の声|低い男|\bmale\b|\bman\b|masculine/)) character = 'power';
  else if (has(s, /透明感|透き通|clear|crisp|明瞭|はっきり/)) character = 'clear';
  else if (has(s, /ささや|囁|whisper|breathy|息混じり|airy/)) character = 'airy';
  else if (has(s, /柔らか|やさし|優しい|甘い|gentle|tender|sweet|soft/)) character = 'soft';
  else if (has(s, /女性|女声|女の声|\bfemale\b|\bwoman\b/)) character = 'natural';

  let voiceStyle: VoiceExpressionPreset = design.expression.preset;
  if (has(s, /ささや|囁|whisper|ひそひそ/)) voiceStyle = 'whisper';
  else if (has(s, /興奮|元気|楽しい|明るい|energetic|excited|cheerful|enthusiastic/)) voiceStyle = 'excited';
  else if (has(s, /落ち着|穏やか|静か|calm|relaxed|peaceful|gentle/)) voiceStyle = 'calm';
  else if (has(s, /真面目|厳か|重厚|serious|grave|authoritative/)) voiceStyle = 'serious';
  else if (has(s, /ナレー|読み聞かせ|アナウンス|narrat|announc/)) voiceStyle = 'narration';

  const slow = has(s, /ゆっくり|ゆったり|遅い|slow|leisurely/);
  const fast = has(s, /早口|速い|テンポよく|fast|brisk|quick/);
  const low = has(s, /低音|低め|深い声|低い声|deep|low.pitched|baritone/);
  const high = has(s, /高音|高め|高い声|少女|young|high.pitched|bright voice/);
  const warm = has(s, /温か|暖か|柔らか|やさし|warm|soft|mellow|rounded/);
  const bright = has(s, /明るい声|明瞭|透き通|bright|clear|crisp|sparkling/);
  const husky = has(s, /ハスキー|掠れ|かすれ|husky|raspy|hoarse|airy|breathy/);
  const strong = has(s, /力強|大きな声|迫力|powerful|strong|bold|loud/);

  return {
    character,
    voiceStyle,
    speed: bound(design.rate * (slow ? 0.88 : fast ? 1.12 : 1), 0.64, 1.55),
    pitch: bound(design.pitch + (low ? -4 : high ? 4 : 0), 45, 76),
    warmth: bound((warm ? 0.45 : 0) + (low ? 0.2 : 0) + (husky ? 0.12 : 0) - (bright ? 0.2 : 0), -0.4, 0.85),
    clarity: bound((bright ? 0.45 : 0.08) + (strong ? 0.14 : 0) - (husky ? 0.13 : 0), -0.1, 0.8),
    air: bound((husky ? 0.35 : 0) + (bright ? 0.15 : 0.05), 0, 0.6),
    breath: bound(husky ? 0.29 : voiceStyle === 'whisper' ? 0.22 : 0.03, 0, 0.38),
    emphasis: bound(strong ? 0.38 : voiceStyle === 'excited' ? 0.3 : 0.1, 0, 0.6),
  };
}

/**
 * Lightweight continuous-domain enhancement (not an imitation of VoxCPM's
 * actual pretrained diffusion decoder). With tiny gains and envelope-aware
 * excitation it preserves neural phonemes instead of re-synthesizing them.
 */
export function reconstructVoxLocalAudio(
  input: Float32Array,
  sampleRate: number,
  profile: VoxLocalProfile,
  quality: VoxLocalQuality,
): Float32Array {
  if (!input.length) return new Float32Array();
  if (!(sampleRate >= 8_000 && sampleRate <= 96_000)) throw new Error('Invalid neural PCM sample rate');
  const out = new Float32Array(input.length);

  // Small, continuous filters preserve the pretrained model's harmonics and
  // consonants; the designer must not replace speech with synthetic noise.
  const warmthA = Math.exp(-2 * Math.PI * 330 / sampleRate);
  const presenceA = Math.exp(-2 * Math.PI * 2400 / sampleRate);
  const airA = Math.exp(-2 * Math.PI * Math.min(6500, sampleRate * 0.37) / sampleRate);
  const attackA = Math.exp(-1 / (sampleRate * 0.007));
  const releaseA = Math.exp(-1 / (sampleRate * 0.075));
  let bass = 0, mid = 0, air = 0, envelope = 0;
  let seed = 0x6af241b9;
  let noiseLow = 0, breathBand = 0;

  // New breath noise is *disabled* for normal voices: older VOX LOCAL added
  // near-white noise to virtually every voiced sample, raising the hiss floor.
  // Whisper/husky design uses a much quieter, band-shaped transitional layer.
  const breathLevel = quality === 'fast'
    ? 0 : Math.max(0, profile.breath - 0.16) * 0.004;
  const presenceBoost = bound(profile.clarity, -0.1, 0.8) * 0.070;
  const airBoost = bound(profile.air, 0, 0.6) * 0.045;
  const warmthBoost = bound(profile.warmth, -0.4, 0.85) * 0.070;

  for (let i = 0; i < input.length; i++) {
    const source = input[i] ?? 0;
    const x = Number.isFinite(source) ? source : 0;
    bass = warmthA * bass + (1 - warmthA) * x;
    mid = presenceA * mid + (1 - presenceA) * x;
    air = airA * air + (1 - airA) * x;
    const magnitude = Math.abs(x);
    const a = magnitude > envelope ? attackA : releaseA;
    envelope = a * envelope + (1 - a) * magnitude;

    // Consonants have unusually strong upper bands. Do not accentuate those
    // peaks indiscriminately: it turns Japanese /s/ into sharp hiss.
    const upper = x - air;
    const relativeUpper = Math.min(1, Math.abs(upper) / Math.max(0.006, envelope * 1.35));
    const deEss = 1 - relativeUpper * 0.50;
    let result = x
      + bass * warmthBoost
      + (x - mid) * presenceBoost * (0.8 + 0.2 * deEss)
      + upper * airBoost * deEss;

    if (quality === 'studio') {
      // Gently lift speech tails while maintaining accent and onset dynamics.
      // No attempt at fake high-resolution diffusion-style resynthesis.
      result *= 1 + 0.018 * (1 - Math.min(1, envelope / 0.12));
    }

    if (breathLevel > 0 && envelope > 0.004 && envelope < 0.21) {
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
      const white = ((seed >>> 0) / 0x100000000) * 2 - 1;
      noiseLow = noiseLow * 0.80 + white * 0.20;
      breathBand = breathBand * 0.38 + (white - noiseLow) * 0.62;
      const activity = Math.min(1, envelope / 0.035);
      const quieter = Math.max(0, 1 - envelope / 0.22);
      result += breathBand * breathLevel * activity * quieter;
    }

    result *= 0.995 + profile.emphasis * 0.035;
    // Soft safety limiter, not a loudness maximizer.
    const excess = Math.max(0, Math.abs(result) - 0.91);
    const safe = result / (1 + excess * 0.9);
    out[i] = bound(safe, -0.98, 0.98);
  }
  const fade = Math.min(Math.floor(sampleRate * 0.006), Math.floor(out.length / 2));
  for (let i = 0; i < fade; i++) {
    const gain = (i + 1) / (fade + 1);
    out[i] = out[i]! * gain;
    out[out.length - 1 - i] = out[out.length - 1 - i]! * gain;
  }
  return out;
}

/** Band-limited resampling: 24kHz neural speech -> 48kHz output, not native 48k generation. */
export function upsampleVoxLocalAudio(input: Float32Array, from: number, to = 48_000): Float32Array {
  if (input.length === 0) return new Float32Array();
  if (from === to) return new Float32Array(input);
  if (!(from > 0 && from <= 96_000 && to >= 8_000 && to <= 96_000)) throw new Error('Invalid sample rate');
  const count = Math.ceil(input.length * to / from);
  const result = new Float32Array(count);
  const taps = 8;
  const cutoff = Math.min(1, to / from);
  for (let i = 0; i < count; i++) {
    const pos = i * from / to;
    const base = Math.floor(pos);
    let sum = 0, weight = 0;
    for (let j = -taps + 1; j <= taps; j++) {
      const index = base + j;
      if (index < 0 || index >= input.length) continue;
      const d = pos - index;
      const sinc = Math.abs(d) < 1e-8 ? cutoff : Math.sin(Math.PI * cutoff * d) / (Math.PI * d);
      const window = 0.5 + 0.5 * Math.cos(Math.PI * d / taps);
      const w = sinc * Math.max(0, window);
      sum += input[index]! * w;
      weight += w;
    }
    result[i] = bound(weight ? sum / weight : 0, -1, 1);
  }
  return result;
}

export function encodeVoxLocalWav(audio: Float32Array, sampleRate: number): Blob {
  const bytes = new ArrayBuffer(44 + audio.length * 2);
  const view = new DataView(bytes);
  const ascii = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  ascii(0, 'RIFF'); view.setUint32(4, 36 + audio.length * 2, true);
  ascii(8, 'WAVE'); ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  ascii(36, 'data'); view.setUint32(40, audio.length * 2, true);
  for (let i = 0; i < audio.length; i++) {
    const sample = bound(audio[i] ?? 0, -1, 1);
    view.setInt16(44 + i * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
  }
  return new Blob([bytes], { type: 'audio/wav' });
}

export class VoxLocalVoice {
  private context: AudioContext | null = null;
  private source: AudioBufferSourceNode | null = null;
  private epoch = 0;
  private cached: {
    key: string;
    audio: Float32Array;
    rate: number;
    reference: Float32Array;
    referenceRate: number;
    metrics: VoxLocalABMetrics;
  } | null = null;

  constructor(private readonly neural: BrowserNeuralVoice) {}

  unlock(): void {
    try {
      this.context ??= new AudioContext({ latencyHint: 'interactive' });
      void this.context.resume().catch(() => {});
    } catch { /* unavailable WebAudio shows an error on play */ }
  }

  stop(): void {
    this.epoch++;
    const source = this.source;
    this.source = null;
    if (source) {
      source.onended = null;
      try { source.stop(); } catch { /* already ended */ }
      source.disconnect();
    }
  }

  async synthesize(
    plan: NeuralProsodyPlan,
    design: VoxLocalDesign,
    onStatus: (status: string) => void,
  ): Promise<{ audio: Float32Array; rate: number } | null> {
    const epoch = this.epoch;
    const profile = designVoxLocalVoice(design);
    const key = JSON.stringify({ plan, profile, quality: design.quality, energy: design.energy, tone: design.tone });
    if (this.cached?.key === key) {
      onStatus('VOX LOCAL · INSTANT REPLAY CACHE');
      return { audio: this.cached.audio, rate: this.cached.rate };
    }
    const options: NeuralVoicePlaybackOptions = {
      character: profile.character,
      rate: profile.speed,
      pitch: profile.pitch,
      energy: design.energy,
      tone: design.tone,
      expression: { preset: profile.voiceStyle, intensity: design.expression.intensity },
      backend: 'wasm',
      onStatus,
    };
    // Use the voice-design delivery in the neural acoustic stage as well
    // as the post-filter; a description should change more than EQ alone.
    // Explicit per-phrase edits retain their own intended expression.
    const designedPlan: NeuralProsodyPlan = plan.edited
      ? plan
      : {
          ...plan,
          segments: plan.segments.map((segment) => ({
            ...segment,
            expression: {
              preset: profile.voiceStyle,
              intensity: design.expression.intensity,
            },
          })),
        };
    const raw = await this.neural.renderPCM(designedPlan, options);
    if (epoch !== this.epoch || !raw) return null;
    onStatus('VOX LOCAL · RECONSTRUCTING VOICE');
    const adjusted = reconstructVoxLocalAudio(raw.audio, raw.sampleRate, profile, design.quality);
    if (epoch !== this.epoch) return null;
    // Compare the post-filter against the *same generated Kokoro utterance*.
    // Match loudness before upsampling to avoid a misleading louder-is-better result.
    const matched = matchVoicePcmLevel(raw.audio, adjusted);
    const metrics = analyzeVoxLocalAB(raw.audio, matched);
    const output = design.quality === 'studio'
      ? { audio: upsampleVoxLocalAudio(matched, raw.sampleRate), rate: 48_000 }
      : { audio: matched, rate: raw.sampleRate };
    if (epoch !== this.epoch) return null;
    this.cached = { key, ...output, reference: raw.audio, referenceRate: raw.sampleRate, metrics };
    return output;
  }

  private async playSide(
    plan: NeuralProsodyPlan,
    design: VoxLocalDesign,
    side: 'reference' | 'local',
    onStatus: (status: string) => void,
    onEnd: () => void,
  ): Promise<void> {
    this.stop();
    const epoch = this.epoch;
    this.unlock();
    const take = await this.synthesize(plan, design, onStatus);
    if (!take || epoch !== this.epoch) return;
    const cache = this.cached;
    if (!cache) return;
    const audio = side === 'reference' ? cache.reference : take.audio;
    const rate = side === 'reference' ? cache.referenceRate : take.rate;
    const context = this.context;
    if (!context) throw new Error('VOX LOCAL · WEB AUDIO UNAVAILABLE');
    if (context.state !== 'running') {
      onStatus('VOX LOCAL · WAITING FOR AUDIO OUTPUT');
      // A suspended iOS AudioContext sometimes cannot resume once the touch
      // gesture has been lost during a long model inference. Do not leave the
      // player in an endless spinner; tell the user to retry.
      let timeout = 0;
      try {
        await Promise.race([
          context.resume(),
          new Promise<never>((_, reject) => {
            timeout = window.setTimeout(() => reject(new Error(
              'AUDIO OUTPUT IS BLOCKED · TAP STOP, THEN SPEAK AGAIN'
            )), 12000);
          }),
        ]);
      } finally {
        window.clearTimeout(timeout);
      }
    }
    if (epoch !== this.epoch) return;
    if (context.state !== 'running') {
      throw new Error('AUDIO OUTPUT SUSPENDED · TAP STOP, THEN SPEAK AGAIN');
    }
    const buffer = context.createBuffer(1, audio.length, rate);
    buffer.getChannelData(0).set(audio);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    this.source = source;
    source.onended = () => {
      if (epoch !== this.epoch) return;
      this.source = null;
      source.disconnect();
      onEnd();
    };
    source.start();
    onStatus(`${side === 'reference' ? 'NEURAL HQ BASE' : 'VOX LOCAL'} · PLAYING ${buffer.duration.toFixed(1)}s · ${rate}Hz`);
  }

  async play(
    plan: NeuralProsodyPlan,
    design: VoxLocalDesign,
    onStatus: (status: string) => void,
    onEnd: () => void,
  ): Promise<void> {
    return this.playSide(plan, design, 'local', onStatus, onEnd);
  }

  /** A is the unmodified neural audio with identical voice, speed and text. */
  async playReference(
    plan: NeuralProsodyPlan,
    design: VoxLocalDesign,
    onStatus: (status: string) => void,
    onEnd: () => void,
  ): Promise<void> {
    return this.playSide(plan, design, 'reference', onStatus, onEnd);
  }

  comparisonMetrics(plan: NeuralProsodyPlan, design: VoxLocalDesign): VoxLocalABMetrics | null {
    const profile = designVoxLocalVoice(design);
    const key = JSON.stringify({ plan, profile, quality: design.quality, energy: design.energy, tone: design.tone });
    return this.cached?.key === key ? this.cached.metrics : null;
  }

  cachedWav(plan: NeuralProsodyPlan, design: VoxLocalDesign): Blob | null {
    const profile = designVoxLocalVoice(design);
    const key = JSON.stringify({ plan, profile, quality: design.quality, energy: design.energy, tone: design.tone });
    if (!this.cached || this.cached.key !== key) return null;
    return encodeVoxLocalWav(this.cached.audio, this.cached.rate);
  }
}
