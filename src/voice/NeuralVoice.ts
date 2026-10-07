import type { VoiceCharacterPreset } from '../compose/VoiceCharacter';
import { voiceExpressionControl, type VoiceExpressionSettings } from './VoiceExpression';
import type { VoicePhraseBoundaryOverride } from './VoicePhraseEditor';
import type { VoiceProsodyEdits, VoiceTimedUnit } from './VoiceSynth';
import type { VoicePunctuationKind, VoiceScript } from './VoiceScript';

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
  pitch: number;
  tone: number;
  expression: VoiceExpressionSettings;
  onStatus?: (message: string) => void;
  onStart?: (voiceId: NeuralVoiceId) => void;
  onEnd?: () => void;
}

export interface NeuralProsodySegment {
  text: string;
  startUnit: number;
  endUnit: number;
  rateScale: number;
  energyScale: number;
  /** Quality-safe post-render shift; intentionally much smaller than DSP F0 edits. */
  pitchSemitones: number;
  pauseAfter: number;
  expression: VoiceExpressionSettings;
}

export interface NeuralProsodyPlan {
  segments: NeuralProsodySegment[];
  edited: boolean;
}

export interface NeuralProsodyPlanInput {
  originalText: string;
  script: VoiceScript;
  timedUnits: readonly VoiceTimedUnit[];
  edits: VoiceProsodyEdits;
  phraseBoundaries?: readonly VoicePhraseBoundaryOverride[];
  hasPhraseEdits?: boolean;
  hasAccentEdits?: boolean;
  markupUsed?: boolean;
  globalExpression: VoiceExpressionSettings;
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

interface RenderedNeuralSegment {
  audio: Float32Array;
  sampleRate: number;
  gain: number;
  pauseAfter: number;
}

export const KOKORO_JP_CDN =
  'https://cdn.jsdelivr.net/npm/kokoro-js-jp@0.2.0/dist/kokoro-jp.web.js';

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

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
  return clamp(rate / control.durationScale, 0.62, 1.55);
}

/** Exact output identity: no stale PCM when the speaker or VOICE LAB edits change. */
export function neuralPlaybackCacheKey(
  plan: NeuralProsodyPlan,
  options: NeuralVoicePlaybackOptions,
): string {
  return JSON.stringify([
    'kokoro-neural-pcm-v1',
    KOKORO_JP_CDN,
    'q8',
    neuralVoiceIdForCharacter(options.character),
    options.rate,
    options.energy,
    options.pitch,
    options.tone,
    options.expression.preset,
    options.expression.intensity,
    plan.edited,
    plan.segments.map((segment) => [
      segment.text,
      segment.startUnit,
      segment.endUnit,
      segment.rateScale,
      segment.energyScale,
      segment.pitchSemitones,
      segment.pauseAfter,
      segment.expression.preset,
      segment.expression.intensity,
    ]),
  ]);
}

export interface CachedNeuralAudio {
  audio: Float32Array;
  sampleRate: number;
}

/** Session-only LRU cache. PCM is kept in RAM, never in localStorage. */
export class NeuralAudioCache {
  private readonly entries = new Map<string, CachedNeuralAudio>();
  private usedBytes = 0;

  constructor(
    private readonly maxBytes = 24 * 1024 * 1024,
    private readonly maxEntries = 8,
  ) {}

  get size(): number {
    return this.entries.size;
  }

  get bytes(): number {
    return this.usedBytes;
  }

  get(key: string): CachedNeuralAudio | null {
    const found = this.entries.get(key);
    if (!found) return null;
    // Refresh recency without allocating another PCM copy.
    this.entries.delete(key);
    this.entries.set(key, found);
    return found;
  }

  set(key: string, value: CachedNeuralAudio): void {
    if (
      value.audio.length === 0
      || !Number.isFinite(value.sampleRate)
      || value.sampleRate <= 0
      || value.audio.byteLength > this.maxBytes
      || this.maxEntries < 1
    ) return;

    const previous = this.entries.get(key);
    if (previous) {
      this.usedBytes -= previous.audio.byteLength;
      this.entries.delete(key);
    }
    this.entries.set(key, value);
    this.usedBytes += value.audio.byteLength;

    while (this.usedBytes > this.maxBytes || this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      const removed = this.entries.get(oldest)!;
      this.usedBytes -= removed.audio.byteLength;
      this.entries.delete(oldest);
    }
  }
}

