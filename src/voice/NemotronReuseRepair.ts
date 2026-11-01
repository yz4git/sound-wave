/**
 * Conservative mobile reference-audio cleanup inspired by NVIDIA's RE-USE
 * speech-preservation priorities, NOT an implementation of its neural model.
 * No speech regeneration, filtering or change to voiced consonants.
 *
 * In sufficiently obvious near-quiet spans we gently attenuate room-noise;
 * smooth transitions avoid pumping and only reduce gain (never amplify).
 */
export interface MobileRepairReport {
  mode: 'unchanged' | 'quiet-floor';
  noiseRms: number;
  signalRms: number;
  speechThreshold: number;
  peak: number;
  attenuatedFraction: number;
  durationSeconds: number;
}
export interface MobileRepairResult { audio: Float32Array; report: MobileRepairReport }
const clamp = (x:number,lo:number,hi:number)=>Math.max(lo,Math.min(hi,x));
export const REUSE_MOBILE_MAX_SECONDS = 20;
const MIN_SAMPLE_RATE=8000, MAX_SAMPLE_RATE=48000;

export function inspectReferenceForRepair(audio: Float32Array, sampleRate: number): MobileRepairReport {
  if(!Number.isFinite(sampleRate)||sampleRate<MIN_SAMPLE_RATE||sampleRate>MAX_SAMPLE_RATE)
    throw new Error('対応音声は8kHz〜48kHzです');
  if(audio.length/sampleRate>REUSE_MOBILE_MAX_SECONDS)
    throw new Error('iPhoneでの音声修復は20秒以内です');
  if(audio.length===0)throw new Error('音声データが空です');
  const block=Math.max(1,Math.round(sampleRate*0.02));
  const levels:number[]=[];
  let energy=0, peak=0;
  for(let i=0;i<audio.length;i+=block){
    let power=0;
    const end=Math.min(audio.length,i+block);
    for(let j=i;j<end;j++){
      const s=audio[j]!;
      if(!Number.isFinite(s))throw new Error('音声に無効なサンプルがあります');
      power+=s*s;energy+=s*s;peak=Math.max(peak,Math.abs(s));
    }
    levels.push(Math.sqrt(power/(end-i)));
  }
  const sorted=[...levels].sort((a,b)=>a-b);
  const percentile=(p:number)=>sorted[Math.min(sorted.length-1,Math.floor((sorted.length-1)*p))]??0;
  const noiseRms=percentile(.15), speechRms=percentile(.85);
  const signalRms=Math.sqrt(energy/audio.length);
  // No-op for already-clean model output or nearly silent audio.
  // A clear high-energy speech component is necessary to justify gating.
  const actionable=noiseRms>.0025 && speechRms>noiseRms*3 && speechRms>.018 && peak<.985;
  return {
    mode:actionable?'quiet-floor':'unchanged',
    noiseRms,signalRms,peak,
    speechThreshold:actionable?Math.min(speechRms*.28,noiseRms*2.1):0,
    attenuatedFraction:0,durationSeconds:audio.length/sampleRate,
  };
}
export function repairReferenceQuietFloor(audio:Float32Array,sampleRate:number):MobileRepairResult {
  const report=inspectReferenceForRepair(audio,sampleRate);
  if(report.mode==='unchanged')return {audio,report};
  const block=Math.max(1,Math.round(sampleRate*.02));
  const windows=Math.ceil(audio.length/block);
  const loud=new Uint8Array(windows);
  for(let w=0;w<windows;w++){
    let e=0;
    const a=w*block,b=Math.min(audio.length,a+block);
    for(let i=a;i<b;i++){const x=audio[i]!;e+=x*x;}
    loud[w]=Math.sqrt(e/(b-a))>report.speechThreshold?1:0;
  }
  // 80ms speech protection on each side of every active block.
  const guard=4;
  const protectedWindow=new Uint8Array(windows);
  for(let w=0;w<windows;w++){
    if(!loud[w])continue;
    for(let k=Math.max(0,w-guard);k<=Math.min(windows-1,w+guard);k++)
      protectedWindow[k]=1;
  }
  const out=new Float32Array(audio.length);
  let gain=1, attenuated=0;
  // At most -11dB in truly quiet regions; 50ms fall / 80ms rise.
  const low=.28;
  const fall=1/(sampleRate*.05),rise=1/(sampleRate*.08);
  for(let i=0;i<audio.length;i++){
    const target=protectedWindow[Math.min(windows-1,Math.floor(i/block))]?1:low;
    gain=target>gain?Math.min(target,gain+rise):Math.max(target,gain-fall);
    out[i]=audio[i]!*gain;
    if(gain<.995)attenuated++;
  }
  const fraction=attenuated/audio.length;
  if(fraction<.025)return {audio,report:{...report,mode:'unchanged',attenuatedFraction:0}};
  return {audio:out,report:{...report,attenuatedFraction:fraction}};
}

/** Remote RE-USE is an optional user-owned HTTPS service, never automatic. */
export function reuseEndpoint(raw:string):URL {
  const url=new URL(raw.trim());
  if(url.protocol!=='https:'||url.username||url.password||url.hash||!url.hostname)
    throw new Error('送信先は認証情報を含まないHTTPS URLにしてください');
  const host=url.hostname.toLowerCase().replace(/^\[|\]$/g,'');
  if(host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')
    ||host==='0.0.0.0'||host==='127.0.0.1'||host.startsWith('127.')
    ||host==='::1'||host==='169.254.169.254'
    ||host.startsWith('10.')||host.startsWith('192.168.')
    ||/^172\.(1[6-9]|2\d|3[01])\./.test(host))
    throw new Error('公開HTTPSエンドポイントを指定してください');
  return url;
}
