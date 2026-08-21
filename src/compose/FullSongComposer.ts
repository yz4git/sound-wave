import {
  compositionLengthSteps,
  compositionStepMs,
  defaultComposeSettings,
  generateComposition,
  type AutoComposition,
  type AutoComposeSettings,
  type CompositionChord,
  type CompositionDrum,
  type CompositionNote,
} from './AutoComposer';
import {
  buildFullSongPlan,
  fullSongSectionAtBar,
  type FullSongSection,
} from './FullSongStructure';
import { genreStyle } from './GenreStyle';

export interface FullSongComposition extends AutoComposition {
  songSections: FullSongSection[];
}

export const DEFAULT_FULL_SONG_BARS = 56;
const STEPS_PER_BAR = 16;
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

function shiftedTonic(tonic: AutoComposeSettings['tonic'], semitones: number): AutoComposeSettings['tonic'] {
  return (((tonic + semitones) % 12 + 12) % 12) as AutoComposeSettings['tonic'];
}

function sectionSeed(seed: number, sectionIndex: number): number {
  let value = (seed ^ Math.imul(sectionIndex + 1, 0x9e3779b1)) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x85ebca6b) >>> 0;
  value ^= value >>> 13;
  return value >>> 0;
}

export function defaultFullSongSettings(seed = Date.now()): AutoComposeSettings {
  return { ...defaultComposeSettings(seed), bars: DEFAULT_FULL_SONG_BARS };
}

export function normalizeFullSongBars(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 16) return DEFAULT_FULL_SONG_BARS;
  return clamp(Math.round(parsed), 24, 72);
}

export function generateFullSongComposition(settings: AutoComposeSettings): FullSongComposition {
  const targetBars = normalizeFullSongBars(settings.bars);
  const profile = genreStyle(settings.genre, settings.subgenre);
  const plan = buildFullSongPlan(profile, targetBars);
  const chords: CompositionChord[] = [];
  const melody: CompositionNote[] = [];
  const drums: CompositionDrum[] = [];

  for (const section of plan.sections) {
    const localSettings: AutoComposeSettings = {
      ...settings,
      tonic: shiftedTonic(settings.tonic, section.keyShiftSemitones),
      density: clamp(settings.density * (0.92 + section.melodyScale * 0.08), 0.15, 1),
      bars: section.bars,
      seed: sectionSeed(settings.seed, section.index),
    };
    const segment = generateComposition(localSettings);
    const stepOffset = section.startBar * STEPS_PER_BAR;

    for (const chord of segment.chords) {
      chords.push({ ...chord, bar: chord.bar + section.startBar });
    }
    for (const note of segment.melody) {
      melody.push({
        ...note,
        step: note.step + stepOffset,
        octave: note.octave + section.registerShift,
        velocity: clamp(note.velocity * section.energyScale, 0.28, 1),
      });
    }
    for (const drum of segment.drums) {
      drums.push({
        ...drum,
        step: drum.step + stepOffset,
        velocity: clamp(drum.velocity * section.drumScale * section.energyScale, 0.08, 1),
      });
    }
  }

  const normalized: AutoComposeSettings = {
    ...settings,
    genre: profile.genre,
    subgenre: profile.id,
    bars: targetBars,
    bpm: clamp(Math.round(settings.bpm), 60, 190),
    density: clamp(settings.density, 0.15, 1),
    seed: settings.seed >>> 0,
  };
  const modeName = normalized.mode.toUpperCase();
  const title = `${profile.label.toUpperCase()} · FULL SONG · ${modeName} · ${String(normalized.seed).slice(-4).padStart(4, '0')}`;

  return {
    settings: normalized,
    chords,
    melody,
    drums,
    arrangement: plan.arrangement,
    songSections: plan.sections,
    title,
  };
}

export function fullSongSectionAtStep(composition: FullSongComposition, step: number): FullSongSection | undefined {
  return fullSongSectionAtBar(composition.songSections, Math.floor(step / STEPS_PER_BAR));
}

export { compositionLengthSteps, compositionStepMs };