function punctuationText(kind: VoicePunctuationKind): string {
  switch (kind) {
    case 'comma': return '、';
    case 'period': return '。';
    case 'question': return '？';
    case 'exclamation': return '！';
    case 'ellipsis': return '……';
    case 'dash': return '――';
    case 'semicolon': return '、';
    case 'middle': return '・';
    case 'linebreak': return '。';
    default: return '';
  }
}

function expressionEqual(
  a: VoiceExpressionSettings,
  b: VoiceExpressionSettings,
): boolean {
  return a.preset === b.preset && Math.abs(a.intensity - b.intensity) < 0.02;
}

function safeNeuralPitch(rawSemitones: number): number {
  // Kokoro has no direct F0-conditioning API. A tiny pitch-preserving-duration
  // adaptation is useful, but large post shifts move formants and immediately
  // cost more quality than they add control. Saturate smoothly at +/-0.65 st.
  return Math.tanh(rawSemitones / 1.45) * 0.65;
}

function meaningfulArray(
  values: readonly number[] | undefined,
  neutral: number,
  epsilon: number,
): boolean {
  return Boolean(values?.some((value) => Math.abs((value ?? neutral) - neutral) > epsilon));
}

function hasNeuralEdits(input: NeuralProsodyPlanInput): boolean {
  return Boolean(
    input.markupUsed
    || input.hasPhraseEdits
    || input.hasAccentEdits
    || meaningfulArray(input.edits.pitchOffsets, 0, 0.03)
    || meaningfulArray(input.edits.energyScales, 1, 0.015)
    || meaningfulArray(input.edits.durationScales, 1, 0.015)
    || meaningfulArray(input.edits.phrasePitchOffsets, 0, 0.03)
    || meaningfulArray(input.edits.phraseRateScales, 1, 0.015)
    || meaningfulArray(input.edits.phraseEnergyScales, 1, 0.015)
    || meaningfulArray(input.edits.phraseEmphasisScales, 0, 0.03)
    || input.edits.localExpressions?.some(Boolean)
  );
}

function lexicalAccentBias(timed: VoiceTimedUnit, enabled: boolean): number {
  if (!enabled) return 0;
  if (timed.unit.pitchAccent === 'high') return 0.3;
  if (timed.unit.pitchAccent === 'low') return -0.24;
  return 0;
}

function unitControl(
  timed: VoiceTimedUnit,
  accentEditing: boolean,
): {
  pitch: number;
  rate: number;
  energy: number;
  expression: VoiceExpressionSettings;
} {
  return {
    pitch: timed.manualPitchOffset
      + timed.phrasePitchOffset
      + lexicalAccentBias(timed, accentEditing),
    rate: clamp(
      timed.phraseRateScale / Math.max(0.55, timed.manualDurationScale),
      0.68,
      1.42,
    ),
    energy: clamp(
      timed.manualEnergyScale
        * timed.phraseEnergyScale
        * (1 + timed.phraseEmphasis * 0.075),
      0.58,
      1.5,
    ),
    expression: timed.expression,
  };
}

function boundaryOverrideAt(
  overrides: readonly VoicePhraseBoundaryOverride[] | undefined,
  after: number,
): VoicePhraseBoundaryOverride | undefined {
  return overrides?.find((item) => item.after === after);
}

function appendUnitText(current: string, timed: VoiceTimedUnit): string {
  return current + timed.unit.display + punctuationText(timed.unit.punctuationAfter);
}

