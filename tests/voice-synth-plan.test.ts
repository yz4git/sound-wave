import { describe, expect, it } from 'vitest';
import { finalizeVoiceUnits, parseVoiceScript } from '../src/voice/VoiceScript';
import {
  VoiceSynth,
  geminatePreclosureSeconds,
  japaneseBoundaryPauseSeconds,
  speechEmphasisProfileFor,
  speechEventProfileFor,
  speechEventTransitionFor,
  speechPitchTransitionScaleFor,
  speechChunkContinuityProfileFor,
  type VoiceSynthSettings,
} from '../src/voice/VoiceSynth';

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
  it('uses punctuation to choose sentence intonation in AUTO mode', () => {
    const synth = new VoiceSynth();
    const autoSettings: VoiceSynthSettings = { ...SETTINGS, intonation: 'auto' };
    const question = synth.plan(parseVoiceScript('あいう？'), autoSettings);
    const statement = synth.plan(parseVoiceScript('あいう。'), autoSettings);
    const exclamation = synth.plan(parseVoiceScript('あいう！'), autoSettings);

    const qFinal = question.units.at(-1)!;
    const sFinal = statement.units.at(-1)!;
    const eFinal = exclamation.units.at(-1)!;

    expect(qFinal.pitchMidi).toBeGreaterThan(sFinal.pitchMidi);
    expect(eFinal.energyScale).toBeGreaterThan(sFinal.energyScale);
    expect(eFinal.duration).toBeLessThan(sFinal.duration);
  });

  it('does not carry first-sentence declination into the next sentence in AUTO mode', () => {
    const synth = new VoiceSynth();
    const autoSettings: VoiceSynthSettings = { ...SETTINGS, intonation: 'auto' };
    const combined = synth.plan(parseVoiceScript('あいう。あいう。'), autoSettings);
    const single = synth.plan(parseVoiceScript('あいう。'), autoSettings);

    expect(combined.units[3]!.pitchMidi).toBeCloseTo(single.units[0]!.pitchMidi, 8);
  });

  it('turns discourse focus into subtle pitch energy and duration prominence', () => {
    const synth = new VoiceSynth();
    const plainScript = parseVoiceScript('あいう');
    const focusedScript = parseVoiceScript('あいう');
    focusedScript.units[0]!.focusStrength = 0.82;

    const plain = synth.plan(plainScript, SETTINGS);
    const focused = synth.plan(focusedScript, SETTINGS);

    expect(focused.units[0]!.pitchMidi).toBeGreaterThan(plain.units[0]!.pitchMidi + 0.1);
    expect(focused.units[0]!.energyScale).toBeGreaterThan(plain.units[0]!.energyScale);
    expect(focused.units[0]!.duration).toBeGreaterThan(plain.units[0]!.duration);
  });

  it('changes local pacing and level for quoted and parenthetical speech', () => {
    const synth = new VoiceSynth();
    const scoped = synth.plan(parseVoiceScript('あ「い」う（え）お。'), SETTINGS);
    const plain = synth.plan(parseVoiceScript('あいうえお。'), SETTINGS);

    const quoted = scoped.units.find((timed) => timed.unit.quoted)!;
    const aside = scoped.units.find((timed) => timed.unit.parenthetical)!;
    const plainI = plain.units[1]!;
    const plainE = plain.units[3]!;

    expect(quoted.duration).toBeGreaterThan(plainI.duration);
    expect(aside.duration).toBeLessThan(plainE.duration);
    expect(aside.energyScale).toBeLessThan(plainE.energyScale);
  });

  it('gives planned breath boundaries a minimum pause at fast speech rates', () => {
    const script = parseVoiceScript('あいうえお かきくけこ さしすせそ たちつてと なにぬねの。');
    const breath = script.units.find((unit) => unit.breathAfter)!;

    expect(breath).toBeTruthy();
    expect(japaneseBoundaryPauseSeconds(breath, 1.65)).toBeGreaterThan(0.09);
  });

  it('renders filled pauses slower and softer than the same morae in plain speech', () => {
    const synth = new VoiceSynth();
    const fillerScript = parseVoiceScript('えーと いく。');
    const plainScript = parseVoiceScript('えーと いく。');
    for (const unit of plainScript.units.slice(0, 3)) {
      unit.filledPause = false;
      unit.hesitationAfter = false;
      unit.expressivePauseAfter = 0;
    }
    finalizeVoiceUnits(plainScript.units);

    const filler = synth.plan(fillerScript, SETTINGS);
    const plain = synth.plan(plainScript, SETTINGS);

    expect(filler.units[0]!.unit.filledPause).toBe(true);
    expect(filler.units[0]!.duration).toBeGreaterThan(plain.units[0]!.duration);
    expect(filler.units[0]!.energyScale).toBeLessThan(plain.units[0]!.energyScale);
  });

  it('keeps hesitation pauses unless a manual pause override replaces them', () => {
    const synth = new VoiceSynth();
    const script = parseVoiceScript('あ……い。');
    const automatic = synth.plan(script, SETTINGS);
    const manual = synth.plan(script, SETTINGS, {
      pauseOverrides: [0, null],
    });

    expect(script.units[0]!.expressivePauseAfter).toBeGreaterThan(0.15);
    expect(automatic.units[1]!.start).toBeGreaterThan(manual.units[1]!.start + 0.12);
  });

  it('uses sentence attitudes to separate shared, assertive, wondering, and uncertain endings', () => {
    const synth = new VoiceSynth();
    const planFor = (attitude: 'shared' | 'assertive' | 'wonder' | 'uncertain') => {
      const script = parseVoiceScript('あね。');
      const final = script.units.at(-1)!;
      final.sentenceAttitude = attitude;
      final.attitudeFocus = true;
      return synth.plan(script, SETTINGS).units.at(-1)!;
    };

    const shared = planFor('shared');
    const assertive = planFor('assertive');
    const wonder = planFor('wonder');
    const uncertain = planFor('uncertain');

    expect(wonder.pitchMidi).toBeGreaterThan(shared.pitchMidi);
    expect(wonder.duration).toBeGreaterThan(assertive.duration);
    expect(assertive.energyScale).toBeGreaterThan(uncertain.energyScale);
    expect(uncertain.duration).toBeGreaterThan(assertive.duration);
  });

  it('adds a subtle pre-phonation lead for longer sentence starts', () => {
    const synth = new VoiceSynth();
    const long = synth.plan(parseVoiceScript('あいうえおか。'), SETTINGS);
    const short = synth.plan(parseVoiceScript('あい。'), SETTINGS);

    expect(long.units[0]!.start).toBeGreaterThan(0.02);
    expect(short.units[0]!.start).toBe(0);
  });

  it('blends compound sentence attitude into final rate, energy, and pitch', () => {
    const synth = new VoiceSynth();
    const sharedQuestion = synth.plan(parseVoiceScript('そうだね？'), SETTINGS);
    const plainQuestion = synth.plan(parseVoiceScript('そうだ？'), SETTINGS);
    const emphatic = synth.plan(parseVoiceScript('いくよ！'), {
      ...SETTINGS,
      expression: { preset: 'excited', intensity: 1 },
    });
    const plainExclaim = synth.plan(parseVoiceScript('いく！'), {
      ...SETTINGS,
      expression: { preset: 'excited', intensity: 1 },
    });
    const wondering = synth.plan(parseVoiceScript('どうかな……'), SETTINGS);

    expect(sharedQuestion.units.at(-1)!.duration).toBeGreaterThan(plainQuestion.units.at(-1)!.duration);
    expect(sharedQuestion.units.at(-1)!.pitchMidi).toBeGreaterThan(plainQuestion.units.at(-1)!.pitchMidi);
    expect(emphatic.units.at(-1)!.energyScale).toBeGreaterThan(plainExclaim.units.at(-1)!.energyScale);
    expect(wondering.units.at(-1)!.duration).toBeGreaterThan(wondering.units[0]!.duration);
    expect(wondering.units.at(-1)!.energyScale).toBeLessThan(wondering.units[0]!.energyScale);
  });

  it('keeps manual mora edits above automatic context delivery', () => {
    const synth = new VoiceSynth();
    const script = parseVoiceScript('そうだね？');
    const automatic = synth.plan(script, SETTINGS);
    const edited = synth.plan(script, SETTINGS, {
      pitchOffsets: script.units.map((_, index) => index === script.units.length - 1 ? -1 : 0),
      energyScales: script.units.map((_, index) => index === script.units.length - 1 ? 0.7 : 1),
      durationScales: script.units.map((_, index) => index === script.units.length - 1 ? 1.4 : 1),
    });

    expect(edited.units.at(-1)!.pitchMidi).toBeLessThan(automatic.units.at(-1)!.pitchMidi - 0.9);
    expect(edited.units.at(-1)!.energyScale).toBeLessThan(automatic.units.at(-1)!.energyScale);
    expect(edited.units.at(-1)!.duration).toBeGreaterThan(automatic.units.at(-1)!.duration);
  });

  it('inserts nonverbal speech events into the playback timeline', () => {
    const synth = new VoiceSynth();
    const script = parseVoiceScript('（息）あ（笑）い（ため息）。');
    const plan = synth.plan(script, SETTINGS);

    expect(plan.events.map((event) => event.event.kind)).toEqual(['inhale', 'laugh', 'sigh']);
    expect(plan.events[0]!.start).toBe(0);
    expect(plan.units[0]!.start).toBeGreaterThan(
      plan.events[0]!.start + plan.events[0]!.duration,
    );
    expect(plan.events[1]!.start).toBeCloseTo(
      plan.units[0]!.start + plan.units[0]!.duration,
      8,
    );
    expect(plan.units[1]!.start).toBeGreaterThan(
      plan.events[1]!.start + plan.events[1]!.duration,
    );
    expect(plan.duration).toBeGreaterThan(plan.units.at(-1)!.start + plan.units.at(-1)!.duration);
  });

  it('gives restart and rethink distinct next-phrase delivery', () => {
    const synth = new VoiceSynth();
    const restartScript = parseVoiceScript('あ（言い直し）い。');
    const rethinkScript = parseVoiceScript('あ（思い直し）い。');
    const plainScript = parseVoiceScript('あい。');

    const restart = synth.plan(restartScript, SETTINGS);
    const rethink = synth.plan(rethinkScript, SETTINGS);
    const plain = synth.plan(plainScript, SETTINGS);

    expect(restart.events[0]?.event.kind).toBe('restart');
    expect(rethink.events[0]?.event.kind).toBe('rethink');
    expect(restart.units[1]!.start).toBeGreaterThan(plain.units[1]!.start + 0.08);
    expect(rethink.units[1]!.start).toBeGreaterThan(restart.units[1]!.start);
    expect(restart.units[1]!.pitchMidi).toBeGreaterThan(plain.units[1]!.pitchMidi);
    expect(rethink.units[1]!.pitchMidi).toBeLessThan(plain.units[1]!.pitchMidi);
    expect(rethink.units[1]!.energyScale).toBeLessThan(plain.units[1]!.energyScale);
    expect(rethink.units[1]!.duration).toBeGreaterThan(plain.units[1]!.duration);
  });

  it('keeps speech-event profiles bounded and lightweight', () => {
    const laugh = speechEventProfileFor('laugh', 0.68);
    const sigh = speechEventProfileFor('sigh', 0.82);
    const inhale = speechEventProfileFor('inhale', 0.72);
    const restart = speechEventTransitionFor([{
      kind: 'restart',
      afterUnit: 0,
      textOffset: 1,
      strength: 1,
    }]);
    const rethink = speechEventTransitionFor([{
      kind: 'rethink',
      afterUnit: 0,
      textOffset: 1,
      strength: 1,
    }]);

    expect(laugh.pulseCount).toBe(2);
    expect(laugh.duration).toBeLessThan(0.3);
    expect(sigh.duration).toBeGreaterThan(laugh.duration);
    expect(inhale.velocityScale).toBeLessThan(sigh.velocityScale);
    expect(restart.pitchSemitones).toBeGreaterThan(0);
    expect(restart.energyScale).toBeGreaterThan(1);
    expect(rethink.pitchSemitones).toBeLessThan(0);
    expect(rethink.rateScale).toBeLessThan(restart.rateScale);
  });

  it('merges repair pauses with punctuation instead of stacking a half-second gap', () => {
    const synth = new VoiceSynth();
    const restart = synth.plan(parseVoiceScript('あ。（言い直し）い。'), SETTINGS);
    const rethink = synth.plan(parseVoiceScript('あ。（思い直し）い。'), SETTINGS);

    const restartGap = restart.units[1]!.start
      - (restart.units[0]!.start + restart.units[0]!.duration);
    const rethinkGap = rethink.units[1]!.start
      - (rethink.units[0]!.start + rethink.units[0]!.duration);

    expect(restartGap).toBeGreaterThan(0.17);
    expect(restartGap).toBeLessThan(0.29);
    expect(rethinkGap).toBeGreaterThan(restartGap);
    expect(rethinkGap).toBeLessThan(0.36);
  });

  it('keeps laugh and sigh events softer and closer to surrounding speech', () => {
    const laugh = speechEventProfileFor('laugh', 0.68);
    const sigh = speechEventProfileFor('sigh', 0.82);

    expect(laugh.velocityScale).toBeLessThan(0.26);
    expect(laugh.gapAfter).toBeLessThan(0.05);
    expect(sigh.velocityScale).toBeLessThan(0.16);
    expect(sigh.duration).toBeGreaterThan(0.42);
    expect(sigh.gapAfter).toBeLessThan(0.06);
  });

  it('softens and slows the lead-in to a hesitant wondering ending', () => {
    const synth = new VoiceSynth();
    const hesitant = synth.plan(parseVoiceScript('まつかな……'), SETTINGS);
    const plain = synth.plan(parseVoiceScript('まつかな。'), SETTINGS);
    const index = hesitant.units.length - 2;

    expect(hesitant.units[index]!.pitchMidi).toBeLessThan(plain.units[index]!.pitchMidi);
    expect(hesitant.units[index]!.energyScale).toBeLessThan(plain.units[index]!.energyScale);
    expect(hesitant.units[index]!.duration).toBeGreaterThan(plain.units[index]!.duration);
  });

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

  it('keeps Japanese long-vowel contrast clearly longer than a short mora', () => {
    const synth = new VoiceSynth();
    const shortPlan = synth.plan(parseVoiceScript('かさ'), SETTINGS);
    const longPlan = synth.plan(parseVoiceScript('かーさ'), SETTINGS);

    const shortVowel = shortPlan.units[0]!.duration;
    const longVowelSpan = longPlan.units[0]!.duration + longPlan.units[1]!.duration;

    expect(longPlan.units[1]!.unit.longVowel).toBe(true);
    expect(longVowelSpan / shortVowel).toBeGreaterThan(2.2);
    expect(longVowelSpan / shortVowel).toBeLessThan(3.2);
  });

  it('scales sokuon pre-closure with the preceding mora and speech rate', () => {
    const normal = geminatePreclosureSeconds(1, 0.17);
    const fast = geminatePreclosureSeconds(1.5, 0.11);
    const slow = geminatePreclosureSeconds(0.7, 0.24);

    expect(slow).toBeGreaterThan(normal);
    expect(normal).toBeGreaterThan(fast);
    expect(fast).toBeGreaterThanOrEqual(0.043);
    expect(slow).toBeLessThanOrEqual(0.098);
  });

  it('preserves phrase-boundary pauses better than simple inverse-rate scaling', () => {
    const sentence = parseVoiceScript('あ。').units[0]!;
    const accent = parseVoiceScript('あ、').units[0]!;
    const fastSentence = japaneseBoundaryPauseSeconds(sentence, 1.6);
    const fastAccent = japaneseBoundaryPauseSeconds(accent, 1.6);

    expect(fastSentence).toBeGreaterThan(fastAccent);
    expect(fastSentence).toBeGreaterThan(sentence.pauseAfter / 1.6);
  });

  it('keeps connective endings open and re-energizes the following clause', () => {
    const synth = new VoiceSynth();
    const connectedScript = parseVoiceScript('いくけど、かえる。');
    const plainScript = parseVoiceScript('いくけど、かえる。');

    for (const unit of plainScript.units) {
      unit.continuationAfter = 'none';
      unit.continuationBefore = 'none';
    }

    const connected = synth.plan(connectedScript, SETTINGS);
    const plain = synth.plan(plainScript, SETTINGS);
    const endIndex = connectedScript.units.findIndex((unit) => unit.continuationAfter !== 'none');
    const nextIndex = endIndex + 1;

    expect(endIndex).toBeGreaterThanOrEqual(0);
    expect(connected.units[endIndex]!.duration).toBeGreaterThan(plain.units[endIndex]!.duration);
    expect(connected.units[nextIndex]!.energyScale).toBeGreaterThan(plain.units[nextIndex]!.energyScale);
    expect(connected.units[nextIndex]!.pitchMidi).toBeGreaterThan(plain.units[nextIndex]!.pitchMidi);
    expect(
      speechPitchTransitionScaleFor(
        connectedScript.units[nextIndex]!,
        connectedScript.units[endIndex],
      ),
    ).toBeLessThan(0.8);
  });

  it('sharpens lexical high-low F0 transitions without snapping every mora', () => {
    const script = parseVoiceScript('あいう');
    script.units[0]!.pitchAccent = 'low';
    script.units[1]!.pitchAccent = 'high';
    script.units[2]!.pitchAccent = 'high';

    expect(speechPitchTransitionScaleFor(script.units[1]!, script.units[0])).toBeLessThan(0.8);
    expect(speechPitchTransitionScaleFor(script.units[2]!, script.units[1])).toBe(1);
  });

  it('applies user-drawn mora pitch offsets without changing timing', () => {
    const synth = new VoiceSynth();
    const script = parseVoiceScript('あさ ひる');
    const base = synth.plan(script, SETTINGS);
    const edited = synth.plan(script, SETTINGS, [0, 1.5, -1.25, 0]);

    expect(edited.units[0]!.start).toBeCloseTo(base.units[0]!.start, 8);
    expect(edited.units[1]!.duration).toBeCloseTo(base.units[1]!.duration, 8);
    expect(edited.units[1]!.pitchMidi - base.units[1]!.pitchMidi).toBeCloseTo(1.5, 6);
    expect(edited.units[2]!.pitchMidi - base.units[2]!.pitchMidi).toBeCloseTo(-1.25, 6);
    expect(edited.units[1]!.manualPitchOffset).toBe(1.5);
  });

  it('applies independent mora energy and duration edits', () => {
    const synth = new VoiceSynth();
    const script = parseVoiceScript('あさ ひる');
    const base = synth.plan(script, SETTINGS);
    const edited = synth.plan(script, SETTINGS, {
      energyScales: [1, 1.35, 0.7, 1],
      durationScales: [1, 1.5, 0.65, 1],
    });

    expect(edited.units[1]!.energyScale).toBeGreaterThan(base.units[1]!.energyScale);
    expect(edited.units[2]!.energyScale).toBeLessThan(base.units[2]!.energyScale);
    expect(edited.units[1]!.duration).toBeGreaterThan(base.units[1]!.duration);
    expect(edited.units[2]!.duration).toBeLessThan(base.units[2]!.duration);
    expect(edited.units[1]!.manualEnergyScale).toBeCloseTo(1.35, 8);
    expect(edited.units[2]!.manualDurationScale).toBeCloseTo(0.65, 8);
  });

  it('changes downstream mora start times when timing is edited', () => {
    const synth = new VoiceSynth();
    const script = parseVoiceScript('あいう');
    const base = synth.plan(script, SETTINGS);
    const stretched = synth.plan(script, SETTINGS, {
      durationScales: [1.6, 1, 1],
    });

    expect(stretched.units[0]!.start).toBeCloseTo(base.units[0]!.start, 8);
    expect(stretched.units[1]!.start).toBeGreaterThan(base.units[1]!.start);
    expect(stretched.duration).toBeGreaterThan(base.duration);
  });

  it('layers expression presets underneath manual prosody edits', () => {
    const synth = new VoiceSynth();
    const script = parseVoiceScript('あさ ひる');
    const neutral = synth.plan(script, SETTINGS);
    const excitedSettings: VoiceSynthSettings = {
      ...SETTINGS,
      expression: { preset: 'excited', intensity: 1 },
    };
    const excited = synth.plan(script, excitedSettings);
    const edited = synth.plan(script, excitedSettings, {
      pitchOffsets: [0, -1.25, 0, 0],
      energyScales: [1, 0.7, 1, 1],
      durationScales: [1, 1.4, 1, 1],
    });

    expect(excited.units[0]!.pitchMidi).toBeGreaterThan(neutral.units[0]!.pitchMidi);
    expect(excited.units[0]!.energyScale).toBeGreaterThan(neutral.units[0]!.energyScale);
    expect(excited.units[0]!.duration).toBeLessThan(neutral.units[0]!.duration);
    expect(edited.units[1]!.pitchMidi).toBeLessThan(excited.units[1]!.pitchMidi);
    expect(edited.units[1]!.energyScale).toBeLessThan(excited.units[1]!.energyScale);
    expect(edited.units[1]!.duration).toBeGreaterThan(excited.units[1]!.duration);
  });

  it('produces a quieter and slower whisper plan', () => {
    const synth = new VoiceSynth();
    const script = parseVoiceScript('しずかに はなす');
    const neutral = synth.plan(script, SETTINGS);
    const whisper = synth.plan(script, {
      ...SETTINGS,
      expression: { preset: 'whisper', intensity: 1 },
    });

    expect(whisper.units[0]!.energyScale).toBeLessThan(neutral.units[0]!.energyScale);
    expect(whisper.units[0]!.duration).toBeGreaterThan(neutral.units[0]!.duration);
  });

  it('lets local delivery override the global delivery for selected morae', () => {
    const synth = new VoiceSynth();
    const script = parseVoiceScript('あさひ');
    const calmSettings: VoiceSynthSettings = {
      ...SETTINGS,
      expression: { preset: 'calm', intensity: 1 },
    };
    const globalCalm = synth.plan(script, calmSettings);
    const localExcited = synth.plan(script, calmSettings, {
      localExpressions: [
        null,
        { preset: 'excited', intensity: 1 },
        null,
      ],
    });

    expect(localExcited.units[0]!.expression.preset).toBe('calm');
    expect(localExcited.units[1]!.expression.preset).toBe('excited');
    expect(localExcited.units[2]!.expression.preset).toBe('calm');
    expect(localExcited.units[1]!.pitchMidi).toBeGreaterThan(globalCalm.units[1]!.pitchMidi);
    expect(localExcited.units[1]!.energyScale).toBeGreaterThan(globalCalm.units[1]!.energyScale);
    expect(localExcited.units[1]!.duration).toBeLessThan(globalCalm.units[1]!.duration);
  });

  it('applies phrase pitch and rate controls beneath mora drawing', () => {
    const synth = new VoiceSynth();
    const script = parseVoiceScript('あいう');
    const base = synth.plan(script, SETTINGS);
    const edited = synth.plan(script, SETTINGS, {
      phrasePitchOffsets: [1, 1, 0],
      phraseRateScales: [1.2, 1.2, 1],
      pitchOffsets: [0, 0.5, 0],
    });

    expect(edited.units[0]!.phrasePitchOffset).toBe(1);
    expect(edited.units[0]!.phraseRateScale).toBe(1.2);
    expect(edited.units[0]!.pitchMidi - base.units[0]!.pitchMidi).toBeCloseTo(1, 6);
    expect(edited.units[1]!.pitchMidi - base.units[1]!.pitchMidi).toBeCloseTo(1.5, 6);
    expect(edited.units[0]!.duration).toBeLessThan(base.units[0]!.duration);
    expect(edited.units[2]!.duration).toBeCloseTo(base.units[2]!.duration, 6);
  });

  it('adds a three-point phrase F0 curve under mora drawing', () => {
    const synth = new VoiceSynth();
    const script = parseVoiceScript('あいう');
    const base = synth.plan(script, SETTINGS);
    const curved = synth.plan(script, SETTINGS, {
      phrasePitchOffsets: [-0.5, 1, -0.25],
      pitchOffsets: [0, 0.25, 0],
    });

    expect(curved.units[0]!.pitchMidi - base.units[0]!.pitchMidi).toBeCloseTo(-0.5, 6);
    expect(curved.units[1]!.pitchMidi - base.units[1]!.pitchMidi).toBeCloseTo(1.25, 6);
    expect(curved.units[2]!.pitchMidi - base.units[2]!.pitchMidi).toBeCloseTo(-0.25, 6);
  });

  it('focuses phrase emphasis on the Japanese accent nucleus', () => {
    const script = parseVoiceScript('あいう');
    script.units[0]!.pitchAccent = 'low';
    script.units[1]!.pitchAccent = 'high';
    script.units[2]!.pitchAccent = 'low';

    const head = speechEmphasisProfileFor(script.units[0]!, script.units[1], 1);
    const nucleus = speechEmphasisProfileFor(script.units[1]!, script.units[2], 1);
    const tail = speechEmphasisProfileFor(script.units[2]!, undefined, 1);

    expect(nucleus.pitchSemitones).toBeGreaterThan(head.pitchSemitones);
    expect(nucleus.pitchSemitones).toBeGreaterThan(tail.pitchSemitones);
    expect(nucleus.energyScale).toBeGreaterThan(head.energyScale);
    expect(nucleus.durationScale).toBeGreaterThan(tail.durationScale);
    expect(nucleus.attackScale).toBeLessThan(head.attackScale);
    expect(nucleus.articulationScale).toBeGreaterThan(head.articulationScale);

    const synth = new VoiceSynth();
    const emphasized = synth.plan(script, SETTINGS, {
      phraseEmphasisScales: [1, 1, 1],
    });
    const base = synth.plan(script, SETTINGS);

    expect(
      emphasized.units[1]!.pitchMidi - base.units[1]!.pitchMidi,
    ).toBeGreaterThan(
      emphasized.units[2]!.pitchMidi - base.units[2]!.pitchMidi,
    );
  });

  it('separates phrase energy from expressive emphasis', () => {
    const synth = new VoiceSynth();
    const script = parseVoiceScript('あいう');
    const base = synth.plan(script, SETTINGS);
    const louder = synth.plan(script, SETTINGS, {
      phraseEnergyScales: [1.25, 1.25, 1.25],
    });
    const emphasized = synth.plan(script, SETTINGS, {
      phraseEmphasisScales: [1, 1, 1],
    });

    expect(louder.units[0]!.phraseEnergyScale).toBeCloseTo(1.25, 8);
    expect(louder.units[0]!.energyScale).toBeGreaterThan(base.units[0]!.energyScale);
    expect(louder.units[0]!.pitchMidi).toBeCloseTo(base.units[0]!.pitchMidi, 8);
    expect(louder.units[0]!.duration).toBeCloseTo(base.units[0]!.duration, 8);

    expect(emphasized.units[0]!.phraseEmphasis).toBe(1);
    expect(emphasized.units[0]!.energyScale).toBeGreaterThan(base.units[0]!.energyScale);
    expect(emphasized.units[0]!.pitchMidi).toBeGreaterThan(base.units[0]!.pitchMidi);
    expect(emphasized.units[0]!.duration).toBeGreaterThan(base.units[0]!.duration);
  });

  it('lets a phrase pause override replace automatic boundary timing', () => {
    const synth = new VoiceSynth();
    const script = parseVoiceScript('あ、い');
    const base = synth.plan(script, SETTINGS);
    const edited = synth.plan(script, SETTINGS, {
      pauseOverrides: [0.25, null],
    });

    const baseGap = base.units[1]!.start - (base.units[0]!.start + base.units[0]!.duration);
    const editedGap = edited.units[1]!.start - (edited.units[0]!.start + edited.units[0]!.duration);

    expect(editedGap).toBeCloseTo(0.25, 6);
    expect(editedGap).toBeGreaterThan(baseGap);
  });

  it('builds continuous sentence chunks without changing the playback timeline', () => {
    const synth = new VoiceSynth();
    const script = parseVoiceScript('あいう。えおか。きくけ。');
    const plan = synth.plan(script, SETTINGS);

    expect(plan.chunks).toHaveLength(3);
    expect(plan.chunks.map((chunk) => chunk.sentenceIndex)).toEqual([0, 1, 2]);
    expect(plan.chunks.every((chunk) => chunk.kind === 'sentence')).toBe(true);
    expect(plan.chunks[1]!.start).toBeCloseTo(plan.units[3]!.start, 8);
    expect(plan.chunks[0]!.gapAfter).toBeGreaterThan(0.2);
  });

  it('bisects an oversized single sentence near natural boundaries', () => {
    const synth = new VoiceSynth();
    const text = 'あいうえおかきくけこ、さしすせそたちつてと、なにぬねのはひふへほ、まみむめもやゆよらりるれろ、わをんあいうえおかきくけこ。';
    const script = parseVoiceScript(text);
    const plan = synth.plan(script, SETTINGS);

    expect(plan.strategy.kind).toBe('long-single');
    expect(plan.chunks.length).toBeGreaterThan(1);
    expect(plan.chunks.every((chunk) => chunk.sentenceIndex === 0)).toBe(true);
    expect(plan.chunks.some((chunk) => chunk.kind === 'long-fragment')).toBe(true);
    expect(plan.chunks.slice(1).every((chunk) => chunk.continuationFromPrevious)).toBe(true);
    expect(Math.max(...plan.chunks.map((chunk) => chunk.endUnit - chunk.startUnit + 1))).toBeLessThanOrEqual(36);
  });

  it('stabilizes processing chunk starts without resetting internal sentence continuity', () => {
    const synth = new VoiceSynth();
    const script = parseVoiceScript('あいうえおかきくけこ、さしすせそたちつてと、なにぬねのはひふへほ、まみむめもやゆよらりるれろ。');
    const plan = synth.plan(script, SETTINGS);
    expect(plan.chunks.length).toBeGreaterThan(1);

    const internal = plan.chunks[1]!;
    const internalProfile = speechChunkContinuityProfileFor(
      internal,
      internal.startUnit,
      plan.chunks.length,
    );
    expect(internal.continuationFromPrevious).toBe(true);
    expect(internalProfile.variationScale).toBeLessThan(1);
    expect(internalProfile.formantCarryScale).toBeGreaterThan(1);
    expect(internalProfile.residualSmoothingScale).toBeGreaterThan(1);
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
