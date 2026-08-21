import { describe, expect, it } from 'vitest';
import { neutralPhraseControl } from '../src/compose/VocalPhraseModel';
import { vocalEventToWorklet } from '../src/compose/VocalWorkletBridge';
import {
  DEFAULT_VOICE_CHARACTER,
  currentVoiceCharacterSettings,
  setActiveVoiceCharacter,
  voiceCharacterFor,
  type VoiceCharacterSettings,
} from '../src/compose/VoiceCharacter';
import type { VocalEvent } from '../src/compose/VocalGenerator';

const EVENT: VocalEvent = {
  step: 0,
  pitch: 0,
  octave: 4,
  durationSteps: 4,
  velocity: 0.8,
  syllable: 'na',
  vowel: 'a',
  nextVowel: 'i',
  articulate: true,
  phraseStart: true,
  phraseEnd: false,
  glideFromMidi: null,
};

function render(settings: VoiceCharacterSettings) {
  return vocalEventToWorklet(
    EVENT,
    'warm',
    2,
    0.72,
    neutralPhraseControl(EVENT),
    undefined,
    undefined,
    0,
    settings,
  );
}

describe('voice character macros', () => {
  it('keeps natural as a neutral baseline', () => {
    const natural = voiceCharacterFor({ preset: 'natural', tone: 0 });
    expect(natural.breathScale).toBe(1);
    expect(natural.attackScale).toBe(1);
    expect(natural.formantScale).toBe(1);
    expect(natural.dynamicsScale).toBe(1);
  });

  it('creates clearly different soft, airy, clear and power voices', () => {
    const soft = voiceCharacterFor({ preset: 'soft', tone: 0 });
    const airy = voiceCharacterFor({ preset: 'airy', tone: 0 });
    const clear = voiceCharacterFor({ preset: 'clear', tone: 0 });
    const power = voiceCharacterFor({ preset: 'power', tone: 0 });

    expect(airy.breathScale).toBeGreaterThan(soft.breathScale);
    expect(clear.articulationScale).toBeGreaterThan(soft.articulationScale);
    expect(power.attackScale).toBeLessThan(soft.attackScale);
    expect(power.dynamicsScale).toBeGreaterThan(airy.dynamicsScale);
  });

  it('uses tone as a bounded darker-to-brighter macro', () => {
    const dark = voiceCharacterFor({ preset: 'natural', tone: -1 });
    const bright = voiceCharacterFor({ preset: 'natural', tone: 1 });

    expect(bright.formantScale).toBeGreaterThan(dark.formantScale);
    expect(bright.upperFormantGainScale).toBeGreaterThan(dark.upperFormantGainScale);
    expect(bright.sourceTiltScale).toBeLessThan(dark.sourceTiltScale);
  });

  it('maps the macro into the existing continuous vocal controls', () => {
    const airy = render({ preset: 'airy', tone: 0 });
    const power = render({ preset: 'power', tone: 0 });

    expect(airy.style.breathLevel).toBeGreaterThan(power.style.breathLevel);
    expect(power.style.attackSeconds).toBeLessThan(airy.style.attackSeconds);
    expect(power.phoneme.noiseMix).toBeGreaterThan(airy.phoneme.noiseMix);
    expect(power.style.presenceGain).toBe(0);
    expect(airy.style.presenceGain).toBe(0);
  });

  it('lets the UI update the bridge default without changing its call signature', () => {
    const previous = currentVoiceCharacterSettings();
    setActiveVoiceCharacter({ preset: 'clear', tone: 0.5 });
    expect(DEFAULT_VOICE_CHARACTER.preset).toBe('clear');
    expect(DEFAULT_VOICE_CHARACTER.tone).toBeCloseTo(0.5);
    setActiveVoiceCharacter(previous);
  });
});
