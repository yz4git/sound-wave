import { describe, expect, it } from 'vitest';
import { inspectVoiceSignal } from '../src/voice/VoiceSignalCheck';

describe('VoiceStudio-inspired non-destructive audio signal checks', () => {
  const rate = 24_000;
  it('checks ordinary neural-voice-like PCM without a false clip warning', () => {
    const pcm = new Float32Array(rate);
    for (let i=0;i<pcm.length;i++) pcm[i] = Math.sin(i*.05)*.14;
    const copy = Float32Array.from(pcm);
    const result = inspectVoiceSignal(pcm,rate);
    expect(result.durationSeconds).toBe(1);
    expect(result.peakDbfs).toBeGreaterThan(-18);
    expect(result.rmsDbfs).toBeLessThan(-14);
    expect(result.clippedSamples).toBe(0);
    expect(result.warnings.some(x=>x.kind==='clipping')).toBe(false);
    expect(pcm).toEqual(copy);
  });
  it('detects extreme clipping and supports zero-length PCM', () => {
    const loud = new Float32Array(rate).fill(.999);
    const result=inspectVoiceSignal(loud,rate);
    expect(result.clippedSamples).toBe(rate);
    expect(result.warnings.some(x=>x.kind==='clipping')).toBe(true);
    const empty=inspectVoiceSignal(new Float32Array(),rate);
    expect(empty.warnings[0]?.kind).toBe('invalid');
  });
  it('measures timestamps for unusually long gaps for seekable review', () => {
    const pcm = new Float32Array(rate*3);
    for(let i=0;i<rate;i++)pcm[i]=Math.sin(i*.1)*.15;
    for(let i=rate*2;i<rate*3;i++)pcm[i]=Math.sin(i*.1)*.15;
    const result=inspectVoiceSignal(pcm,rate);
    const gaps=result.warnings.filter(x=>x.kind==='silence');
    expect(gaps.length).toBeGreaterThan(0);
    expect(gaps[0]!.timeSeconds).toBeCloseTo(1,1);
  });
  it('reports low-volume and input/sample rate failures without crashing', () => {
    const quiet=new Float32Array(rate).fill(0.000001);
    expect(inspectVoiceSignal(quiet,rate).warnings.some(x=>x.kind==='low-volume')).toBe(true);
    expect(()=>inspectVoiceSignal(quiet,0)).toThrow('Invalid audio sample rate');
  });
  it('reports corrupted nonfinite samples independently from zeroes', () => {
    const pcm=new Float32Array(rate);
    pcm[7]=NaN;pcm[19]=Infinity;
    expect(inspectVoiceSignal(pcm,rate).warnings.some(x=>x.kind==='invalid')).toBe(true);
  });
});
