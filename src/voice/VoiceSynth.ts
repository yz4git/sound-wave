import type { PitchClass } from '../core/music';
import type { VocalEvent, VocalStyle } from '../compose/VocalGenerator';
import type { VocalPhraseControl } from '../compose/VocalPhraseModel';
import { VocalWorkletBridge, vocalEventToWorklet, type VocalWorkletStatus } from '../compose/VocalWorkletBridge';
import type { VoiceCharacterPreset } from '../compose/VoiceCharacter';
import { WavCapture } from '../compose/SongExport';
import {
  prosodyOffsetForUnit,
  resolveVoiceIntonation,
  type VoiceIntonation,
  type VoiceResolvedIntonation,
  type VoiceScript,
  type VoiceUnit,
} from './VoiceScript';
import {
  voiceExpressionControl,
  voiceExpressionForUnit,
  type VoiceExpressionSettings,
} from './VoiceExpression';

export interface VoiceSynthSettings {
  style: VocalStyle;
  character: VoiceCharacterPreset;
  tone: number;
  rate: number;
  pitch: number;
  energy: number;
  intonation: VoiceIntonation;
  expression?: VoiceExpressionSettings;
}

export interface VoiceProsodyEdits {
  pitchOffsets?: readonly number[];
  energyScales?: readonly number[];
  durationScales?: readonly number[];
  localExpressions?: readonly (VoiceExpressionSettings | null)[];
  phrasePitchOffsets?: readonly number[];
  phraseRateScales?: readonly number[];
  phraseEnergyScales?: readonly number[];
  phraseEmphasisScales?: readonly number[];
  pauseOverrides?: readonly (number | null)[];
}

type VoiceProsodyInput = VoiceProsodyEdits | readonly number[];

export interface VoiceTimedUnit {
  unit: VoiceUnit;
  start: number;
  duration: number;
  pitchMidi: number;
  energyScale: number;
  manualPitchOffset: number;
  manualEnergyScale: number;
  manualDurationScale: number;
  phrasePitchOffset: number;
  phraseRateScale: number;
  phraseEnergyScale: number;
  phraseEmphasis: number;
  expression: VoiceExpressionSettings;
}

export interface VoicePlaybackPlan {
  duration: number;
  units: VoiceTimedUnit[];
}

export interface SpeechSourceProfile {
  sourceMix: number;
  sourceTilt: number;
  coarticulation: number;
  pulseNoise: number;
  geminateClosureSeconds: number;
}

export function speechSourceProfileFor(expression: VoiceExpressionSettings): SpeechSourceProfile {
  const neutral: SpeechSourceProfile = {
    sourceMix: 0.91,
    sourceTilt: 0.62,
    coarticulation: 0.82,
    pulseNoise: 0.055,
    geminateClosureSeconds: 0.052,
  };
  const target: SpeechSourceProfile = expression.preset === 'whisper'
    ? {
        sourceMix: 0.8,
        sourceTilt: 0.78,
        coarticulation: 0.82,
        pulseNoise: 0.18,
        geminateClosureSeconds: 0.052,
      }
    : expression.preset === 'excited'
      ? {
          sourceMix: 0.86,
          sourceTilt: 0.5,
          coarticulation: 0.72,
          pulseNoise: 0.045,
          geminateClosureSeconds: 0.05,
        }
      : expression.preset === 'calm'
        ? {
            sourceMix: 0.94,
            sourceTilt: 0.7,
            coarticulation: 0.88,
            pulseNoise: 0.07,
            geminateClosureSeconds: 0.054,
          }
        : expression.preset === 'serious'
          ? {
              sourceMix: 0.92,
              sourceTilt: 0.56,
              coarticulation: 0.78,
              pulseNoise: 0.04,
              geminateClosureSeconds: 0.052,
            }
          : expression.preset === 'narration'
            ? {
                sourceMix: 0.93,
                sourceTilt: 0.63,
                coarticulation: 0.84,
                pulseNoise: 0.055,
                geminateClosureSeconds: 0.053,
              }
            : neutral;

  if (expression.preset === 'neutral') return neutral;
  const amount = clamp(expression.intensity, 0, 1.35);
  const lerp = (a: number, b: number): number => a + (b - a) * amount;
  return {
    sourceMix: clamp(lerp(neutral.sourceMix, target.sourceMix), 0.72, 0.98),
    sourceTilt: clamp(lerp(neutral.sourceTilt, target.sourceTilt), 0.38, 0.84),
    coarticulation: clamp(lerp(neutral.coarticulation, target.coarticulation), 0.62, 0.94),
    pulseNoise: clamp(lerp(neutral.pulseNoise, target.pulseNoise), 0.025, 0.22),
    geminateClosureSeconds: clamp(
      lerp(neutral.geminateClosureSeconds, target.geminateClosureSeconds),
      0.048,
      0.058,
    ),
  };
}

