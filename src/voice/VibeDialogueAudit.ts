import { auditCompareJapanese } from './HaasAudit';
import type { VibeDialogueBoundary, VibeSpeaker } from './VibeDialogue';

/** VibeVoice-ASR Who/When/What post-processor output. These are recognized
 * observations, NEVER the ground-truth timeline built by Sound Wave.
 */
export interface VibeAsrSegment {
  startSeconds: number;
  endSeconds: number;
  speakerId: string;
  text: string;
}
export interface VibeAsrTurnAudit {
  index: number;
  speaker: VibeSpeaker;
  startSeconds: number;
  endSeconds: number;
  expected: string;
  recognized: string;
  recognizedSpeaker: string;
  cer: number | null;
  notes: string[];
}
export interface VibeAsrAuditReport {
  turns: VibeAsrTurnAudit[];
  matched: number;
  total: number;
  meanCer: number | null;
  speakerInconsistencies: number;
}

export function parseVibeAsrSegments(input: unknown, audioDuration: number): VibeAsrSegment[] {
  if (!Number.isFinite(audioDuration) || audioDuration <= 0 || audioDuration > 121)
    throw new Error('先に120秒以内の会話WAVを生成してください');
  let data: unknown = input;
  if (typeof data === 'string') {
    if (data.length > 25000) throw new Error('ASR結果が大きすぎます');
    try { data = JSON.parse(data); } catch { throw new Error('VibeVoice-ASRのJSON形式が不正です'); }
  }
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const obj = data as Record<string, unknown>;
    // Support official demo result `{file,raw_text,segments:[...]}`, or our service.
    if (Array.isArray(obj.segments)) data = obj.segments;
    else if (typeof obj.raw_text === 'string') {
      try { data = JSON.parse(obj.raw_text); }
      catch { throw new Error('raw_textからASRセグメントを読めませんでした'); }
    }
  }
  if (!Array.isArray(data) || data.length > 80)
    throw new Error('ASR結果は最大80個のセグメント配列にしてください');
  const output: VibeAsrSegment[] = [];
  for (const value of data) {
    if (!value || typeof value !== 'object') throw new Error('ASRの各セグメントが不正です');
    const o = value as Record<string, unknown>;
    const from = o.start_time ?? o['Start time'] ?? o.Start;
    const to = o.end_time ?? o['End time'] ?? o.End;
    const who = o.speaker_id ?? o['Speaker ID'] ?? o.Speaker;
    const said = o.text ?? o.Content;
    const startSeconds = typeof from === 'number' ? from : typeof from === 'string' ? Number(from) : NaN;
    const endSeconds = typeof to === 'number' ? to : typeof to === 'string' ? Number(to) : NaN;
    if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds)
      || startSeconds < 0 || endSeconds <= startSeconds || endSeconds > audioDuration + .7)
      throw new Error('ASRの時刻が音声の長さと一致しません');
    if (typeof said !== 'string' || !said.trim() || Array.from(said).length > 550)
      throw new Error('ASRの認識文が不正です');
    if (typeof who !== 'string' && typeof who !== 'number')
      throw new Error('ASRの話者IDがありません');
    const speakerId = String(who).trim().slice(0, 50);
    if (!speakerId) throw new Error('ASRの話者IDが空です');
    output.push({startSeconds,endSeconds,speakerId,text:said.trim()});
  }
  // Avoid attributing recognized text in timeline order based on model JSON order.
  return output.sort((a,b) => a.startSeconds - b.startSeconds || a.endSeconds-b.endSeconds);
}

function overlap(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0,Math.min(aEnd,bEnd)-Math.max(aStart,bStart));
}

/** Align ASR observations to generated turn time ranges. Speaker IDs cannot
 * directly map to A/B/C/D because diarization labels are arbitrary.
 */
