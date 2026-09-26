const STORAGE_KEY = 'sound-wave-voice-prosody-edits-v1';
const MAX_ENTRIES = 12;

export interface VoiceProsodySnapshot {
  key: string;
  unitCount: number;
  pitch: number[];
  energy: number[];
  duration: number[];
  updatedAt: number;
}

interface VoiceProsodyStoreData {
  version: 1;
  entries: VoiceProsodySnapshot[];
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

function hashText(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export function voiceProsodyKey(text: string): string {
  const normalized = text.normalize('NFC');
  return `${normalized.length}:${hashText(normalized)}`;
}

function readStore(storage: Storage): VoiceProsodyStoreData {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return { version: 1, entries: [] };
    const parsed = JSON.parse(raw) as Partial<VoiceProsodyStoreData>;
    if (parsed.version !== 1 || !Array.isArray(parsed.entries)) {
      return { version: 1, entries: [] };
    }
    return {
      version: 1,
      entries: parsed.entries.filter((entry): entry is VoiceProsodySnapshot => (
        typeof entry?.key === 'string'
        && Number.isInteger(entry.unitCount)
        && Array.isArray(entry.pitch)
        && Array.isArray(entry.energy)
        && Array.isArray(entry.duration)
        && typeof entry.updatedAt === 'number'
      )),
    };
  } catch {
    return { version: 1, entries: [] };
  }
}

function sanitizeArray(
  source: readonly number[],
  count: number,
  fallback: number,
  min: number,
  max: number,
): number[] {
  const result = new Array<number>(count).fill(fallback);
  for (let index = 0; index < count; index += 1) {
    const value = Number(source[index]);
    result[index] = Number.isFinite(value) ? clamp(value, min, max) : fallback;
  }
  return result;
}

export function hasMeaningfulProsodyEdits(
  pitch: readonly number[],
  energy: readonly number[],
  duration: readonly number[],
): boolean {
  const count = Math.max(pitch.length, energy.length, duration.length);
  for (let index = 0; index < count; index += 1) {
    if (Math.abs((pitch[index] ?? 0)) > 0.001) return true;
    if (Math.abs((energy[index] ?? 1) - 1) > 0.001) return true;
    if (Math.abs((duration[index] ?? 1) - 1) > 0.001) return true;
  }
  return false;
}

export function loadVoiceProsodySnapshot(
  storage: Storage,
  text: string,
  unitCount: number,
): VoiceProsodySnapshot | null {
  const key = voiceProsodyKey(text);
  const entry = readStore(storage).entries.find((candidate) => (
    candidate.key === key && candidate.unitCount === unitCount
  ));
  if (!entry) return null;

  return {
    key,
    unitCount,
    pitch: sanitizeArray(entry.pitch, unitCount, 0, -3, 3),
    energy: sanitizeArray(entry.energy, unitCount, 1, 0.45, 1.55),
    duration: sanitizeArray(entry.duration, unitCount, 1, 0.6, 1.65),
    updatedAt: entry.updatedAt,
  };
}

export function saveVoiceProsodySnapshot(
  storage: Storage,
  text: string,
  unitCount: number,
  pitch: readonly number[],
  energy: readonly number[],
  duration: readonly number[],
  now = Date.now(),
): void {
  const key = voiceProsodyKey(text);
  const data = readStore(storage);
  const entries = data.entries.filter((entry) => entry.key !== key);

  if (hasMeaningfulProsodyEdits(pitch, energy, duration)) {
    entries.unshift({
      key,
      unitCount,
      pitch: sanitizeArray(pitch, unitCount, 0, -3, 3),
      energy: sanitizeArray(energy, unitCount, 1, 0.45, 1.55),
      duration: sanitizeArray(duration, unitCount, 1, 0.6, 1.65),
      updatedAt: now,
    });
  }

  entries.sort((a, b) => b.updatedAt - a.updatedAt);
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({
      version: 1,
      entries: entries.slice(0, MAX_ENTRIES),
    } satisfies VoiceProsodyStoreData));
  } catch {
    // Storage may be unavailable or full. Editing still works for this session.
  }
}

export function clearVoiceProsodySnapshot(storage: Storage, text: string): void {
  const key = voiceProsodyKey(text);
  const data = readStore(storage);
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({
      version: 1,
      entries: data.entries.filter((entry) => entry.key !== key),
    } satisfies VoiceProsodyStoreData));
  } catch {
    // Ignore restricted storage.
  }
}

export const VOICE_PROSODY_STORAGE_KEY = STORAGE_KEY;
