import { describe, expect, it } from 'vitest';
import type { VocalEvent } from '../src/compose/VocalGenerator';
import { karaokeSingingControlFor } from '../src/compose/KaraokeSinging';
import { neutralPhraseControl } from '../src/compose/VocalPhraseModel';

function event(overrides: Partial<VocalEvent> = {}): VocalEvent {
  return {
    step: 0,
    pitch: 0,
    octave: 4,
    durationSteps: 2,
    velocity: 0.8,
    syllable: 'ka',
    vowel: 'a',
    nextVowel: 'i',
    articulate: true,
    phraseStart: true,
    phraseEnd: false,
    glideFromMidi: null,
    ...overrides,
  };
}

describe('karaoke-score-inspired vocal control', () => {
  it('keeps long tones straighter and more stable before late vibrato', () => {
    const vocal = event();
    const control = karaokeSingingControlFor(vocal, 0.9, neutralPhraseControl(vocal));
    expect(control.longTone).toBe(true);
    expect(control.pitchStability).toBeGreaterThanOrEqual(0.9);
    expect(control.straightHoldRatio).toBeGreaterThanOrEqual(0.6);
    expect(control.vibratoGain).toBeGreaterThan(0.5);
  });

  it('keeps short notes nearly straight rather than overusing vibrato', () => {
    const vocal = event({ durationSteps: 1, phraseStart: false });
    const control = karaokeSingingControlFor(vocal, 0.28, neutralPhraseControl(vocal));
    expect(control.longTone).toBe(false);
    expect(control.vibratoGain).toBeLessThan(0.25);
    expect(control.straightHoldRatio).toBeGreaterThanOrEqual(0.85);
  });

  it('uses small deterministic ornaments only at eligible phrase boundaries', () => {
    const start = event({ step: 0, phraseStart: true });
    const startControl = karaokeSingingControlFor(start, 0.5, neutralPhraseControl(start));
    expect(startControl.scoopCents).toBeGreaterThan(0);
    expect(startControl.scoopCents).toBeLessThanOrEqual(10);

    const middle = event({ step: 8, phraseStart: false, phraseEnd: false });
    const middleControl = karaokeSingingControlFor(middle, 0.5, neutralPhraseControl(middle));
    expect(middleControl.scoopCents).toBe(0);
    expect(middleControl.fallCents).toBe(0);
  });

  it('adds a modest four-bar dynamic contour without extreme level jumps', () => {
    const gains = [0, 16, 32, 48].map((step) => {
      const vocal = event({ step });
      return karaokeSingingControlFor(vocal, 0.5, neutralPhraseControl(vocal)).dynamicGain;
    });
    expect(gains[0]).toBeLessThan(gains[3]!);
    expect(Math.min(...gains)).toBeGreaterThanOrEqual(0.9);
    expect(Math.max(...gains)).toBeLessThanOrEqual(1.1);
  });
});
