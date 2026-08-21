import { scaleFor, type PitchClass, type Tonality } from '../core/music';
import type { FullSongComposition } from './FullSongComposer';
import { fullSongSectionAtStep } from './FullSongComposer';
import type { GenreStyleProfile } from './GenreStyle';
import { genreStyle } from './GenreStyle';
import type { VocalEvent } from './VocalGenerator';

export interface HarmonyVoice {
  event: VocalEvent;
  gainScale: number;
}

export interface VocalEnsembleControl {
  doubleLevel: number;
  doubleDelaySeconds: number;
  harmony: HarmonyVoice | null;
  label: 'LEAD' | 'DOUBLE' | 'HARMONY' | 'STACKED';
}

let activeComposition: FullSongComposition | null = null;

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

export function setActiveVocalEnsembleComposition(composition: FullSongComposition | null): void {
  activeComposition = composition;
}

export function getActiveVocalEnsembleComposition(): FullSongComposition | null {
  return activeComposition;
}

function deterministicUnit(step: number, salt: number): number {
  let value = Math.imul(step + 23 + salt * 149, 0x45d9f3b) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x45d9f3b) >>> 0;
  value ^= value >>> 16;
  return value / 4294967296;
}

function midiFor(pitch: PitchClass, octave: number): number {
  return 12 * (octave + 1) + pitch;
}

function pitchFromMidi(midi: number): { pitch: PitchClass; octave: number } {
  const normalized = Math.max(36, Math.min(96, Math.round(midi)));
  return {
    pitch: (((normalized % 12) + 12) % 12) as PitchClass,
    octave: Math.floor(normalized / 12) - 1,
  };
}

function diatonicHarmony(
  event: VocalEvent,
  tonality: Tonality,
  scaleSteps: number,
  preferBelow: boolean,
): VocalEvent {
  const scale = scaleFor(tonality);
  const midi = midiFor(event.pitch, event.octave);
  const pitchIndex = scale.indexOf(event.pitch);
  if (pitchIndex < 0 || scale.length === 0) {
    const shifted = pitchFromMidi(midi + (preferBelow ? -3 : 4));
    return { ...event, ...shifted, velocity: event.velocity * 0.72, articulate: false };
  }

  const direction = preferBelow ? -1 : 1;
  const rawIndex = pitchIndex + direction * scaleSteps;
  const wrappedIndex = ((rawIndex % scale.length) + scale.length) % scale.length;
  const octaveDelta = Math.floor(rawIndex / scale.length);
  const targetPitch = scale[wrappedIndex] ?? event.pitch;
  const targetMidi = midiFor(targetPitch, event.octave + octaveDelta);
  const shifted = pitchFromMidi(targetMidi);
  return {
    ...event,
    ...shifted,
    velocity: event.velocity * 0.72,
    articulate: false,
    glideFromMidi: null,
  };
}

function chorusLike(sectionKind: string | undefined): boolean {
  return sectionKind === 'chorus' || sectionKind === 'drop' || sectionKind === 'post' || sectionKind === 'climax';
}

export function vocalEnsembleFor(
  composition: FullSongComposition,
  profile: GenreStyleProfile,
  event: VocalEvent,
): VocalEnsembleControl {
  const section = fullSongSectionAtStep(composition, event.step);
  const kind = section?.kind;
  const hook = chorusLike(kind);
  const finalHook = hook && section !== undefined && section.index >= composition.songSections.length - 2;
  const longTone = event.durationSteps >= 2;
  const phraseAnchor = event.phraseStart || event.phraseEnd || longTone;
  const pick = deterministicUnit(event.step, section?.index ?? 0);
  const tonality: Tonality = {
    tonic: (((composition.settings.tonic + (section?.keyShiftSemitones ?? 0)) % 12 + 12) % 12) as PitchClass,
    mode: composition.settings.mode,
  };

  if (!hook) {
    return { doubleLevel: 0, doubleDelaySeconds: 0.012, harmony: null, label: 'LEAD' };
  }

  if (profile.genre === 'rock') {
    const level = finalHook ? 0.18 : 0.12;
    const addHarmony = finalHook && phraseAnchor && pick < 0.32;
    return {
      doubleLevel: level,
      doubleDelaySeconds: 0.009,
      harmony: addHarmony
        ? { event: diatonicHarmony(event, tonality, 2, true), gainScale: 0.34 }
        : null,
      label: addHarmony ? 'STACKED' : 'DOUBLE',
    };
  }

  if (profile.genre === 'k-pop') {
    const addHarmony = phraseAnchor && pick < (finalHook ? 0.88 : 0.66);
    const preferBelow = deterministicUnit(event.step, 17) < 0.46;
    return {
      doubleLevel: finalHook ? 0.2 : 0.14,
      doubleDelaySeconds: 0.008,
      harmony: addHarmony
        ? { event: diatonicHarmony(event, tonality, 2, preferBelow), gainScale: finalHook ? 0.44 : 0.36 }
        : null,
      label: addHarmony ? 'STACKED' : 'DOUBLE',
    };
  }

  if (profile.genre === 'game-music') {
    const addHarmony = phraseAnchor && pick < (finalHook ? 0.58 : 0.34);
    return {
      doubleLevel: finalHook ? 0.1 : 0.06,
      doubleDelaySeconds: 0.011,
      harmony: addHarmony
        ? { event: diatonicHarmony(event, tonality, 4, pick > 0.28), gainScale: 0.3 }
        : null,
      label: addHarmony ? 'HARMONY' : 'LEAD',
    };
  }

  const ballad = profile.id === 'ballad';
  const chance = ballad ? (finalHook ? 0.68 : 0.44) : (finalHook ? 0.86 : 0.64);
  const addHarmony = phraseAnchor && pick < chance;
  return {
    doubleLevel: ballad ? (finalHook ? 0.1 : 0.05) : (finalHook ? 0.16 : 0.1),
    doubleDelaySeconds: ballad ? 0.014 : 0.011,
    harmony: addHarmony
      ? { event: diatonicHarmony(event, tonality, 2, false), gainScale: ballad ? 0.34 : finalHook ? 0.42 : 0.35 }
      : null,
    label: addHarmony ? (finalHook ? 'STACKED' : 'HARMONY') : 'LEAD',
  };
}

export function activeVocalEnsembleFor(event: VocalEvent): VocalEnsembleControl {
  if (!activeComposition) {
    return { doubleLevel: 0, doubleDelaySeconds: 0.012, harmony: null, label: 'LEAD' };
  }
  const profile = genreStyle(activeComposition.settings.genre, activeComposition.settings.subgenre);
  return vocalEnsembleFor(activeComposition, profile, event);
}

export function scaleHarmonyVelocity(event: VocalEvent, gainScale: number): VocalEvent {
  return { ...event, velocity: clamp(event.velocity * gainScale, 0.16, 0.68) };
}