export function buildNeuralProsodyPlan(
  input: NeuralProsodyPlanInput,
): NeuralProsodyPlan {
  const edited = hasNeuralEdits(input);
  const units = input.timedUnits;

  // Preserve the exact model-native whole-utterance path whenever the editor
  // has not changed anything. This is the highest-quality baseline and avoids
  // needless phrase resets.
  if (!edited || units.length === 0) {
    return {
      edited: false,
      segments: [{
        text: input.originalText.trim(),
        startUnit: 0,
        endUnit: Math.max(0, units.length - 1),
        rateScale: 1,
        energyScale: 1,
        pitchSemitones: 0,
        pauseAfter: 0,
        expression: input.globalExpression,
      }],
    };
  }

  const segments: NeuralProsodySegment[] = [];
  let start = 0;
  let text = '';
  let pitchSum = 0;
  let rateLogSum = 0;
  let energyLogSum = 0;
  let count = 0;
  let expression = units[0]?.expression ?? input.globalExpression;

  const flush = (end: number, forcedBoundary: boolean): void => {
    if (count <= 0) return;
    const last = units[end]!;
    const override = boundaryOverrideAt(input.phraseBoundaries, end);
    let spokenText = text;
    if (
      forcedBoundary
      && !punctuationText(last.unit.punctuationAfter)
      && last.unit.boundaryAfter === 'accent'
    ) {
      // Only real/user-visible phrase boundaries receive a punctuation cue.
      // Internal safety cuts intentionally stay punctuation-free.
      spokenText += '、';
    } else if (
      last.unit.boundaryAfter === 'sentence'
      && !punctuationText(last.unit.punctuationAfter)
    ) {
      spokenText += '。';
    }

    const explicitPause = override?.pauseSeconds;
    const pauseAfter = explicitPause !== null && explicitPause !== undefined
      ? Math.max(0, explicitPause - 0.055)
      : override?.boundary === 'accent'
        ? Math.max(0, last.unit.pauseAfter - 0.07)
        : 0;

    segments.push({
      text: spokenText,
      startUnit: start,
      endUnit: end,
      rateScale: clamp(Math.exp(rateLogSum / count), 0.7, 1.4),
      energyScale: clamp(Math.exp(energyLogSum / count), 0.62, 1.45),
      pitchSemitones: safeNeuralPitch(pitchSum / count),
      pauseAfter: clamp(pauseAfter, 0, 0.5),
      expression,
    });
    start = end + 1;
    text = '';
    pitchSum = 0;
    rateLogSum = 0;
    energyLogSum = 0;
    count = 0;
    expression = units[start]?.expression ?? input.globalExpression;
  };

  for (let index = 0; index < units.length; index += 1) {
    const timed = units[index]!;
    const control = unitControl(timed, Boolean(input.hasAccentEdits));
    if (count === 0) expression = control.expression;

    text = appendUnitText(text, timed);
    pitchSum += control.pitch;
    rateLogSum += Math.log(Math.max(0.01, control.rate));
    energyLogSum += Math.log(Math.max(0.01, control.energy));
    count += 1;

    const next = units[index + 1];
    const nextControl = next
      ? unitControl(next, Boolean(input.hasAccentEdits))
      : null;
    const override = boundaryOverrideAt(input.phraseBoundaries, index);
    const userSplit = override?.boundary === 'accent';
    const sentenceEnd = timed.unit.boundaryAfter === 'sentence';
    const expressionChange = Boolean(
      nextControl && !expressionEqual(control.expression, nextControl.expression),
    );

    // Neural segmentation must follow language structure, not every control
    // discontinuity. Small PITCH/ENERGY/TIMING changes are averaged inside the
    // current neural phrase; otherwise Kokoro repeatedly restarts prosody in
    // the middle of Japanese bunsetsu and sounds "chopped".
    const punctuationBoundary = timed.unit.punctuationAfter !== 'none'
      && timed.unit.punctuationAfter !== 'middle';
    const discourseBoundary = timed.unit.continuationAfter !== 'none'
      || timed.unit.discourseAfter !== 'none'
      || timed.unit.expressivePauseAfter >= 0.07
      || timed.unit.pauseAfter >= 0.1;
    const naturalBoundary = timed.unit.boundaryAfter === 'accent'
      && (punctuationBoundary || discourseBoundary);

    // LOCAL DELIVERY is an explicit user request and needs a new model pass,
    // but defer it until at least a short phrase has formed when possible.
    const deliveryBoundary = expressionChange && count >= 5;

    // Long utterances are allowed to stay intact much longer than before.
    // Prefer a linguistic boundary after ~18 mora; only use a hard safety cut
    // at 34 mora, and never insert an artificial comma for that safety cut.
    const longNaturalBreak = count >= 18 && naturalBoundary;
    const hardSafetyBreak = count >= 34;

    if (
      !next
      || sentenceEnd
      || userSplit
      || naturalBoundary
      || deliveryBoundary
      || longNaturalBreak
      || hardSafetyBreak
    ) {
      const commaCue = Boolean(
        userSplit
        || naturalBoundary
        || deliveryBoundary && timed.unit.boundaryAfter === 'accent',
      );
      flush(index, commaCue);
    }
  }

  return { edited: true, segments };
}

