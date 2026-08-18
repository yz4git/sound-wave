export interface SkillModel {
  timing: number;
  syncopation: number;
  density: number;
  polyrhythm: number;
  stability: number;
}

export interface RhythmChallenge {
  steps: readonly boolean[];
  accents: readonly number[];
  subdivisions: number;
  polyrhythm: 1 | 3 | 5;
  complexity: number;
  targetDifficulty: number;
}

export interface HitSample {
  errorMs: number;
  hit: boolean;
  syncopated: boolean;
  polyrhythmic: boolean;
}

export interface RhythmClock {
  bpm: number;
  beatsPerBar: number;
  subdivisionsPerBeat: number;
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createInitialSkill(): SkillModel {
  return {
    timing: 0.42,
    syncopation: 0.25,
    density: 0.3,
    polyrhythm: 0.12,
    stability: 0.5,
  };
}

export function aggregateSkill(skill: SkillModel): number {
  return clamp01(
    skill.timing * 0.38 +
    skill.syncopation * 0.2 +
    skill.density * 0.16 +
    skill.polyrhythm * 0.12 +
    skill.stability * 0.14,
  );
}

export function targetDifficultyFor(skill: SkillModel, flowBias = 0.08): number {
  return clamp01(aggregateSkill(skill) + flowBias);
}

export function stepDurationMs(clock: RhythmClock): number {
  return 60000 / clock.bpm / clock.subdivisionsPerBeat;
}

export function judgeTiming(errorMs: number, stepMs: number): number {
  const normalized = Math.abs(errorMs) / Math.max(1, stepMs * 0.55);
  return clamp01(1 - normalized);
}

export function updateSkill(skill: SkillModel, samples: readonly HitSample[]): SkillModel {
  if (samples.length === 0) return skill;

  const alpha = 0.16;
  const hitRate = samples.filter((sample) => sample.hit).length / samples.length;
  const timingScore = samples.reduce((sum, sample) => {
    if (!sample.hit) return sum;
    return sum + clamp01(1 - Math.abs(sample.errorMs) / 130);
  }, 0) / samples.length;

  const syncSamples = samples.filter((sample) => sample.syncopated);
  const syncScore = syncSamples.length === 0
    ? skill.syncopation
    : syncSamples.filter((sample) => sample.hit).length / syncSamples.length;

  const polySamples = samples.filter((sample) => sample.polyrhythmic);
  const polyScore = polySamples.length === 0
    ? skill.polyrhythm
    : polySamples.filter((sample) => sample.hit).length / polySamples.length;

  const errorMean = samples.reduce((sum, sample) => sum + Math.abs(sample.errorMs), 0) / samples.length;
  const stabilityScore = clamp01(1 - errorMean / 180);
  const densityScore = clamp01(hitRate * 0.75 + timingScore * 0.25);

  return {
    timing: clamp01(skill.timing * (1 - alpha) + timingScore * alpha),
    syncopation: clamp01(skill.syncopation * (1 - alpha) + syncScore * alpha),
    density: clamp01(skill.density * (1 - alpha) + densityScore * alpha),
    polyrhythm: clamp01(skill.polyrhythm * (1 - alpha) + polyScore * alpha),
    stability: clamp01(skill.stability * (1 - alpha) + stabilityScore * alpha),
  };
}

function choosePolyrhythm(difficulty: number, random: () => number): 1 | 3 | 5 {
  if (difficulty > 0.78 && random() < 0.36) return 5;
  if (difficulty > 0.48 && random() < 0.46) return 3;
  return 1;
}

export function generateRhythmChallenge(
  skill: SkillModel,
  seed: number,
  previous?: RhythmChallenge,
): RhythmChallenge {
  const random = mulberry32(seed);
  const target = targetDifficultyFor(skill);
  const subdivisions = target < 0.34 ? 2 : 4;
  const count = subdivisions * 4;
  const baseDensity = 0.24 + target * 0.38;
  const syncBias = skill.syncopation * 0.15 + target * 0.15;
  const polyrhythm = choosePolyrhythm(target, random);
  const steps: boolean[] = new Array(count).fill(false);
  const accents: number[] = new Array(count).fill(0);

  for (let i = 0; i < count; i += 1) {
    const downbeat = i % subdivisions === 0;
    const offbeat = !downbeat && i % Math.max(1, subdivisions / 2) === 0;
    const ghostPenalty = previous?.steps[i] ? 0.08 : 0;
    const probability = baseDensity + (downbeat ? 0.2 : offbeat ? syncBias : syncBias * 0.5) - ghostPenalty;
    steps[i] = random() < clamp01(probability);

    if (steps[i]) {
      const metricAccent = downbeat ? 0.95 : offbeat ? 0.68 : 0.45;
      const polyAccent = polyrhythm > 1 && i % Math.max(1, Math.round(count / polyrhythm)) === 0 ? 0.18 : 0;
      accents[i] = clamp01(metricAccent + polyAccent + random() * 0.08);
    }
  }

  steps[0] = true;
  accents[0] = 1;
  if (steps.filter(Boolean).length < 2) {
    const midpoint = Math.floor(count / 2);
    steps[midpoint] = true;
    accents[midpoint] = 0.72;
  }

  const density = steps.filter(Boolean).length / count;
  const syncopated = steps.reduce((sum, enabled, index) => {
    if (!enabled) return sum;
    return sum + (index % subdivisions === 0 ? 0 : 1);
  }, 0) / count;
  const polyComplexity = polyrhythm === 1 ? 0 : polyrhythm === 3 ? 0.14 : 0.24;
  const complexity = clamp01(density * 0.55 + syncopated * 0.75 + polyComplexity);

  return {
    steps,
    accents,
    subdivisions,
    polyrhythm,
    complexity,
    targetDifficulty: target,
  };
}

export function nearestActiveStep(
  challenge: RhythmChallenge,
  phaseInBar: number,
): { index: number; distanceInSteps: number } {
  const length = challenge.steps.length;
  const current = ((phaseInBar % 1) + 1) % 1 * length;
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let i = 0; i < length; i += 1) {
    if (!challenge.steps[i]) continue;
    const raw = Math.abs(i - current);
    const wrapped = Math.min(raw, length - raw);
    if (wrapped < bestDistance) {
      bestDistance = wrapped;
      bestIndex = i;
    }
  }

  return { index: bestIndex, distanceInSteps: bestDistance };
}
