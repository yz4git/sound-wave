/**
 * Keep Kokoro's native whole-sentence prosody for ordinary text. Exceptionally
 * long unedited text must be split because kokoro-js tokenizes with
 * truncation:true and can silently omit speech beyond 510 tokens.
 *
 * Split only when total text exceeds the conservative 112 code-point target.
 * Prefer true sentence boundaries; then commas, whitespace, and Intl.Segmenter
 * Japanese word boundaries. Never inject synthetic punctuation.
 */
export const NEURAL_MAX_UNEDITED_CHARS = 112;

function boundaries(text: string): string[] {
  const result: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]!;
    const sentenceStop = /[。！？!?]/u.test(c);
    if (!sentenceStop && c !== '\n') continue;
    let end = i + 1;
    if (sentenceStop) {
      while (end < text.length && /[。！？!?」』）】］]/u.test(text[end]!)) end++;
    }
    const part = text.slice(start, end);
    if (part.trim()) result.push(part);
    else if (result.length > 0) result[result.length - 1] += part;
    start = end;
    i = end - 1;
  }
  const last = text.slice(start);
  if (last.trim()) result.push(last);
  else if (last && result.length > 0) result[result.length - 1] += last;
  return result;
}

function splitLongSentence(sentence: string, maxChars: number): string[] {
  let rest = sentence;
  const chunks: string[] = [];
  while (Array.from(rest).length > maxChars) {
    const chars = Array.from(rest);
    const ideal = Math.ceil(chars.length / Math.ceil(chars.length / maxChars));
    const minBoundary = Math.min(Math.max(12, Math.floor(ideal * 0.55)), ideal);
    const maxBoundary = Math.min(maxChars, chars.length - 1);
    const candidates: { index: number; priority: number }[] = [];
    for (let i = minBoundary; i <= maxBoundary; i += 1) {
      const previous = chars[i - 1] ?? '';
      let priority = 0;
      if (/[。！？!?]/u.test(previous)) priority = 4;
      else if (/[、,，;；:：]/u.test(previous)) priority = 3;
      else if (/\s/u.test(previous)) priority = 2;
      if (priority > 0) candidates.push({ index: i, priority });
    }

    // JS Intl.Segmenter is available on modern iOS Safari, but is not
    // required for the app to work on unsupported browsers.
    if (candidates.length === 0 && typeof Intl.Segmenter === 'function') {
      const joined = chars.join('');
      const segmenter = new Intl.Segmenter('ja', { granularity: 'word' });
      for (const part of segmenter.segment(joined)) {
        const index = Array.from(joined.slice(0, part.index)).length;
        if (index >= minBoundary && index <= maxBoundary) {
          candidates.push({ index, priority: 1 });
        }
      }
    }
    candidates.sort((a, b) => b.priority - a.priority
      || Math.abs(a.index - ideal) - Math.abs(b.index - ideal));
    const cut = candidates[0]?.index ?? Math.min(maxBoundary, ideal);
    const chunk = chars.slice(0, cut).join('');
    if (chunk.trim()) chunks.push(chunk);
    else if (chunks.length > 0) chunks[chunks.length - 1] += chunk;
    rest = chars.slice(cut).join('');
  }
  if (rest.trim()) chunks.push(rest);
  else if (rest && chunks.length > 0) chunks[chunks.length - 1] += rest;
  return chunks;
}

export function splitLongNeuralText(
  text: string,
  maxChars = NEURAL_MAX_UNEDITED_CHARS,
): string[] {
  if (!Number.isFinite(maxChars) || maxChars < 32) {
    throw new RangeError('Neural chunk size must be at least 32 characters.');
  }
  const raw = text.trim();
  if (!raw) return [];
  if (Array.from(raw).length <= maxChars) return [raw];

  const pieces = boundaries(raw);
  // For long passages, hear the first natural sentence sooner instead of
  // waiting for a full ~112-character inference pass. A single sentence
  // longer than this target is kept intact up to maxChars.
  const firstAudioTarget = Math.min(maxChars, 56);
  const out: string[] = [];
  let current = '';
  for (const piece of pieces) {
    const parts = Array.from(piece).length > maxChars
      ? splitLongSentence(piece, maxChars)
      : [piece];
    for (const item of parts) {
      const joined = current ? current + item : item;
      const currentLimit = out.length === 0 ? firstAudioTarget : maxChars;
      if (current && Array.from(joined).length > currentLimit) {
        out.push(current);
        current = item;
      } else {
        current = joined;
      }
    }
  }
  if (current) out.push(current);
  return out;
}
