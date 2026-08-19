import { describe, expect, it } from 'vitest';
import { generateRhythmChallenge, createInitialSkill } from '../src/core/rhythm';
import {
  advancePressure,
  applyPressureIntent,
  createPressureState,
  pressureDanger,
  spawnPressureForBar,
} from '../src/game/PressureSystem';

describe('harmonic pressure system', () => {
  it('spawns a small readable set of deterministic waves for a bar', () => {
    const challenge = generateRhythmChallenge(createInitialSkill(), 44);
    const a = spawnPressureForBar(createPressureState(), challenge, 112, 99);
    const b = spawnPressureForBar(createPressureState(), challenge, 112, 99);

    expect(a.waves.length).toBeGreaterThanOrEqual(3);
    expect(a.waves.length).toBeLessThanOrEqual(5);
    expect(a.waves).toEqual(b.waves);
  });

  it('turns missed pressure into stability damage', () => {
    const challenge = generateRhythmChallenge(createInitialSkill(), 12);
    let pressure = spawnPressureForBar(createPressureState(), challenge, 112, 12);
    const before = pressure.stability;

    for (let i = 0; i < 40 && pressure.waves.length > 0; i += 1) {
      pressure = advancePressure(pressure, 250, 0.9).pressure;
    }

    expect(pressure.stability).toBeLessThan(before);
  });

  it('makes intensify a visible risk/reward decision', () => {
    const challenge = generateRhythmChallenge(createInitialSkill(), 71);
    const base = spawnPressureForBar(createPressureState(), challenge, 112, 71);
    const target = [...base.waves].sort((a, b) => a.etaMs - b.etaMs)[0];
    expect(target).toBeDefined();

    const result = applyPressureIntent(base, 'intensify', 0.4, 1);
    const changed = result.pressure.waves.find((wave) => wave.id === target?.id);

    expect(changed?.amplified).toBe(true);
    expect(changed?.pressure ?? 0).toBeGreaterThan(target?.pressure ?? 0);
    expect(changed?.reward ?? 0).toBeGreaterThan(target?.reward ?? 0);
    expect(changed?.etaMs ?? Infinity).toBeLessThan(target?.etaMs ?? 0);
  });

  it('lets delay buy time and diverge reroute the priority wave', () => {
    const challenge = generateRhythmChallenge(createInitialSkill(), 88);
    const base = spawnPressureForBar(createPressureState(), challenge, 112, 88);
    const target = [...base.waves].sort((a, b) => a.etaMs - b.etaMs)[0];
    expect(target).toBeDefined();

    const delayed = applyPressureIntent(base, 'delay', 0.7, 0.8).pressure;
    const delayedWave = delayed.waves.find((wave) => wave.id === target?.id);
    expect(delayedWave?.etaMs ?? 0).toBeGreaterThan(target?.etaMs ?? Infinity);

    const rerouted = applyPressureIntent(base, 'diverge', 0.7, 0.8).pressure;
    const reroutedWave = rerouted.waves.find((wave) => wave.id === target?.id);
    expect(reroutedWave?.lane).not.toBe(target?.lane);
  });

  it('turns high-tension resolve into a multi-wave release and reward', () => {
    const challenge = generateRhythmChallenge(createInitialSkill(), 93);
    const base = spawnPressureForBar(createPressureState(0.7), challenge, 112, 93);
    const beforeCount = base.waves.length;
    const beforeDanger = pressureDanger(base);

    const released = applyPressureIntent(base, 'resolve', 0.82, 1);

    expect(released.affected).toBeGreaterThanOrEqual(2);
    expect(released.pressure.waves.length).toBeLessThan(beforeCount);
    expect(released.scoreBonus).toBeGreaterThan(0);
    expect(released.pressure.stability).toBeGreaterThan(base.stability);
    expect(pressureDanger(released.pressure)).toBeLessThan(beforeDanger);
  });
});
