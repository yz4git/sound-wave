import type { VocalStyle } from './VocalGenerator';

export type GenreId = 'j-pop' | 'rock' | 'k-pop' | 'game-music';

export interface GenreStyleProfile {
  genre: GenreId;
  id: string;
  label: string;
  bpmRange: readonly [number, number];
  densityBias: number;
  progression: readonly (readonly number[])[];
  colorDegrees: readonly number[];
  melodyDensity: number;
  syncopation: number;
  leapChance: number;
  longNoteChance: number;
  kickDrive: number;
  snareDrive: number;
  hatDrive: number;
  clapDrive: number;
  bassDrive: number;
  chordDrive: number;
  melodyDrive: number;
  recommendedVocalStyle: VocalStyle;
  vocalEnergy: number;
  vocalArticulation: number;
  description: string;
}

export interface GenreDefinition {
  id: GenreId;
  label: string;
  defaultSubgenre: string;
  subgenres: readonly GenreStyleProfile[];
}

function profile(
  genre: GenreId,
  id: string,
  label: string,
  config: Omit<GenreStyleProfile, 'genre' | 'id' | 'label'>,
): GenreStyleProfile {
  return { genre, id, label, ...config };
}

const JPOP: readonly GenreStyleProfile[] = [
  profile('j-pop', 'mainstream', '王道J-POP', {
    bpmRange: [96, 138], densityBias: 0.05,
    progression: [[0, 5, 3], [3, 5, 1], [5, 2, 4], [4, 0, 5]], colorDegrees: [3, 5],
    melodyDensity: 1.08, syncopation: 0.32, leapChance: 0.18, longNoteChance: 0.34,
    kickDrive: 0.82, snareDrive: 0.9, hatDrive: 0.78, clapDrive: 0.3,
    bassDrive: 0.82, chordDrive: 0.86, melodyDrive: 0.98,
    recommendedVocalStyle: 'warm', vocalEnergy: 1, vocalArticulation: 0.94,
    description: '循環進行と歌えるフックを重視した現代的ポップ。',
  }),
  profile('j-pop', 'idol-pop', 'アイドルポップ', {
    bpmRange: [118, 158], densityBias: 0.13,
    progression: [[0, 3, 5], [5, 1, 3], [3, 4, 5], [4, 0, 5]], colorDegrees: [3, 5],
    melodyDensity: 1.2, syncopation: 0.4, leapChance: 0.22, longNoteChance: 0.28,
    kickDrive: 0.9, snareDrive: 0.94, hatDrive: 0.92, clapDrive: 0.48,
    bassDrive: 0.84, chordDrive: 0.9, melodyDrive: 1.05,
    recommendedVocalStyle: 'bright', vocalEnergy: 1.06, vocalArticulation: 1.06,
    description: '高密度なフック、明るいアタック、前向きな推進感。',
  }),
  profile('j-pop', 'anime-pop', 'アニソン系', {
    bpmRange: [126, 168], densityBias: 0.16,
    progression: [[0, 5, 2], [3, 1, 5], [4, 6, 3], [4, 0, 6]], colorDegrees: [6, 3, 5],
    melodyDensity: 1.22, syncopation: 0.38, leapChance: 0.32, longNoteChance: 0.36,
    kickDrive: 0.94, snareDrive: 0.98, hatDrive: 0.96, clapDrive: 0.25,
    bassDrive: 0.94, chordDrive: 1, melodyDrive: 1.06,
    recommendedVocalStyle: 'bright', vocalEnergy: 1.08, vocalArticulation: 1.08,
    description: '高揚感のあるコード移動と広めのメロディレンジ。',
  }),
  profile('j-pop', 'city-pop', 'シティポップ', {
    bpmRange: [88, 124], densityBias: -0.02,
    progression: [[0, 3, 5], [1, 3, 5], [5, 2, 6], [4, 3, 0]], colorDegrees: [1, 3, 5, 6],
    melodyDensity: 0.88, syncopation: 0.48, leapChance: 0.12, longNoteChance: 0.42,
    kickDrive: 0.72, snareDrive: 0.76, hatDrive: 0.82, clapDrive: 0.18,
    bassDrive: 0.9, chordDrive: 0.96, melodyDrive: 0.82,
    recommendedVocalStyle: 'airy', vocalEnergy: 0.92, vocalArticulation: 0.84,
    description: '滑らかなコードカラーと後ノリ寄りのシンコペーション。',
  }),
  profile('j-pop', 'ballad', 'バラード', {
    bpmRange: [64, 92], densityBias: -0.18,
    progression: [[0, 3, 5], [5, 1, 3], [3, 4, 5], [4, 0, 3]], colorDegrees: [3, 5],
    melodyDensity: 0.68, syncopation: 0.12, leapChance: 0.1, longNoteChance: 0.68,
    kickDrive: 0.42, snareDrive: 0.5, hatDrive: 0.38, clapDrive: 0,
    bassDrive: 0.58, chordDrive: 0.9, melodyDrive: 0.78,
    recommendedVocalStyle: 'airy', vocalEnergy: 0.9, vocalArticulation: 0.76,
    description: '長音と余白、柔らかいフレーズ終端を重視。',
  }),
  profile('j-pop', 'pop-rock', 'ロック寄りJ-POP', {
    bpmRange: [112, 152], densityBias: 0.08,
    progression: [[0, 5, 3], [3, 1, 5], [5, 4, 6], [4, 0, 5]], colorDegrees: [5, 6],
    melodyDensity: 1.04, syncopation: 0.26, leapChance: 0.24, longNoteChance: 0.32,
    kickDrive: 1, snareDrive: 1, hatDrive: 0.92, clapDrive: 0.08,
    bassDrive: 1, chordDrive: 1.04, melodyDrive: 0.96,
    recommendedVocalStyle: 'warm', vocalEnergy: 1.1, vocalArticulation: 1.04,
    description: '歌ものの明瞭さを保ったバンド志向のJ-POP。',
  }),
] as const;

