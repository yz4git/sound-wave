import { describe, expect, it } from 'vitest';
import { parseVibeAsrSegments, auditVibeDialogueAsr, formatVibeSrt } from '../src/voice/VibeDialogueAudit';
import type { VibeDialogueBoundary } from '../src/voice/VibeDialogue';

const expected:VibeDialogueBoundary[]=[
 {speaker:'A',text:'おはようございます。',startSeconds:0,endSeconds:1.6},
 {speaker:'B',text:'どうしましたか？',startSeconds:1.81,endSeconds:3.0},
 {speaker:'A',text:'大丈夫ですよ。',startSeconds:3.27,endSeconds:4.5},
];

describe('VibeVoice-ASR who/when/what parser',()=>{
 it('accepts official title-cased output, snake case and wrapper responses',()=>{
  const official=[
   {'Start time':0,'End time':1.5,'Speaker ID':'Speaker 0','Content':'おはようございます。'},
   {start_time:'1.9',end_time:'2.95',speaker_id:'Speaker 1',text:'どうしましたか？'},
  ];
  const result=parseVibeAsrSegments({segments:official},4.5);
  expect(result).toHaveLength(2);
  expect(result[0]).toMatchObject({startSeconds:0,endSeconds:1.5,speakerId:'Speaker 0'});
  expect(parseVibeAsrSegments(JSON.stringify(official),4.5)).toEqual(result);
  expect(parseVibeAsrSegments({raw_text:JSON.stringify(official)},4.5)).toEqual(result);
 });
 it('rejects malformed timestamps, missing speaker, overlong transcription, invalid JSON',()=>{
  expect(()=>parseVibeAsrSegments('bad',4)).toThrow();
  expect(()=>parseVibeAsrSegments([{text:'hi',speaker_id:'1',start_time:-1,end_time:1}],4)).toThrow();
  expect(()=>parseVibeAsrSegments([{text:'hi',speaker_id:'1',start_time:1,end_time:8}],4)).toThrow();
  expect(()=>parseVibeAsrSegments([{text:'hi',start_time:0,end_time:1}],4)).toThrow();
  expect(()=>parseVibeAsrSegments([{text:'a'.repeat(560),speaker_id:1,start_time:0,end_time:1}],4)).toThrow();
  expect(()=>parseVibeAsrSegments([],800)).toThrow();
  expect(()=>parseVibeAsrSegments(Array.from({length:81},(_,i)=>({start_time:i/100,end_time:(i+1)/100,speaker_id:'1',text:'a'})),4)).toThrow();
 });
});
describe('VibeVoice-ASR vs scripted dialogue comparison',()=>{
 it('keeps diarization IDs independent of A/B names and aligns by overlap',()=>{
  const result=auditVibeDialogueAsr(expected,parseVibeAsrSegments([
   {start_time:3.30,end_time:4.4,speaker_id:'Speaker 0',text:'大丈夫ですよ。'},
   {start_time:1.9,end_time:2.95,speaker_id:'Speaker 1',text:'どうしましたか?'},
   {start_time:0.03,end_time:1.5,speaker_id:'Speaker 0',text:'おはようございます。'},
  ],4.5));
  expect(result.matched).toBe(3);
  expect(result.speakerInconsistencies).toBe(0);
  expect(result.turns[0]!.recognizedSpeaker).toBe('Speaker 0');
  expect(result.turns[2]!.recognizedSpeaker).toBe('Speaker 0');
  expect(result.turns[0]!.cer).toBe(0);
  expect(result.turns[1]!.cer).toBe(0);
 });
 it('detects inconsistent speaker labels and missing utterances without hallucinating transcripts',()=>{
  const recognized=parseVibeAsrSegments([
   {start_time:0,end_time:1.5,speaker_id:0,text:'おはようございます。'},
   {start_time:3.3,end_time:4.4,speaker_id:1,text:'大丈夫ですよ。'},
  ],4.5);
  const result=auditVibeDialogueAsr(expected,recognized);
  expect(result.matched).toBe(2);
  expect(result.turns[1]!.cer).toBeNull();
  expect(result.turns[1]!.notes[0]).toContain('認識結果がありません');
  expect(result.speakerInconsistencies).toBe(1);
 });
 it('supports structured SRT with accurate timeline and speaker IDs',()=>{
  const srt=formatVibeSrt(expected);
  expect(srt).toContain('00:00:00,000 --> 00:00:01,600');
  expect(srt).toContain('00:00:01,810 --> 00:00:03,000');
  expect(srt).toContain('A: おはようございます。');
  expect(srt).toContain('B: どうしましたか？');
  expect(srt.split('-->').length).toBe(4);
  expect(()=>formatVibeSrt([])).toThrow();
  expect(()=>formatVibeSrt([{speaker:'A',text:'x',startSeconds:4,endSeconds:3}])).toThrow();
 });
});
