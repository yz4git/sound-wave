import { describe, expect, it } from 'vitest';
import { phonemeTimingFor } from '../src/compose/JapanesePhoneme';
import type { VocalEvent } from '../src/compose/VocalGenerator';
import { neutralPhraseControl } from '../src/compose/VocalPhraseModel';
import {
  consonantPreRollSeconds,
  scoreAlignedExpressionFor,
} from '../src/compose/ScoreAlignedExpression';

function event(syllable: string, overrides: Partial<VocalEvent> = {}): VocalEvent {
  return {
    step: 0,
    pitch: 0,
    octave: 4,
    durationSteps: 2,
    velocity: 0.72,
    syllable,
    vowel: 'a',
    nextVowel: null,
    articulate: true,
    phraseStart: true,
    phraseEnd: false,
    glideFromMidi: null,
    ...overrides,
  };
}

describe('score-aligned expression planning', () => {
  it('pre-rolls consonants but keeps vowel-only notes on score time', () => {
    const vowel = event('ah');
    const stop = event('ka');
    const fricative = event('sa');

    expect(consonantPreRollSeconds(vowel, phonemeTimingFor(vowel.syllable))).toBe(0);
    expect(consonantPreRollSeconds(stop, phonemeTimingFor(stop.syllable))).toBeGreaterThan(0.04);
    expect(consonantPreRollSeconds(fricative, phonemeTimingFor(fricative.syllable))).toBeGreaterThan(0.04);
  });

  it('never pre-rolls beyond the scheduler safety bound', () => {
    for (const syllable of ['ka', 'ta', 'sa', 'ha', 'fu', 'pa', 'ba', 'ga', 'za', 'na']) {
      const current = event(syllable);
      const preRoll = consonantPreRollSeconds(current, phonemeTimingFor(syllable));
      expect(preRoll).toBeGreaterThanOrEqual(0);
      expect(preRoll).toBeLessThanOrEqual(0.065);
    }
  });

  it('protects articulated transitions and gives long sustains more timbre motion', () => {
    const articulated = event('ka');
    const legato = event('a', { articulate: false, phraseStart: false, glideFromMidi: 60 });
    const phrase = neutralPhraseControl(articulated);

    const shortControl = scoreAlignedExpressionFor(articulated, phonemeTimingFor('ka'), 0.24, phrase);
    const longControl = scoreAlignedExpressionFor(articulated, phonemeTimingFor('ka'), 1.1, phrase);
    const legatoControl = scoreAlignedExpressionFor(legato, phonemeTimingFor('a'), 0.6, neutralPhraseControl(legato));

    expect(shortControl.transitionPreservation).toBeGreaterThanOrEqual(0.9);
    expect(longControl.sustainTimbreMotion).toBeGreaterThan(shortControl.sustainTimbreMotion);
    expect(legatoControl.sustainTimbreMotion).toBeGreaterThanOrEqual(1);
  });

  it('softens phrase entry and phrase release without large dynamics jumps', () => {
    const start = event('na', { phraseStart: true, phraseEnd: false });
    const end = event('ne', { phraseStart: false, phraseEnd: true });
    const startControl = scoreAlignedExpressionFor(start, phonemeTimingFor('na'), 0.6, neutralPhraseControl(start));
    const endControl = scoreAlignedExpressionFor(end, phonemeTimingFor('ne'), 0.6, neutralPhraseControl(end));

    expect(startControl.energyStartScale).toBeLessThan(1);
    expect(startControl.energyStartScale).toBeGreaterThan(0.9);
    expect(endControl.energyEndScale).toBeLessThan(0.95);
    expect(endControl.upperFormantScale).toBeGreaterThanOrEqual(0.975);
    expect(endControl.upperFormantScale).toBeLessThanOrEqual(1.025);
  });
});