const ROCK: readonly GenreStyleProfile[] = [
  profile('rock', 'pop-rock', 'POP ROCK', {
    bpmRange: [108, 148], densityBias: 0.06,
    progression: [[0, 3, 5], [3, 5, 1], [5, 4, 3], [4, 0, 5]], colorDegrees: [3, 5],
    melodyDensity: 0.98, syncopation: 0.22, leapChance: 0.22, longNoteChance: 0.3,
    kickDrive: 1, snareDrive: 1, hatDrive: 0.86, clapDrive: 0.04,
    bassDrive: 1, chordDrive: 1.08, melodyDrive: 0.9,
    recommendedVocalStyle: 'warm', vocalEnergy: 1.1, vocalArticulation: 1.02,
    description: '四つ打ちではなくバンドの8ビートを中心にしたロック。',
  }),
  profile('rock', 'alternative', 'ALTERNATIVE', {
    bpmRange: [92, 138], densityBias: -0.02,
    progression: [[0, 6, 3], [5, 3, 1], [6, 4, 3], [4, 6, 0]], colorDegrees: [6, 3],
    melodyDensity: 0.82, syncopation: 0.34, leapChance: 0.27, longNoteChance: 0.36,
    kickDrive: 0.92, snareDrive: 1, hatDrive: 0.76, clapDrive: 0,
    bassDrive: 1.02, chordDrive: 1.08, melodyDrive: 0.82,
    recommendedVocalStyle: 'warm', vocalEnergy: 1.04, vocalArticulation: 0.9,
    description: '少し暗いカラーと余白を持つオルタナティブ。',
  }),
  profile('rock', 'hard-rock', 'HARD ROCK', {
    bpmRange: [104, 154], densityBias: 0.08,
    progression: [[0, 6, 5], [5, 6, 3], [4, 6, 5], [4, 6, 0]], colorDegrees: [6, 5],
    melodyDensity: 0.92, syncopation: 0.2, leapChance: 0.3, longNoteChance: 0.34,
    kickDrive: 1.12, snareDrive: 1.08, hatDrive: 0.92, clapDrive: 0,
    bassDrive: 1.12, chordDrive: 1.15, melodyDrive: 0.86,
    recommendedVocalStyle: 'bright', vocalEnergy: 1.16, vocalArticulation: 1.1,
    description: '強いバックビートと重いコードアタック。',
  }),
  profile('rock', 'punk', 'PUNK', {
    bpmRange: [148, 188], densityBias: 0.18,
    progression: [[0, 3, 4], [3, 4, 5], [4, 5, 3], [4, 0, 3]], colorDegrees: [3, 4, 5],
    melodyDensity: 1.12, syncopation: 0.12, leapChance: 0.18, longNoteChance: 0.14,
    kickDrive: 1.08, snareDrive: 1.12, hatDrive: 1.12, clapDrive: 0,
    bassDrive: 1.12, chordDrive: 1.1, melodyDrive: 0.92,
    recommendedVocalStyle: 'bright', vocalEnergy: 1.16, vocalArticulation: 1.18,
    description: '高速8ビート、短い音価、直線的な推進感。',
  }),
  profile('rock', 'emo', 'EMO', {
    bpmRange: [96, 142], densityBias: 0.02,
    progression: [[0, 5, 3], [3, 1, 5], [5, 6, 4], [4, 0, 6]], colorDegrees: [5, 6, 3],
    melodyDensity: 1, syncopation: 0.28, leapChance: 0.34, longNoteChance: 0.46,
    kickDrive: 0.98, snareDrive: 1.04, hatDrive: 0.88, clapDrive: 0,
    bassDrive: 0.98, chordDrive: 1.06, melodyDrive: 1,
    recommendedVocalStyle: 'warm', vocalEnergy: 1.12, vocalArticulation: 1.02,
    description: '大きな感情曲線とサビでの音域上昇を意識。',
  }),
  profile('rock', 'indie', 'INDIE ROCK', {
    bpmRange: [88, 132], densityBias: -0.06,
    progression: [[0, 2, 5], [1, 3, 5], [5, 6, 3], [4, 2, 0]], colorDegrees: [2, 3, 6],
    melodyDensity: 0.78, syncopation: 0.4, leapChance: 0.15, longNoteChance: 0.38,
    kickDrive: 0.84, snareDrive: 0.88, hatDrive: 0.8, clapDrive: 0.02,
    bassDrive: 0.9, chordDrive: 0.92, melodyDrive: 0.8,
    recommendedVocalStyle: 'airy', vocalEnergy: 0.94, vocalArticulation: 0.82,
    description: '軽い揺らぎと少ない音数のインディー志向。',
  }),
] as const;

