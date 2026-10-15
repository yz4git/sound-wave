import { describe, expect, it } from 'vitest';
import { neuralCpuDtypeForDevice, neuralPlaybackCacheKey, type NeuralProsodyPlan } from '../src/voice/NeuralVoice';

describe('iPhone Kokoro WASM memory safety', () => {
  it('uses smaller q4 model on iOS Safari instead of 90MB q8', () => {
    expect(neuralCpuDtypeForDevice({
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_5 like Mac OS X) AppleWebKit/605.1.15',
      platform: 'iPhone',
      maxTouchPoints: 5,
    })).toBe('q4');
    expect(neuralCpuDtypeForDevice({
      userAgent: 'Mozilla/5.0 (iPad; CPU OS 26_4 like Mac OS X)',
      platform: 'iPad',
      maxTouchPoints: 5,
    })).toBe('q4');
    expect(neuralCpuDtypeForDevice({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15',
      platform: 'MacIntel',
      maxTouchPoints: 5,
    })).toBe('q4');
  });
  it('keeps desktop q8 and does not treat macOS touchless Safari as an iPad', () => {
    expect(neuralCpuDtypeForDevice({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      platform: 'MacIntel',
      maxTouchPoints: 0,
    })).toBe('q8');
    expect(neuralCpuDtypeForDevice({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      platform: 'Win32',
      maxTouchPoints: 0,
    })).toBe('q8');
  });
});