export function geminatePreclosureSeconds(
  rate: number,
  precedingMoraDuration?: number,
): number {
  const normalizedRate = clamp(rate, 0.55, 1.8);
  const reference = precedingMoraDuration
    ?? 0.165 / normalizedRate;
  const targetTotalClosure = clamp(reference * 0.82, 0.095, 0.145);
  return clamp(targetTotalClosure - 0.052, 0.06, 0.098);
}

export function japaneseBoundaryPauseSeconds(unit: VoiceUnit, rate: number): number {
  if (unit.pauseAfter <= 0) return 0;
  const normalizedRate = clamp(rate, 0.55, 1.8);
  const exponent = unit.boundaryAfter === 'sentence' ? 0.46 : 0.68;
  const rateScale = 1 / (normalizedRate ** exponent);
  const boundaryScale = unit.boundaryAfter === 'sentence' ? 1.04 : 0.94;
  const planned = unit.pauseAfter * rateScale * boundaryScale;
  const breathFloor = unit.breathAfter ? 0.115 / (normalizedRate ** 0.24) : 0;
  return clamp(Math.max(planned, breathFloor), 0.025, 0.52);
}

export function speechPitchTransitionScaleFor(
  unit: VoiceUnit,
  previousUnit: VoiceUnit | undefined,
): number {
  if (!previousUnit) return 0.82;
  const lexicalStep = previousUnit.pitchAccent !== 'auto'
    && unit.pitchAccent !== 'auto'
    && previousUnit.pitchAccent !== unit.pitchAccent;
  if (lexicalStep) return 0.72;
  if (unit.continuationBefore !== 'none') return 0.76;
  if (unit.discourseBefore === 'quote' || unit.parenthetical !== previousUnit.parenthetical) return 0.79;
  if (unit.accentStart || unit.phraseStart) return 0.84;
  return 1;
}

export interface SpeechEmphasisProfile {
  pitchSemitones: number;
  durationScale: number;
  energyScale: number;
  attackScale: number;
  articulationScale: number;
  sourceTiltScale: number;
}

export function speechEmphasisProfileFor(
  unit: VoiceUnit,
  nextUnit: VoiceUnit | undefined,
  emphasis: number,
): SpeechEmphasisProfile {
  const amount = clamp(emphasis, 0, 1.5);
  if (amount <= 0) {
    return {
      pitchSemitones: 0,
      durationScale: 1,
      energyScale: 1,
      attackScale: 1,
      articulationScale: 1,
      sourceTiltScale: 1,
    };
  }

  const accentNucleus = unit.pitchAccent === 'high'
    && (unit.accentEnd || nextUnit?.pitchAccent === 'low');
  const lexicalHigh = unit.pitchAccent === 'high';

  const pitchWeight = accentNucleus
    ? 0.34
    : unit.accentStart
      ? 0.24
      : lexicalHigh
        ? 0.14
        : 0.05;
  const durationWeight = accentNucleus
    ? 0.055
    : unit.accentStart
      ? 0.035
      : unit.accentEnd
        ? 0.026
        : 0.012;
  const energyWeight = accentNucleus
    ? 0.18
    : unit.accentStart
      ? 0.14
      : lexicalHigh
        ? 0.09
        : 0.045;
  const articulationWeight = accentNucleus
    ? 0.12
    : unit.accentStart
      ? 0.09
      : lexicalHigh
        ? 0.07
        : 0.045;
  const attackWeight = accentNucleus
    ? 0.13
    : unit.accentStart
      ? 0.1
      : 0.05;
  const tiltWeight = accentNucleus
    ? 0.075
    : unit.accentStart
      ? 0.055
      : 0.03;

  return {
    pitchSemitones: amount * pitchWeight,
    durationScale: 1 + amount * durationWeight,
    energyScale: 1 + amount * energyWeight,
    attackScale: 1 - Math.min(0.2, amount * attackWeight),
    articulationScale: 1 + amount * articulationWeight,
    sourceTiltScale: 1 - Math.min(0.12, amount * tiltWeight),
  };
}