const KPOP: readonly GenreStyleProfile[] = [
  profile('k-pop', 'dance-pop', 'DANCE POP', {
    bpmRange: [112, 132], densityBias: 0.12,
    progression: [[0, 5, 3], [3, 5, 1], [5, 4, 6], [4, 0, 5]], colorDegrees: [3, 5, 6],
    melodyDensity: 1.05, syncopation: 0.54, leapChance: 0.24, longNoteChance: 0.24,
    kickDrive: 1.12, snareDrive: 0.94, hatDrive: 1.04, clapDrive: 0.72,
    bassDrive: 1.12, chordDrive: 0.8, melodyDrive: 0.94,
    recommendedVocalStyle: 'bright', vocalEnergy: 1.08, vocalArticulation: 1.12,
    description: 'タイトな低域、反復フック、強いシンコペーション。',
  }),
  profile('k-pop', 'girl-group', 'GIRL GROUP', {
    bpmRange: [108, 136], densityBias: 0.14,
    progression: [[0, 3, 5], [5, 1, 3], [3, 4, 6], [4, 0, 5]], colorDegrees: [3, 5],
    melodyDensity: 1.16, syncopation: 0.58, leapChance: 0.28, longNoteChance: 0.28,
    kickDrive: 1.06, snareDrive: 0.94, hatDrive: 1.08, clapDrive: 0.8,
    bassDrive: 1.08, chordDrive: 0.82, melodyDrive: 1.02,
    recommendedVocalStyle: 'bright', vocalEnergy: 1.06, vocalArticulation: 1.16,
    description: '細かなフックと明瞭なリズム発音を重視。',
  }),
  profile('k-pop', 'boy-group', 'BOY GROUP', {
    bpmRange: [98, 128], densityBias: 0.1,
    progression: [[0, 6, 3], [5, 3, 1], [6, 4, 5], [4, 6, 0]], colorDegrees: [6, 3],
    melodyDensity: 1, syncopation: 0.62, leapChance: 0.3, longNoteChance: 0.3,
    kickDrive: 1.12, snareDrive: 1, hatDrive: 0.98, clapDrive: 0.6,
    bassDrive: 1.16, chordDrive: 0.78, melodyDrive: 0.9,
    recommendedVocalStyle: 'warm', vocalEnergy: 1.12, vocalArticulation: 1.12,
    description: '低域グルーヴと強いアクセントを持つパフォーマンス型。',
  }),
  profile('k-pop', 'rnb-pop', 'R&B POP', {
    bpmRange: [72, 104], densityBias: -0.06,
    progression: [[0, 3, 5], [1, 5, 3], [5, 2, 6], [4, 3, 0]], colorDegrees: [1, 2, 3, 5, 6],
    melodyDensity: 0.78, syncopation: 0.66, leapChance: 0.12, longNoteChance: 0.48,
    kickDrive: 0.72, snareDrive: 0.68, hatDrive: 0.84, clapDrive: 0.38,
    bassDrive: 1.02, chordDrive: 0.9, melodyDrive: 0.8,
    recommendedVocalStyle: 'airy', vocalEnergy: 0.92, vocalArticulation: 0.8,
    description: '深いポケットと滑らかな歌唱を意識したR&B寄り。',
  }),
  profile('k-pop', 'electro', 'ELECTRO POP', {
    bpmRange: [118, 142], densityBias: 0.16,
    progression: [[0, 5, 6], [3, 5, 1], [6, 4, 3], [4, 0, 6]], colorDegrees: [6, 3, 5],
    melodyDensity: 1.02, syncopation: 0.7, leapChance: 0.26, longNoteChance: 0.2,
    kickDrive: 1.18, snareDrive: 0.88, hatDrive: 1.16, clapDrive: 0.74,
    bassDrive: 1.18, chordDrive: 0.72, melodyDrive: 0.94,
    recommendedVocalStyle: 'bright', vocalEnergy: 1.08, vocalArticulation: 1.18,
    description: '電子的な反復と強いダンスグルーヴ。',
  }),
  profile('k-pop', 'ballad', 'BALLAD', {
    bpmRange: [62, 88], densityBias: -0.2,
    progression: [[0, 3, 5], [5, 1, 3], [3, 4, 5], [4, 0, 3]], colorDegrees: [3, 5],
    melodyDensity: 0.64, syncopation: 0.16, leapChance: 0.14, longNoteChance: 0.72,
    kickDrive: 0.34, snareDrive: 0.42, hatDrive: 0.28, clapDrive: 0,
    bassDrive: 0.54, chordDrive: 0.88, melodyDrive: 0.8,
    recommendedVocalStyle: 'airy', vocalEnergy: 0.9, vocalArticulation: 0.76,
    description: 'ロングトーンと抑揚を前面に出したバラード。',
  }),
] as const;

