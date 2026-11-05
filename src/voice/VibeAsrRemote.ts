import { parseVibeAsrSegments, type VibeAsrSegment } from './VibeDialogueAudit';

export const VIBE_ASR_WAV_MAX_BYTES = 12 * 1024 * 1024;
const MAX_RESULT_BYTES = 128 * 1024;

/** Only explicit user-owned HTTPS endpoints. No local/private networks. */
export function vibeAsrApiUrl(input:string): string {
  let u:URL;
  try {u=new URL(input.trim());} catch {throw new Error('ASRサーバーのHTTPS URLが不正です');}
  if(u.protocol!=='https:'||!u.hostname||u.username||u.password||u.search||u.hash)
    throw new Error('送信先には認証情報を含まないHTTPS URLが必要です');
  const host=u.hostname.toLowerCase().replace(/^\[|\]$/g,'');
  if(host==='localhost'||host==='0.0.0.0'||host==='::1'
    ||host.endsWith('.localhost')||host.endsWith('.local')
    ||/^127\./.test(host)||/^10\./.test(host)||/^192\.168\./.test(host)
    ||/^172\.(1[6-9]|2\d|3[01])\./.test(host)
    ||host==='169.254.169.254')
      throw new Error('公開HTTPSのASRサーバーを指定してください');
  const base=u.href.replace(/\/+$/,'');
  return base.endsWith('/api/vibe-asr')?base:base+'/api/vibe-asr';
}

export async function requestVibeAsr(
  endpoint:string,
  token:string,
  wav:Blob,
  audioDuration:number,
  signal:AbortSignal,
  onStatus:(message:string)=>void,
  hotwords:string,
):Promise<VibeAsrSegment[]> {
  const url=vibeAsrApiUrl(endpoint);
  if(token.trim().length<16)throw new Error('認証用の長いAPIトークンを入力してください');
  if(wav.size<44||wav.size>VIBE_ASR_WAV_MAX_BYTES)throw new Error('ASR音声は12MB以内にしてください');
  if(!Number.isFinite(audioDuration)||audioDuration<=0||audioDuration>120)
    throw new Error('ASR対象は120秒以内の会話音声です');
  if(Array.from(hotwords).length>160)throw new Error('専門用語は160文字以内にしてください');
  const form=new FormData();
  form.append('audio',wav,'sound-wave-dialogue.wav');
  form.append('hotwords',hotwords.trim());
  onStatus('VibeVoice-ASRへ会話WAVを送信中…');
  const response=await fetch(url,{
    method:'POST',cache:'no-store',credentials:'omit',mode:'cors',
    headers:{Authorization:`Bearer ${token.trim()}`},
    body:form,signal,
  });
  if(!response.ok)throw new Error(`ASRサーバー HTTP ${response.status}`);
  const ctype=response.headers.get('content-type')??'';
  if(!/application\/json/i.test(ctype))throw new Error('ASRサーバーはJSONで結果を返してください');
  if(Number(response.headers.get('content-length'))>MAX_RESULT_BYTES)
    throw new Error('ASRのJSON応答が大きすぎます');
  const reader=response.body?.getReader();
  let text:string;
  if(reader){
    const chunks:Uint8Array[]=[];let total=0;
    while(true){
      const next=await reader.read();
      if(next.done)break;
      total+=next.value.byteLength;
      if(total>MAX_RESULT_BYTES){await reader.cancel();throw new Error('ASR応答が大きすぎます');}
      chunks.push(next.value);
    }
    const bytes=new Uint8Array(total);let start=0;
    for(const part of chunks){bytes.set(part,start);start+=part.byteLength;}
    text=new TextDecoder().decode(bytes);
  }else{
    text=await response.text();
    if(text.length>MAX_RESULT_BYTES)throw new Error('ASR応答が大きすぎます');
  }
  if(signal.aborted)throw new Error('ASR認識が中断されました');
  return parseVibeAsrSegments(text,audioDuration);
}