export function auditVibeDialogueAsr(
  expected: readonly VibeDialogueBoundary[],
  recognized: readonly VibeAsrSegment[],
): VibeAsrAuditReport {
  if (!expected.length || expected.length > 10 || recognized.length > 80)
    throw new Error('分析できる発話数の上限を超えています');
  const distributed = expected.map(() => [] as VibeAsrSegment[]);
  for (const seg of recognized) {
    let best = -1, bestDuration = 0;
    for (const [i,turn] of expected.entries()) {
      const duration = overlap(seg.startSeconds,seg.endSeconds,turn.startSeconds,turn.endSeconds);
      if (duration > bestDuration) { bestDuration = duration; best = i; }
    }
    if (best >= 0) distributed[best]!.push(seg);
  }
  const mapping = new Map<string,VibeSpeaker>();
  const inverse = new Map<VibeSpeaker,string>();
  let inconsistencies=0, cerSum=0, compared=0;
  const turns = expected.map((expectedTurn,index): VibeAsrTurnAudit => {
    const words = distributed[index]!;
    const combined = words.map(x=>x.text).join('').trim();
    const votes = new Map<string,number>();
    for (const seg of words) votes.set(
      seg.speakerId,
      (votes.get(seg.speakerId)??0)
       +overlap(seg.startSeconds,seg.endSeconds,expectedTurn.startSeconds,expectedTurn.endSeconds),
    );
    const found = Array.from(votes.entries()).sort((a,b)=>b[1]-a[1])[0]?.[0] ?? '';
    const notes:string[]=[];
    if (found) {
      const assigned = mapping.get(found);
      const previouslySeen = inverse.get(expectedTurn.speaker);
      if (assigned && assigned !== expectedTurn.speaker) {
        notes.push('同じ認識話者IDが別の台本話者にも割り当てられました');
        inconsistencies++;
      } else if (previouslySeen && previouslySeen !== found) {
        notes.push('同じ台本話者の認識IDが途中で変化しました');
        inconsistencies++;
      } else {
        mapping.set(found,expectedTurn.speaker);
        inverse.set(expectedTurn.speaker,found);
      }
      if (votes.size > 1) notes.push('1発話の内部で複数の話者IDが検出されました');
    } else notes.push('この発話には認識結果がありません');
    const cer = combined
      ? auditCompareJapanese(expectedTurn.text, combined).kanaFlexible.cer : null;
    if (cer !== null) {cerSum += cer;compared++;}
    return {
      index,speaker:expectedTurn.speaker,
      startSeconds:expectedTurn.startSeconds,endSeconds:expectedTurn.endSeconds,
      expected:expectedTurn.text,recognized:combined,
      recognizedSpeaker:found,cer,notes,
    };
  });
  return {
    turns,matched:compared,total:expected.length,
    meanCer:compared?cerSum/compared:null,
    speakerInconsistencies:inconsistencies,
  };
}

export function formatVibeSrt(timeline: readonly VibeDialogueBoundary[]): string {
  if(!timeline.length || timeline.length>10)throw new Error('字幕にできる発話がありません');
  const stamp=(seconds:number):string=>{
    const ms=Math.max(0,Math.round(seconds*1000));
    const h=Math.floor(ms/3600000).toString().padStart(2,'0');
    const m=Math.floor(ms%3600000/60000).toString().padStart(2,'0');
    const s=Math.floor(ms%60000/1000).toString().padStart(2,'0');
    const frac=(ms%1000).toString().padStart(3,'0');
    return `${h}:${m}:${s},${frac}`;
  };
  return timeline.map((turn,index)=>{
    if(!Number.isFinite(turn.startSeconds)||!Number.isFinite(turn.endSeconds)
      || turn.startSeconds<0 || turn.endSeconds<=turn.startSeconds || turn.endSeconds>121)
      throw new Error('字幕時刻が不正です');
    return `${index+1}\n${stamp(turn.startSeconds)} --> ${stamp(turn.endSeconds)}\n${turn.speaker}: ${turn.text.replace(/[\r\n]+/g,' ')}\n`;
  }).join('\n');
}
