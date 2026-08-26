export type EightBitKind = 'bgm' | 'sfx';
export type EightBitBgmPurpose = 'field' | 'battle' | 'boss-battle' | 'dungeon' | 'town' | 'victory' | 'game-over';
export type EightBitSfxPurpose = 'attack' | 'hit' | 'critical' | 'jump' | 'damage' | 'pickup' | 'magic' | 'explosion' | 'select';
export type EightBitPurpose = EightBitBgmPurpose | EightBitSfxPurpose;
export type EightBitChannel = 'pulse1' | 'pulse2' | 'triangle' | 'noise';
export type EightBitDuty = 0.125 | 0.25 | 0.5;
export type EightBitNoiseKind = 'kick' | 'snare' | 'hat' | 'burst' | 'metal';

export interface EightBitSettings {
  kind: EightBitKind;
  purpose: EightBitPurpose;
  intensity: number;
  seed: number;
  bpm: number;
  bars: 4 | 8 | 16;
}

export interface EightBitEvent {
  channel: EightBitChannel;
  start: number;
  duration: number;
  volume: number;
  midi?: number;
  endMidi?: number;
  duty?: EightBitDuty;
  noiseKind?: EightBitNoiseKind;
  noiseRate?: number;
}

export interface EightBitComposition {
  version: 'sound-wave-eight-bit-v1';
  title: string;
  kind: EightBitKind;
  purpose: EightBitPurpose;
  purposeLabel: string;
  description: string;
  loop: boolean;
  duration: number;
  bpm: number;
  bars: number;
  seed: number;
  intensity: number;
  events: EightBitEvent[];
}

interface BgmProfile {
  label: string;
  description: string;
  bpm: number;
  rootMidi: number;
  scale: readonly number[];
  progression: readonly number[];
  melodyDensity: number;
  pulse2Rate: 2 | 4;
  duty: EightBitDuty;
  bassDrive: number;
  drumDrive: number;
}

const MAJOR = [0, 2, 4, 5, 7, 9, 11] as const;
const MINOR = [0, 2, 3, 5, 7, 8, 10] as const;
const DORIAN = [0, 2, 3, 5, 7, 9, 10] as const;
const PHRYGIAN = [0, 1, 3, 5, 7, 8, 10] as const;

const BGM_PROFILES: Record<EightBitBgmPurpose, BgmProfile> = {
  field: {
    label: 'FIELD BGM',
    description: 'Forward-moving adventure loop with a singable lead and open harmony.',
    bpm: 132,
    rootMidi: 60,
    scale: MAJOR,
    progression: [0, 4, 5, 3],
    melodyDensity: 0.58,
    pulse2Rate: 2,
    duty: 0.25,
    bassDrive: 0.58,
    drumDrive: 0.45,
  },
  battle: {
    label: 'BATTLE BGM',
    description: 'Fast combat loop with tight arpeggios, urgent bass and dense noise drums.',
    bpm: 156,
    rootMidi: 57,
    scale: MINOR,
    progression: [0, 5, 6, 4],
    melodyDensity: 0.78,
    pulse2Rate: 4,
    duty: 0.25,
    bassDrive: 0.82,
    drumDrive: 0.84,
  },
  'boss-battle': {
    label: 'BOSS BATTLE BGM',
    description: 'Aggressive high-tension loop using darker scale motion and relentless channel pressure.',
    bpm: 172,
    rootMidi: 53,
    scale: PHRYGIAN,
    progression: [0, 1, 5, 4],
    melodyDensity: 0.9,
    pulse2Rate: 4,
    duty: 0.125,
    bassDrive: 0.96,
    drumDrive: 1,
  },
  dungeon: {
    label: 'DUNGEON BGM',
    description: 'Sparse mysterious loop with suspended phrases and restrained percussion.',
    bpm: 104,
    rootMidi: 50,
    scale: DORIAN,
    progression: [0, 3, 1, 4],
    melodyDensity: 0.42,
    pulse2Rate: 2,
    duty: 0.125,
    bassDrive: 0.42,
    drumDrive: 0.28,
  },
  town: {
    label: 'TOWN BGM',
    description: 'Warm relaxed loop with bright melody motion and light rhythmic support.',
    bpm: 118,
    rootMidi: 60,
    scale: MAJOR,
    progression: [0, 3, 4, 0],
    melodyDensity: 0.52,
    pulse2Rate: 2,
    duty: 0.5,
    bassDrive: 0.46,
    drumDrive: 0.34,
  },
  victory: {
    label: 'VICTORY BGM',
    description: 'Short celebratory fanfare loop with bright upward motion and strong cadence.',
    bpm: 146,
    rootMidi: 62,
    scale: MAJOR,
    progression: [0, 4, 5, 0],
    melodyDensity: 0.72,
    pulse2Rate: 4,
    duty: 0.25,
    bassDrive: 0.7,
    drumDrive: 0.68,
  },
  'game-over': {
    label: 'GAME OVER BGM',
    description: 'Slow descending ending cue with reduced rhythm and a dark final cadence.',
    bpm: 82,
    rootMidi: 55,
    scale: MINOR,
    progression: [0, 5, 3, 0],
    melodyDensity: 0.38,
    pulse2Rate: 2,
    duty: 0.125,
    bassDrive: 0.34,
    drumDrive: 0.12,
  },
};

