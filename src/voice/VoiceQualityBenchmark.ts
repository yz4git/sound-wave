import {
  type SpeechUtteranceStrategy,
  type VoicePlaybackPlan,
  type VoiceSynthSettings,
  VoiceSynth,
} from './VoiceSynth';
import { parseVoiceScript } from './VoiceScript';

export type VoiceQualityCaseKind =
  | 'short'
  | 'neutral'
  | 'question'
  | 'hesitation'
  | 'sibilant'
  | 'stop'
  | 'nasal'
  | 'repair'
  | 'long-single'
  | 'multi-sentence';

export interface VoiceQualityCase {
  id: string;
  kind: VoiceQualityCaseKind;
  text: string;
}

export interface VoicePlanQualityMetrics {
  unitCount: number;
  eventCount: number;
  duration: number;
  pitchRangeSemitones: number;
  meanEnergy: number;
  maxInterUnitGap: number;
  meanUnitDuration: number;
  strategy: SpeechUtteranceStrategy;
}

export interface VoicePlanQualityResult {
  testCase: VoiceQualityCase;
  metrics: VoicePlanQualityMetrics;
}

const LONG_SINGLE = 'きょうはとてもいいてんきなので、ゆっくりあるきながら、まちのようすやそらのいろやかぜのおとをたしかめて、もうすこしだけとおくまでいってみることにする。';

export const VOICE_QUALITY_CASES: readonly VoiceQualityCase[] = [
  { id: 'short', kind: 'short', text: 'いいね。' },
  { id: 'neutral', kind: 'neutral', text: 'こんにちは。きょうはいいてんきです。' },
  { id: 'question', kind: 'question', text: 'ほんとうにいくの？' },
  { id: 'hesitation', kind: 'hesitation', text: 'まつかな……' },
  { id: 'sibilant', kind: 'sibilant', text: 'さしすせそ。しずかにはなす。' },
  { id: 'stop', kind: 'stop', text: 'かたぱ。がだば。' },
  { id: 'nasal', kind: 'nasal', text: 'なまん。みんなでまつ。' },
  { id: 'repair', kind: 'repair', text: 'あ。（言い直し）い。（思い直し）う。' },
  { id: 'long-single', kind: 'long-single', text: LONG_SINGLE.repeat(2) },
  { id: 'multi-sentence', kind: 'multi-sentence', text: 'おはよう。きょうはいくよ。ほんとうにいくの？' },
] as const;

export function measureVoicePlaybackPlan(plan: VoicePlaybackPlan): VoicePlanQualityMetrics {
  const pitches = plan.units.map((unit) => unit.pitchMidi);
  const energies = plan.units.map((unit) => unit.energyScale);
  const gaps: number[] = [];

  for (let index = 1; index < plan.units.length; index += 1) {
    const previous = plan.units[index - 1]!;
    const current = plan.units[index]!;
    gaps.push(Math.max(0, current.start - (previous.start + previous.duration)));
  }

  const pitchRangeSemitones = pitches.length > 0
    ? Math.max(...pitches) - Math.min(...pitches)
    : 0;
  const meanEnergy = energies.length > 0
    ? energies.reduce((sum, value) => sum + value, 0) / energies.length
    : 0;
  const meanUnitDuration = plan.units.length > 0
    ? plan.units.reduce((sum, unit) => sum + unit.duration, 0) / plan.units.length
    : 0;

  return {
    unitCount: plan.units.length,
    eventCount: plan.events.length,
    duration: plan.duration,
    pitchRangeSemitones,
    meanEnergy,
    maxInterUnitGap: gaps.length > 0 ? Math.max(...gaps) : 0,
    meanUnitDuration,
    strategy: plan.strategy,
  };
}

export function runVoicePlanQualityCase(
  testCase: VoiceQualityCase,
  settings: VoiceSynthSettings,
): VoicePlanQualityResult {
  const synth = new VoiceSynth();
  const plan = synth.plan(parseVoiceScript(testCase.text), settings);
  return {
    testCase,
    metrics: measureVoicePlaybackPlan(plan),
  };
}

export function runVoicePlanQualitySuite(
  settings: VoiceSynthSettings,
  cases: readonly VoiceQualityCase[] = VOICE_QUALITY_CASES,
): VoicePlanQualityResult[] {
  return cases.map((testCase) => runVoicePlanQualityCase(testCase, settings));
}
