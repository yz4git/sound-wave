import { describe, expect, it } from 'vitest';
import {
  accentNucleusForPattern,
  accentPatternForNucleus,
  applyAccentNucleus,
  collectAccentPhrases,
} from '../src/voice/VoiceAccentEditor';
import { parseVoiceScript } from '../src/voice/VoiceScript';

describe('VOICE LAB accent phrase editor', () => {
  it('builds heiban and lexical-drop patterns', () => {
    expect(accentPatternForNucleus(4, 0)).toEqual(['low', 'high', 'high', 'high']);
    expect(accentPatternForNucleus(4, 1)).toEqual(['high', 'low', 'low', 'low']);
    expect(accentPatternForNucleus(4, 2)).toEqual(['low', 'high', 'low', 'low']);
    expect(accentPatternForNucleus(4, 4)).toEqual(['low', 'high', 'high', 'high']);
  });

  it('infers visible nucleus positions when a drop exists', () => {
    expect(accentNucleusForPattern(['high', 'low', 'low'])).toBe(1);
    expect(accentNucleusForPattern(['low', 'high', 'low'])).toBe(2);
    expect(accentNucleusForPattern(['low', 'high', 'high'])).toBe(0);
    expect(accentNucleusForPattern(['auto', 'auto'])).toBeNull();
  });

  it('applies a manual nucleus to only one accent phrase', () => {
    const script = parseVoiceScript('あいう、えお');
    const phrases = collectAccentPhrases(script);

    expect(phrases).toHaveLength(2);
    applyAccentNucleus(script, phrases[0]!.start, phrases[0]!.end, 2);

    expect(script.units.slice(0, 3).map((unit) => unit.pitchAccent))
      .toEqual(['low', 'high', 'low']);
    expect(script.units.slice(3).every((unit) => unit.pitchAccent === 'auto')).toBe(true);
  });
});
