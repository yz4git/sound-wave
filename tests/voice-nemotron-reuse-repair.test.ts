import { describe, expect, it } from 'vitest';
import {
  inspectReferenceForRepair, repairReferenceQuietFloor, reuseEndpoint, REUSE_MOBILE_MAX_SECONDS,
} from '../src/voice/NemotronReuseRepair';

describe('Nemotron RE-USE-informed reference repair without bundled neural model', () => {
  const sr=24000;
  it('does not change a clean generated Japanese voice', () => {
    const clean=new Float32Array(sr*2);
    for(let i=0;i<clean.length;i++)clean[i]=.14*Math.sin(i*.013);
    const result=repairReferenceQuietFloor(clean,sr);
    expect(result.audio).toBe(clean);
    expect(result.report.mode).toBe('unchanged');
  });
  it('attenuates background only in obvious quiet spans and protects speech samples', () => {
    const raw=new Float32Array(sr*4);
    for(let i=0;i<raw.length;i++){
      const noise=.006*Math.sin(i*.09);
      const speech=(i>=sr&&i<sr*3) ? .16*Math.sin(i*.042) : 0;
      raw[i]=speech+noise;
    }
    const before=Float32Array.from(raw);
    const result=repairReferenceQuietFloor(raw,sr);
    expect(result.report.mode).toBe('quiet-floor');
    expect(result.report.attenuatedFraction).toBeGreaterThan(.15);
    expect(Math.abs(result.audio[0]!)).toBeLessThanOrEqual(Math.abs(raw[0]!));
    expect(Math.abs(result.audio[Math.floor(sr*.5)]!)).toBeLessThan(Math.abs(raw[Math.floor(sr*.5)]!));
    expect(result.audio[Math.floor(sr*2)]).toBeCloseTo(raw[Math.floor(sr*2)]!,5);
    expect(raw).toEqual(before);
  });
  it('does not silently fix clipped or nearly silent recordings', () => {
    const clipped=new Float32Array(sr*2).fill(.999);
    expect(repairReferenceQuietFloor(clipped,sr).audio).toBe(clipped);
    const silence=new Float32Array(sr);
    expect(repairReferenceQuietFloor(silence,sr).report.mode).toBe('unchanged');
  });
  it('caps audio duration and rejects malformed PCM', () => {
    expect(REUSE_MOBILE_MAX_SECONDS).toBe(20);
    expect(()=>inspectReferenceForRepair(new Float32Array(sr*21),sr)).toThrow();
    expect(()=>inspectReferenceForRepair(new Float32Array(0),sr)).toThrow();
    expect(()=>inspectReferenceForRepair(new Float32Array(2),3000)).toThrow();
    expect(()=>inspectReferenceForRepair(new Float32Array([.1,NaN]),sr)).toThrow();
  });
  it('requires a user-specified public HTTPS GPU endpoint', () => {
    expect(reuseEndpoint('https://gpu.example.com/api/enhance').pathname).toBe('/api/enhance');
    for(const url of [
      'http://gpu.example.com/api/enhance',
      'https://localhost/api/enhance',
      'https://127.0.0.1/api/enhance',
      'https://192.168.1.1/api/enhance',
      'https://10.0.0.1/api/enhance',
      'https://172.22.1.2/api/enhance',
      'https://name:token@gpu.example.com/api/enhance',
      'https://gpu.example.com/api/enhance#token',
    ])expect(()=>reuseEndpoint(url)).toThrow();
  });
});
