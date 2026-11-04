import { describe, expect, it } from 'vitest';
import {
  isMingWav, mingTtsEndpoint, validateMingJapaneseRequest,
  MING_TTS_REFERENCE_LIMIT_BYTES, MING_TTS_OUTPUT_LIMIT_BYTES,
} from '../src/voice/MingTtsReference';

const tinyWav = ():File => new File([new Uint8Array(44)],'sample.wav',{type:'audio/wav'});
function input() {
  return {
    endpoint:'https://tts.example.com',
    token:'a-random-secret-token-of-adequate-length',
    variant:'0.5b' as const,
    text:'今日はいい天気ですね。',
    promptText:'この声を使用して日本語を読みます。',
    promptWav:tinyWav(),
  };
}
describe('Ming-3.0 Japanese opt-in GPU benchmark', () => {
  it('always uses a dedicated HTTPS endpoint',()=>{
    expect(mingTtsEndpoint('https://tts.example.com')).toBe('https://tts.example.com/api/ming-tts');
    expect(mingTtsEndpoint('https://tts.example.com/api/ming-tts')).toBe('https://tts.example.com/api/ming-tts');
  });
  it('refuses credentials, private endpoints and insecure origins',()=>{
    for(const url of [
      'http://tts.example.com',
      'https://tts.example.com#anything',
      'https://username:secret@tts.example.com',
      'https://localhost:7872',
      'https://127.0.0.1',
      'https://10.0.1.1',
      'https://172.16.5.1',
      'https://192.168.4.1',
      'https://tts.example.com?token=bad',
    ]) expect(()=>mingTtsEndpoint(url)).toThrow();
  });
  it('requires an explicit authorized voice reference WAV and its transcript',()=>{
    expect(()=>validateMingJapaneseRequest(input())).not.toThrow();
    expect(()=>validateMingJapaneseRequest({...input(),promptText:'  '})).toThrow();
    expect(()=>validateMingJapaneseRequest({...input(),text:' '})).toThrow();
    expect(()=>validateMingJapaneseRequest({...input(),text:'あ'.repeat(421)})).toThrow();
    expect(()=>validateMingJapaneseRequest({...input(),token:' '})).toThrow();
    expect(()=>validateMingJapaneseRequest({...input(),variant:'unrecognized' as '0.5b'})).toThrow();
    expect(()=>validateMingJapaneseRequest({...input(),promptWav:new File(['a'],'ref.mp3')})).toThrow();
    expect(MING_TTS_REFERENCE_LIMIT_BYTES).toBeLessThan(MING_TTS_OUTPUT_LIMIT_BYTES);
  });
  it('rejects malformed response regardless of HTTP content type',()=>{
    const correct = new Uint8Array(44);
    for(const [pos,word] of [[0,'RIFF'],[8,'WAVE']] as const)
      [...word].forEach((c,i)=>correct[pos+i]=c.charCodeAt(0));
    expect(isMingWav(correct)).toBe(true);
    expect(isMingWav(new Uint8Array(44))).toBe(false);
    expect(isMingWav(new Uint8Array(7))).toBe(false);
  });
});
