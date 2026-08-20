import { describe, expect, it } from 'vitest';
import { consonantForSyllable, phonemeTimingFor } from '../src/compose/JapanesePhoneme';

describe('Japanese phoneme timing', () => {
  it('recognizes requested consonant classes and moraic n', () => {
    expect(consonantForSyllable('ka')).toBe('k');
    expect(consonantForSyllable('ta')).toBe('t');
    expect(consonantForSyllable('sa')).toBe('s');
    expect(consonantForSyllable('ha')).toBe('h');
    expect(consonantForSyllable('fu')).toBe('f');
    expect(consonantForSyllable('pa')).toBe('p');
    expect(consonantForSyllable('ba')).toBe('b');
    expect(consonantForSyllable('ga')).toBe('g');
    expect(consonantForSyllable('za')).toBe('z');
    expect(consonantForSyllable('na')).toBe('n');
    expect(consonantForSyllable('n')).toBe('N');
  });

  it('gives stops closure and burst timing', () => {
    for (const syllable of ['ka', 'ta', 'pa', 'ba', 'ga']) {
      const timing = phonemeTimingFor(syllable);
      expect(timing.closureSeconds).toBeGreaterThan(0);
      expect(timing.burstSeconds).toBeGreaterThan(0);
      expect(timing.voicingDelaySeconds).toBeGreaterThanOrEqual(0);
    }
  });

  it('gives fricatives an audible but bounded frication window', () => {
    for (const syllable of ['sa', 'ha', 'fu', 'za']) {
      const timing = phonemeTimingFor(syllable);
      expect(timing.fricationSeconds).toBeGreaterThan(0.025);
      expect(timing.fricationSeconds).toBeLessThan(0.08);
      expect(timing.noiseMix).toBeGreaterThan(0);
      expect(timing.noiseMix).toBeLessThan(0.3);
    }
  });

  it('keeps voiced obstruents voiced earlier than unvoiced peers', () => {
    expect(phonemeTimingFor('ba').voicingDelaySeconds).toBeLessThan(phonemeTimingFor('pa').voicingDelaySeconds);
    expect(phonemeTimingFor('ga').voicingDelaySeconds).toBeLessThan(phonemeTimingFor('ka').voicingDelaySeconds);
    expect(phonemeTimingFor('za').voicedMix).toBeGreaterThan(phonemeTimingFor('sa').voicedMix);
  });

  it('models moraic n as a strongly nasal voiced mora', () => {
    const timing = phonemeTimingFor('n');
    expect(timing.moraicN).toBe(true);
    expect(timing.nasalMix).toBeGreaterThan(0.7);
    expect(timing.voicedMix).toBeGreaterThan(0.7);
    expect(timing.coarticulationLead).toBeGreaterThan(0.3);
  });
});
