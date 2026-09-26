import { describe, expect, it } from 'vitest';
import {
  geminatePreclosureSeconds,
  speechSourceProfileFor,
} from '../src/voice/VoiceSynth';

describe('VOICE LAB speech source', () => {
  it('uses a strongly speech-weighted source for neutral delivery', () => {
    const profile = speechSourceProfileFor({ preset: 'neutral', intensity: 1 });

    expect(profile.sourceMix).toBeGreaterThan(0.85);
    expect(profile.sourceTilt).toBeGreaterThan(0.5);
    expect(profile.coarticulation).toBeGreaterThan(0.75);
    expect(profile.pulseNoise).toBeGreaterThan(0);
  });

  it('moves whisper toward more tilt and aspiration', () => {
    const neutral = speechSourceProfileFor({ preset: 'neutral', intensity: 1 });
    const whisper = speechSourceProfileFor({ preset: 'whisper', intensity: 1 });

    expect(whisper.sourceTilt).toBeGreaterThan(neutral.sourceTilt);
    expect(whisper.pulseNoise).toBeGreaterThan(neutral.pulseNoise);
    expect(whisper.sourceMix).toBeLessThan(neutral.sourceMix);
  });

  it('returns to neutral source behavior when style intensity is zero', () => {
    const neutral = speechSourceProfileFor({ preset: 'neutral', intensity: 1 });
    const mutedExcited = speechSourceProfileFor({ preset: 'excited', intensity: 0 });

    expect(mutedExcited).toEqual(neutral);
  });

  it('keeps Japanese sokuon pre-closure in a speech-like range', () => {
    expect(geminatePreclosureSeconds(1)).toBeGreaterThanOrEqual(0.08);
    expect(geminatePreclosureSeconds(0.7)).toBeGreaterThan(geminatePreclosureSeconds(1.4));
    expect(geminatePreclosureSeconds(1.5)).toBeGreaterThanOrEqual(0.06);
  });
});
