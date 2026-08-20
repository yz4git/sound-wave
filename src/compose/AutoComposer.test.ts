import { describe, expect, it } from 'vitest';
import {
  compositionLengthSteps,
  defaultComposeSettings,
  generateComposition,
  type AutoComposeSettings,
} from './AutoComposer';

const settings: AutoComposeSettings = {
  ...defaultComposeSettings(12345),
  tonic: 0,
  mode: 'minor',
  bpm: 108,
  density: 0.55,
  bars: 8,
  seed: 12345,
};

describe('AutoComposer', () => {
  it('generates deterministic compositions from the same settings and seed', () => {
    expect(generateComposition(settings)).toEqual(generateComposition(settings));
  });

  it('starts and ends on tonic to create a complete phrase', () => {
    const composition = generateComposition(settings);
    expect(composition.chords[0]?.degree).toBe(0);
    expect(composition.chords.at(-1)?.degree).toBe(0);
  });

  it('keeps melodic notes inside the selected scale or current chord vocabulary', () => {
    const composition = generateComposition(settings);
    const allowed = new Set([0, 2, 3, 5, 7, 8, 10]);
    for (const note of composition.melody) expect(allowed.has(note.pitch)).toBe(true);
  });

  it('creates a playable rhythm section and the requested bar length', () => {
    const composition = generateComposition(settings);
    expect(composition.drums.some((event) => event.voice === 'kick')).toBe(true);
    expect(composition.drums.some((event) => event.voice === 'snare')).toBe(true);
    expect(compositionLengthSteps(composition)).toBe(128);
  });

  it('changes material when the seed changes', () => {
    const a = generateComposition(settings);
    const b = generateComposition({ ...settings, seed: settings.seed + 1 });
    expect(a.melody).not.toEqual(b.melody);
  });
});
