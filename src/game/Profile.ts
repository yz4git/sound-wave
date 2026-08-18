import { createInitialSkill, type SkillModel } from '../core/rhythm';

export interface PlayerProfile {
  version: 1;
  skill: SkillModel;
  bestScore: number;
  bestCombo: number;
  sessions: number;
}

const STORAGE_KEY = 'sound-wave:profile:v1';

export function createProfile(): PlayerProfile {
  return {
    version: 1,
    skill: createInitialSkill(),
    bestScore: 0,
    bestCombo: 0,
    sessions: 0,
  };
}

function validUnit(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function validSkill(value: unknown): value is SkillModel {
  if (!value || typeof value !== 'object') return false;
  const skill = value as Partial<SkillModel>;
  return validUnit(skill.timing)
    && validUnit(skill.syncopation)
    && validUnit(skill.density)
    && validUnit(skill.polyrhythm)
    && validUnit(skill.stability);
}

function browserStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    // Safari private mode, sandboxed webviews and embedded hosts may throw merely
    // by reading window.localStorage. Storage must never be allowed to block boot.
    return null;
  }
}

export function loadProfile(storage?: Pick<Storage, 'getItem'> | null): PlayerProfile {
  try {
    const target = storage === undefined ? browserStorage() : storage;
    if (!target) return createProfile();

    const raw = target.getItem(STORAGE_KEY);
    if (!raw) return createProfile();
    const parsed = JSON.parse(raw) as Partial<PlayerProfile>;
    if (parsed.version !== 1 || !validSkill(parsed.skill)) return createProfile();
    return {
      version: 1,
      skill: parsed.skill,
      bestScore: typeof parsed.bestScore === 'number' && Number.isFinite(parsed.bestScore) ? Math.max(0, parsed.bestScore) : 0,
      bestCombo: typeof parsed.bestCombo === 'number' && Number.isFinite(parsed.bestCombo) ? Math.max(0, parsed.bestCombo) : 0,
      sessions: typeof parsed.sessions === 'number' && Number.isFinite(parsed.sessions) ? Math.max(0, parsed.sessions) : 0,
    };
  } catch {
    return createProfile();
  }
}

export function saveProfile(
  profile: PlayerProfile,
  storage?: Pick<Storage, 'setItem'> | null,
): void {
  try {
    const target = storage === undefined ? browserStorage() : storage;
    if (!target) return;
    target.setItem(STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // Storage may be unavailable in private browsing, sandboxed webviews or a
    // constrained host. Persistence is optional; gameplay must continue.
  }
}

export function updateProfile(
  profile: PlayerProfile,
  skill: SkillModel,
  score: number,
  combo: number,
): PlayerProfile {
  return {
    ...profile,
    skill,
    bestScore: Math.max(profile.bestScore, score),
    bestCombo: Math.max(profile.bestCombo, combo),
  };
}