function cubicSample(input: Float32Array, position: number): number {
  const index = Math.floor(position);
  const t = position - index;
  const y0 = input[Math.max(0, index - 1)] ?? 0;
  const y1 = input[Math.max(0, Math.min(input.length - 1, index))] ?? 0;
  const y2 = input[Math.max(0, Math.min(input.length - 1, index + 1))] ?? 0;
  const y3 = input[Math.max(0, Math.min(input.length - 1, index + 2))] ?? 0;
  const a0 = y3 - y2 - y0 + y1;
  const a1 = y0 - y1 - a0;
  const a2 = y2 - y0;
  return a0 * t * t * t + a1 * t * t + a2 * t + y1;
}

function resampleForPitch(
  input: Float32Array,
  pitchFactor: number,
): Float32Array {
  if (Math.abs(pitchFactor - 1) < 0.001) return input;
  const outputLength = Math.max(1, Math.round(input.length / pitchFactor));
  const output = new Float32Array(outputLength);
  for (let index = 0; index < outputLength; index += 1) {
    output[index] = cubicSample(input, index * pitchFactor);
  }
  return output;
}

function mergeRenderedSegments(
  segments: readonly RenderedNeuralSegment[],
): { audio: Float32Array; sampleRate: number } {
  if (segments.length === 0) {
    return { audio: new Float32Array(0), sampleRate: 24_000 };
  }
  const sampleRate = segments[0]!.sampleRate;
  const prepared = segments.map((segment) => {
    if (segment.sampleRate === sampleRate) return segment;
    const ratio = segment.sampleRate / sampleRate;
    return {
      ...segment,
      audio: resampleForPitch(segment.audio, ratio),
      sampleRate,
    };
  });

  const crossfade = Math.max(1, Math.round(sampleRate * 0.008));
  let total = 0;
  for (let index = 0; index < prepared.length; index += 1) {
    const segment = prepared[index]!;
    total += segment.audio.length;
    total += Math.round(segment.pauseAfter * sampleRate);
    if (index > 0 && prepared[index - 1]!.pauseAfter <= 0) total -= crossfade;
  }

  const output = new Float32Array(Math.max(1, total));
  let cursor = 0;
  for (let segmentIndex = 0; segmentIndex < prepared.length; segmentIndex += 1) {
    const segment = prepared[segmentIndex]!;
    const canCrossfade = segmentIndex > 0
      && prepared[segmentIndex - 1]!.pauseAfter <= 0
      && cursor >= crossfade;
    const overlap = canCrossfade
      ? Math.min(crossfade, segment.audio.length, cursor)
      : 0;
    const start = cursor - overlap;

    for (let index = 0; index < segment.audio.length; index += 1) {
      const sample = segment.audio[index]! * segment.gain;
      const target = start + index;
      if (index < overlap) {
        const t = (index + 1) / (overlap + 1);
        const fadeIn = Math.sin(t * Math.PI * 0.5);
        const fadeOut = Math.cos(t * Math.PI * 0.5);
        output[target] = output[target]! * fadeOut + sample * fadeIn;
      } else {
        output[target] = sample;
      }
    }

    cursor = start + segment.audio.length;
    cursor += Math.round(segment.pauseAfter * sampleRate);
  }

  let peak = 0;
  for (let index = 0; index < output.length; index += 1) {
    peak = Math.max(peak, Math.abs(output[index]!));
  }
  if (peak > 0.985) {
    const scale = 0.985 / peak;
    for (let index = 0; index < output.length; index += 1) {
      output[index] = (output[index] ?? 0) * scale;
    }
  }

  return { audio: output, sampleRate };
}

/**
 * Optional high-quality local neural renderer.
 *
 * The model output remains the primary signal. Editor control is applied by
 * model-native segment speed/expression/energy wherever possible. Only pitch
 * uses a deliberately tiny, duration-compensated cubic resample so formants
 * stay effectively unchanged and Kokoro's timbre remains intact.
 */
export class BrowserNeuralVoice {
  private modelPromise: Promise<KokoroJPInstance> | null = null;
  private readonly audioCache = new NeuralAudioCache();
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

