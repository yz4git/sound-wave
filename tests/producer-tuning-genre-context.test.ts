import { describe, expect, it } from 'vitest';
import { defaultComposeSettings, generateComposition } from '../src/compose/AutoComposer';
import { genreStyle } from '../src/compose/GenreStyle';
import { generateVocalLine } from '../src/compose/VocalGenerator';
import { neutralPhraseControl } from '../src/compose/VocalPhraseModel';
import { vocalEventToWorklet } from '../src/compose/VocalWorkletBridge';

describe('genre-aware producer tuning context', () => {
  it('changes practical tuning with the selected genre profile', () => {
    const composition = generateComposition({ ...defaultComposeSettings(404), seed: 404, density: 1 });
    const base = generateVocalLine(composition, 9898)[0];
    expect(base).toBeDefined();
    const event = { ...base!, phraseStart: true, durationSteps: 3 };
    const phrase = neutralPhraseControl(event);

    const rock = vocalEventToWorklet(event, 'warm', 2, 0.72, phrase, genreStyle('rock', 'hard-rock'));
    const kpop = vocalEventToWorklet(event, 'warm', 2, 0.72, phrase, genreStyle('k-pop', 'dance-pop'));
    const ballad = vocalEventToWorklet(event, 'warm', 2, 0.72, phrase, genreStyle('j-pop', 'ballad'));

    expect(rock.style.attackSeconds).toBeLessThan(ballad.style.attackSeconds);
    expect(kpop.style.jitterCents).toBeLessThan(rock.style.jitterCents);
    expect(ballad.style.breathLevel).toBeGreaterThan(rock.style.breathLevel);
  });

  it('uses the arrangement section to identify hook tuning', () => {
    const settings = { ...defaultComposeSettings(505), seed: 505, density: 1, bars: 8 };
    const composition = generateComposition(settings);
    const base = generateVocalLine(composition, 6767)[0];
    expect(base).toBeDefined();
    const event = { ...base!, phraseStart: true, step: 64 };
    const phrase = neutralPhraseControl(event);
    const profile = genreStyle('j-pop', 'mainstream');
    const chorus = composition.arrangement.find((bar) => bar.section === 'chorus');
    const verse = composition.arrangement.find((bar) => bar.section === 'verse');
    expect(chorus).toBeDefined();
    expect(verse).toBeDefined();

    const hook = vocalEventToWorklet(event, 'warm', 2, 0.5, phrase, profile, chorus, 0);
    const plain = vocalEventToWorklet(event, 'warm', 2, 0.5, phrase, profile, verse, 0);

    expect(hook.producerTuning.role).toBe('hook');
    expect(hook.producerTuning.dynamicsStartScale).toBeGreaterThanOrEqual(plain.producerTuning.dynamicsStartScale);
  });
});
