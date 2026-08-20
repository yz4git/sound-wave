import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('continuous vocal AudioWorklet source', () => {
  const source = readFileSync('public/vocal-worklet.js', 'utf8');

  it('registers one persistent Sound Wave vocal processor', () => {
    expect(source).toContain("registerProcessor('sound-wave-vocal-processor'");
    expect(source).toContain('class SoundWaveVocalProcessor extends AudioWorkletProcessor');
  });

  it('does not recreate oscillator nodes for vocal notes', () => {
    expect(source).not.toMatch(/createOscillator\s*\(/);
    expect(source).toContain('this.phase');
    expect(source).toContain('glottalFlow');
  });

  it('keeps source-filter and humanization state inside the worklet', () => {
    expect(source).toContain('formantY1');
    expect(source).toContain('jitterState');
    expect(source).toContain('shimmerState');
    expect(source).toContain('delayBuffer');
    expect(source).toContain('radiationState');
  });
});
