import { describe, expect, it } from 'vitest';
import {
  designVoxLocalVoice,
  reconstructVoxLocalAudio,
  upsampleVoxLocalAudio,
  encodeVoxLocalWav,
  type VoxLocalDesign,
} from '../src/voice/VoxLocalVoice';

const settings: VoxLocalDesign = {
  description: '穏やかで温かい男性の低い声で、ゆっくり話して',
  quality: 'balanced',
  fallbackCharacter: 'natural',
  rate: 1,
  pitch: 60,
  energy: 0.92,
  tone: 0,
  expression: { preset: 'neutral', intensity: 1 },
};

describe('serverless Vox Local model', () => {
  it('converts natural-language Japanese voice descriptions into real voice controls', () => {
    const result = designVoxLocalVoice(settings);
    expect(result.character).toBe('power');
    expect(result.voiceStyle).toBe('calm');
    expect(result.pitch).toBeLessThan(60);
    expect(result.speed).toBeLessThan(1);
    expect(result.warmth).toBeGreaterThan(0);
    expect(designVoxLocalVoice({
      ...settings,
      description: 'bright clear young female voice, fast and excited',
    })).toMatchObject({
      character: 'clear',
      voiceStyle: 'excited',
    });
  });

  it('reconstructs original spectral character without NaN or runaway clipping', () => {
    const input = Float32Array.from({ length: 4800 }, (_, i) =>
      Math.sin(i * 2 * Math.PI * 220 / 24_000) * 0.6);
    const profile = designVoxLocalVoice(settings);
    const a = reconstructVoxLocalAudio(input, 24_000, profile, 'studio');
    const b = reconstructVoxLocalAudio(input, 24_000, profile, 'studio');
    expect(a.length).toBe(input.length);
    expect([...a].every(Number.isFinite)).toBe(true);
    expect(Math.max(...a.map(Math.abs))).toBeLessThan(1);
    expect(a).toEqual(b);
    expect(a).not.toEqual(input);
  });

  it('resamples and writes a valid 48kHz PCM16 WAV header', async () => {
    const input = Float32Array.from({ length: 2400 }, (_, i) =>
      Math.sin(i * 2 * Math.PI * 440 / 24_000) * 0.5);
    const stereo = upsampleVoxLocalAudio(input, 24_000);
    expect(stereo.length).toBe(4800);
    expect(stereo.slice(100, 250).every(Number.isFinite)).toBe(true);
    const wav = encodeVoxLocalWav(stereo, 48_000);
    const view = new DataView(await wav.arrayBuffer());
    expect(view.getUint32(24, true)).toBe(48_000);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(stereo.length * 2);
  });

  it('rejects nonsense rates and handles silence', () => {
    expect(upsampleVoxLocalAudio(new Float32Array(0), 24_000).length).toBe(0);
    expect(() => upsampleVoxLocalAudio(new Float32Array(2), 0)).toThrow();
    expect(encodeVoxLocalWav(new Float32Array(0), 24_000).size).toBe(44);
  });
});
