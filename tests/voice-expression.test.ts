import { describe, expect, it } from 'vitest';
import {
  validVoiceExpressionPreset,
  voiceExpressionControl,
  voiceExpressionForUnit,
} from '../src/voice/VoiceExpression';
import { parseVoiceScript } from '../src/voice/VoiceScript';

describe('Voice Lab expression presets', () => {
  it('validates the supported delivery presets', () => {
    expect(validVoiceExpressionPreset('neutral')).toBe(true);
    expect(validVoiceExpressionPreset('whisper')).toBe(true);
    expect(validVoiceExpressionPreset('unknown')).toBe(false);
  });

  it('maps excited speech toward higher, stronger and faster delivery', () => {
    const control = voiceExpressionControl({ preset: 'excited', intensity: 1 });

    expect(control.pitchShift).toBeGreaterThan(0);
    expect(control.pitchRangeScale).toBeGreaterThan(1);
    expect(control.energyScale).toBeGreaterThan(1);
    expect(control.durationScale).toBeLessThan(1);
    expect(control.attackScale).toBeLessThan(1);
  });

  it('maps calm speech toward softer, slower and narrower delivery', () => {
    const control = voiceExpressionControl({ preset: 'calm', intensity: 1 });

    expect(control.pitchRangeScale).toBeLessThan(1);
    expect(control.energyScale).toBeLessThan(1);
    expect(control.durationScale).toBeGreaterThan(1);
    expect(control.attackScale).toBeGreaterThan(1);
  });

  it('uses breath and reduced voicing for whisper delivery', () => {
    const control = voiceExpressionControl({ preset: 'whisper', intensity: 1 });

    expect(control.breathScale).toBeGreaterThan(1.5);
    expect(control.voicingScale).toBeLessThan(0.6);
    expect(control.energyScale).toBeLessThan(0.8);
  });

  it('scales smoothly toward neutral at zero intensity', () => {
    const control = voiceExpressionControl({ preset: 'excited', intensity: 0 });

    expect(control.pitchShift).toBe(0);
    expect(control.pitchRangeScale).toBe(1);
    expect(control.energyScale).toBe(1);
    expect(control.durationScale).toBe(1);
    expect(control.breathScale).toBe(1);
    expect(control.voicingScale).toBe(1);
  });

  it('adds local phrase shaping without changing the text plan', () => {
    const script = parseVoiceScript('あさ。ひる。');
    const first = voiceExpressionForUnit(
      script.units[0]!,
      0,
      script.units.length,
      { preset: 'narration', intensity: 1 },
    );
    const middle = voiceExpressionForUnit(
      script.units[1]!,
      1,
      script.units.length,
      { preset: 'narration', intensity: 1 },
    );

    expect(first.pitchOffset).toBeGreaterThan(middle.pitchOffset);
    expect(script.units.map((unit) => unit.syllable)).toEqual(['a', 'sa', 'hi', 'ru']);
  });
});
