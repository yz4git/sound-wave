import { describe, expect, it } from 'vitest';
import type { VocalEvent } from '../src/compose/VocalGenerator';
import { neutralPhraseControl } from '../src/compose/VocalPhraseModel';
import { phonemeTimingFor } from '../src/compose/JapanesePhoneme';
import { vocaloidExpressionFor } from '../src/compose/VocaloidExpression';
import { spectralEnvelopeControlFor } from '../src/compose/VocalSpectralEnvelope';

function event(overrides: Partial<VocalEvent> = {}): VocalEvent {
  return {
    step: 0,
    pitch: 0,
    octave: 4,
    durationSteps: 2,
    velocity: 0.72,
    syllable: 'ka',
    vowel: 'a',
    nextVowel: null,
    articulate: true,
    phraseStart: true,
    phraseEnd: false,
    glideFromMidi: null,
    ...overrides,
  };
}

describe('v20.8 spectral envelope trajectory', () => {
  it('uses faster transition smoothing than sustained-vowel smoothing', () => {
    const vocal = event();
    const phrase = neutralPhraseControl(vocal);
    const phoneme = phonemeTimingFor(vocal.syllable);
    const vocaloid = vocaloidExpressionFor(vocal, phoneme, 0.8, phrase);
    const control = spectralEnvelopeControlFor(vocal, 0.8, phrase, vocaloid);

    expect(control.transitionSmoothingMs).toBeLessThan(control.timeSmoothingMs);
    expect(control.transitionProtectionSeconds).toBeGreaterThan(0.04);
    expect(control.frequencySmoothing).toBeGreaterThanOrEqual(0.08);
    expect(control.frequencySmoothing).toBeLessThanOrEqual(0.19);
  });

  it('gives longer vowels more time-frequency smoothing than short notes', () => {
    const vocal = event();
    const phrase = neutralPhraseControl(vocal);
    const phoneme = phonemeTimingFor(vocal.syllable);
    const shortExpression = vocaloidExpressionFor(vocal, phoneme, 0.22, phrase);
    const longExpression = vocaloidExpressionFor(vocal, phoneme, 1.1, phrase);
    const shortControl = spectralEnvelopeControlFor(vocal, 0.22, phrase, shortExpression);
    const longControl = spectralEnvelopeControlFor(vocal, 1.1, phrase, longExpression);

    expect(longControl.timeSmoothingMs).toBeGreaterThan(shortControl.timeSmoothingMs);
    expect(longControl.frequencySmoothing).toBeGreaterThan(shortControl.frequencySmoothing);
    expect(longControl.spectralTiltDepth).toBeGreaterThan(shortControl.spectralTiltDepth);
  });

  it('keeps every trajectory parameter inside conservative DSP bounds', () => {
    const vocal = event({ phraseStart: false, phraseEnd: true, syllable: 'sa' });
    const phrase = neutralPhraseControl(vocal);
    const phoneme = phonemeTimingFor(vocal.syllable);
    const vocaloid = vocaloidExpressionFor(vocal, phoneme, 2.2, phrase);
    const control = spectralEnvelopeControlFor(vocal, 2.2, phrase, vocaloid);

    expect(control.timeSmoothingMs).toBeGreaterThanOrEqual(22);
    expect(control.timeSmoothingMs).toBeLessThanOrEqual(40);
    expect(control.transitionSmoothingMs).toBeGreaterThanOrEqual(7);
    expect(control.spectralTiltDepth).toBeLessThanOrEqual(0.021);
    expect(control.vibratoEnvelopeDepth).toBeLessThanOrEqual(0.008);
    expect(control.trajectoryDepth).toBeGreaterThanOrEqual(0.72);
    expect(control.trajectoryDepth).toBeLessThanOrEqual(1.08);
  });
});