export interface SpeechFinalityProfile {
  creak: number;
  breath: number;
  pitchSemitones: number;
  durationScale: number;
  energyScale: number;
  releaseScale: number;
  fallCents: number;
}

export function speechFinalityProfileFor(
  expression: VoiceExpressionSettings,
  intonation: VoiceResolvedIntonation,
): SpeechFinalityProfile {
  const base: SpeechFinalityProfile = intonation === 'question'
    ? {
        creak: 0.035,
        breath: 0.06,
        pitchSemitones: 0.08,
        durationScale: 1.065,
        energyScale: 1,
        releaseScale: 1.06,
        fallCents: 0,
      }
    : intonation === 'content-question'
      ? {
          creak: 0.05,
          breath: 0.065,
          pitchSemitones: 0.02,
          durationScale: 1.055,
          energyScale: 0.98,
          releaseScale: 1.08,
          fallCents: 0,
        }
      : intonation === 'rise'
      ? {
          creak: 0.06,
          breath: 0.055,
          pitchSemitones: 0.04,
          durationScale: 1.04,
          energyScale: 0.99,
          releaseScale: 1.06,
          fallCents: 0,
        }
      : intonation === 'exclaim'
        ? {
            creak: 0.07,
            breath: 0.055,
            pitchSemitones: 0.08,
            durationScale: 1.01,
            energyScale: 1.06,
            releaseScale: 1,
            fallCents: 1,
          }
        : intonation === 'fall'
        ? {
            creak: 0.3,
            breath: 0.065,
            pitchSemitones: -0.1,
            durationScale: 1.08,
            energyScale: 0.93,
            releaseScale: 1.12,
            fallCents: 7,
          }
        : intonation === 'flat'
          ? {
              creak: 0.14,
              breath: 0.065,
              pitchSemitones: -0.02,
              durationScale: 1.03,
              energyScale: 0.97,
              releaseScale: 1.06,
              fallCents: 2,
            }
          : {
              creak: 0.24,
              breath: 0.08,
              pitchSemitones: -0.04,
              durationScale: 1.06,
              energyScale: 0.95,
              releaseScale: 1.1,
              fallCents: 5,
            };

  const delta = expression.preset === 'serious'
    ? {
        creak: 0.12,
        breath: -0.035,
        pitchSemitones: -0.08,
        durationScale: 0.02,
        energyScale: 0.01,
        releaseScale: -0.02,
        fallCents: 2,
      }
    : expression.preset === 'narration'
      ? {
          creak: 0.07,
          breath: -0.01,
          pitchSemitones: -0.03,
          durationScale: 0.02,
          energyScale: -0.01,
          releaseScale: 0.03,
          fallCents: 1,
        }
      : expression.preset === 'calm'
        ? {
            creak: -0.06,
            breath: 0.02,
            pitchSemitones: -0.04,
            durationScale: 0.04,
            energyScale: -0.04,
            releaseScale: 0.06,
            fallCents: -1,
          }
        : expression.preset === 'excited'
          ? {
              creak: -0.16,
              breath: -0.005,
              pitchSemitones: 0.08,
              durationScale: -0.02,
              energyScale: 0.05,
              releaseScale: -0.03,
              fallCents: -2,
            }
          : expression.preset === 'whisper'
            ? {
                creak: -0.22,
                breath: 0.2,
                pitchSemitones: 0,
                durationScale: 0.03,
                energyScale: -0.07,
                releaseScale: 0.08,
                fallCents: -5,
              }
            : {
                creak: 0,
                breath: 0,
                pitchSemitones: 0,
                durationScale: 0,
                energyScale: 0,
                releaseScale: 0,
                fallCents: 0,
              };

  const amount = expression.preset === 'neutral'
    ? 0
    : clamp(expression.intensity, 0, 1.35);
  const risingEnding = intonation === 'question'
    || intonation === 'content-question'
    || intonation === 'rise';
  const pitchAmount = risingEnding ? amount * 0.5 : amount;

  return {
    creak: risingEnding
      ? clamp(base.creak + delta.creak * amount, 0, 0.07)
      : clamp(base.creak + delta.creak * amount, 0, 0.5),
    breath: clamp(base.breath + delta.breath * amount, 0.02, 0.35),
    pitchSemitones: clamp(
      base.pitchSemitones + delta.pitchSemitones * pitchAmount,
      -0.24,
      0.22,
    ),
    durationScale: clamp(base.durationScale + delta.durationScale * amount, 0.98, 1.16),
    energyScale: clamp(base.energyScale + delta.energyScale * amount, 0.82, 1.08),
    releaseScale: clamp(base.releaseScale + delta.releaseScale * amount, 0.96, 1.22),
    fallCents: risingEnding
      ? 0
      : clamp(base.fallCents + delta.fallCents * amount, 0, 10),
  };
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

function normalizeProsodyEdits(input: VoiceProsodyInput): VoiceProsodyEdits {
  if (Array.isArray(input)) return { pitchOffsets: input as readonly number[] };
  return input as VoiceProsodyEdits;
}

function pitchClassForMidi(midi: number): PitchClass {
  return (((Math.round(midi) % 12) + 12) % 12) as PitchClass;
}

function octaveForMidi(midi: number): number {
  return Math.floor(Math.round(midi) / 12) - 1;
}

function midiToHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

export function japaneseUnitDurationSeconds(unit: VoiceUnit, rate: number): number {
  const consonantHeavy = /^(k|ky|s|sh|t|ch|ts|h|f|p|g|gy|z|j|d|b)/i.test(unit.syllable);
  const nasal = unit.moraicN;
  let base = nasal ? 0.155 : consonantHeavy ? 0.174 : 0.165;

  // A long-vowel continuation is its own mora. Making the continuation about
  // 1.45× a short mora keeps the full V+V: contrast near the robust Japanese
  // perceptual duration ratio while still allowing speech-rate compression.
  if (unit.longVowel) base *= 1.45;
  if (unit.focusStrength > 0) base *= 1 + unit.focusStrength * 0.012;

  // Tokyo-style high-vowel devoicing is realized with temporal compression,
  // not just a quieter periodic source.
  if (unit.devoiced) base *= unit.pitchAccent === 'high' ? 0.78 : 0.68;

  // Phrase-final lengthening is stronger at a sentence edge than at an
  // internal accent-phrase boundary.
  if (unit.accentEnd && !unit.phraseEnd) base *= 1.045;
  if (unit.continuationAfter !== 'none' && !unit.phraseEnd) base *= 1.035;
  if (unit.phraseEnd) base *= 1.13;

  return clamp(base / clamp(rate, 0.55, 1.8), 0.055, 0.44);
}

function unitEnergyScale(unit: VoiceUnit): number {
  let scale = 1;
  if (unit.accentStart) scale *= 1.02;
  if (unit.accentEnd) scale *= 0.98;
  if (unit.continuationAfter !== 'none') scale *= 0.97;
  if (unit.continuationBefore !== 'none') scale *= 1.025;
  if (unit.quoted) scale *= 1.015;
  if (unit.parenthetical) scale *= 0.92;
  if (unit.focusStrength > 0) scale *= 1 + unit.focusStrength * 0.055;
  if (unit.phraseEnd) scale *= 0.94;
  if (unit.longVowel) scale *= 0.97;
  if (unit.devoiced) scale *= 0.56;
  return scale;
}

function phraseControlFor(unit: VoiceUnit, energy: number): VocalPhraseControl {
  const progressStart = unit.phraseCount <= 1
    ? 0
    : unit.phraseIndex / Math.max(1, unit.phraseCount);
  const progressEnd = unit.phraseCount <= 1
    ? 1
    : (unit.phraseIndex + 1) / Math.max(1, unit.phraseCount);
  const crestStart = 0.9 + Math.sin(progressStart * Math.PI) * 0.075;
  const crestEnd = 0.9 + Math.sin(progressEnd * Math.PI) * 0.075;
  const boundaryRelease = unit.phraseEnd
    ? 0.91
    : unit.continuationAfter !== 'none'
      ? 0.995
      : unit.accentEnd
        ? 0.97
        : 1;

  return {
    phraseIndex: 0,
    phraseStartStep: 0,
    phraseEndStep: unit.phraseCount,
    progressStart,
    progressEnd,
    energyStart: clamp(crestStart * energy, 0.58, 1.32),
    energyEnd: clamp(crestEnd * energy * boundaryRelease, 0.55, 1.32),
    centeringStart: unit.phraseEnd ? 0.025 : 0,
    centeringEnd: unit.phraseEnd
      ? 0.11
      : unit.continuationAfter !== 'none'
        ? 0.025
        : unit.accentEnd
          ? 0.045
          : 0.015,
    aspirationDepth: clamp(0.068 + (1 - energy) * 0.05 + (unit.devoiced ? 0.035 : 0), 0.05, 0.145),
    sourceTractCoupling: unit.devoiced ? 0.0065 : 0.0085,
  };
}

export class VoiceSynth {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private limiter: DynamicsCompressorNode | null = null;
  private readonly worklet = new VocalWorkletBridge();
  private readonly wavCapture = new WavCapture();

  get status(): VocalWorkletStatus {
    return this.worklet.status;
  }

  get currentTime(): number {
    return this.context?.currentTime ?? 0;
  }

  async unlock(): Promise<void> {
    if (!this.context) {
      const context = new AudioContext({ latencyHint: 'interactive' });
      const voiceBus = context.createGain();
      const highpass = context.createBiquadFilter();
      const compressor = context.createDynamicsCompressor();
      const master = context.createGain();
      const limiter = context.createDynamicsCompressor();

      voiceBus.gain.value = 0.92;
      highpass.type = 'highpass';
      highpass.frequency.value = 62;
      highpass.Q.value = 0.45;
      compressor.threshold.value = -18;
      compressor.knee.value = 10;
      compressor.ratio.value = 2.1;
      compressor.attack.value = 0.006;
      compressor.release.value = 0.16;
      master.gain.value = 0.84;
      limiter.threshold.value = -2.2;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.002;
      limiter.release.value = 0.075;

      voiceBus.connect(highpass);
      highpass.connect(compressor);
      compressor.connect(master);
      master.connect(limiter);
      limiter.connect(context.destination);

      this.context = context;
      this.master = master;
      this.limiter = limiter;
      const moduleUrl = new URL('vocal-worklet.js', document.baseURI).toString();
      await this.worklet.initialize(context, voiceBus, moduleUrl);
    }
    if (this.context.state !== 'running') await this.context.resume();
  }

  stop(): void {
    this.worklet.clear();
    this.wavCapture.cancel();
  }

  suspend(): void {
    void this.context?.suspend();
  }

  resume(): void {
    void this.context?.resume();
  }

  plan(
    script: VoiceScript,
    settings: VoiceSynthSettings,
    prosodyInput: VoiceProsodyInput = {},
  ): VoicePlaybackPlan {
    const edits = normalizeProsodyEdits(prosodyInput);
    const globalExpression = settings.expression ?? { preset: 'neutral', intensity: 1 };
    const units: VoiceTimedUnit[] = [];
    let cursor = 0;

    script.units.forEach((unit, index) => {
      if (unit.geminateBefore) {
        const precedingMoraDuration = units[units.length - 1]?.duration;
        cursor += geminatePreclosureSeconds(settings.rate, precedingMoraDuration);
      }

      const expression = edits.localExpressions?.[index] ?? globalExpression;
      const expressionControl = voiceExpressionControl(expression);
      const expressionUnit = voiceExpressionForUnit(unit, index, script.units.length, expression);
      const resolvedIntonation = resolveVoiceIntonation(unit, settings.intonation);
      const offset = prosodyOffsetForUnit(unit, index, script.units.length, resolvedIntonation)
        * expressionControl.pitchRangeScale;
      const manualPitchOffset = clamp(edits.pitchOffsets?.[index] ?? 0, -3.5, 3.5);
      const manualEnergyScale = clamp(edits.energyScales?.[index] ?? 1, 0.45, 1.55);
      const manualDurationScale = clamp(edits.durationScales?.[index] ?? 1, 0.6, 1.65);
      const phrasePitchOffset = clamp(edits.phrasePitchOffsets?.[index] ?? 0, -3, 3);
      const phraseRateScale = clamp(edits.phraseRateScales?.[index] ?? 1, 0.72, 1.35);
      const phraseEnergyScale = clamp(edits.phraseEnergyScales?.[index] ?? 1, 0.65, 1.45);
      const phraseEmphasis = clamp(edits.phraseEmphasisScales?.[index] ?? 0, 0, 1.5);
      const effectiveRate = settings.rate * phraseRateScale * unit.autoRateScale;
      const emphasisProfile = speechEmphasisProfileFor(
        unit,
        script.units[index + 1],
        phraseEmphasis,
      );
      const finality = speechFinalityProfileFor(expression, resolvedIntonation);
      const finalPitchOffset = unit.phraseEnd ? finality.pitchSemitones : 0;
      const finalDurationScale = unit.phraseEnd ? finality.durationScale : 1;
      const finalEnergyScale = unit.phraseEnd ? finality.energyScale : 1;

      const pitchMidi = clamp(
        settings.pitch
          + offset
          + expressionUnit.pitchOffset
          + phrasePitchOffset
          + emphasisProfile.pitchSemitones
          + finalPitchOffset
          + manualPitchOffset,
        40,
        82,
      );
      const duration = clamp(
        japaneseUnitDurationSeconds(unit, effectiveRate)
          * expressionUnit.durationScale
          * emphasisProfile.durationScale
          * finalDurationScale
          * manualDurationScale,
        0.05,
        0.58,
      );
      const energyScale = clamp(
        unitEnergyScale(unit)
          * expressionUnit.energyScale
          * phraseEnergyScale
          * emphasisProfile.energyScale
          * finalEnergyScale
          * manualEnergyScale,
        0.22,
        1.8,
      );

      units.push({
        unit,
        start: cursor,
        duration,
        pitchMidi,
        energyScale,
        manualPitchOffset,
        manualEnergyScale,
        manualDurationScale,
        phrasePitchOffset,
        phraseRateScale,
        phraseEnergyScale,
        phraseEmphasis,
        expression,
      });

      const pauseOverride = edits.pauseOverrides?.[index];
      const pause = pauseOverride === null || pauseOverride === undefined
        ? japaneseBoundaryPauseSeconds(unit, effectiveRate)
        : clamp(pauseOverride, 0, 0.36);
      cursor += duration + pause;
    });

    return { duration: cursor + 0.08, units };
  }

  async play(
    script: VoiceScript,
    settings: VoiceSynthSettings,
    prosodyInput: VoiceProsodyInput = {},
  ): Promise<VoicePlaybackPlan> {
    await this.unlock();
    if (!this.context) throw new Error('Voice AudioContext unavailable');
    if (this.worklet.status !== 'ready') throw new Error('Voice AudioWorklet unavailable');

    this.worklet.clear();
    const plan = this.plan(script, settings, prosodyInput);
    const startAt = this.context.currentTime + 0.055;
    let previousPitchMidi: number | null = null;

    plan.units.forEach((timed, index) => {
      const unit = timed.unit;
      const expressionControl = voiceExpressionControl(timed.expression);
      const speechSource = speechSourceProfileFor(timed.expression);
      const emphasis = timed.phraseEmphasis;
      const emphasisProfile = speechEmphasisProfileFor(
        unit,
        plan.units[index + 1]?.unit,
        emphasis,
      );
      const resolvedIntonation = resolveVoiceIntonation(unit, settings.intonation);
      const finality = speechFinalityProfileFor(timed.expression, resolvedIntonation);
      const previousUnit = plan.units[index - 1]?.unit;
      const pitchTransitionScale = speechPitchTransitionScaleFor(unit, previousUnit);
      const roundedMidi = Math.round(timed.pitchMidi);
      const event: VocalEvent = {
        step: index,
        pitch: pitchClassForMidi(roundedMidi),
        octave: octaveForMidi(roundedMidi),
        durationSteps: 1,
        velocity: clamp(0.72 * settings.energy * timed.energyScale, 0.2, 0.98),
        syllable: unit.syllable,
        vowel: unit.vowel,
        nextVowel: plan.units[index + 1]?.unit.vowel ?? null,
        articulate: !unit.longVowel,
        phraseStart: unit.phraseStart,
        phraseEnd: unit.phraseEnd,
        glideFromMidi: previousPitchMidi === null ? null : Math.round(previousPitchMidi),
      };

      const phrase = phraseControlFor(unit, settings.energy * timed.energyScale);
      const workletEvent = vocalEventToWorklet(
        event,
        settings.style,
        startAt + timed.start,
        timed.duration,
        phrase,
        undefined,
        undefined,
        index % 16,
        {
          preset: settings.character,
          tone: clamp(settings.tone + expressionControl.toneOffset, -1, 1),
        },
      );

      workletEvent.targetHz = midiToHz(timed.pitchMidi);
      workletEvent.glideFromHz = previousPitchMidi === null || unit.phraseStart
        ? null
        : midiToHz(previousPitchMidi);

      workletEvent.karaoke = {
        ...workletEvent.karaoke,
        scoopCents: unit.phraseStart ? 1.5 + emphasis * 1.6 : 0,
        fallCents: unit.phraseEnd ? finality.fallCents : unit.accentEnd ? 1 : 0,
        vibratoGain: 0,
      };

      workletEvent.style = {
        ...workletEvent.style,
        vibratoDepthCents: 0,
        intensityModDepth: Math.min(workletEvent.style.intensityModDepth, 0.006 + emphasis * 0.002),
        jitterCents: Math.min(workletEvent.style.jitterCents, 0.34 + emphasis * 0.06),
        shimmerDepth: Math.min(workletEvent.style.shimmerDepth, 0.004),
        doubleLevel: 0,
        onsetPitchCents: unit.phraseStart ? 1.8 : 0,
        breathLevel: clamp(workletEvent.style.breathLevel * expressionControl.breathScale, 0, 1.2),
        attackSeconds: workletEvent.style.attackSeconds
          * expressionControl.attackScale
          * emphasisProfile.attackScale
          * (unit.geminateBefore ? 0.78 : 1),
        releaseSeconds: workletEvent.style.releaseSeconds * (unit.phraseEnd ? finality.releaseScale : 0.88),
        speechSourceMix: speechSource.sourceMix,
        speechSourceTilt: clamp(speechSource.sourceTilt * emphasisProfile.sourceTiltScale, 0.32, 0.9),
        speechCoarticulation: speechSource.coarticulation,
        speechPulseNoise: speechSource.pulseNoise,
        speechPitchTransitionScale: pitchTransitionScale,
        speechFinalCreak: unit.phraseEnd ? finality.creak : 0,
        speechFinalBreath: unit.phraseEnd
          ? finality.breath
          : unit.breathAfter
            ? 0.09
            : 0,
      };

      workletEvent.voiceCharacter = {
        ...workletEvent.voiceCharacter,
        breathScale: clamp(workletEvent.voiceCharacter.breathScale * expressionControl.breathScale, 0.55, 2),
        attackScale: clamp(workletEvent.voiceCharacter.attackScale * expressionControl.attackScale, 0.55, 1.6),
        articulationScale: clamp(
          workletEvent.voiceCharacter.articulationScale
            * expressionControl.articulationScale
            * emphasisProfile.articulationScale,
          0.62,
          1.5,
        ),
        sourceTiltScale: clamp(
          workletEvent.voiceCharacter.sourceTiltScale * expressionControl.sourceTiltScale,
          0.72,
          1.42,
        ),
      };

      if (expressionControl.voicingScale < 0.999) {
        workletEvent.phoneme = {
          ...workletEvent.phoneme,
          voicedMix: workletEvent.phoneme.voicedMix * expressionControl.voicingScale,
          aspirationMix: clamp(
            workletEvent.phoneme.aspirationMix + (1 - expressionControl.voicingScale) * 0.18,
            0,
            1,
          ),
          noiseMix: clamp(
            workletEvent.phoneme.noiseMix + (1 - expressionControl.voicingScale) * 0.09,
            0,
            1,
          ),
        };
      }

      if (unit.geminateBefore) {
        workletEvent.phoneme = {
          ...workletEvent.phoneme,
          closureSeconds: Math.max(
            workletEvent.phoneme.closureSeconds,
            speechSource.geminateClosureSeconds,
          ),
          burstSeconds: workletEvent.phoneme.burstSeconds * 1.08,
          noiseMix: clamp(workletEvent.phoneme.noiseMix * 1.08, 0, 1),
        };
      }

      if (unit.devoiced) {
        workletEvent.phoneme = {
          ...workletEvent.phoneme,
          voicedMix: workletEvent.phoneme.voicedMix * 0.14,
          aspirationMix: Math.max(0.24, workletEvent.phoneme.aspirationMix),
          noiseMix: Math.max(0.11, workletEvent.phoneme.noiseMix),
        };
        workletEvent.formants = workletEvent.formants.map((band) => ({
          ...band,
          gain: band.gain * 0.48,
        }));
        workletEvent.style = {
          ...workletEvent.style,
          breathLevel: workletEvent.style.breathLevel * 1.5,
          glottalOpenQuotient: clamp(workletEvent.style.glottalOpenQuotient + 0.055, 0.46, 0.88),
          intensityModDepth: workletEvent.style.intensityModDepth * 0.45,
        };
        workletEvent.velocity = clamp(workletEvent.velocity * 0.7, 0.16, 0.72);
      }

      if (unit.longVowel) {
        workletEvent.phoneme = {
          ...workletEvent.phoneme,
          closureSeconds: 0,
          burstSeconds: 0,
          fricationSeconds: 0,
          noiseMix: workletEvent.phoneme.noiseMix * 0.32,
          aspirationMix: workletEvent.phoneme.aspirationMix * 0.78,
        };
      }

      workletEvent.ensemble = {
        label: 'LEAD',
        harmonyTargetHz: null,
        harmonyGainScale: 0,
      };
      workletEvent.velocity = clamp(workletEvent.velocity, 0.16, 0.98);
      this.worklet.schedule(workletEvent);
      previousPitchMidi = timed.pitchMidi;
    });

    return plan;
  }

  async renderWav(
    script: VoiceScript,
    settings: VoiceSynthSettings,
    prosodyInput: VoiceProsodyInput = {},
  ): Promise<Blob> {
    await this.unlock();
    if (!this.context || !this.limiter) throw new Error('Voice render unavailable');
    this.stop();
    this.wavCapture.start(this.context, this.limiter);
    const plan = await this.play(script, settings, prosodyInput);
    await new Promise<void>((resolve) => window.setTimeout(resolve, Math.ceil((plan.duration + 0.18) * 1000)));
    return this.wavCapture.finish();
  }
}