const GAME: readonly GenreStyleProfile[] = [
  profile('game-music', 'jrpg', 'JRPG', {
    bpmRange: [96, 138], densityBias: 0.06,
    progression: [[0, 5, 2], [3, 1, 5], [4, 6, 3], [4, 0, 6]], colorDegrees: [2, 3, 6],
    melodyDensity: 1.06, syncopation: 0.28, leapChance: 0.32, longNoteChance: 0.38,
    kickDrive: 0.82, snareDrive: 0.82, hatDrive: 0.72, clapDrive: 0.06,
    bassDrive: 0.9, chordDrive: 1.04, melodyDrive: 1.12,
    recommendedVocalStyle: 'warm', vocalEnergy: 1, vocalArticulation: 0.96,
    description: '旋律主導で場面展開を感じるJRPG風。',
  }),
  profile('game-music', 'battle', 'BATTLE', {
    bpmRange: [132, 176], densityBias: 0.18,
    progression: [[0, 6, 5], [1, 4, 6], [4, 6, 3], [4, 6, 0]], colorDegrees: [6, 4, 1],
    melodyDensity: 1.22, syncopation: 0.42, leapChance: 0.38, longNoteChance: 0.18,
    kickDrive: 1.1, snareDrive: 1.06, hatDrive: 1.1, clapDrive: 0.05,
    bassDrive: 1.12, chordDrive: 1.08, melodyDrive: 1.12,
    recommendedVocalStyle: 'bright', vocalEnergy: 1.1, vocalArticulation: 1.12,
    description: '高速16分と緊張度の高い進行を使う戦闘曲。',
  }),
  profile('game-music', 'boss-battle', 'BOSS BATTLE', {
    bpmRange: [118, 164], densityBias: 0.2,
    progression: [[0, 1, 6], [6, 4, 1], [4, 6, 2], [4, 1, 0]], colorDegrees: [1, 6, 4],
    melodyDensity: 1.18, syncopation: 0.48, leapChance: 0.44, longNoteChance: 0.26,
    kickDrive: 1.14, snareDrive: 1.1, hatDrive: 1.04, clapDrive: 0,
    bassDrive: 1.18, chordDrive: 1.14, melodyDrive: 1.08,
    recommendedVocalStyle: 'bright', vocalEnergy: 1.14, vocalArticulation: 1.1,
    description: '半音カラーと大きな跳躍でボス戦の圧を作る。',
  }),
  profile('game-music', 'racing', 'RACING', {
    bpmRange: [138, 178], densityBias: 0.16,
    progression: [[0, 5, 3], [3, 5, 1], [5, 4, 6], [4, 0, 5]], colorDegrees: [5, 6],
    melodyDensity: 1.1, syncopation: 0.58, leapChance: 0.28, longNoteChance: 0.16,
    kickDrive: 1.16, snareDrive: 0.96, hatDrive: 1.16, clapDrive: 0.4,
    bassDrive: 1.16, chordDrive: 0.84, melodyDrive: 1.02,
    recommendedVocalStyle: 'bright', vocalEnergy: 1.08, vocalArticulation: 1.12,
    description: '前へ進み続ける高速パルスと短いフック。',
  }),
  profile('game-music', 'puzzle', 'PUZZLE', {
    bpmRange: [92, 126], densityBias: -0.08,
    progression: [[0, 2, 5], [1, 3, 5], [5, 2, 6], [4, 2, 0]], colorDegrees: [1, 2, 3, 6],
    melodyDensity: 0.84, syncopation: 0.5, leapChance: 0.12, longNoteChance: 0.28,
    kickDrive: 0.62, snareDrive: 0.58, hatDrive: 0.82, clapDrive: 0.22,
    bassDrive: 0.7, chordDrive: 0.78, melodyDrive: 0.92,
    recommendedVocalStyle: 'airy', vocalEnergy: 0.88, vocalArticulation: 0.84,
    description: '規則的だが少しひねりのある反復パターン。',
  }),
  profile('game-music', 'adventure', 'ADVENTURE', {
    bpmRange: [92, 132], densityBias: 0,
    progression: [[0, 3, 5], [1, 5, 3], [4, 6, 2], [4, 0, 5]], colorDegrees: [2, 3, 5, 6],
    melodyDensity: 0.96, syncopation: 0.24, leapChance: 0.26, longNoteChance: 0.42,
    kickDrive: 0.76, snareDrive: 0.74, hatDrive: 0.68, clapDrive: 0.04,
    bassDrive: 0.82, chordDrive: 0.98, melodyDrive: 1.08,
    recommendedVocalStyle: 'warm', vocalEnergy: 0.98, vocalArticulation: 0.9,
    description: '探索感のある広い旋律と穏やかな起伏。',
  }),
] as const;

