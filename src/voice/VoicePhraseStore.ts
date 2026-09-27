import { voiceProsodyKey } from './VoiceProsodyStore';
import type {
  VoicePhraseBoundaryOverride,
  VoicePhraseShapeOverride,
} from './VoicePhraseEditor';

const STORAGE_KEY = 'sound-wave-voice-phrase-edits-v1';
const MAX_ENTRIES = 12;

interface VoicePhraseEntry {
  key: string;
  boundaries: VoicePhraseBoundaryOverride[];
  shapes: VoicePhraseShapeOverride[];
  updatedAt: number;
}

interface VoicePhraseStoreData {
  version: 1;
  entries: VoicePhraseEntry[];
}

function readStore(storage: Storage): VoicePhraseStoreData {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return { version: 1, entries: [] };
    const parsed = JSON.parse(raw) as Partial<VoicePhraseStoreData>;
    if (parsed.version !== 1 || !Array.isArray(parsed.entries)) {
      return { version: 1, entries: [] };
    }
    return {
      version: 1,
      entries: parsed.entries.filter((entry): entry is VoicePhraseEntry => (
        typeof entry?.key === 'string'
        && Array.isArray(entry.boundaries)
        && Array.isArray(entry.shapes)
        && typeof entry.updatedAt === 'number'
      )),
    };
  } catch {
    return { version: 1, entries: [] };
  }
}

function sanitizeBoundary(
  value: VoicePhraseBoundaryOverride,
): VoicePhraseBoundaryOverride | null {
  const after = Math.floor(Number(value.after));
  if (!Number.isFinite(after) || after < 0) return null;
  const boundary = value.boundary === 'accent' ? 'accent' : 'none';
  const rawPause = value.pauseSeconds;
  const pauseSeconds = rawPause === null
    ? null
    : Math.max(0, Math.min(0.36, Number(rawPause)));
  if (pauseSeconds !== null && !Number.isFinite(pauseSeconds)) return null;
  return { after, boundary, pauseSeconds };
}

function sanitizeShape(
  value: VoicePhraseShapeOverride,
): VoicePhraseShapeOverride | null {
  const start = Math.floor(Number(value.start));
  const end = Math.floor(Number(value.end));
  const pitchOffset = Math.max(-3, Math.min(3, Number(value.pitchOffset)));
  const rateScale = Math.max(0.72, Math.min(1.35, Number(value.rateScale)));
  const rawEnergy = Number(value.energyScale ?? 1);
  const rawEmphasis = Number(value.emphasis ?? 0);
  const rawCurveStart = Number(value.curveStart ?? 0);
  const rawCurvePeak = Number(value.curvePeak ?? 0);
  const rawCurveEnd = Number(value.curveEnd ?? 0);
  const energyScale = Math.max(0.65, Math.min(1.45, rawEnergy));
  const emphasis = Math.max(0, Math.min(1.5, rawEmphasis));
  const curveStart = Math.max(-2.5, Math.min(2.5, rawCurveStart));
  const curvePeak = Math.max(-2.5, Math.min(2.5, rawCurvePeak));
  const curveEnd = Math.max(-2.5, Math.min(2.5, rawCurveEnd));
  if (
    !Number.isFinite(start) || !Number.isFinite(end)
    || !Number.isFinite(pitchOffset) || !Number.isFinite(rateScale)
    || !Number.isFinite(energyScale) || !Number.isFinite(emphasis)
    || !Number.isFinite(curveStart) || !Number.isFinite(curvePeak) || !Number.isFinite(curveEnd)
    || start < 0 || end < start
  ) return null;
  return {
    start,
    end,
    pitchOffset,
    rateScale,
    energyScale,
    emphasis,
    curveStart,
    curvePeak,
    curveEnd,
  };
}

export function loadVoicePhraseEdits(
  storage: Storage,
  text: string,
): {
  boundaries: VoicePhraseBoundaryOverride[];
  shapes: VoicePhraseShapeOverride[];
} {
  const key = voiceProsodyKey(text);
  const entry = readStore(storage).entries.find((candidate) => candidate.key === key);
  if (!entry) return { boundaries: [], shapes: [] };

  return {
    boundaries: entry.boundaries
      .map(sanitizeBoundary)
      .filter((value): value is VoicePhraseBoundaryOverride => value !== null),
    shapes: entry.shapes
      .map(sanitizeShape)
      .filter((value): value is VoicePhraseShapeOverride => value !== null),
  };
}

export function saveVoicePhraseEdits(
  storage: Storage,
  text: string,
  boundaries: readonly VoicePhraseBoundaryOverride[],
  shapes: readonly VoicePhraseShapeOverride[],
  now = Date.now(),
): void {
  const key = voiceProsodyKey(text);
  const data = readStore(storage);
  const entries = data.entries.filter((entry) => entry.key !== key);
  const safeBoundaries = boundaries
    .map(sanitizeBoundary)
    .filter((value): value is VoicePhraseBoundaryOverride => value !== null);
  const safeShapes = shapes
    .map(sanitizeShape)
    .filter((value): value is VoicePhraseShapeOverride => value !== null);

  if (safeBoundaries.length > 0 || safeShapes.length > 0) {
    entries.unshift({
      key,
      boundaries: safeBoundaries,
      shapes: safeShapes,
      updatedAt: now,
    });
  }

  entries.sort((a, b) => b.updatedAt - a.updatedAt);
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({
      version: 1,
      entries: entries.slice(0, MAX_ENTRIES),
    } satisfies VoicePhraseStoreData));
  } catch {
    // Restricted storage: keep edits for the current session only.
  }
}

export function clearVoicePhraseEdits(storage: Storage, text: string): void {
  saveVoicePhraseEdits(storage, text, [], []);
}

export const VOICE_PHRASE_STORAGE_KEY = STORAGE_KEY;
