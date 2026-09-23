import { describe, expect, it } from 'vitest';
import { parseVoiceScript } from '../src/voice/VoiceScript';
import { VoiceSynth, type VoiceSynthSettings } from '../src/voice/VoiceSynth';

const SETTINGS: VoiceSynthSettings = {
  style: 'warm',
  character: 'natural',
  tone: 0,
  rate: 1,
  pitch: 60,
  energy: 0.92,
  intonation: 'natural',
};

describe('Voice Lab synthesis plan', () => {
  it('keeps mora-level F0 continuous instead of semitone quantizing every unit', () => {
    const synth = new VoiceSynth();
    const plan = synth.plan(parseVoiceScript('あさ ひる よる。'), SETTINGS);

    expect(plan.units.length).toBeGreaterThan(4);
    expect(plan.units.some((unit) => Math.abs(unit.pitchMidi - Math.round(unit.pitchMidi)) > 0.01)).toBe(true);
  });

  it('inserts a closure gap before a sokuon-marked consonant', () => {
    const synth = new VoiceSynth();
    const plan = synth.plan(parseVoiceScript('きって'), SETTINGS);
    const first = plan.units[0]!;
    const second = plan.units[1]!;
    const gap = second.start - (first.start + first.duration);

    expect(second.unit.geminateBefore).toBe(true);
    expect(gap).toBeGreaterThan(0.04);
  });

  it('gives long vowels a longer mora duration', () => {
    const synth = new VoiceSynth();
    const plan = synth.plan(parseVoiceScript('スーパー'), SETTINGS);
    const normal = plan.units[0]!;
    const long = plan.units[1]!;

    expect(long.unit.longVowel).toBe(true);
    expect(long.duration).toBeGreaterThan(normal.duration);
  });

  it('compresses and softens devoiced high vowels', () => {
    const synth = new VoiceSynth();
    const plan = synth.plan(parseVoiceScript('すき'), SETTINGS);
    const devoiced = plan.units[0]!;
    const voiced = plan.units[1]!;

    expect(devoiced.unit.devoiced).toBe(true);
    expect(devoiced.energyScale).toBeLessThan(voiced.energyScale);
    expect(devoiced.duration).toBeLessThan(voiced.duration);
  });

  it('preserves longer sentence pauses than accent phrase pauses', () => {
    const synth = new VoiceSynth();
    const accentPlan = synth.plan(parseVoiceScript('あさ ひる'), SETTINGS);
    const sentencePlan = synth.plan(parseVoiceScript('あさ。ひる'), SETTINGS);

    const accentGap = accentPlan.units[2]!.start - (accentPlan.units[1]!.start + accentPlan.units[1]!.duration);
    const sentenceGap = sentencePlan.units[2]!.start - (sentencePlan.units[1]!.start + sentencePlan.units[1]!.duration);

    expect(sentenceGap).toBeGreaterThan(accentGap);
  });
});
