import { describe, expect, it } from 'vitest';
import { defaultComposeSettings, generateComposition } from '../src/compose/AutoComposer';
import { generateVocalLine } from '../src/compose/VocalGenerator';
import { neutralPhraseControl } from '../src/compose/VocalPhraseModel';
import { sourceFilterCouplingFor } from '../src/compose/VocalSourceFilterCoupling';
import type { VocalSpectralEnvelopeControl } from '../src/compose/VocalSpectralEnvelope';
import { vocalEventToWorklet } from '../src/compose/VocalWorkletBridge';

const spectral: VocalSpectralEnvelopeControl = {
  timeSmoothingMs: 30,
  transitionSmoothingMs: 9,
  frequencySmoothing: 0.12,
  transitionProtectionSeconds: 0.06,
  spectralTiltDepth: 0.012,
  vibratoEnvelopeDepth: 0.005,
  trajectoryDepth: 0.92,
};

function baseEvent() {
  const composition = generateComposition({ ...defaultComposeSettings(9090), seed: 9090, density: 1 });
  const event = generateVocalLine(composition, 20209)[0];
  expect(event).toBeDefined();
  return event!;
}

describe('v20.9 dynamic source-filter coupling', () => {
  it('reduces tract feedback while increasing source softening at high F0', () => {
    const event = baseEvent();
    const phrase = neutralPhraseControl(event);
    const low = sourceFilterCouplingFor({ ...event, vowel: 'a' }, 220, phrase, spectral);
    const high = sourceFilterCouplingFor({ ...event, vowel: 'a' }, 880, phrase, spectral);

    expect(high.highPitchCompensation).toBeGreaterThan(low.highPitchCompensation);
    expect(high.sourceTiltDepth).toBeGreaterThan(low.sourceTiltDepth);
    expect(high.tractFeedbackDepth).toBeLessThan(low.tractFeedbackDepth);
  });

  it('gives open vowels more filter load than closed vowels', () => {
    const event = baseEvent();
    const phrase = neutralPhraseControl(event);
    const open = sourceFilterCouplingFor({ ...event, vowel: 'a' }, 330, phrase, spectral);
    const closed = sourceFilterCouplingFor({ ...event, vowel: 'i' }, 330, phrase, spectral);

    expect(open.filterLoad).toBeGreaterThan(closed.filterLoad);
    expect(open.openQuotientOffset).toBeGreaterThan(closed.openQuotientOffset);
  });

  it('opens and aspirates more at phrase release without exceeding safety bounds', () => {
    const event = baseEvent();
    const middle = { ...event, phraseEnd: false };
    const ending = { ...event, phraseEnd: true };
    const middleControl = sourceFilterCouplingFor(middle, 440, neutralPhraseControl(middle), spectral);
    const endingControl = sourceFilterCouplingFor(ending, 440, neutralPhraseControl(ending), spectral);

    expect(endingControl.aspirationCoupling).toBeGreaterThan(middleControl.aspirationCoupling);
    expect(endingControl.openQuotientOffset).toBeGreaterThan(middleControl.openQuotientOffset);
    expect(endingControl.tractFeedbackDepth).toBeLessThanOrEqual(0.0105);
    expect(endingControl.highPitchCompensation).toBeLessThanOrEqual(0.6);
  });

  it('maps coupling into the actual worklet event while preserving Presence Reset', () => {
    const event = baseEvent();
    const mapped = vocalEventToWorklet({ ...event, vowel: 'a' }, 'warm', 1, 0.72);

    expect(mapped.sourceFilter.tractFeedbackDepth).toBeGreaterThan(0);
    expect(mapped.sourceFilter.sourceTiltDepth).toBeGreaterThan(0);
    expect(mapped.phrase.sourceTractCoupling).toBeGreaterThanOrEqual(0.004);
    expect(mapped.phrase.sourceTractCoupling).toBeLessThanOrEqual(0.013);
    expect(mapped.style.glottalOpenQuotient).toBeGreaterThan(0.48);
    expect(mapped.style.glottalOpenQuotient).toBeLessThan(0.82);
    expect(mapped.spectral.spectralTiltDepth).toBeGreaterThanOrEqual(0.006);
    expect(mapped.style.presenceGain).toBe(0);
  });
});
