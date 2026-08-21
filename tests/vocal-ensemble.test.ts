import { afterEach, describe, expect, it } from 'vitest';
import { defaultFullSongSettings, generateFullSongComposition } from '../src/compose/FullSongComposer';
import { genreStyle } from '../src/compose/GenreStyle';
import type { VocalEvent } from '../src/compose/VocalGenerator';
import {
  setActiveVocalEnsembleComposition,
  vocalEnsembleFor,
} from '../src/compose/VocalEnsemble';
import { neutralPhraseControl } from '../src/compose/VocalPhraseModel';
import { vocalEventToWorklet } from '../src/compose/VocalWorkletBridge';

const eventAt = (step: number): VocalEvent => ({
  step,
  pitch: 0,
  octave: 5,
  durationSteps: 3,
  velocity: 0.82,
  syllable: 'ka',
  vowel: 'a',
  nextVowel: 'a',
  articulate: true,
  phraseStart: true,
  phraseEnd: false,
  glideFromMidi: null,
});

afterEach(() => setActiveVocalEnsembleComposition(null));

describe('Vocal Ensemble', () => {
  it('keeps verses lead-focused and adds J-pop chorus support', () => {
    const composition = generateFullSongComposition({ ...defaultFullSongSettings(101), seed: 101 });
    const profile = genreStyle('j-pop', 'mainstream');
    const verse = composition.songSections.find((section) => section.kind === 'verse');
    const chorus = composition.songSections.find((section) => section.kind === 'chorus');
    expect(verse).toBeDefined();
    expect(chorus).toBeDefined();

    const verseControl = vocalEnsembleFor(composition, profile, eventAt((verse?.startBar ?? 0) * 16));
    const chorusStep = (chorus?.startBar ?? 0) * 16;
    const hookLength = (chorus?.bars ?? 8) * 16;
    const chorusControls = Array.from({ length: hookLength }, (_, index) =>
      vocalEnsembleFor(composition, profile, eventAt(chorusStep + index)));
    expect(verseControl.label).toBe('LEAD');
    expect(verseControl.doubleLevel).toBe(0);
    expect(chorusControls.every((control) => control.doubleLevel > 0)).toBe(true);
    expect(chorusControls.some((control) => control.harmony !== null)).toBe(true);
  });

  it('gives K-pop hooks a stronger stacked treatment than ordinary sections', () => {
    const settings = { ...defaultFullSongSettings(202), genre: 'k-pop' as const, subgenre: 'dance-pop', seed: 202 };
    const composition = generateFullSongComposition(settings);
    const profile = genreStyle('k-pop', 'dance-pop');
    const verse = composition.songSections.find((section) => section.kind === 'verse');
    const drop = composition.songSections.find((section) => section.kind === 'drop');
    const verseControl = vocalEnsembleFor(composition, profile, eventAt((verse?.startBar ?? 0) * 16));
    const dropStep = (drop?.startBar ?? 0) * 16;
    const hookLength = (drop?.bars ?? 8) * 16;
    const dropControls = Array.from({ length: hookLength }, (_, index) => vocalEnsembleFor(composition, profile, eventAt(dropStep + index)));
    expect(verseControl.doubleLevel).toBe(0);
    expect(dropControls.every((control) => control.doubleLevel >= 0.14)).toBe(true);
    expect(dropControls.some((control) => control.harmony !== null)).toBe(true);
  });

  it('maps the ensemble into the lead worklet event without undoing Presence Reset', () => {
    const composition = generateFullSongComposition({ ...defaultFullSongSettings(303), seed: 303 });
    const chorus = composition.songSections.find((section) => section.kind === 'chorus');
    expect(chorus).toBeDefined();
    setActiveVocalEnsembleComposition(composition);
    const event = eventAt((chorus?.startBar ?? 0) * 16);
    const worklet = vocalEventToWorklet(event, 'warm', 2, 0.7, neutralPhraseControl(event));
    expect(worklet.ensemble.label).not.toBe('LEAD');
    expect(worklet.style.doubleLevel).toBeGreaterThan(0);
    expect(worklet.style.doubleLevel).toBeLessThanOrEqual(0.22);
    expect(worklet.style.presenceGain).toBe(0);
  });
});
