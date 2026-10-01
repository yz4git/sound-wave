import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../public/vocal-worklet.js', import.meta.url), 'utf8');

describe('speech-only vocal worklet DSP', () => {
  it('keeps the static AudioWorklet syntactically valid', () => {
    expect(() => new Function(source)).not.toThrow();
  });

  it('contains continuous tract, CV overlap, and glottal-humanization paths', () => {
    expect(source).toContain('speechFormantCarry');
    expect(source).toContain('speechVowelTransitionScale');
    expect(source).toContain('speechCVOverlap');
    expect(source).toContain('speechGlottalDriftCents');
    expect(source).toContain('speechGlottalJitterCents');
    expect(source).toContain('speechOpenQuotientMotion');
    expect(source).toContain('speechMicroPhase');
  });
});
