import { inspectVoiceSignal } from './VoiceSignalCheck';
import type { VibeDialogueMix, VibeSpeaker } from './VibeDialogue';

export interface VibeLocalWarning {
  index:number;
  speaker:VibeSpeaker;
  seconds:number;
  message:string;
}
export interface VibeLocalReview {
  warnings:VibeLocalWarning[];
  turnCount:number;
  speakerCount:number;
  durationSeconds:number;
  averageRmsDbfs:number;
}

/** Advisory acoustic QC only. It cannot determine Japanese naturalness,
 * intonation correctness or exact ASR diarization.
 */
export function reviewLocalVibeDialogue(mix: VibeDialogueMix): VibeLocalReview {
  if(mix.boundaries.length<1||mix.boundaries.length>10)throw new Error('会話の発話数が不正です');
  const warnings:VibeLocalWarning[]=[];
  const speakerRms=new Map<VibeSpeaker,number[]>();
  let totalRms=0,validCount=0;
  for(const [index,turn] of mix.boundaries.entries()){
    const start=Math.round(turn.startSeconds*mix.rate);
    const end=Math.round(turn.endSeconds*mix.rate);
    if(start<0||end>mix.audio.length||end<=start)
      throw new Error('発話の音声区間が不正です');
    const report=inspectVoiceSignal(mix.audio.subarray(start,end),mix.rate);
    if(report.rmsDbfs>-110) {totalRms+=report.rmsDbfs;validCount++;}
    const list=speakerRms.get(turn.speaker)??[];
    list.push(report.rmsDbfs);
    speakerRms.set(turn.speaker,list);
    for(const warning of report.warnings.slice(0,2)) {
      if(warnings.length>=12)break;
      warnings.push({
        index,speaker:turn.speaker,
        seconds:turn.startSeconds+warning.timeSeconds,message:warning.message,
      });
    }
    const cps=Array.from(turn.text).length/Math.max(.1,report.durationSeconds);
    if(cps>12 && warnings.length<12)
      warnings.push({index,speaker:turn.speaker,seconds:turn.startSeconds,
        message:'文字数に対して発話時間が短い可能性があります。早口・欠落を確認してください'});
  }
  // Same speaker being louder in a later take is not automatically an error,
  // but >9 dB drift is worth checking by ear.
  for(const [speaker,values] of speakerRms){
    if(values.length<2)continue;
    const lo=Math.min(...values),hi=Math.max(...values);
    if(hi-lo>9 && warnings.length<12)
      warnings.push({index:0,speaker,seconds:0,
        message:`同じ話者の発話間で平均音量が${(hi-lo).toFixed(1)}dB異なります（参考値）`});
  }
  return {
    warnings,turnCount:mix.boundaries.length,speakerCount:speakerRms.size,
    durationSeconds:mix.seconds,averageRmsDbfs:validCount?totalRms/validCount:-120,
  };
}
