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
    expect(consonantForSyllable('shi')).toBe('sh');
    expect(consonantForSyllable('chi')).toBe('ch');
    expect(consonantForSyllable('tsu')).toBe('ts');
    expect(consonantForSyllable('ji')).toBe('j');
    expect(consonantForSyllable('da')).toBe('d');
    expect(consonantForSyllable('wa')).toBe('w');
    expect(consonantForSyllable('vu')).toBe('v');
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

  it('models Japanese affricates as closure plus sustained frication', () => {
    for (const syllable of ['chi', 'tsu', 'ji']) {
      const timing = phonemeTimingFor(syllable);
      expect(timing.closureSeconds).toBeGreaterThan(0);
      expect(timing.fricationSeconds).toBeGreaterThan(0.035);
      expect(timing.noiseMix).toBeGreaterThan(0.15);
    }
    expect(phonemeTimingFor('chi').voicedMix).toBeLessThan(phonemeTimingFor('ji').voicedMix);
  });

  it('keeps Japanese /k/ VOT longer than /p/ and /t/', () => {
    const k = phonemeTimingFor('ka').voicingDelaySeconds;
    const t = phonemeTimingFor('ta').voicingDelaySeconds;
    const p = phonemeTimingFor('pa').voicingDelaySeconds;

    expect(k).toBeGreaterThan(t);
    expect(k).toBeGreaterThan(p);
    expect(k).toBeGreaterThan(0.045);
    expect(t).toBeGreaterThanOrEqual(0.025);
    expect(p).toBeGreaterThanOrEqual(0.025);
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
