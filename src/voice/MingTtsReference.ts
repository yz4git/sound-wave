/** Optional Ming-3.0-TTS Japanese evaluation adapter.
 * The REAL model runs on a user-owned NVIDIA GPU service, not in iPhone Safari.
 * Japanese multilingual synthesis requires a matching voice reference and transcript.
 * No microphone access and no automatic network upload.
 */
export type MingTtsVariant = '0.5b' | 'tiny';
export interface MingJapaneseRequest {
  endpoint: string;
  token: string;
  variant: MingTtsVariant;
  text: string;
  promptText: string;
  promptWav: File;
}
export const MING_TTS_REFERENCE_LIMIT_BYTES = 8 * 1024 * 1024;
export const MING_TTS_OUTPUT_LIMIT_BYTES = 12 * 1024 * 1024;
export const MING_TTS_MAX_TEXT = 420;

export function mingTtsEndpoint(raw: string): string {
  let url: URL;
  try { url = new URL(raw.trim()); } catch { throw new Error('Ming GPUのHTTPS URLを入力してください'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search)
    throw new Error('Ming GPUには認証情報・クエリを含まないHTTPS URLが必要です');
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.local') || host.endsWith('.localhost')
      || host === '0.0.0.0' || host === '::1' || /^127\./.test(host)
      || /^10\./.test(host) || /^192\.168\./.test(host)
      || /^172\.(1[6-9]|2\d|3[01])\./.test(host)
      || host === '169.254.169.254')
    throw new Error('公開HTTPSのGPUサーバーを指定してください');
  const base = url.href.replace(/\/+$/, '');
  return base.endsWith('/api/ming-tts') ? base : base + '/api/ming-tts';
}
export function validateMingJapaneseRequest(request: MingJapaneseRequest): void {
  mingTtsEndpoint(request.endpoint);
  if (!request.token.trim() || request.token.length < 16) throw new Error('GPUサーバー用のAPIトークンが必要です');
  if (request.variant !== '0.5b' && request.variant !== 'tiny') throw new Error('未知のMingモデルです');
  if (!request.text.trim() || Array.from(request.text).length > MING_TTS_MAX_TEXT)
    throw new Error('文章は1〜420文字以内にしてください');
  if (!request.promptText.trim() || Array.from(request.promptText).length > 420)
    throw new Error('参照音声と一致する書き起こしを1〜420文字で入力してください');
  if (request.promptWav.size < 44 || request.promptWav.size > MING_TTS_REFERENCE_LIMIT_BYTES)
    throw new Error('参照WAVファイルは8MB以内にしてください');
  if (!/\.wav$/i.test(request.promptWav.name))
    throw new Error('参照音声はWAVファイルを使用してください');
}
export function isMingWav(bytes: Uint8Array): boolean {
  if (bytes.length < 44) return false;
  const ascii = (from: number, value: string) =>
    [...value].every((c, index) => bytes[from + index] === c.charCodeAt(0));
  return ascii(0, 'RIFF') && ascii(8, 'WAVE');
}
export async function generateMingJapanese(
  request: MingJapaneseRequest,
  signal: AbortSignal,
  onStatus: (status: string) => void,
): Promise<Blob> {
  validateMingJapaneseRequest(request);
  const form = new FormData();
  form.append('text', request.text.trim());
  form.append('prompt_text', request.promptText.trim());
  form.append('variant', request.variant);
  form.append('audio', request.promptWav, 'reference.wav');
  onStatus('MING · 参照WAVを指定GPUサーバーに送信中（手動実行）…');
  const response = await fetch(mingTtsEndpoint(request.endpoint), {
    method: 'POST', mode: 'cors', credentials: 'omit', cache: 'no-store',
    headers: { Authorization: `Bearer ${request.token}` },
    body: form, signal,
  });
  if (!response.ok) throw new Error(`Ming GPUサーバー HTTP ${response.status}`);
  const type = response.headers.get('content-type') ?? '';
  if (!/^(audio\/(wav|x-wav|wave)|application\/octet-stream)/i.test(type))
    throw new Error('Ming GPUからWAV音声が返されませんでした');
  const max = MING_TTS_OUTPUT_LIMIT_BYTES;
  if (Number(response.headers.get('content-length')) > max)
    throw new Error('Mingの出力WAVが12MBを超えています');
  const reader = response.body?.getReader();
  let bytes: Uint8Array;
  if (reader) {
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.length;
      if (length > max) { await reader.cancel(); throw new Error('出力WAVが12MBを超えています'); }
      chunks.push(next.value);
    }
    bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  } else {
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > max) throw new Error('出力WAVが12MBを超えています');
    bytes = new Uint8Array(buffer);
  }
  if (signal.aborted) throw new Error('比較処理が中断されました');
  if (!isMingWav(bytes)) throw new Error('GPUから正しいWAVが返されませんでした');
  return new Blob([bytes], { type: 'audio/wav' });
}
