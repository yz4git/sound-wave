import { describe, expect, it } from 'vitest';
import {
  parseVoiceMarkup,
  removeVoiceMarkup,
  wrapVoiceSelection,
} from '../src/voice/VoiceMarkup';

describe('Voice Lab local delivery markup', () => {
  it('removes recognized tags from spoken text while preserving mora order', () => {
    const script = parseVoiceMarkup('あ[whisper]さ[/]ひ');

    expect(script.plainText).toBe('あさひ');
    expect(script.units.map((unit) => unit.syllable)).toEqual(['a', 'sa', 'hi']);
    expect(script.markupUsed).toBe(true);
    expect(script.localExpressions[0]).toBeNull();
    expect(script.localExpressions[1]?.preset).toBe('whisper');
    expect(script.localExpressions[2]).toBeNull();
  });

  it('does not create a synthetic phrase boundary at style tag edges', () => {
    const script = parseVoiceMarkup('あ[calm]さ[/]ひ');

    expect(script.units[0]?.phraseStart).toBe(true);
    expect(script.units[0]?.phraseEnd).toBe(false);
    expect(script.units[1]?.phraseStart).toBe(false);
    expect(script.units[1]?.phraseEnd).toBe(false);
    expect(script.units[2]?.phraseEnd).toBe(true);
  });

  it('parses local delivery intensity percentages', () => {
    const script = parseVoiceMarkup('[excited:125]げんき[/]');

    expect(script.localExpressions.every((value) => value?.preset === 'excited')).toBe(true);
    expect(script.localExpressions.every((value) => value?.intensity === 1.25)).toBe(true);
  });

  it('preserves text segments for System TTS style switching', () => {
    const script = parseVoiceMarkup('ゆっくり [whisper:120]しずかに[/] そして [excited]げんきに[/]');

    expect(script.speechSegments.map((segment) => segment.expression?.preset ?? 'global'))
      .toEqual(['global', 'whisper', 'global', 'excited']);
    expect(script.speechSegments[1]?.expression?.intensity).toBe(1.2);
    expect(script.speechSegments.map((segment) => segment.text).join('')).toBe(script.plainText);
  });

  it('supports nested local delivery with the innermost style taking effect', () => {
    const script = parseVoiceMarkup('[calm]あ[whisper]さ[/]ひ[/]');

    expect(script.localExpressions[0]?.preset).toBe('calm');
    expect(script.localExpressions[1]?.preset).toBe('whisper');
    expect(script.localExpressions[2]?.preset).toBe('calm');
  });

  it('wraps only the selected text using the requested local style', () => {
    const result = wrapVoiceSelection(
      'あさひる',
      1,
      3,
      { preset: 'serious', intensity: 1.2 },
    );

    expect(result).not.toBeNull();
    expect(result?.text).toBe('あ[serious:120]さひ[/]る');
    expect(result?.text.slice(result.selectionStart, result.selectionEnd)).toBe('さひ');
  });

  it('can strip local delivery tags without altering ordinary text', () => {
    expect(removeVoiceMarkup('[whisper]しずか[/]に [excited:110]はやく[/]'))
      .toBe('しずかに はやく');
    expect(removeVoiceMarkup('ふつうの[unknown]タグ')).toBe('ふつうの[unknown]タグ');
  });
});
