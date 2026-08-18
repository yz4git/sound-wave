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

export function loadProfile(storage: Pick<Storage, 'getItem'> = localStorage): PlayerProfile {
  try {
    const raw = storage.getItem(STORAGE_KEY);
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
  storage: Pick<Storage, 'setItem'> = localStorage,
): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // Storage may be unavailable in private browsing or a constrained webview.
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
