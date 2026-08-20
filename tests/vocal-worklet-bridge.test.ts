import { describe, expect, it } from 'vitest';
import { defaultComposeSettings, generateComposition } from '../src/compose/AutoComposer';
import { generateVocalLine } from '../src/compose/VocalGenerator';
import { buildVocalPhraseControls } from '../src/compose/VocalPhraseModel';
import { vocalEventToWorklet } from '../src/compose/VocalWorkletBridge';

describe('continuous vocal AudioWorklet bridge', () => {
  it('maps a vocal note into one complete DSP event', () => {
    const composition = generateComposition({ ...defaultComposeSettings(4242), seed: 4242, density: 1 });
    const line = generateVocalLine(composition, 99);
    const event = line[0];
    expect(event).toBeDefined();

    const mapped = vocalEventToWorklet(event!, 'warm', 1.25, 0.5);
    expect(mapped.when).toBe(1.25);
    expect(mapped.duration).toBe(0.5);
    expect(mapped.targetHz).toBeGreaterThan(60);
    expect(mapped.formants).toHaveLength(5);
    expect(mapped.formants.every((band) => band.bandwidth > 0 && band.targetHz > 0)).toBe(true);
    expect(mapped.phoneme.coarticulationLead).toBeGreaterThan(0);
    expect(mapped.phoneme.voicingDelaySeconds).toBeGreaterThanOrEqual(0);
    expect(mapped.style.glottalOpenQuotient).toBeGreaterThan(0);
    expect(mapped.style.glottalOpenQuotient).toBeLessThan(1);
    expect(mapped.style.vibratoRateHz).toBeGreaterThanOrEqual(5);
    expect(mapped.style.vibratoRateHz).toBeLessThanOrEqual(7);
    expect(mapped.phrase.energyStart).toBeGreaterThan(0);
    expect(mapped.phrase.sourceTractCoupling).toBeGreaterThan(0);
  });

  it('maps planned next vowels into per-formant anticipatory targets', () => {
    const composition = generateComposition({ ...defaultComposeSettings(76543), seed: 76543, density: 1 });
    const line = generateVocalLine(composition, 222);
    const event = line.find((candidate) => candidate.nextVowel !== null);
    expect(event).toBeDefined();

    const mapped = vocalEventToWorklet(event!, 'warm', 0.5, 0.45);
    expect(mapped.formants.every((band) => band.nextHz !== null)).toBe(true);
    expect(mapped.formants.some((band) => band.nextHz !== band.targetHz)).toBe(true);
  });

  it('maps requested Japanese obstruent timing into the worklet event', () => {
    let mappedStop: ReturnType<typeof vocalEventToWorklet> | null = null;
    let mappedFricative: ReturnType<typeof vocalEventToWorklet> | null = null;

    for (let seed = 1; seed <= 40 && (!mappedStop || !mappedFricative); seed += 1) {
      const composition = generateComposition({ ...defaultComposeSettings(seed), seed, density: 1 });
      const line = generateVocalLine(composition, seed * 7919);
      for (const event of line) {
        if (!event.articulate) continue;
        const mapped = vocalEventToWorklet(event, 'warm', 0, 0.4);
        if (['k', 't', 'p', 'b', 'g'].includes(mapped.phoneme.consonant)) mappedStop ??= mapped;
        if (['s', 'h', 'f', 'z'].includes(mapped.phoneme.consonant)) mappedFricative ??= mapped;
      }
    }

    expect(mappedStop).not.toBeNull();
    expect(mappedStop!.phoneme.closureSeconds).toBeGreaterThan(0);
    expect(mappedStop!.phoneme.burstSeconds).toBeGreaterThan(0);
    expect(mappedFricative).not.toBeNull();
    expect(mappedFricative!.phoneme.fricationSeconds).toBeGreaterThan(0);
    expect(mappedFricative!.phoneme.noiseMix).toBeGreaterThan(0);
  });

  it('preserves phrase and portamento planning for melisma events', () => {
    const composition = generateComposition({ ...defaultComposeSettings(98765), seed: 98765, density: 1 });
    const line = generateVocalLine(composition, 314159);
    const melisma = line.find((event) => !event.articulate && event.glideFromMidi !== null);
    expect(melisma).toBeDefined();

    const controls = buildVocalPhraseControls(line);
    const phraseControl = controls.get(melisma!.step);
    expect(phraseControl).toBeDefined();

    const mapped = vocalEventToWorklet(melisma!, 'airy', 2, 0.32, phraseControl!);
    expect(mapped.articulate).toBe(false);
    expect(mapped.glideFromHz).not.toBeNull();
    expect(mapped.glideFromHz!).toBeGreaterThan(40);
    expect(mapped.phraseStart).toBe(melisma!.phraseStart);
    expect(mapped.phraseEnd).toBe(melisma!.phraseEnd);
    expect(mapped.phrase.progressStart).toBe(phraseControl!.progressStart);
    expect(mapped.phrase.progressEnd).toBe(phraseControl!.progressEnd);
    expect(mapped.phrase.energyStart).toBe(phraseControl!.energyStart);
    expect(mapped.phrase.energyEnd).toBe(phraseControl!.energyEnd);
    expect(mapped.phrase.centeringEnd).toBe(phraseControl!.centeringEnd);
    expect(mapped.phrase.aspirationDepth).toBeGreaterThan(0);
    expect(mapped.phrase.sourceTractCoupling).toBeGreaterThan(0);
    expect(mapped.style.breathLevel).toBeGreaterThan(0);
    expect(mapped.style.doubleDelaySeconds).toBeGreaterThan(0);
  });
});