const SFX_LABELS: Record<EightBitSfxPurpose, string> = {
  attack: 'ATTACK SFX',
  hit: 'HIT SFX',
  critical: 'CRITICAL SFX',
  jump: 'JUMP SFX',
  damage: 'DAMAGE SFX',
  pickup: 'PICKUP SFX',
  magic: 'MAGIC SFX',
  explosion: 'EXPLOSION SFX',
  select: 'SELECT SFX',
};

const SFX_DESCRIPTIONS: Record<EightBitSfxPurpose, string> = {
  attack: 'Fast descending pulse slash with a short noise edge.',
  hit: 'Compact impact chirp layered with a sharp noise burst.',
  critical: 'Bright rising multi-note strike with extra transient energy.',
  jump: 'Quick upward pulse sweep.',
  damage: 'Harsh descending buzz with unstable low support.',
  pickup: 'Three-step ascending collectible chime.',
  magic: 'Sparkling arpeggio with high pulse accents and metallic noise.',
  explosion: 'Long decaying noise blast reinforced by a low falling tone.',
  select: 'Very short clean UI confirmation blip.',
};

class Rng {
  private state: number;
  constructor(seed: number) { this.state = seed >>> 0 || 0x6d2b79f5; }
  next(): number {
    let t = this.state += 0x6d2b79f5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(max: number): number { return Math.floor(this.next() * max); }
  pick<T>(items: readonly T[]): T { return items[Math.min(items.length - 1, this.int(items.length))]!; }
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

function isBgmPurpose(value: EightBitPurpose): value is EightBitBgmPurpose {
  return value in BGM_PROFILES;
}

function scaleMidi(root: number, scale: readonly number[], degree: number): number {
  const octave = Math.floor(degree / scale.length);
  const index = ((degree % scale.length) + scale.length) % scale.length;
  return root + scale[index]! + octave * 12;
}

function addTone(
  events: EightBitEvent[],
  channel: Exclude<EightBitChannel, 'noise'>,
  start: number,
  duration: number,
  midi: number,
  volume: number,
  duty?: EightBitDuty,
  endMidi?: number,
): void {
  events.push({ channel, start, duration, midi, endMidi, volume, duty });
}

function addNoise(
  events: EightBitEvent[],
  start: number,
  duration: number,
  volume: number,
  noiseKind: EightBitNoiseKind,
  noiseRate = 1,
): void {
  events.push({ channel: 'noise', start, duration, volume, noiseKind, noiseRate });
}

const MELODY_SHAPES: readonly (readonly (number | null)[])[] = [
  [0, null, 2, null, 4, null, 5, 4, 2, null, 1, null, 2, 4, 2, null],
  [0, 2, null, 3, 4, null, 2, 1, 0, null, 4, null, 3, 2, 1, null],
  [0, null, 4, 3, 2, null, 5, null, 4, 2, 1, null, 3, 2, 0, null],
  [0, 1, 2, null, 4, 3, 2, null, 5, 4, 3, 2, 1, null, 0, null],
];

function generateBgm(settings: EightBitSettings): EightBitComposition {
  const purpose = isBgmPurpose(settings.purpose) ? settings.purpose : 'field';
  const profile = BGM_PROFILES[purpose];
  const rng = new Rng(settings.seed ^ purpose.length * 0x9e3779b9);
  const bpm = clamp(settings.bpm || profile.bpm, 70, 220);
  const bars = settings.bars;
  const intensity = clamp(settings.intensity, 0, 1);
  const step = 60 / bpm / 4;
  const barDuration = step * 16;
  const duration = bars * barDuration;
  const events: EightBitEvent[] = [];
  const shape = rng.pick(MELODY_SHAPES);
  const shapeShift = rng.int(profile.scale.length);
  const octaveShift = rng.next() > 0.72 ? 12 : 0;
  const leadRoot = profile.rootMidi + 12 + octaveShift;
  const pulse2Volume = 0.13 + intensity * 0.08;
  const leadVolume = 0.16 + intensity * 0.1;

  for (let bar = 0; bar < bars; bar += 1) {
    const barStart = bar * barDuration;
    const progressionDegree = profile.progression[bar % profile.progression.length]!;
    const chordRootDegree = progressionDegree;
    const variation = bar >= Math.max(2, Math.floor(bars / 2));

    for (let localStep = 0; localStep < 16; localStep += 1) {
      const shapeDegree = shape[localStep]!;
      if (shapeDegree !== null) {
        const densityGate = profile.melodyDensity + intensity * 0.2;
        if (rng.next() <= densityGate) {
          let degree = shapeDegree + shapeShift + chordRootDegree;
          if (variation && localStep >= 8 && rng.next() > 0.55) degree += rng.next() > 0.5 ? 1 : -1;
          const midi = scaleMidi(leadRoot, profile.scale, degree);
          const lengthSteps = rng.next() > 0.76 ? 2 : 1;
          addTone(events, 'pulse1', barStart + localStep * step, step * (lengthSteps * 0.88), midi, leadVolume, profile.duty);
        }
      }
    }

    const arpStride = profile.pulse2Rate === 4 ? 2 : 4;
    const chordDegrees = [chordRootDegree, chordRootDegree + 2, chordRootDegree + 4, chordRootDegree + 2];
    for (let localStep = 0; localStep < 16; localStep += arpStride) {
      const arpIndex = Math.floor(localStep / arpStride) % chordDegrees.length;
      const degree = chordDegrees[arpIndex]!;
      const midi = scaleMidi(profile.rootMidi + 12, profile.scale, degree + (bar % 2 === 1 && arpIndex === 2 ? 7 : 0));
      addTone(events, 'pulse2', barStart + localStep * step, step * arpStride * 0.72, midi, pulse2Volume, profile.duty === 0.125 ? 0.25 : 0.125);
    }

    const bassPattern = purpose === 'boss-battle' || purpose === 'battle'
      ? [0, 4, 0, 5]
      : purpose === 'dungeon' || purpose === 'game-over'
        ? [0, 0, 4, 0]
        : [0, 4, 5, 4];
    for (let beat = 0; beat < 4; beat += 1) {
      if (purpose === 'game-over' && beat % 2 === 1) continue;
      const degreeOffset = bassPattern[beat]!;
      const midi = scaleMidi(profile.rootMidi - 12, profile.scale, chordRootDegree + degreeOffset);
      addTone(events, 'triangle', barStart + beat * 4 * step, step * (purpose === 'battle' || purpose === 'boss-battle' ? 2.9 : 3.55), midi, 0.13 + profile.bassDrive * 0.09 + intensity * 0.04);
      if ((purpose === 'battle' || purpose === 'boss-battle') && intensity > 0.55 && beat < 3) {
        const nextMidi = scaleMidi(profile.rootMidi - 12, profile.scale, chordRootDegree + (beat % 2 === 0 ? 4 : 0));
        addTone(events, 'triangle', barStart + (beat * 4 + 2) * step, step * 1.6, nextMidi, 0.1 + intensity * 0.05);
      }
    }

    const drum = profile.drumDrive * (0.55 + intensity * 0.65);
    for (let localStep = 0; localStep < 16; localStep += 1) {
      const when = barStart + localStep * step;
      if (localStep % 4 === 0 && purpose !== 'game-over') addNoise(events, when, step * 0.75, 0.12 + drum * 0.09, 'kick', 0.72);
      if (localStep === 4 || localStep === 12) addNoise(events, when, step * 0.86, 0.11 + drum * 0.1, 'snare', 1.1);
      const hatStride = purpose === 'boss-battle' ? 1 : purpose === 'battle' ? 2 : 4;
      if (localStep % hatStride === 2 % hatStride && purpose !== 'game-over' && rng.next() < 0.5 + drum * 0.42) {
        addNoise(events, when, step * 0.34, 0.045 + drum * 0.05, 'hat', 1.5 + intensity * 0.5);
      }
    }
  }

  return {
    version: 'sound-wave-eight-bit-v1',
    title: `${profile.label} ${String(settings.seed >>> 0).padStart(8, '0').slice(-8)}`,
    kind: 'bgm',
    purpose,
    purposeLabel: profile.label,
    description: profile.description,
    loop: true,
    duration,
    bpm,
    bars,
    seed: settings.seed >>> 0,
    intensity,
    events: events.sort((a, b) => a.start - b.start),
  };
}

function generateSfx(settings: EightBitSettings): EightBitComposition {
  const purpose = isBgmPurpose(settings.purpose) ? 'attack' : settings.purpose as EightBitSfxPurpose;
  const intensity = clamp(settings.intensity, 0, 1);
  const seed = settings.seed >>> 0;
  const rng = new Rng(seed ^ purpose.length * 0x85ebca6b);
  const events: EightBitEvent[] = [];
  const v = 0.17 + intensity * 0.12;
  let duration = 0.35;

  switch (purpose) {
    case 'attack':
      duration = 0.26;
      addTone(events, 'pulse1', 0, 0.14, 84 + rng.int(4), v, 0.125, 57 + rng.int(5));
      addTone(events, 'pulse2', 0.018, 0.11, 72, v * 0.62, 0.25, 50);
      addNoise(events, 0.005, 0.075, v * 0.9, 'burst', 1.8);
      break;
    case 'hit':
      duration = 0.2;
      addTone(events, 'pulse1', 0, 0.075, 70 + rng.int(7), v * 0.75, 0.25, 48);
      addNoise(events, 0, 0.12, v * 1.15, 'snare', 1.25 + intensity * 0.7);
      break;
    case 'critical':
      duration = 0.48;
      addNoise(events, 0, 0.11, v * 1.2, 'burst', 1.7);
      [72, 79, 84, 91].forEach((midi, index) => addTone(events, index % 2 === 0 ? 'pulse1' : 'pulse2', index * 0.065, 0.12, midi + rng.int(3), v, index % 2 === 0 ? 0.125 : 0.25));
      addTone(events, 'triangle', 0.015, 0.23, 43, v * 0.58, undefined, 31);
      break;
    case 'jump':
      duration = 0.32;
      addTone(events, 'pulse1', 0, 0.22, 53 + rng.int(3), v, 0.25, 88 + rng.int(4));
      break;
    case 'damage':
      duration = 0.42;
      addTone(events, 'pulse1', 0, 0.29, 69 + rng.int(4), v, 0.125, 36 + rng.int(5));
      addTone(events, 'pulse2', 0.035, 0.22, 63, v * 0.72, 0.125, 41);
      addNoise(events, 0, 0.21, v * 0.82, 'metal', 0.7 + intensity * 0.8);
      break;
    case 'pickup':
      duration = 0.42;
      [76, 83, 88].forEach((midi, index) => addTone(events, index === 1 ? 'pulse2' : 'pulse1', index * 0.08, 0.12, midi + rng.int(2), v * (0.88 + index * 0.05), index === 1 ? 0.125 : 0.25));
      break;
    case 'magic':
      duration = 0.62;
      [60, 67, 72, 79, 84, 91].forEach((midi, index) => addTone(events, index % 2 === 0 ? 'pulse1' : 'pulse2', index * 0.055, 0.15, midi + rng.int(4), v * 0.82, index % 3 === 0 ? 0.125 : 0.25));
      addNoise(events, 0.12, 0.26, v * 0.42, 'metal', 2.2);
      break;
    case 'explosion':
      duration = 0.82;
      addNoise(events, 0, 0.68, v * 1.28, 'burst', 0.58 + intensity * 0.35);
      addNoise(events, 0.08, 0.42, v * 0.8, 'snare', 0.42);
      addTone(events, 'triangle', 0, 0.52, 45, v * 0.65, undefined, 24);
      break;
    case 'select':
      duration = 0.16;
      addTone(events, 'pulse1', 0, 0.075, 81 + rng.int(3), v * 0.82, 0.25);
      break;
  }

  return {
    version: 'sound-wave-eight-bit-v1',
    title: `${SFX_LABELS[purpose]} ${String(seed).padStart(8, '0').slice(-8)}`,
    kind: 'sfx',
    purpose,
    purposeLabel: SFX_LABELS[purpose],
    description: SFX_DESCRIPTIONS[purpose],
    loop: false,
    duration,
    bpm: 0,
    bars: 0,
    seed,
    intensity,
    events,
  };
}

export function defaultEightBitSettings(): EightBitSettings {
  return {
    kind: 'bgm',
    purpose: 'field',
    intensity: 0.62,
    seed: Date.now() >>> 0,
    bpm: BGM_PROFILES.field.bpm,
    bars: 8,
  };
}

export function recommendedBpm(purpose: EightBitPurpose): number {
  return isBgmPurpose(purpose) ? BGM_PROFILES[purpose].bpm : 0;
}

export function eightBitPurposeLabel(purpose: EightBitPurpose): string {
  return isBgmPurpose(purpose) ? BGM_PROFILES[purpose].label : SFX_LABELS[purpose];
}

export function eightBitPurposeDescription(purpose: EightBitPurpose): string {
  return isBgmPurpose(purpose) ? BGM_PROFILES[purpose].description : SFX_DESCRIPTIONS[purpose];
}

export function generateEightBitComposition(settings: EightBitSettings): EightBitComposition {
  return settings.kind === 'bgm' ? generateBgm(settings) : generateSfx(settings);
}

export interface ParsedEightBitRequest {
  kind: EightBitKind;
  purpose: EightBitPurpose;
}

export function parseEightBitRequest(text: string, fallback: ParsedEightBitRequest): ParsedEightBitRequest {
  const value = text.trim().toLowerCase();
  if (!value) return fallback;

  const sfxMatchers: readonly [RegExp, EightBitSfxPurpose][] = [
    [/会心|クリティカル|critical/, 'critical'],
    [/攻撃|斬撃|attack|slash|sword/, 'attack'],
    [/命中|ヒット|hit|impact/, 'hit'],
    [/ジャンプ|jump/, 'jump'],
    [/ダメージ|被弾|damage|hurt/, 'damage'],
    [/アイテム|コイン|取得|pickup|coin|item/, 'pickup'],
    [/魔法|spell|magic/, 'magic'],
    [/爆発|explosion|boom/, 'explosion'],
    [/決定|選択|カーソル|select|confirm|cursor/, 'select'],
  ];
  for (const [pattern, purpose] of sfxMatchers) if (pattern.test(value)) return { kind: 'sfx', purpose };

  const bgmMatchers: readonly [RegExp, EightBitBgmPurpose][] = [
    [/ボス|boss/, 'boss-battle'],
    [/戦闘|バトル|battle|combat/, 'battle'],
    [/ダンジョン|洞窟|迷宮|dungeon|cave/, 'dungeon'],
    [/町|街|村|town|village/, 'town'],
    [/勝利|クリア|victory|clear|fanfare/, 'victory'],
    [/ゲームオーバー|game\s*over|敗北|defeat/, 'game-over'],
    [/フィールド|冒険|field|overworld|adventure/, 'field'],
  ];
  for (const [pattern, purpose] of bgmMatchers) if (pattern.test(value)) return { kind: 'bgm', purpose };

  if (/\bbgm\b|曲|音楽/.test(value) && fallback.kind !== 'bgm') return { kind: 'bgm', purpose: 'field' };
  if (/\bsfx\b|\bse\b|効果音/.test(value) && fallback.kind !== 'sfx') return { kind: 'sfx', purpose: 'select' };
  return fallback;
}

export const EIGHT_BIT_BGM_PURPOSES = Object.freeze(Object.keys(BGM_PROFILES) as EightBitBgmPurpose[]);
export const EIGHT_BIT_SFX_PURPOSES = Object.freeze(Object.keys(SFX_LABELS) as EightBitSfxPurpose[]);
