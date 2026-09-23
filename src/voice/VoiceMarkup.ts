import {
  finalizeVoiceUnits,
  parseVoiceScript,
  type VoiceScript,
  type VoiceUnit,
} from './VoiceScript';
import {
  validVoiceExpressionPreset,
  type VoiceExpressionSettings,
} from './VoiceExpression';

export interface VoiceMarkupScript extends VoiceScript {
  plainText: string;
  localExpressions: (VoiceExpressionSettings | null)[];
  markupUsed: boolean;
}

const TAG = /\[(\/)?([a-z]+)?(?::(\d{1,3}))?\]/gi;
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

function neutralizeSyntheticFinalBoundary(units: VoiceUnit[]): void {
  const final = units[units.length - 1];
  if (!final) return;
  if (final.boundaryAfter === 'sentence' && final.pauseAfter < 0.26) {
    final.boundaryAfter = 'none';
  }
}

export function parseVoiceMarkup(text: string): VoiceMarkupScript {
  const units: VoiceUnit[] = [];
  const localExpressions: (VoiceExpressionSettings | null)[] = [];
  const unsupported: string[] = [];
  const plainParts: string[] = [];
  const stack: VoiceExpressionSettings[] = [];
  let markupUsed = false;
  let cursor = 0;

  const appendSegment = (segment: string): void => {
    if (!segment) return;
    plainParts.push(segment);
    const parsed = parseVoiceScript(segment);
    neutralizeSyntheticFinalBoundary(parsed.units);

    const active = stack[stack.length - 1] ?? null;
    for (const unit of parsed.units) {
      units.push({
        ...unit,
        index: units.length,
      });
      localExpressions.push(active ? { ...active } : null);
    }
    unsupported.push(...parsed.unsupported);
  };

  for (const match of text.matchAll(TAG)) {
    const index = match.index ?? 0;
    const raw = match[0] ?? '';
    const closing = Boolean(match[1]);
    const rawName = (match[2] ?? '').toLowerCase();
    const rawIntensity = match[3];

    const recognizedClosing = closing && (rawName === '' || validVoiceExpressionPreset(rawName));
    const recognizedOpening = !closing && validVoiceExpressionPreset(rawName);
    if (!recognizedClosing && !recognizedOpening) continue;

    appendSegment(text.slice(cursor, index));
    markupUsed = true;
    cursor = index + raw.length;

    if (recognizedClosing) {
      if (stack.length > 0) stack.pop();
      continue;
    }

    const intensity = rawIntensity === undefined
      ? 1
      : clamp(Number(rawIntensity) / 100, 0, 1.35);
    stack.push({
      preset: rawName,
      intensity,
    });
  }

  appendSegment(text.slice(cursor));
  finalizeVoiceUnits(units);

  return {
    units,
    unsupported: [...new Set(unsupported)],
    plainText: plainParts.join(''),
    localExpressions,
    markupUsed,
  };
}

export function stripVoiceMarkup(text: string): string {
  return parseVoiceMarkup(text).plainText;
}

export function wrapVoiceSelection(
  text: string,
  start: number,
  end: number,
  expression: VoiceExpressionSettings,
): { text: string; selectionStart: number; selectionEnd: number } | null {
  if (end <= start) return null;
  const selected = text.slice(start, end);
  if (!selected.trim()) return null;

  const intensity = clamp(Math.round(expression.intensity * 100), 0, 135);
  const suffix = intensity === 100 ? '' : `:${intensity}`;
  const open = `[${expression.preset}${suffix}]`;
  const close = '[/]';
  const replacement = open + selected + close;

  return {
    text: text.slice(0, start) + replacement + text.slice(end),
    selectionStart: start + open.length,
    selectionEnd: start + open.length + selected.length,
  };
}

export function removeVoiceMarkup(text: string): string {
  return text.replace(TAG, (raw, closing, name) => {
    const normalized = typeof name === 'string' ? name.toLowerCase() : '';
    const recognized = closing
      ? normalized === '' || validVoiceExpressionPreset(normalized)
      : validVoiceExpressionPreset(normalized);
    return recognized ? '' : raw;
  });
}
