import { cleanNeuralJoinEdges } from './VoxSeamlessJoin';
import { classifyJapaneseDialogue } from './VoxDialogueDirector';
import type { VoiceCharacterPreset } from '../compose/VoiceCharacter';

/**
 * VibeVoice-informed local dialogue staging, NOT Microsoft's trained speech
 * tokenizer or next-token diffusion. Kokoro generates independent turns.
 */
export type VibeSpeaker = 'A' | 'B' | 'C' | 'D';
export interface VibeDialogueTurn {
  speaker: VibeSpeaker;
  text: string;
  index: number;
}
export interface VibeSpeakerConfig {
  speaker: VibeSpeaker;
  description: string;
  character: VoiceCharacterPreset;
  pitchOffset: number;
}
export const VIBE_MAX_TURNS = 10;
export const VIBE_MAX_SCRIPT_CHARS = 420;
export const VIBE_MAX_TURN_CHARS = 140;
export const VIBE_MAX_RENDER_SECONDS = 120;

export const VIBE_SPEAKERS: readonly VibeSpeakerConfig[] = [
  {speaker:'A', description:'やさしい落ち着いた女性の声', character:'soft', pitchOffset:2},
  {speaker:'B', description:'低めで落ち着いた男性の声', character:'power', pitchOffset:-4},
  {speaker:'C', description:'透明感のある明瞭な女性の声', character:'clear', pitchOffset:4},
  {speaker:'D', description:'少し息混じりで柔らかい声', character:'airy', pitchOffset:0},
];

/** Requires a speaker on each line. Prevents silent misattribution. */
export function parseVibeDialogueScript(raw: string): VibeDialogueTurn[] {
  if (!raw.trim()) throw new Error('会話台本を入力してください');
  const lines = raw.split(/\r?\n/u).map((line)=>line.trim()).filter(Boolean);
  if (!lines.length || lines.length > VIBE_MAX_TURNS)
    throw new Error(`会話台本は1〜${VIBE_MAX_TURNS}行にしてください`);
  const results: VibeDialogueTurn[] = [];
  let count = 0;
  for (const [index,line] of lines.entries()) {
    const match = /^(?:\[([A-D])\]|(?:speaker[_ -]?([1-4])|([A-D]))\s*[:：])\s*(.+)$/iu.exec(line);
    if (!match) throw new Error(`${index+1}行目：A: または [A] の話者指定が必要です`);
    const speaker = (match[1] || match[3] || String.fromCharCode(64+Number(match[2]))).toUpperCase() as VibeSpeaker;
    const text = match[4]!.trim();
    if (!text || Array.from(text).length > VIBE_MAX_TURN_CHARS)
      throw new Error(`${index+1}行目：発話は1〜${VIBE_MAX_TURN_CHARS}文字以内にしてください`);
    count += Array.from(text).length;
    if (count > VIBE_MAX_SCRIPT_CHARS)
      throw new Error(`台本全体は${VIBE_MAX_SCRIPT_CHARS}文字以内にしてください`);
    results.push({speaker,text,index:results.length});
  }
  return results;
}

export interface VibeTurnAudio {
  speaker: VibeSpeaker;
  text: string;
  audio: Float32Array;
  rate: number;
}
export interface VibeDialogueBoundary {
  speaker: VibeSpeaker;
  text: string;
  startSeconds: number;
  endSeconds: number;
}
export interface VibeDialogueMix {
  audio: Float32Array;
  rate: number;
  boundaries: VibeDialogueBoundary[];
  seconds: number;
}

/** Pure in-memory PCM merge. Never mixes different speakers simultaneously.
 * The short silence models conversational turn-taking without voice cloning.
 */
export function assembleVibeDialogueAudio(takes: readonly VibeTurnAudio[]): VibeDialogueMix {
  if (!takes.length || takes.length > VIBE_MAX_TURNS) throw new Error('会話の音声数が不正です');
  const sr = takes[0]!.rate;
  if (!Number.isInteger(sr) || sr < 8000 || sr > 48000) throw new Error('音声サンプルレートが不正です');
  const parts: {speaker:VibeSpeaker;text:string;samples:Float32Array;pauseSamples:number}[]=[];
  let length=0;
  for (const [index,take] of takes.entries()) {
    if (take.rate!==sr) throw new Error('話者ごとに異なる音声形式は結合できません');
    if (!take.audio.length || take.audio.length>sr*VIBE_MAX_RENDER_SECONDS)
      throw new Error('発話が長すぎるか音声が空です');
    const cleaned=cleanNeuralJoinEdges(take.audio,sr,index,takes.length).audio;
    const act=classifyJapaneseDialogue(take.text).act;
    const next=takes[index+1];
    const switchSpeaker=next!==undefined && next.speaker!==take.speaker;
    const gap= !next ? 0 : switchSpeaker
      ? (act==='question' ? .27 : act==='acknowledgement' ? .18 : .21)
      : .13;
    const pauseSamples=Math.round(sr*gap);
    parts.push({speaker:take.speaker,text:take.text,samples:cleaned,pauseSamples});
    length+=cleaned.length+pauseSamples;
    if(length>sr*VIBE_MAX_RENDER_SECONDS)throw new Error('会話の長さが120秒を超えました');
  }
  const audio=new Float32Array(length);
  const boundaries:VibeDialogueBoundary[]=[];
  let position=0;
  for(const part of parts){
    const start=position;
    audio.set(part.samples,position);
    position+=part.samples.length;
    boundaries.push({
      speaker:part.speaker,text:part.text,
      startSeconds:start/sr,endSeconds:position/sr,
    });
    position+=part.pauseSamples;
  }
  return {audio,rate:sr,boundaries,seconds:length/sr};
}
