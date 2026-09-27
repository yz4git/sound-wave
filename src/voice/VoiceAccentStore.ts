import { voiceProsodyKey } from './VoiceProsodyStore';

const STORAGE_KEY = 'sound-wave-voice-accent-edits-v1';
const MAX_ENTRIES = 12;

export interface VoiceAccentOverride {
  start: number;
  end: number;
  nucleus: number;
}

interface VoiceAccentEntry {
  key: string;
  overrides: VoiceAccentOverride[];
  updatedAt: number;
}

interface VoiceAccentStoreData {
  version: 1;
  entries: VoiceAccentEntry[];
}

function readStore(storage: Storage): VoiceAccentStoreData {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return { version: 1, entries: [] };
    const parsed = JSON.parse(raw) as Partial<VoiceAccentStoreData>;
    if (parsed.version !== 1 || !Array.isArray(parsed.entries)) {
      return { version: 1, entries: [] };
    }
    return {
      version: 1,
      entries: parsed.entries.filter((entry): entry is VoiceAccentEntry => (
        typeof entry?.key === 'string'
        && typeof entry.updatedAt === 'number'
        && Array.isArray(entry.overrides)
      )),
    };
  } catch {
    return { version: 1, entries: [] };
  }
}

function sanitizeOverride(value: VoiceAccentOverride): VoiceAccentOverride | null {
  const start = Math.floor(Number(value.start));
  const end = Math.floor(Number(value.end));
  const nucleus = Math.floor(Number(value.nucleus));
  if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(nucleus)) return null;
  if (start < 0 || end < start) return null;
  return {
    start,
    end,
    nucleus: Math.max(0, Math.min(end - start + 1, nucleus)),
  };
}

export function loadVoiceAccentOverrides(
  storage: Storage,
  text: string,
): VoiceAccentOverride[] {
  const key = voiceProsodyKey(text);
  const entry = readStore(storage).entries.find((candidate) => candidate.key === key);
  if (!entry) return [];
  return entry.overrides
    .map(sanitizeOverride)
    .filter((value): value is VoiceAccentOverride => value !== null);
}

export function saveVoiceAccentOverrides(
  storage: Storage,
  text: string,
  overrides: readonly VoiceAccentOverride[],
  now = Date.now(),
): void {
  const key = voiceProsodyKey(text);
  const data = readStore(storage);
  const entries = data.entries.filter((entry) => entry.key !== key);
  const sanitized = overrides
    .map(sanitizeOverride)
    .filter((value): value is VoiceAccentOverride => value !== null);

  if (sanitized.length > 0) {
    entries.unshift({ key, overrides: sanitized, updatedAt: now });
  }

  entries.sort((a, b) => b.updatedAt - a.updatedAt);
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({
      version: 1,
      entries: entries.slice(0, MAX_ENTRIES),
    } satisfies VoiceAccentStoreData));
  } catch {
    // Editing remains available for the current session.
  }
}

export function clearVoiceAccentOverrides(storage: Storage, text: string): void {
  saveVoiceAccentOverrides(storage, text, []);
}

export const VOICE_ACCENT_STORAGE_KEY = STORAGE_KEY;
