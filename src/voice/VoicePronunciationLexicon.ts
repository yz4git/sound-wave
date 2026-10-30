/**
 * Lightweight, user-authored Japanese pronunciation lexicon inspired by
 * VoiceStudio's lexicon workflow. Independently implemented: no AGPL code.
 *
 * Applies to text sent to Kokoro (not the original text/UI/ASR reference),
 * so transcription comparisons retain the words the author actually typed.
 */
import type { NeuralProsodyPlan } from './NeuralVoice';
import { splitLongNeuralText, NEURAL_MAX_UNEDITED_CHARS } from './NeuralLongText';

export const VOICE_LEXICON_STORAGE_KEY = 'sound-wave-voice-pronunciation-v1';
export const VOICE_LEXICON_LIMIT = 48;
export interface VoicePronunciationEntry { word: string; reading: string }

const WORD_MAX = 40;
const READING_MAX = 80;
const KANA_ONLY = /^[\u3040-\u309f\u30a0-\u30ff\u31f0-\u31ff\u30fc\u30fb\s]+$/u;

export function normalizedPronunciationEntry(word: string, reading: string): VoicePronunciationEntry | null {
  const key = word.normalize('NFKC').trim();
  const pronounce = reading.normalize('NFKC').trim();
  if (!key || !pronounce || key.length > WORD_MAX || pronounce.length > READING_MAX) return null;
  if (/[\p{Cc}\p{Cf}\[\]<>]/u.test(key) || !KANA_ONLY.test(pronounce)) return null;
  if (!/[\p{L}\p{N}]/u.test(key)) return null;
  return { word: key, reading: pronounce };
}

export function parsePronunciationLexicon(input: unknown): VoicePronunciationEntry[] {
  if (!Array.isArray(input)) return [];
  const output: VoicePronunciationEntry[] = [];
  for (const item of input.slice(0, VOICE_LEXICON_LIMIT * 3)) {
    if (!item || typeof item !== 'object') continue;
    const data = item as Record<string, unknown>;
    if (typeof data.word !== 'string' || typeof data.reading !== 'string') continue;
    const entry = normalizedPronunciationEntry(data.word, data.reading);
    if (!entry) continue;
    const found = output.findIndex((other) => other.word.toLowerCase() === entry.word.toLowerCase());
    if (found >= 0) output[found] = entry;
    else if (output.length < VOICE_LEXICON_LIMIT) output.push(entry);
  }
  return output;
}

export function addPronunciationEntry(
  current: readonly VoicePronunciationEntry[],
  word: string,
  reading: string,
): VoicePronunciationEntry[] {
  const entry = normalizedPronunciationEntry(word, reading);
  if (!entry) throw new Error('単語は40文字以内、読みは80文字以内のひらがな・カタカナにしてください。');
  const next = current.filter((other) => other.word.toLowerCase() !== entry.word.toLowerCase());
  if (next.length >= VOICE_LEXICON_LIMIT) throw new Error('発音辞書は48件までです。');
  return [...next, entry];
}

function isLatinOrDigit(c: string | undefined): boolean {
  return Boolean(c && /[A-Za-z0-9]/u.test(c));
}
export interface PronunciationApplication { text: string; replacements: number; matchedWords: string[] }

/** Longest-match wins. Do not cascade: a replacement is never searched again.
 * A Latin/number term is matched as a complete word, not inside a longer ID.
 */
export function applyPronunciationLexicon(
  rawText: string,
  entries: readonly VoicePronunciationEntry[],
): PronunciationApplication {
  if (entries.length === 0 || !rawText) return { text: rawText, replacements: 0, matchedWords: [] };
  const sorted = [...entries]
    .filter((item) => normalizedPronunciationEntry(item.word, item.reading) !== null)
    .sort((a, b) => b.word.length - a.word.length || a.word.localeCompare(b.word, 'ja'));
  let i = 0, output = '', replacements = 0;
  const matchedWords = new Set<string>();
  while (i < rawText.length) {
    let found: VoicePronunciationEntry | undefined;
    for (const entry of sorted) {
      const candidate = rawText.slice(i, i + entry.word.length);
      if (candidate.length !== entry.word.length || candidate.toLowerCase() !== entry.word.toLowerCase()) continue;
      const startsLatin = isLatinOrDigit(entry.word[0]);
      const endsLatin = isLatinOrDigit(entry.word[entry.word.length - 1]);
      if (startsLatin && isLatinOrDigit(rawText[i - 1])) continue;
      if (endsLatin && isLatinOrDigit(rawText[i + entry.word.length])) continue;
      found = entry;
      break;
    }
    if (found) {
      output += found.reading;
      matchedWords.add(found.word);
      replacements++;
      i += found.word.length;
    } else {
      const point = rawText.codePointAt(i)!;
      const c = String.fromCodePoint(point);
      output += c;
      i += c.length;
    }
  }
  return { text: output, replacements, matchedWords: [...matchedWords] };
}

export function lexiconFromStorage(storage: Pick<Storage, 'getItem'>): VoicePronunciationEntry[] {
  try { return parsePronunciationLexicon(JSON.parse(storage.getItem(VOICE_LEXICON_STORAGE_KEY) || '[]')); }
  catch { return []; }
}

export function storePronunciationLexicon(storage: Pick<Storage, 'setItem'>, data: readonly VoicePronunciationEntry[]): void {
  storage.setItem(VOICE_LEXICON_STORAGE_KEY, JSON.stringify(parsePronunciationLexicon(data)));
}

/**
 * Transform only the Kokoro inference plan. VoiceStudio-inspired reading edits
 * must not change the human-readable source text or the editor unit offsets.
 * A longer kana pronunciation can expand a previously safe chunk beyond the
 * model input limit, so split only those expanded segments at sentence/word
 * boundaries. Preserve the original pause at the *last* subchunk.
 */
export function applyLexiconToNeuralPlan(
  plan: NeuralProsodyPlan,
  dictionary: readonly VoicePronunciationEntry[],
): NeuralProsodyPlan {
  if (!dictionary.length) return plan;
  let changed = false;
  const segments = plan.segments.flatMap((segment) => {
    const converted = applyPronunciationLexicon(segment.text, dictionary);
    if (!converted.replacements) return [segment];
    changed = true;
    const portions = Array.from(converted.text).length > NEURAL_MAX_UNEDITED_CHARS
      ? splitLongNeuralText(converted.text)
      : [converted.text];
    return portions.map((text, index) => ({
      ...segment,
      text,
      pauseAfter: index === portions.length - 1 ? segment.pauseAfter : 0,
    }));
  });
  return changed ? { ...plan, segments } : plan;
}
