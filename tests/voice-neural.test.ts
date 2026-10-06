import { describe, expect, it } from 'vitest';
import {
  KOKORO_JP_CDN,
  neuralSpeedForSettings,
  neuralVoiceIdForCharacter,
} from '../src/voice/NeuralVoice';

describe('Neural HQ configuration', () => {
  it('pins the browser renderer instead of following an unversioned CDN', () => {
    expect(KOKORO_JP_CDN).toContain('kokoro-js-jp@0.2.0');
  });

  it('maps each Sound Wave character to a Japanese Kokoro voice', () => {
    expect(neuralVoiceIdForCharacter('natural')).toBe('jf_alpha');
    expect(neuralVoiceIdForCharacter('soft')).toBe('jf_tebukuro');
    expect(neuralVoiceIdForCharacter('clear')).toBe('jf_nezumi');
    expect(neuralVoiceIdForCharacter('airy')).toBe('jf_gongitsune');
    expect(neuralVoiceIdForCharacter('power')).toBe('jm_kumo');
  });

  it('uses expression duration as neural speaking-rate control with safe bounds', () => {
    const neutral = neuralSpeedForSettings(1, { preset: 'neutral', intensity: 1 });
    const calm = neuralSpeedForSettings(1, { preset: 'calm', intensity: 1 });
    const excited = neuralSpeedForSettings(1, { preset: 'excited', intensity: 1 });
    expect(neutral).toBeGreaterThan(0.8);
    expect(calm).toBeLessThan(neutral);
    expect(excited).toBeGreaterThan(neutral);
    expect(neuralSpeedForSettings(10, { preset: 'neutral', intensity: 1 })).toBe(1.55);
    expect(neuralSpeedForSettings(0.1, { preset: 'neutral', intensity: 1 })).toBe(0.62);
  });
});
