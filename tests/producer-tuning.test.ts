import { describe, expect, it } from 'vitest';
import { defaultComposeSettings, generateComposition } from '../src/compose/AutoComposer';
import { genreStyle } from '../src/compose/GenreStyle';
import { producerTuningFor } from '../src/compose/ProducerTuning';
import { generateVocalLine } from '../src/compose/VocalGenerator';
import { buildVocalPhraseControls, neutralPhraseControl } from '../src/compose/VocalPhraseModel';

describe('producer tuning grammar', () => {
  it('keeps ornaments sparse instead of applying them to every note', () => {
    const composition = generateComposition({ ...defaultComposeSettings(321), seed: 321, density: 1 });
    const line = generateVocalLine(composition, 777);
    const controls = buildVocalPhraseControls(line);
    const profile = genreStyle('j-pop', 'mainstream');
    const tuned = line.map((event) => producerTuningFor(
      event,
      controls.get(event.step) ?? neutralPhraseControl(event),
      profile,
      composition.arrangement[Math.floor(event.step / 16)],
      event.step % 16,
      event.durationSteps * 0.13,
    ));

    const ornamented = tuned.filter((control) => control.scoopCentsAdd > 0 || control.fallCentsAdd > 0);
    expect(ornamented.length).toBeLessThan(tuned.length);
    expect(tuned.some((control) => control.role === 'plain' || control.role === 'long-tone')).toBe(true);
  });

  it('makes phrase heads crisper and phrase tails dynamically softer', () => {
    const composition = generateComposition({ ...defaultComposeSettings(42), seed: 42, density: 1 });
    const line = generateVocalLine(composition, 1234);
    const head = line.find((event) => event.phraseStart);
    const tail = line.find((event) => event.phraseEnd);
    expect(head).toBeDefined();
    expect(tail).toBeDefined();

    const headControl = producerTuningFor(head!, neutralPhraseControl(head!), undefined, undefined, head!.step % 16, 0.45);
    const tailControl = producerTuningFor(tail!, neutralPhraseControl(tail!), undefined, undefined, tail!.step % 16, 0.45);

    expect(headControl.attackTimeScale).toBeLessThan(1);
    expect(headControl.dynamicsStartScale).toBeGreaterThanOrEqual(1);
    expect(tailControl.dynamicsEndScale).toBeLessThan(1.02);
    expect(tailControl.airScale).toBeGreaterThanOrEqual(1);
  });

  it('uses longer-note vibrato without destabilizing micro pitch', () => {
    const composition = generateComposition({ ...defaultComposeSettings(91), seed: 91, density: 1 });
    const line = generateVocalLine(composition, 8181);
    const event = line[0];
    expect(event).toBeDefined();

    const shortControl = producerTuningFor({ ...event!, durationSteps: 1 }, neutralPhraseControl(event!), undefined, undefined, event!.step % 16, 0.22);
    const longControl = producerTuningFor({ ...event!, durationSteps: 4 }, neutralPhraseControl(event!), undefined, undefined, event!.step % 16, 0.9);

    expect(longControl.vibratoScale).toBeGreaterThan(shortControl.vibratoScale);
    expect(longControl.jitterScale).toBeLessThanOrEqual(1.05);
    expect(shortControl.jitterScale).toBeLessThanOrEqual(1.05);
  });

  it('adapts diction and air to the selected genre', () => {
    const composition = generateComposition({ ...defaultComposeSettings(55), seed: 55, density: 1 });
    const event = generateVocalLine(composition, 444)[0];
    expect(event).toBeDefined();
    const phrase = neutralPhraseControl(event!);

    const rock = producerTuningFor(event!, phrase, genreStyle('rock', 'hard-rock'), undefined, event!.step % 16, 0.4);
    const kpop = producerTuningFor(event!, phrase, genreStyle('k-pop', 'dance-pop'), undefined, event!.step % 16, 0.4);
    const ballad = producerTuningFor(event!, phrase, genreStyle('j-pop', 'ballad'), undefined, event!.step % 16, 0.4);

    expect(rock.attackTimeScale).toBeLessThan(ballad.attackTimeScale);
    expect(kpop.jitterScale).toBeLessThan(rock.jitterScale);
    expect(ballad.airScale).toBeGreaterThan(rock.airScale);
  });
});