  private async renderPlan(
    tts: KokoroJPInstance,
    plan: NeuralProsodyPlan,
    options: NeuralVoicePlaybackOptions,
    generation: number,
  ): Promise<{ audio: Float32Array; sampleRate: number }> {
    const voiceId = neuralVoiceIdForCharacter(options.character);
    const renderedSegments: RenderedNeuralSegment[] = [];
    const globalPitch = clamp(
      (options.pitch - 60) * 0.03 + options.tone * 0.32,
      -0.55,
      0.55,
    );

    for (let index = 0; index < plan.segments.length; index += 1) {
      if (generation !== this.generation) {
        return { audio: new Float32Array(0), sampleRate: 24_000 };
      }
      const segment = plan.segments[index]!;
      const pitchSemitones = clamp(
        segment.pitchSemitones + globalPitch,
        -0.75,
        0.75,
      );
      const pitchFactor = 2 ** (pitchSemitones / 12);
      const desiredSpeed = neuralSpeedForSettings(
        options.rate * segment.rateScale,
        segment.expression,
      );
      const modelSpeed = clamp(desiredSpeed / pitchFactor, 0.62, 1.55);
      options.onStatus?.(
        plan.segments.length > 1
          ? `NEURAL HQ · GENERATING ${index + 1}/${plan.segments.length}`
          : 'NEURAL HQ · GENERATING',
      );

      const rendered = await tts.speak(segment.text, voiceId, modelSpeed);
      if (generation !== this.generation) {
        return { audio: new Float32Array(0), sampleRate: 24_000 };
      }
      if (!(rendered.audio instanceof Float32Array) || rendered.audio.length === 0) {
        throw new Error('Kokoro returned no PCM audio.');
      }
      const expressionControl = voiceExpressionControl(segment.expression);
      renderedSegments.push({
        audio: resampleForPitch(rendered.audio, pitchFactor),
        sampleRate: Number.isFinite(rendered.sampling_rate)
          ? clamp(rendered.sampling_rate, 8_000, 96_000)
          : 24_000,
        gain: clamp(
          options.energy
            * segment.energyScale
            * expressionControl.energyScale,
          0.18,
          1.18,
        ),
        pauseAfter: segment.pauseAfter,
      });
    }

    return mergeRenderedSegments(renderedSegments);
  }

  async play(
    text: string,
    options: NeuralVoicePlaybackOptions,
  ): Promise<void> {
    return this.playPlan({
      edited: false,
      segments: [{
        text,
        startUnit: 0,
        endUnit: 0,
        rateScale: 1,
        energyScale: 1,
        pitchSemitones: 0,
        pauseAfter: 0,
        expression: options.expression,
      }],
    }, options);
  }

  async playPlan(
    plan: NeuralProsodyPlan,
    options: NeuralVoicePlaybackOptions,
  ): Promise<void> {
    this.stop();
    const generation = this.generation;
    const context = this.ensureContext();

    if (context.state !== 'running') await context.resume();
    if (generation !== this.generation) return;

    const cacheKey = neuralPlaybackCacheKey(plan, options);
    let rendered = this.audioCache.get(cacheKey);

    if (rendered) {
      // Do not await the model at all. The same edited phrase can play on the
      // next touch even if the model has since been suspended/released.
      options.onStatus?.('NEURAL HQ · CACHED · INSTANT REPLAY');
    } else {
      const wasLoaded = this.loaded;
      options.onStatus?.(
        wasLoaded
          ? plan.edited
            ? 'NEURAL HQ · APPLYING VOICE LAB EDITS'
            : 'NEURAL HQ · PREPARING JAPANESE'
          : 'NEURAL HQ · LOADING KOKORO 82M Q8 · FIRST USE',
      );

      const tts = await this.loadModel();
      if (generation !== this.generation) return;

      rendered = await this.renderPlan(tts, plan, options, generation);
      if (generation !== this.generation || rendered.audio.length === 0) return;

      // Store the final, already-edited PCM, preserving exactly the original
      // voice quality, crossfades and pauses on every subsequent replay.
      this.audioCache.set(cacheKey, rendered);
    }

    const voiceId = neuralVoiceIdForCharacter(options.character);
    const buffer = context.createBuffer(
      1,
      rendered.audio.length,
      rendered.sampleRate,
    );
    buffer.getChannelData(0).set(rendered.audio);

    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = buffer;
    gain.gain.value = 1;
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
