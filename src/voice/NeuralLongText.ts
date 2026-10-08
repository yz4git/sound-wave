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
    if (!sentenceStop && c !== '\\n') continue;
    let end = i + 1;
    if (sentenceStop) {
      while (end < text.length && /[。！？!?」』）】］]/u.test(text[end]!)) end++;
    }
    const part = text.slice(start, end).trim();
    if (part) result.push(part);
    start = end;
    i = end - 1;
  }
  const last = text.slice(start).trim();
  if (last) result.push(last);
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
      else if (/\\s/u.test(previous)) priority = 2;
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
    const chunk = chars.slice(0, cut).join('').trim();
    if (chunk) chunks.push(chunk);
    rest = chars.slice(cut).join('').trimStart();
  }
  if (rest.trim()) chunks.push(rest.trim());
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
  const out: string[] = [];
  let current = '';
  for (const piece of pieces) {
    const parts = Array.from(piece).length > maxChars
      ? splitLongSentence(piece, maxChars)
      : [piece];
    for (const item of parts) {
      const joined = current ? current + item : item;
      if (Array.from(joined).length > maxChars && current) {
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
