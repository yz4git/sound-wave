import { describe, expect, it } from 'vitest';
import type { VocalEvent } from '../src/compose/VocalGenerator';
import { vocalResonanceControlFor } from '../src/compose/VocalResonance';
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

describe('dynamic resonance and glottal control', () => {
  it('keeps harmonic collision protection conservative', () => {
    const vocal = event();
    const control = vocalResonanceControlFor(vocal, neutralPhraseControl(vocal));
    expect(control.collisionThresholdRatio).toBeGreaterThan(0.25);
    expect(control.collisionThresholdRatio).toBeLessThan(0.6);
    expect(control.collisionGainFloor).toBeGreaterThanOrEqual(0.7);
    expect(control.collisionGainFloor).toBeLessThan(1);
    expect(control.collisionBandwidthBoost).toBeGreaterThan(0);
    expect(control.collisionBandwidthBoost).toBeLessThan(0.5);
  });

  it('uses restrained glottal and resonance motion', () => {
    const vocal = event({ phraseEnd: true });
    const control = vocalResonanceControlFor(vocal, neutralPhraseControl(vocal));
    expect(control.energyClosureDepth).toBeGreaterThan(0);
    expect(control.energyClosureDepth).toBeLessThan(0.06);
    expect(control.releaseOpenBoost).toBeGreaterThan(0);
    expect(control.releaseOpenBoost).toBeLessThan(0.08);
    expect(control.highPitchOpenBoost).toBeLessThan(0.05);
    expect(control.vibratoResonanceDepth).toBeGreaterThan(0);
    expect(control.vibratoResonanceDepth).toBeLessThan(0.03);
  });

  it('adds anti-formant control only to nasal syllables', () => {
    const plain = event({ syllable: 'ka' });
    const nasal = event({ syllable: 'na' });
    const moraicN = event({ syllable: 'n' });

    const plainControl = vocalResonanceControlFor(plain, neutralPhraseControl(plain));
    const nasalControl = vocalResonanceControlFor(nasal, neutralPhraseControl(nasal));
    const moraicControl = vocalResonanceControlFor(moraicN, neutralPhraseControl(moraicN));

    expect(plainControl.nasalZeroMix).toBe(0);
    expect(plainControl.nasalZeroHz).toBe(0);
    expect(nasalControl.nasalZeroMix).toBeGreaterThan(0);
    expect(nasalControl.nasalZeroHz).toBeGreaterThan(800);
    expect(moraicControl.nasalZeroMix).toBeGreaterThan(nasalControl.nasalZeroMix);
  });
});
