import { measureVoicePcm, type VoicePcmStats } from './VoxLocalCompare';
import { inspectVoiceSignal } from './VoiceSignalCheck';

/** Compare genuine Microsoft VibeVoice-Realtime WAV (imported after official inference)
 * with the existing local Kokoro / VOX LOCAL output. This is an A/B listening
 * protocol, not an implementation of VibeVoice acoustic inference.
 */
export const VIBE_REALTIME_MAX_CHARS = 180;
export const VIBE_REALTIME_MAX_SECONDS = 70;
export const VIBE_REALTIME_FILE_LIMIT = 12 * 1024 * 1024;
export type VibeRealtimeSource = 'realtime' | 'kokoro';
export type VibeRealtimeCriterion = 'natural' | 'pronunciation' | 'flow';
export type VibeRealtimeChoice = 'a' | 'b' | 'tie';
export type VibeRealtimeOrder = { a: VibeRealtimeSource; b: VibeRealtimeSource };

export interface VibeRealtimeTake { audio: Float32Array; rate: number }
export interface VibeRealtimeMatchedTake extends VibeRealtimeTake {
  stats: VoicePcmStats;
  durationSeconds: number;
  originalStats: VoicePcmStats;
}
export interface VibeRealtimeAB {
  kokoro: VibeRealtimeMatchedTake;
  realtime: VibeRealtimeMatchedTake;
  levelDifferenceDb: number;
  durationRatio: number;
  warnings: string[];
}

export function validateVibeRealtimeText(text: string): string {
  const value=text.trim();
  const length=Array.from(value).length;
  if (length < 12 || length > VIBE_REALTIME_MAX_CHARS)
    throw new Error(`比較する日本語原稿は12〜${VIBE_REALTIME_MAX_CHARS}文字にしてください`);
  if (/\[[A-D]\]\s*|(?:^|\n)[A-D][:：]/u.test(value))
    throw new Error('Realtimeは単一話者用です。A: などの話者指定を外してください');
  return value;
}
export function shuffledVibeRealtimeOrder(random: () => number = Math.random): VibeRealtimeOrder {
  return random()<.5
    ? {a:'kokoro',b:'realtime'}
    : {a:'realtime',b:'kokoro'};
}
export function prepareVibeRealtimeAudio(
  take: VibeRealtimeTake,
  targetRms = 10 ** (-25 / 20),
): VibeRealtimeMatchedTake {
  if (!Number.isInteger(take.rate) || take.rate < 8000 || take.rate > 48000)
    throw new Error('音声のサンプルレートが8〜48kHzの範囲外です');
  const duration=take.audio.length / take.rate;
  if (duration < .2 || duration > VIBE_REALTIME_MAX_SECONDS)
    throw new Error('比較音声は0.2〜70秒以内にしてください');
  const before=measureVoicePcm(take.audio);
  if (before.rms < .002 || before.peak < .012 || before.clippedSamples > take.rate*.02)
    throw new Error('音声が無音または極端に音割れしています');
  for (let i=0;i<take.audio.length;i++)
    if (!Number.isFinite(take.audio[i]))throw new Error('音声に不正なサンプルが含まれています');
  // Shared A/B target, never >+4dB boost to avoid amplifying noise.
  // This is RMS matching, not perceptual LUFS or phoneme reconstruction.
  if(!Number.isFinite(targetRms) || targetRms<.001 || targetRms>.5)
    throw new Error('音量の共通目標値が不正です');
  const gain=Math.min(1.6,Math.max(.625,targetRms/before.rms),
    .98/Math.max(1e-6,before.peak));
  const output=new Float32Array(take.audio.length);
  for(let i=0;i<output.length;i++)output[i]=Math.max(-.98,Math.min(.98,take.audio[i]!*gain));
  return {
    audio:output,rate:take.rate,
    stats:measureVoicePcm(output),durationSeconds:duration,originalStats:before,
  };
}
export function prepareVibeRealtimeAB(kokoro:VibeRealtimeTake,realtime:VibeRealtimeTake): VibeRealtimeAB {
  // Geometric mean asks both takes to move toward the same center without
  // boosting either as aggressively as a fixed high target would.
  const a=measureVoicePcm(kokoro.audio).rms;
  const b=measureVoicePcm(realtime.audio).rms;
  const target=Math.max(.02,Math.min(.15,Math.sqrt(a*b)));
  const k=prepareVibeRealtimeAudio(kokoro,target);
  const r=prepareVibeRealtimeAudio(realtime,target);
  const warnings:string[]=[];
  const difference=Math.abs(k.stats.rmsDbfs-r.stats.rmsDbfs);
  if (difference>2.5)
    warnings.push(`音量差が${difference.toFixed(1)}dB残っています。聴感評価では音量を調整してください`);
  const ratio=Math.max(k.durationSeconds,r.durationSeconds)
    /Math.max(.1,Math.min(k.durationSeconds,r.durationSeconds));
  if (ratio>1.5)
    warnings.push('同じ文章に対して再生時間が大きく異なります。文字の読み飛ばしや発話速度を確認してください');
  for (const [name,take] of [['Kokoro',k],['VibeVoice',r]] as const){
    const diagnostics=inspectVoiceSignal(take.audio,take.rate);
    if (diagnostics.warnings.some(x=>x.kind==='silence'))
      warnings.push(`${name}に長い無音区間があります。聴き比べてください`);
  }
  return {kokoro:k,realtime:r,levelDifferenceDb:k.stats.rmsDbfs-r.stats.rmsDbfs,
    durationRatio:ratio,warnings};
}
export function revealVibeRealtimeChoice(
 order:VibeRealtimeOrder,criterion:VibeRealtimeCriterion,choice:VibeRealtimeChoice,
): string {
  const criterionText:Record<VibeRealtimeCriterion,string>={
    natural:'声の自然さ',pronunciation:'日本語の発音',flow:'語尾と文章のつながり',
  };
  const verdict=choice==='tie'?'同じくらい':`${choice.toUpperCase()}を選択`;
  const model=(s:VibeRealtimeSource)=>s==='kokoro'?'Kokoro / VOX LOCAL':'Microsoft VibeVoice-Realtime';
  return `${criterionText[criterion]}：${verdict}。A=${model(order.a)}、B=${model(order.b)}。この結果は聴感上の主観評価であり、モデルの品質保証ではありません。`;
}
