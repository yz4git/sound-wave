import type { PlayerIntent } from '../core/music';
import type { InputJudgement } from './GameEngine';

export type ModifierId =
  | 'resonant-release'
  | 'offbeat-engine'
  | 'edge-sustain'
  | 'deceptive-current'
  | 'overdrive'
  | 'poly-core';

export interface ModifierDefinition {
  id: ModifierId;
  name: string;
  description: string;
}

export interface ModifierContext {
  intent: PlayerIntent;
  judgement: InputJudgement;
  tension: number;
  syncopated: boolean;
  polyrhythm: 1 | 3 | 5;
}

export interface ModifierBonus {
  scoreMultiplier: number;
  flowBonus: number;
  triggered: ModifierId[];
}

export const MODIFIERS: readonly ModifierDefinition[] = [
  { id: 'resonant-release', name: 'RESONANT RELEASE', description: 'Resolve high tension for +35% score.' },
  { id: 'offbeat-engine', name: 'OFFBEAT ENGINE', description: 'Syncopated hits gain +30% score.' },
  { id: 'edge-sustain', name: 'EDGE SUSTAIN', description: 'Delay high tension to preserve extra Flow.' },
  { id: 'deceptive-current', name: 'DECEPTIVE CURRENT', description: 'Diverge gains +25% score.' },
  { id: 'overdrive', name: 'OVERDRIVE', description: 'Perfect Intensify actions gain +40% score.' },
  { id: 'poly-core', name: 'POLY CORE', description: 'Actions inside 3:4 or 5:4 patterns gain +35% score.' },
] as const;

export function modifierDefinition(id: ModifierId): ModifierDefinition {
  const definition = MODIFIERS.find((item) => item.id === id);
  if (!definition) throw new Error(`Unknown modifier: ${id}`);
  return definition;
}

export function chooseModifier(active: readonly ModifierId[], seed: number): ModifierId | null {
  const available = MODIFIERS.filter((item) => !active.includes(item.id));
  if (available.length === 0) return null;
  const hash = Math.abs(Math.imul(seed ^ (seed >>> 16), 0x45d9f3b));
  return available[hash % available.length]?.id ?? null;
}

export function calculateModifierBonus(
  active: readonly ModifierId[],
  context: ModifierContext,
): ModifierBonus {
  let scoreMultiplier = 1;
  let flowBonus = 0;
  const triggered: ModifierId[] = [];

  const trigger = (id: ModifierId, multiplier: number, flow = 0): void => {
    if (!active.includes(id)) return;
    scoreMultiplier *= multiplier;
    flowBonus += flow;
    triggered.push(id);
  };

  if (context.intent === 'resolve' && context.tension >= 0.65) {
    trigger('resonant-release', 1.35, 0.025);
  }
  if (context.syncopated && context.judgement !== 'miss') {
    trigger('offbeat-engine', 1.3, 0.01);
  }
  if (context.intent === 'delay' && context.tension >= 0.6 && context.judgement !== 'miss') {
    trigger('edge-sustain', 1.08, 0.07);
  }
  if (context.intent === 'diverge' && context.judgement !== 'miss') {
    trigger('deceptive-current', 1.25, 0.015);
  }
  if (context.intent === 'intensify' && context.judgement === 'perfect') {
    trigger('overdrive', 1.4, 0.02);
  }
  if (context.polyrhythm !== 1 && context.judgement !== 'miss') {
    trigger('poly-core', 1.35, 0.025);
  }

  return { scoreMultiplier, flowBonus, triggered };
}
