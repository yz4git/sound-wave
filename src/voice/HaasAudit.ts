/**
 * Haas-ASR inspired Japanese intelligibility review.
 * These are simple, transparent CER metrics, not jacer or official Haas scores.
 * CER assesses transcript readability, NOT conversational naturalness.
 */
export interface SpeechErrorCounts {
  substitutions: number;
  deletions: number;
  insertions: number;
}
export interface SpeechAuditScore extends SpeechErrorCounts {
  characters: number;
  errors: number;
  cer: number;
}
export interface SpeechAuditComparison {
  strict: SpeechAuditScore;
  kanaFlexible: SpeechAuditScore;
  expected: string;
  recognized: string;
}
export interface SpeechSilenceReport {
  durationSeconds: number;
  activeSeconds: number;
  quietSeconds: number;
  quietRatio: number;
  longGaps: number;
  longestGapSeconds: number;
}
const PUNCT = /[\s\p{P}\p{S}]/gu;
function kataToHira(c: string): string {
  const x = c.codePointAt(0)!;
  return x >= 0x30a1 && x <= 0x30f6 ? String.fromCodePoint(x - 0x60) : c;
}
export function auditNormalizeJapanese(text: string, kanaFlexible = false): string {
  const stripped = text.normalize('NFKC').toLowerCase().replace(PUNCT, '');
  return kanaFlexible ? Array.from(stripped).map(kataToHira).join('') : stripped;
}
export function auditCharacterErrors(expected: string, recognized: string): SpeechAuditScore {
  const a = Array.from(expected), b = Array.from(recognized);
  // Source text input is capped by VOICE LAB; cap external recognizer responses.
  if (a.length > 1000 || b.length > 1000) throw new Error('照合するテキストが長すぎます（1000文字以内）');
  const rows = Array.from({length:a.length+1},()=>new Uint16Array(b.length+1));
  for(let i=0;i<=a.length;i++)rows[i]![0]=i;
  for(let j=0;j<=b.length;j++)rows[0]![j]=j;
  for(let i=1;i<=a.length;i++)for(let j=1;j<=b.length;j++)
    rows[i]![j]=Math.min(
      rows[i-1]![j]!+1, rows[i]![j-1]!+1,
      rows[i-1]![j-1]!+(a[i-1]===b[j-1]?0:1)
    );
  let i=a.length,j=b.length, substitutions=0,deletions=0,insertions=0;
  while(i>0 || j>0){
    if(i>0&&j>0&&a[i-1]===b[j-1]&&rows[i]![j]===rows[i-1]![j-1]){i--;j--;continue;}
    if(i>0&&j>0&&rows[i]![j]===rows[i-1]![j-1]!+1){substitutions++;i--;j--;continue;}
    if(i>0&&rows[i]![j]===rows[i-1]![j]!+1){deletions++;i--;continue;}
    insertions++;j--;
  }
  const errors=substitutions+deletions+insertions;
  return {substitutions,deletions,insertions,errors,characters:a.length,cer:a.length?errors/a.length:(b.length?1:0)};
}
export function auditCompareJapanese(expected: string, recognized: string): SpeechAuditComparison {
  const a=auditNormalizeJapanese(expected), b=auditNormalizeJapanese(recognized);
  return {
    expected,recognized,
    strict:auditCharacterErrors(a,b),
    kanaFlexible:auditCharacterErrors(auditNormalizeJapanese(expected,true),auditNormalizeJapanese(recognized,true)),
  };
}
/**
 * Silence measurements use block RMS, inspired by Haas's VAD/quiet splitting.
 * A 20ms window and conservative -40 dBFS threshold keep light fricatives
 * from being mistaken for full pauses. No samples are modified or deleted.
 */
export function auditSpeechSilence(
  pcm: Float32Array, sampleRate: number,
  silenceRms = 0.01, longGapSeconds = 0.42,
): SpeechSilenceReport {
  if(!Number.isFinite(sampleRate)||sampleRate<8000||sampleRate>192000)throw new Error('Invalid audio sample rate');
  const block=Math.max(1,Math.round(sampleRate*.02));
  let quietFrames=0, trailing=0, longest=0, longGaps=0;
  for(let i=0;i<pcm.length;i+=block){
    const end=Math.min(pcm.length,i+block);
    let energy=0;
    for(let k=i;k<end;k++){const v=pcm[k]??0;energy+=v*v;}
    const rms=Math.sqrt(energy/(end-i));
    if(rms<silenceRms) {
      quietFrames+=end-i;trailing+=end-i;
    } else {
      if(trailing/sampleRate>=longGapSeconds)longGaps++;
      longest=Math.max(longest,trailing);trailing=0;
    }
  }
  if(trailing/sampleRate>=longGapSeconds)longGaps++;
  longest=Math.max(longest,trailing);
  const durationSeconds=pcm.length/sampleRate, quietSeconds=quietFrames/sampleRate;
  return {durationSeconds,quietSeconds,activeSeconds:durationSeconds-quietSeconds,
    quietRatio:durationSeconds?quietSeconds/durationSeconds:0,
    longGaps,longestGapSeconds:longest/sampleRate};
}
/** Only named HTTPS endpoints are allowed; nothing is uploaded automatically. */
export function validateHaasAuditEndpoint(url: string): URL {
  const parsed=new URL(url.trim());
  if(parsed.protocol!=='https:')throw new Error('音声送信先にはHTTPSが必要です');
  if(parsed.username||parsed.password||parsed.hash)throw new Error('URLに認証情報やフラグメントを含めないでください');
  if(!parsed.hostname||parsed.hostname==='localhost'||parsed.hostname==='127.0.0.1')throw new Error('公開済みのHTTPSサーバーURLを指定してください');
  return parsed;
}
export function parseHaasTranscript(response: unknown): string {
  if(!response||typeof response!=='object')throw new Error('Haasサーバーの応答が不正です');
  const record=response as Record<string,unknown>;
  if(typeof record.text!=='string'||!record.text.trim())throw new Error('Haasサーバーから認識テキストが返されませんでした');
  return record.text.slice(0,1000);
}
