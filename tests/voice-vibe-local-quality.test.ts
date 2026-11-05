import { describe, it, expect } from 'vitest';
import { reviewLocalVibeDialogue } from '../src/voice/VibeDialogueQC';
import { assembleVibeDialogueAudio } from '../src/voice/VibeDialogue';
import { vibeAsrApiUrl } from '../src/voice/VibeAsrRemote';

const sr=24000;
const tone=(seconds:number,amp:number):Float32Array=>{
 const buf=new Float32Array(Math.round(seconds*sr));
 for(let i=0;i<buf.length;i++)buf[i]=Math.sin(i*.085)*amp;
 return buf;
};
describe('VibeVoice-inspired mobile acoustic quality checks',()=>{
 it('reports the utterances, identities, duration and averaged signal levels',()=>{
  const a=tone(1.3,.13),b=tone(1.2,.1);
  const out=assembleVibeDialogueAudio([
   {speaker:'A',text:'おはようございます。',audio:a,rate:sr},
   {speaker:'B',text:'おはようございます。',audio:b,rate:sr},
  ]);
  const audit=reviewLocalVibeDialogue(out);
  expect(audit.turnCount).toBe(2);
  expect(audit.speakerCount).toBe(2);
  expect(audit.durationSeconds).toBeCloseTo(out.seconds,5);
  expect(audit.averageRmsDbfs).toBeGreaterThan(-35);
  expect(audit.warnings).toHaveLength(0);
 });
 it('detects low volume and substantial speaker re-entry drift',()=>{
  const output=assembleVibeDialogueAudio([
    {speaker:'A',text:'普通の音声です。',audio:tone(.6,.2),rate:sr},
    {speaker:'B',text:'はい。',audio:tone(.6,.12),rate:sr},
    {speaker:'A',text:'音が非常に小さくなりました。',audio:tone(.7,.003),rate:sr},
  ]);
  const review=reviewLocalVibeDialogue(output);
  expect(review.speakerCount).toBe(2);
  expect(review.warnings.some(x=>x.message.includes('音量'))).toBe(true);
  expect(review.warnings.some(x=>x.speaker==='A')).toBe(true);
 });
 it('does not treat source text timings as recognized speech',()=>{
  const output=assembleVibeDialogueAudio([
    {speaker:'C',text:'おはよう。',audio:tone(.5,.2),rate:sr},
  ]);
  const review=reviewLocalVibeDialogue(output);
  expect(Object.keys(review).includes('recognizedText')).toBe(false);
  expect(review.turnCount).toBe(1);
 });
});
describe('VibeVoice-ASR private GPU API endpoint',()=>{
 it('accepts public HTTPS and adds the known suffix once',()=>{
  expect(vibeAsrApiUrl('https://my-asr.example.com')).toBe('https://my-asr.example.com/api/vibe-asr');
  expect(vibeAsrApiUrl('https://my-asr.example.com/api/vibe-asr'))
    .toBe('https://my-asr.example.com/api/vibe-asr');
 });
 it('rejects local and unauthenticated links',()=>{
  for(const url of [
    'http://my-asr.example.com','https://localhost:7873',
    'https://127.0.0.1','https://192.168.0.1',
    'https://10.3.7.1','https://172.31.0.1',
    'https://my-asr.example.com?token=1',
    'https://user:pass@my-asr.example.com',
    'https://my-asr.example.com/#token',
  ])expect(()=>vibeAsrApiUrl(url)).toThrow();
 });
});