export const GENRE_DEFINITIONS: readonly GenreDefinition[] = [
  { id: 'j-pop', label: 'J-POP', defaultSubgenre: 'mainstream', subgenres: JPOP },
  { id: 'rock', label: 'ROCK', defaultSubgenre: 'pop-rock', subgenres: ROCK },
  { id: 'k-pop', label: 'K-POP', defaultSubgenre: 'dance-pop', subgenres: KPOP },
  { id: 'game-music', label: 'GAME MUSIC', defaultSubgenre: 'jrpg', subgenres: GAME },
] as const;

export const GENRE_IDS = GENRE_DEFINITIONS.map((genre) => genre.id) as readonly GenreId[];

export function genreDefinition(genre: GenreId): GenreDefinition {
  return GENRE_DEFINITIONS.find((entry) => entry.id === genre) ?? GENRE_DEFINITIONS[0]!;
}

export function genreStyle(genre: GenreId, subgenre: string): GenreStyleProfile {
  const definition = genreDefinition(genre);
  return definition.subgenres.find((style) => style.id === subgenre)
    ?? definition.subgenres.find((style) => style.id === definition.defaultSubgenre)
    ?? definition.subgenres[0]!;
}

export function defaultSubgenreFor(genre: GenreId): string {
  return genreDefinition(genre).defaultSubgenre;
}

export function validGenre(value: unknown): value is GenreId {
  return typeof value === 'string' && GENRE_IDS.includes(value as GenreId);
}

export function validSubgenre(genre: GenreId, value: unknown): value is string {
  return typeof value === 'string' && genreDefinition(genre).subgenres.some((style) => style.id === value);
}
