import {describe,it,expect} from 'vitest';
import {
 VIBE_REALTIME_FILE_LIMIT,VIBE_REALTIME_MAX_CHARS,VIBE_REALTIME_MAX_SECONDS,
 validateVibeRealtimeText,shuffledVibeRealtimeOrder,prepareVibeRealtimeAudio,
 prepareVibeRealtimeAB,revealVibeRealtimeChoice,
} from '../src/voice/VibeRealtimeCompare';

const sr=24000;
const tone=(n:number,gain:number):Float32Array=>{
 const result=new Float32Array(Math.round(sr*n));
 for(let i=0;i<result.length;i++)result[i]=Math.sin(i*.06)*gain;
 return result;
};
describe('VibeVoice-Realtime Japanese blind comparison',()=>{
 it('allows a short-to-medium single-speaker Japanese script',()=>{
  expect(validateVibeRealtimeText('こんにちは。今日はいい天気ですね。')).toBe('こんにちは。今日はいい天気ですね。');
  expect(()=>validateVibeRealtimeText('こんにちは。')).toThrow();
  expect(()=>validateVibeRealtimeText('あ'.repeat(VIBE_REALTIME_MAX_CHARS+1))).toThrow();
  expect(()=>validateVibeRealtimeText('A: 今日はいい天気ですね。')).toThrow();
  expect(VIBE_REALTIME_FILE_LIMIT).toBe(12*1024*1024);
  expect(VIBE_REALTIME_MAX_SECONDS).toBe(70);
 });
 it('shuffles source identities; the choice text unmasks only after a vote',()=>{
  expect(shuffledVibeRealtimeOrder(()=>.1)).toEqual({a:'kokoro',b:'realtime'});
  expect(shuffledVibeRealtimeOrder(()=>.9)).toEqual({a:'realtime',b:'kokoro'});
  const description=revealVibeRealtimeChoice({a:'realtime',b:'kokoro'},'pronunciation','a');
  expect(description).toContain('日本語の発音');
  expect(description).toContain('A=Microsoft VibeVoice-Realtime');
  expect(revealVibeRealtimeChoice({a:'kokoro',b:'realtime'},'flow','tie')).toContain('同じくらい');
 });
 it('does not modify original samples and RMS-matches independently across audio lengths',()=>{
  const original=tone(.8,.06),source=tone(1.2,.11);
  const old=Float32Array.from(original),before=Float32Array.from(source);
  const matched=prepareVibeRealtimeAB({audio:original,rate:sr},{audio:source,rate:sr});
  expect(original).toEqual(old);
  expect(source).toEqual(before);
  expect(matched.kokoro.audio).not.toBe(original);
  expect(matched.realtime.audio).not.toBe(source);
  expect(matched.kokoro.audio.length).toBe(original.length);
  expect(matched.realtime.audio.length).toBe(source.length);
  expect(matched.kokoro.stats.peak).toBeLessThanOrEqual(.98);
  expect(matched.realtime.stats.peak).toBeLessThanOrEqual(.98);
  expect(matched.levelDifferenceDb).toBeCloseTo(0,1);
 });
 it('warns for different speech durations instead of claiming speech quality',()=>{
  const r=prepareVibeRealtimeAB(
   {audio:tone(.9,.12),rate:sr},
   {audio:tone(2.9,.09),rate:sr},
  );
  expect(r.durationRatio).toBeGreaterThan(3);
  expect(r.warnings.some(x=>x.includes('再生時間'))).toBe(true);
 });
 it('refuses broken, silent, clipped, out-of-range samples',()=>{
  expect(()=>prepareVibeRealtimeAudio({audio:new Float32Array(sr),rate:sr})).toThrow();
  expect(()=>prepareVibeRealtimeAudio({audio:tone(.8,.1),rate:3000})).toThrow();
  expect(()=>prepareVibeRealtimeAudio({audio:tone(71,.1),rate:sr})).toThrow();
  expect(()=>prepareVibeRealtimeAudio({audio:new Float32Array(sr).fill(1),rate:sr})).toThrow();
  const corrupt=tone(.8,.1);corrupt[100]=NaN;
  expect(()=>prepareVibeRealtimeAudio({audio:corrupt,rate:sr})).toThrow();
 });
});
