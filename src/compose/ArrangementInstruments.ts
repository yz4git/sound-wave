import type { ArrangementBar } from './GenreArrangement';
import type { GenreStyleProfile } from './GenreStyle';

export type ArrangementInstrument =
  | 'piano'
  | 'pad'
  | 'strings'
  | 'rhythm-guitar'
  | 'lead-guitar'
  | 'pluck'
  | 'synth-pad'
  | 'fx-rise'
  | 'arp'
  | 'brass'
  | 'synth-lead';

export interface ArrangementInstrumentAccent {
  instrument: ArrangementInstrument;
  gain: number;
  octave: number;
  durationSteps: number;
  toneIndex: number;
}

function hookSection(section: ArrangementBar['section']): boolean {
  return section === 'chorus' || section === 'drop' || section === 'post' || section === 'climax';
}

export function arrangementInstrumentAccents(
  profile: GenreStyleProfile,
  state: ArrangementBar | undefined,
  localStep: number,
): ArrangementInstrumentAccent[] {
  if (!state) return [];
  const section = state.section;
  const result: ArrangementInstrumentAccent[] = [];

  if (profile.genre === 'j-pop') {
    if ((section === 'verse' || section === 'pre' || section === 'break') && localStep % 4 === 0) {
      result.push({ instrument: 'piano', gain: section === 'pre' ? 0.055 : 0.043, octave: 4, durationSteps: section === 'break' ? 3.6 : 2.8, toneIndex: localStep / 4 });
    }
    if (hookSection(section) && localStep === 0) {
      result.push({ instrument: 'pad', gain: 0.045, octave: 4, durationSteps: 15.5, toneIndex: 0 });
      result.push({ instrument: 'strings', gain: 0.035, octave: 5, durationSteps: 15.2, toneIndex: 1 });
    }
    return result;
  }

  if (profile.genre === 'rock') {
    if (section !== 'break' && localStep % 2 === 0) {
      result.push({ instrument: 'rhythm-guitar', gain: hookSection(section) ? 0.048 : 0.038, octave: 3, durationSteps: 1.25, toneIndex: localStep / 2 });
    }
    if (hookSection(section) && (localStep === 0 || localStep === 8)) {
      result.push({ instrument: 'lead-guitar', gain: 0.03, octave: 5, durationSteps: 3.2, toneIndex: localStep === 0 ? 2 : 1 });
    }
    return result;
  }

  if (profile.genre === 'k-pop') {
    if ((section === 'verse' || section === 'drop' || section === 'post') && [2, 6, 10, 14].includes(localStep)) {
      result.push({ instrument: 'pluck', gain: hookSection(section) ? 0.045 : 0.034, octave: 5, durationSteps: 1.1, toneIndex: Math.floor(localStep / 4) });
    }
    if (section === 'pre' && localStep === 0) {
      result.push({ instrument: 'synth-pad', gain: 0.038, octave: 4, durationSteps: 15.5, toneIndex: 0 });
    }
    if (section === 'pre' && localStep >= 12) {
      result.push({ instrument: 'fx-rise', gain: 0.012 + (localStep - 12) * 0.004, octave: 6, durationSteps: 1, toneIndex: localStep - 12 });
    }
    return result;
  }

  if (profile.genre === 'game-music') {
    if (localStep % 2 === 0 && section !== 'break') {
      result.push({ instrument: 'arp', gain: hookSection(section) ? 0.04 : 0.03, octave: 5, durationSteps: 1.35, toneIndex: localStep / 2 });
    }
    if (section === 'climax' && (localStep === 0 || localStep === 8)) {
      result.push({ instrument: 'brass', gain: 0.035, octave: 4, durationSteps: 3.5, toneIndex: localStep === 0 ? 0 : 2 });
      result.push({ instrument: 'synth-lead', gain: 0.028, octave: 5, durationSteps: 3.1, toneIndex: localStep === 0 ? 1 : 2 });
    }
  }

  return result;
}

export function arrangementInstrumentLabel(profile: GenreStyleProfile, state: ArrangementBar | undefined): string {
  const section = state?.section ?? 'verse';
  if (profile.genre === 'j-pop') return hookSection(section) ? 'PIANO · PAD · STRINGS' : 'PIANO';
  if (profile.genre === 'rock') return hookSection(section) ? 'RHYTHM + LEAD GUITAR' : 'RHYTHM GUITAR';
  if (profile.genre === 'k-pop') return section === 'pre' ? 'SYNTH PAD · FX RISE' : 'PLUCK · SYNTH';
  return hookSection(section) ? 'ARP · BRASS · SYNTH LEAD' : 'ARP';
}
