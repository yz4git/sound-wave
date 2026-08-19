import type { PlayerIntent } from '../core/music';
import { stepDurationMs, type RhythmChallenge } from '../core/rhythm';

export type WaveLane = 0 | 1 | 2;
export type PressureWaveKind = 'pulse' | 'dissonance' | 'accent';

export interface PressureWave {
  id: number;
  lane: WaveLane;
  kind: PressureWaveKind;
  etaMs: number;
  initialEtaMs: number;
  pressure: number;
  reward: number;
  amplified: boolean;
  delayed: boolean;
  diverged: boolean;
}

export interface PressureEvent {
  type: 'spawn' | 'resolve' | 'delay' | 'diverge' | 'intensify' | 'breach';
  message: string;
  waveIds: number[];
  scoreBonus: number;
  stabilityDelta: number;
}

export interface PressureState {
  waves: PressureWave[];
  nextId: number;
  stability: number;
  lastEvent: PressureEvent | null;
}

export interface PressureAdvanceResult {
  pressure: PressureState;
  breached: number;
  damage: number;
}

export interface PressureIntentResult {
  pressure: PressureState;
  scoreBonus: number;
  affected: number;
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

function seededUnit(seed: number): number {
  let value = seed >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return (value >>> 0) / 4294967296;
}

function laneFor(seed: number, index: number): WaveLane {
  return Math.floor(seededUnit(seed ^ Math.imul(index + 1, 0x9e3779b9)) * 3) as WaveLane;
}

function kindFor(challenge: RhythmChallenge, index: number): PressureWaveKind {
  const accent = challenge.accents[index] ?? 0;
  const offbeat = index % challenge.subdivisions !== 0;
  if (accent >= 0.88) return 'accent';
  if (offbeat || challenge.polyrhythm !== 1) return 'dissonance';
  return 'pulse';
}

function candidateIndices(challenge: RhythmChallenge): number[] {
  const active = challenge.steps
    .map((enabled, index) => ({ enabled, index, accent: challenge.accents[index] ?? 0 }))
    .filter((item) => item.enabled);

  active.sort((a, b) => {
    const accentDelta = b.accent - a.accent;
    return Math.abs(accentDelta) > 0.01 ? accentDelta : a.index - b.index;
  });

  const wanted = Math.min(5, Math.max(3, Math.round(3 + challenge.complexity * 2)));
  return active.slice(0, wanted).map((item) => item.index).sort((a, b) => a - b);
}

export function createPressureState(stability = 1): PressureState {
  return {
    waves: [],
    nextId: 1,
    stability: clamp01(stability),
    lastEvent: null,
  };
}

export function spawnPressureForBar(
  pressure: PressureState,
  challenge: RhythmChallenge,
  bpm: number,
  seed: number,
): PressureState {
  const stepMs = stepDurationMs({
    bpm,
    beatsPerBar: 4,
    subdivisionsPerBeat: challenge.subdivisions,
  });
  const indices = candidateIndices(challenge);
  let nextId = pressure.nextId;
  const spawned: PressureWave[] = [];

  for (const index of indices) {
    const accent = challenge.accents[index] ?? 0.5;
    const kind = kindFor(challenge, index);
    const leadMs = 1450 + index * stepMs * 0.72;
    const pressureAmount = clamp(0.38 + accent * 0.38 + challenge.complexity * 0.24, 0.35, 1.15);
    const reward = clamp(0.8 + accent * 0.35 + challenge.complexity * 0.32, 0.8, 1.5);
    spawned.push({
      id: nextId,
      lane: laneFor(seed, index),
      kind,
      etaMs: leadMs,
      initialEtaMs: leadMs,
      pressure: pressureAmount,
      reward,
      amplified: false,
      delayed: false,
      diverged: false,
    });
    nextId += 1;
  }

  return {
    ...pressure,
    waves: [...pressure.waves, ...spawned].slice(-12),
    nextId,
    lastEvent: spawned.length > 0
      ? { type: 'spawn', message: `PRESSURE +${spawned.length}`, waveIds: spawned.map((wave) => wave.id), scoreBonus: 0, stabilityDelta: 0 }
      : pressure.lastEvent,
  };
}

export function waveProgress(wave: PressureWave): number {
  return clamp01(1 - wave.etaMs / Math.max(1, wave.initialEtaMs));
}

export function pressureDanger(pressure: PressureState): number {
  if (pressure.waves.length === 0) return 0;
  return clamp01(pressure.waves.reduce((sum, wave) => {
    const progress = waveProgress(wave);
    return sum + progress * progress * wave.pressure;
  }, 0) / 2.4);
}

export function advancePressure(
  pressure: PressureState,
  deltaMs: number,
  tension: number,
): PressureAdvanceResult {
  const safeDelta = Math.max(0, Math.min(250, deltaMs));
  const tensionRush = 1 + Math.max(0, clamp01(tension) - 0.62) * 0.85;
  const surviving: PressureWave[] = [];
  const breachedIds: number[] = [];
  let damage = 0;

  for (const wave of pressure.waves) {
    const speed = wave.amplified ? 1.12 : 1;
    const etaMs = wave.etaMs - safeDelta * tensionRush * speed;
    if (etaMs <= 0) {
      breachedIds.push(wave.id);
      damage += (0.02 + wave.pressure * 0.045) * (1 + clamp01(tension) * 0.25);
    } else {
      surviving.push({ ...wave, etaMs });
    }
  }

  if (breachedIds.length === 0) {
    return {
      pressure: { ...pressure, waves: surviving },
      breached: 0,
      damage: 0,
    };
  }

  const appliedDamage = clamp(damage, 0, 0.32);
  return {
    pressure: {
      ...pressure,
      waves: surviving,
      stability: clamp01(pressure.stability - appliedDamage),
      lastEvent: {
        type: 'breach',
        message: breachedIds.length > 1 ? `CORE BREACH ×${breachedIds.length}` : 'CORE BREACH',
        waveIds: breachedIds,
        scoreBonus: 0,
        stabilityDelta: -appliedDamage,
      },
    },
    breached: breachedIds.length,
    damage: appliedDamage,
  };
}

function priorityWaves(waves: readonly PressureWave[]): PressureWave[] {
  return [...waves].sort((a, b) => a.etaMs - b.etaMs || b.pressure - a.pressure);
}

function divergedLane(wave: PressureWave): WaveLane {
  if (wave.lane === 1) return wave.id % 2 === 0 ? 0 : 2;
  return 1;
}

export function applyPressureIntent(
  pressure: PressureState,
  intent: PlayerIntent,
  tension: number,
  quality: number,
): PressureIntentResult {
  const ordered = priorityWaves(pressure.waves);
  const target = ordered[0];
  if (!target) return { pressure, scoreBonus: 0, affected: 0 };

  const q = clamp01(quality);
  const targetId = target.id;

  if (intent === 'resolve') {
    const count = tension >= 0.78 ? 3 : tension >= 0.62 ? 2 : 1;
    const resolved = ordered.slice(0, count);
    const resolvedIds = new Set(resolved.map((wave) => wave.id));
    const scoreBonus = Math.round(resolved.reduce((sum, wave) => {
      const risk = 0.75 + waveProgress(wave) * 0.8 + wave.pressure * 0.25;
      return sum + 95 * wave.reward * risk * (0.7 + q * 0.45) * (0.85 + clamp01(tension) * 0.55);
    }, 0));
    const recovery = Math.min(0.08, resolved.length * (0.012 + q * 0.008));
    return {
      pressure: {
        ...pressure,
        waves: pressure.waves.filter((wave) => !resolvedIds.has(wave.id)),
        stability: clamp01(pressure.stability + recovery),
        lastEvent: {
          type: 'resolve',
          message: resolved.length > 1 ? `RELEASE ×${resolved.length}` : 'RELEASE',
          waveIds: [...resolvedIds],
          scoreBonus,
          stabilityDelta: recovery,
        },
      },
      scoreBonus,
      affected: resolved.length,
    };
  }

  const waves = pressure.waves.map((wave): PressureWave => {
    if (wave.id !== targetId) return wave;
    if (intent === 'delay') {
      const added = 520 + q * 420;
      return {
        ...wave,
        etaMs: wave.etaMs + added,
        initialEtaMs: wave.initialEtaMs + added * 0.45,
        pressure: clamp(wave.pressure * 0.96, 0.3, 1.4),
        delayed: true,
      };
    }
    if (intent === 'diverge') {
      return {
        ...wave,
        lane: divergedLane(wave),
        etaMs: wave.etaMs + 220 + q * 180,
        initialEtaMs: wave.initialEtaMs + 110,
        pressure: clamp(wave.pressure * 0.91, 0.28, 1.4),
        diverged: true,
      };
    }
    return {
      ...wave,
      etaMs: Math.max(120, wave.etaMs * (0.84 - q * 0.06)),
      pressure: clamp(wave.pressure * (1.16 + q * 0.16), 0.3, 1.45),
      reward: clamp(wave.reward * (1.22 + q * 0.18), 0.8, 2.2),
      amplified: true,
    };
  });

  const eventType = intent === 'delay' ? 'delay' : intent === 'diverge' ? 'diverge' : 'intensify';
  const message = intent === 'delay' ? 'WAVE HELD' : intent === 'diverge' ? 'WAVE REROUTED' : 'RISK AMPLIFIED';
  return {
    pressure: {
      ...pressure,
      waves,
      lastEvent: {
        type: eventType,
        message,
        waveIds: [targetId],
        scoreBonus: 0,
        stabilityDelta: 0,
      },
    },
    scoreBonus: 0,
    affected: 1,
  };
}
