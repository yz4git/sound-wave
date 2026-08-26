import type { EightBitComposition, EightBitDuty, EightBitEvent, EightBitNoiseKind } from './EightBitComposer';

const SAMPLE_RATE = 44100;
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

function midiToHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

function makePulseWave(context: BaseAudioContext, duty: EightBitDuty): PeriodicWave {
  const harmonics = 32;
  const real = new Float32Array(harmonics + 1);
  const imag = new Float32Array(harmonics + 1);
  for (let n = 1; n <= harmonics; n += 1) {
    const phase = Math.PI * 2 * n * duty;
    real[n] = (2 / (Math.PI * n)) * Math.sin(phase);
    imag[n] = (2 / (Math.PI * n)) * (1 - Math.cos(phase));
  }
  return context.createPeriodicWave(real, imag, { disableNormalization: false });
}

function makeNoiseBuffer(context: BaseAudioContext, metallic: boolean): AudioBuffer {
  const length = 4096;
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);
  let lfsr = metallic ? 0x5d : 0x5a5d;
  for (let i = 0; i < length; i += 1) {
    const bit = metallic
      ? ((lfsr >> 0) ^ (lfsr >> 1)) & 1
      : ((lfsr >> 0) ^ (lfsr >> 1)) & 1;
    lfsr = metallic
      ? ((lfsr >> 1) | (bit << 6)) & 0x7f
      : ((lfsr >> 1) | (bit << 14)) & 0x7fff;
    data[i] = (lfsr & 1) === 0 ? -1 : 1;
  }
  return buffer;
}

interface GraphCache {
  pulse125: PeriodicWave;
  pulse25: PeriodicWave;
  pulse50: PeriodicWave;
  noise: AudioBuffer;
  metalNoise: AudioBuffer;
}

const graphCache = new WeakMap<BaseAudioContext, GraphCache>();

function cacheFor(context: BaseAudioContext): GraphCache {
  const cached = graphCache.get(context);
  if (cached) return cached;
  const created: GraphCache = {
    pulse125: makePulseWave(context, 0.125),
    pulse25: makePulseWave(context, 0.25),
    pulse50: makePulseWave(context, 0.5),
    noise: makeNoiseBuffer(context, false),
    metalNoise: makeNoiseBuffer(context, true),
  };
  graphCache.set(context, created);
  return created;
}

function pulseWave(cache: GraphCache, duty: EightBitDuty | undefined): PeriodicWave {
  if (duty === 0.125) return cache.pulse125;
  if (duty === 0.5) return cache.pulse50;
  return cache.pulse25;
}

function noiseFilter(context: BaseAudioContext, kind: EightBitNoiseKind | undefined): BiquadFilterNode {
  const filter = context.createBiquadFilter();
  if (kind === 'kick') {
    filter.type = 'lowpass';
    filter.frequency.value = 980;
    filter.Q.value = 0.6;
  } else if (kind === 'snare') {
    filter.type = 'bandpass';
    filter.frequency.value = 2100;
    filter.Q.value = 0.55;
  } else if (kind === 'hat') {
    filter.type = 'highpass';
    filter.frequency.value = 5200;
    filter.Q.value = 0.45;
  } else if (kind === 'metal') {
    filter.type = 'bandpass';
    filter.frequency.value = 3200;
    filter.Q.value = 2.2;
  } else {
    filter.type = 'bandpass';
    filter.frequency.value = 1250;
    filter.Q.value = 0.42;
  }
  return filter;
}

function scheduleTone(
  context: BaseAudioContext,
  destination: AudioNode,
  event: EightBitEvent,
  offset: number,
  nodes?: Set<AudioScheduledSourceNode>,
): void {
  if (event.midi === undefined) return;
  const start = offset + event.start;
  const end = start + Math.max(0.015, event.duration);
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const cache = cacheFor(context);
  if (event.channel === 'triangle') oscillator.type = 'triangle';
  else oscillator.setPeriodicWave(pulseWave(cache, event.duty));

  const startHz = midiToHz(event.midi);
  oscillator.frequency.setValueAtTime(startHz, start);
  if (event.endMidi !== undefined) {
    const endHz = midiToHz(event.endMidi);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, endHz), Math.max(start + 0.01, end - 0.006));
  }

  const attack = Math.min(0.006, event.duration * 0.16);
  const release = Math.min(0.025, event.duration * 0.28);
  const volume = clamp(event.volume, 0, 0.45);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), start + Math.max(0.002, attack));
  gain.gain.setValueAtTime(Math.max(0.0002, volume * 0.9), Math.max(start + attack, end - release));
  gain.gain.exponentialRampToValueAtTime(0.0001, end);

  oscillator.connect(gain);
  gain.connect(destination);
  oscillator.start(start);
  oscillator.stop(end + 0.004);
  nodes?.add(oscillator);
}

