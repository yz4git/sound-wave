import { describe, it, expect } from 'vitest';
import { parseVibeDialogueScript, assembleVibeDialogueAudio,
  VIBE_SPEAKERS, VIBE_MAX_TURNS, VIBE_MAX_SCRIPT_CHARS } from '../src/voice/VibeDialogue';

describe('VibeVoice-inspired local dialogue script', () => {
  it('parses up to four stable speakers with explicit labels, including Japanese colon', () => {
    const lines=parseVibeDialogueScript('A: こんにちは。\n[B] はい、どうしましたか？\nspeaker_3: 私も参加します。\nD：よろしくお願いします。');
    expect(lines.map(x=>x.speaker)).toEqual(['A','B','C','D']);
    expect(lines[1]!.text).toBe('はい、どうしましたか？');
    expect(lines.every((x,i)=>x.index===i)).toBe(true);
    expect(VIBE_SPEAKERS.map(x=>x.speaker)).toEqual(['A','B','C','D']);
  });
  it('does not guess who speaks if a line lacks an explicit speaker marker', () => {
    expect(()=>parseVibeDialogueScript('こんにちは。')).toThrow('話者指定');
    expect(()=>parseVibeDialogueScript('E: こんにちは。')).toThrow();
    expect(()=>parseVibeDialogueScript('speaker_5: 不明。')).toThrow();
  });
  it('rejects excessive turns, text and blank input to prevent iPhone memory crashes',()=>{
    expect(()=>parseVibeDialogueScript('   ')).toThrow();
    expect(()=>parseVibeDialogueScript('A: こんにちは\n'.repeat(VIBE_MAX_TURNS+1))).toThrow();
    expect(()=>parseVibeDialogueScript('A: '+'あ'.repeat(141))).toThrow();
    const one='あ'.repeat(130);
    expect(()=>parseVibeDialogueScript(Array.from({length:4},()=>`A: ${one}`).join('\n'))).toThrow();
    expect(VIBE_MAX_SCRIPT_CHARS).toBe(420);
  });
});

describe('VibeVoice-informed local speaker turn assembly', () => {
  const sr=24000;
  const pcm=(seconds:number,freq=0.07)=>{
    const length=Math.round(sr*seconds);
    const result=new Float32Array(length);
    for(let i=0;i<length;i++) result[i]=0.13*Math.sin(i*freq);
    return result;
  };
  it('preserves each speaker turn in order and inserts a question-aware handoff pause',()=>{
    const first=pcm(.6), second=pcm(.45,.04);
    const mixed=assembleVibeDialogueAudio([
      {speaker:'A',text:'お元気ですか？',audio:first,rate:sr},
      {speaker:'B',text:'はい。',audio:second,rate:sr},
    ]);
    expect(mixed.boundaries.length).toBe(2);
    expect(mixed.boundaries[0]!.speaker).toBe('A');
    expect(mixed.boundaries[1]!.speaker).toBe('B');
    expect(mixed.boundaries[1]!.startSeconds-mixed.boundaries[0]!.endSeconds).toBeCloseTo(.27,2);
    expect(mixed.audio.slice(0,first.length)).toEqual(first);
    const secondStart=Math.round(mixed.boundaries[1]!.startSeconds*sr);
    expect(mixed.audio.slice(secondStart,secondStart+second.length)).toEqual(second);
  });
  it('shortens same-speaker continuity gaps and leaves input PCM immutable',()=>{
    const input=pcm(.32);
    const original=Float32Array.from(input);
    const result=assembleVibeDialogueAudio([
      {speaker:'A',text:'まず説明します。',audio:input,rate:sr},
      {speaker:'A',text:'続けます。',audio:input,rate:sr},
    ]);
    expect(result.boundaries[1]!.startSeconds-result.boundaries[0]!.endSeconds).toBeCloseTo(.13,2);
    expect(input).toEqual(original);
  });
  it('rejects mismatched formats and empty speech',()=>{
    expect(()=>assembleVibeDialogueAudio([])).toThrow();
    expect(()=>assembleVibeDialogueAudio([{speaker:'A',text:'あ',audio:new Float32Array(),rate:sr}])).toThrow();
    expect(()=>assembleVibeDialogueAudio([
      {speaker:'A',text:'あ',audio:pcm(.2),rate:sr},
      {speaker:'B',text:'はい',audio:pcm(.2),rate:48000},
    ])).toThrow();
    expect(()=>assembleVibeDialogueAudio([{speaker:'A',text:'あ',audio:new Float32Array(sr*121),rate:sr}])).toThrow();
  });
});
