/**
 * Independent, advisory signal-health checks inspired by VoiceStudio's
 * output QA. Never claims to measure speech naturalness or accent.
 * Does not modify a single sample of the take.
 */
export type VoiceSignalWarningKind = 'silence' | 'clipping' | 'low-volume' | 'dc-offset' | 'volume-jump' | 'invalid';
export interface VoiceSignalWarning { kind: VoiceSignalWarningKind; timeSeconds: number; message: string }
export interface VoiceSignalReport {
  durationSeconds: number;
  peakDbfs: number;
  rmsDbfs: number;
  clippedSamples: number;
  warnings: VoiceSignalWarning[];
}
const safeDb = (amplitude: number) => amplitude > 1e-10 ? 20 * Math.log10(amplitude) : -120;

export function inspectVoiceSignal(pcm: Float32Array, sampleRate: number): VoiceSignalReport {
  if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 192000)
    throw new Error('Invalid audio sample rate');
  const durationSeconds=pcm.length/sampleRate;
  const warnings: VoiceSignalWarning[]=[];
  if (!pcm.length) {
    warnings.push({kind:'invalid',timeSeconds:0,message:'音声データが空です'});
    return {durationSeconds,peakDbfs:-120,rmsDbfs:-120,clippedSamples:0,warnings};
  }
  const add=(kind:VoiceSignalWarningKind,timeSeconds:number,message:string)=>{
    if(warnings.length<12)warnings.push({kind,timeSeconds:Math.max(0,timeSeconds),message});
  };
  let peak=0, sum=0, sumSq=0, clippedSamples=0, invalid=0;
  // Sample statistics in one O(n) pass; no copies or allocations per sample.
  for(let i=0;i<pcm.length;i++){
    const sample=pcm[i]!;
    if(!Number.isFinite(sample)){invalid++;continue;}
    const abs=Math.abs(sample);peak=Math.max(peak,abs);
    sum+=sample;sumSq+=sample*sample;
    if(abs>=0.985)clippedSamples++;
  }
  const rms=Math.sqrt(sumSq/pcm.length);
  if(invalid>0)add('invalid',0,`不正なサンプル ${invalid}個を検出`);
  if(clippedSamples>sampleRate*.002)add('clipping',0,`ピーク付近に張り付くサンプル ${clippedSamples}個（クリッピングの可能性）`);
  if(rms<0.006)add('low-volume',0,'全体の音量が非常に小さい可能性があります');
  const mean=sum/pcm.length;
  if(Math.abs(mean)>0.025)add('dc-offset',0,'波形にDCオフセットがある可能性があります');
  // 100 ms short-term windows. Only compare voiced regions; vowels, quiet
  // consonants and normal punctuation must not trigger nuisance alerts.
  const size=Math.max(1,Math.round(sampleRate*.1));
  let lastLoud=NaN, lastTime=0, bigChanges=0;
  let silenceSamples=0, silenceStarted=0, priorSilence=0;
  for(let start=0;start<pcm.length;start+=size){
    const end=Math.min(start+size,pcm.length);
    let power=0;
    for(let i=start;i<end;i++){const v=pcm[i]!;if(Number.isFinite(v))power+=v*v;}
    const windowRms=Math.sqrt(power/(end-start));
    if(windowRms<.008) {
      if(!silenceSamples)silenceStarted=start;
      silenceSamples+=end-start;
    } else {
      if(silenceSamples>=sampleRate*.72&&silenceStarted>sampleRate*.15){
        add('silence',silenceStarted/sampleRate,`長い無音 ${(silenceSamples/sampleRate).toFixed(2)}秒`);
      }
      priorSilence=silenceSamples;
      silenceSamples=0;
      const loud=safeDb(windowRms);
      if(Number.isFinite(lastLoud)&&priorSilence<sampleRate*.12&&Math.abs(loud-lastLoud)>19){
        bigChanges++;
        if(bigChanges===2)add('volume-jump',start/sampleRate,'短い時間で音量差が大きく変化しています（要聴感確認）');
      } else if(bigChanges>0)bigChanges--;
      lastLoud=loud;lastTime=start/sampleRate;
    }
  }
  if(silenceSamples>=sampleRate*.72)add('silence',silenceStarted/sampleRate,`末尾の無音 ${(silenceSamples/sampleRate).toFixed(2)}秒`);
  void lastTime;
  return {durationSeconds,peakDbfs:safeDb(peak),rmsDbfs:safeDb(rms),clippedSamples,warnings};
}