function scheduleNoise(
  context: BaseAudioContext,
  destination: AudioNode,
  event: EightBitEvent,
  offset: number,
  nodes?: Set<AudioScheduledSourceNode>,
): void {
  const start = offset + event.start;
  const end = start + Math.max(0.012, event.duration);
  const cache = cacheFor(context);
  const source = context.createBufferSource();
  source.buffer = event.noiseKind === 'metal' ? cache.metalNoise : cache.noise;
  source.loop = true;
  source.playbackRate.value = clamp(event.noiseRate ?? 1, 0.2, 4);
  const filter = noiseFilter(context, event.noiseKind);
  const gain = context.createGain();
  const volume = clamp(event.volume, 0, 0.5);
  const attack = Math.min(0.004, event.duration * 0.12);

  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), start + Math.max(0.001, attack));
  gain.gain.exponentialRampToValueAtTime(0.0001, end);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(destination);
  source.start(start);
  source.stop(end + 0.004);
  nodes?.add(source);
}

function scheduleComposition(
  context: BaseAudioContext,
  destination: AudioNode,
  composition: EightBitComposition,
  offset: number,
  nodes?: Set<AudioScheduledSourceNode>,
): void {
  for (const event of composition.events) {
    if (event.channel === 'noise') scheduleNoise(context, destination, event, offset, nodes);
    else scheduleTone(context, destination, event, offset, nodes);
  }
}

function createMaster(context: BaseAudioContext): { input: GainNode; output: AudioNode } {
  const input = context.createGain();
  const compressor = context.createDynamicsCompressor();
  input.gain.value = 0.82;
  compressor.threshold.value = -8;
  compressor.knee.value = 4;
  compressor.ratio.value = 4;
  compressor.attack.value = 0.002;
  compressor.release.value = 0.08;
  input.connect(compressor);
  return { input, output: compressor };
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
}

function audioBufferToWav(buffer: AudioBuffer): Blob {
  const frames = buffer.length;
  const channels = 2;
  const bytesPerSample = 2;
  const blockAlign = channels * bytesPerSample;
  const output = new ArrayBuffer(44 + frames * blockAlign);
  const view = new DataView(output);
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + frames * blockAlign, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, frames * blockAlign, true);

  const left = buffer.getChannelData(0);
  const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left;
  let offset = 44;
  for (let i = 0; i < frames; i += 1) {
    const l = clamp(left[i] ?? 0, -1, 1);
    const r = clamp(right[i] ?? 0, -1, 1);
    view.setInt16(offset, l < 0 ? l * 0x8000 : l * 0x7fff, true); offset += 2;
    view.setInt16(offset, r < 0 ? r * 0x8000 : r * 0x7fff, true); offset += 2;
  }
  return new Blob([output], { type: 'audio/wav' });
}

export class EightBitAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private output: AudioNode | null = null;
  private readonly activeNodes = new Set<AudioScheduledSourceNode>();
  private stopTimer = 0;
  private playing = false;

  get isPlaying(): boolean { return this.playing; }

  async unlock(): Promise<void> {
    if (!this.context) {
      this.context = new AudioContext({ latencyHint: 'interactive' });
      const master = createMaster(this.context);
      this.master = master.input;
      this.output = master.output;
      this.output.connect(this.context.destination);
    }
    if (this.context.state !== 'running') await this.context.resume();
  }

  suspend(): void { void this.context?.suspend(); }
  resume(): void { void this.context?.resume(); }

  async play(composition: EightBitComposition): Promise<void> {
    await this.unlock();
    if (!this.context || !this.master) return;
    this.stop();
    const start = this.context.currentTime + 0.035;
    scheduleComposition(this.context, this.master, composition, start, this.activeNodes);
    this.playing = true;
    this.stopTimer = window.setTimeout(() => {
      this.playing = false;
      this.activeNodes.clear();
    }, Math.ceil((composition.duration + 0.08) * 1000));
  }

  stop(): void {
    if (this.stopTimer) window.clearTimeout(this.stopTimer);
    this.stopTimer = 0;
    for (const node of this.activeNodes) {
      try { node.stop(); } catch { /* already stopped */ }
      try { node.disconnect(); } catch { /* already disconnected */ }
    }
    this.activeNodes.clear();
    this.playing = false;
  }

  async renderWav(composition: EightBitComposition): Promise<Blob> {
    const tail = composition.kind === 'sfx' ? 0.05 : 0.015;
    const frames = Math.max(1, Math.ceil((composition.duration + tail) * SAMPLE_RATE));
    const context = new OfflineAudioContext(2, frames, SAMPLE_RATE);
    const master = createMaster(context);
    master.output.connect(context.destination);
    scheduleComposition(context, master.input, composition, 0.002);
    const rendered = await context.startRendering();
    return audioBufferToWav(rendered);
  }
}
