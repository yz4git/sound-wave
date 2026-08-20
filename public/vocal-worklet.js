const NEUTRAL_FORMANTS = [500, 1500, 2500, 3500, 4500];

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function smoothstep(value) {
  const x = clamp01(value);
  return x * x * (3 - 2 * x);
}

function smootherstep(value) {
  const x = clamp01(value);
  return x * x * x * (x * (x * 6 - 15) + 10);
}

const DEFAULT_KARAOKE = Object.freeze({
  pitchStability: 0.86,
  straightHoldRatio: 0.88,
  vibratoGain: 0.18,
  scoopCents: 0,
  fallCents: 0,
  dynamicGain: 1,
  longTone: false,
});

const DEFAULT_RESONANCE = Object.freeze({
  collisionThresholdRatio: 0.42,
  collisionGainFloor: 0.78,
  collisionBandwidthBoost: 0.34,
  bandwidthMotion: 0.16,
  gainMotion: 0.1,
  energyClosureDepth: 0.032,
  releaseOpenBoost: 0.035,
  highPitchOpenBoost: 0.032,
  speedEnergyBoost: 0.024,
  vibratoResonanceDepth: 0.016,
  nasalZeroHz: 0,
  nasalZeroQ: 2.2,
  nasalZeroMix: 0,
});

const DEFAULT_SPECTRAL = Object.freeze({
  timeSmoothingMs: 28,
  transitionSmoothingMs: 9,
  frequencySmoothing: 0.1,
  transitionProtectionSeconds: 0.06,
  spectralTiltDepth: 0.01,
  vibratoEnvelopeDepth: 0.005,
  trajectoryDepth: 0.9,
});

class SoundWaveVocalProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = [];
    this.active = null;
    this.phase = 0;
    this.currentHz = 110;
    this.previousFlow = 0;
    this.sourceState = 0;
    this.outputState = 0;

    this.formantY1 = new Float64Array(5);
    this.formantY2 = new Float64Array(5);
    this.formantCoefficient = new Float64Array(5);
    this.formantR2 = new Float64Array(5);
    this.formantInput = new Float64Array(5);
    this.formantGainScale = new Float64Array(5);
    this.formantGainScale.fill(1);

    // v20.8 keeps a continuous spectral-envelope state across connected notes.
    this.spectralFrequencyState = new Float64Array(5);
    this.spectralBandwidthState = new Float64Array(5);
    this.spectralGainState = new Float64Array(5);
    this.spectralTargetFrequency = new Float64Array(5);
    this.spectralTargetBandwidth = new Float64Array(5);
    this.spectralRawGain = new Float64Array(5);
    this.spectralInitialized = new Uint8Array(5);

    this.presenceY1 = 0;
    this.presenceY2 = 0;
    this.presenceCoefficient = 0;
    this.presenceR2 = 0;
    this.presenceInput = 0;

    this.previousRadiationInput = 0;
    this.radiationState = 0;
    this.radiationAlpha = 0.9;
    this.radiationMix = 0;

    this.nasalNotchB0 = 1;
    this.nasalNotchB1 = 0;
    this.nasalNotchB2 = 0;
    this.nasalNotchA1 = 0;
    this.nasalNotchA2 = 0;
    this.nasalNotchX1 = 0;
    this.nasalNotchX2 = 0;
    this.nasalNotchY1 = 0;
    this.nasalNotchY2 = 0;

    this.noiseSeed = 0x6d2b79f5;
    this.jitterState = 0;
    this.shimmerState = 0;
    this.fricationLowState = 0;
    this.nasalState = 0;
    this.envelopeState = 0;

    this.vibratoPhase = 0;
    this.driftPhase = 0;
    this.lastVibratoRate = 5.1;

    this.delayBuffer = new Float32Array(4096);
    this.delayWrite = 0;
    this.delaySamples = 512;

    this.coefficientCountdown = 0;
    this.lastEventEndFrame = -1;
    this.port.onmessage = (message) => this.handleMessage(message.data);
  }

  handleMessage(data) {
    if (!data || typeof data.type !== 'string') return;

    if (data.type === 'clear') {
      this.queue.length = 0;
      this.active = null;
      this.envelopeState = 0;
      this.outputState = 0;
      this.lastEventEndFrame = -1;
      this.spectralInitialized.fill(0);
      return;
    }

    if (data.type !== 'schedule' || !data.event) return;
    const event = data.event;
    const scheduled = {
      ...event,
      phoneme: event.phoneme || {
        consonant: 'vowel',
        closureSeconds: 0,
        burstSeconds: 0,
        fricationSeconds: 0,
        voicingDelaySeconds: 0,
        noiseMix: 0,
        voicedMix: 1,
        nasalMix: 0,
        aspirationMix: 0.04,
        coarticulationLead: 0.2,
        moraicN: false,
      },
      karaoke: event.karaoke || DEFAULT_KARAOKE,
      resonance: event.resonance || DEFAULT_RESONANCE,
      spectral: event.spectral || DEFAULT_SPECTRAL,
      startFrame: Math.max(currentFrame, Math.round(event.when * sampleRate)),
      endFrame: Math.max(currentFrame + 1, Math.round((event.when + event.duration) * sampleRate)),
      transitionFromHz: null,
    };
    this.queue.push(scheduled);
    this.queue.sort((a, b) => a.startFrame - b.startFrame);
  }

  randomSigned() {
    this.noiseSeed = (Math.imul(this.noiseSeed, 1664525) + 1013904223) >>> 0;
    return this.noiseSeed / 4294967296 * 2 - 1;
  }

  prepareNasalNotch(resonance) {
    const frequency = Math.max(0, resonance.nasalZeroHz || 0);
    if (frequency <= 0 || resonance.nasalZeroMix <= 0) {
      this.nasalNotchB0 = 1;
      this.nasalNotchB1 = 0;
      this.nasalNotchB2 = 0;
      this.nasalNotchA1 = 0;
      this.nasalNotchA2 = 0;
      return;
    }

    const safeFrequency = Math.min(sampleRate * 0.42, Math.max(120, frequency));
    const q = Math.max(0.5, Math.min(8, resonance.nasalZeroQ || 2.2));
    const w0 = 2 * Math.PI * safeFrequency / sampleRate;
    const alpha = Math.sin(w0) / (2 * q);
    const cos = Math.cos(w0);
    const a0 = 1 + alpha;
    this.nasalNotchB0 = 1 / a0;
    this.nasalNotchB1 = -2 * cos / a0;
    this.nasalNotchB2 = 1 / a0;
    this.nasalNotchA1 = -2 * cos / a0;
    this.nasalNotchA2 = (1 - alpha) / a0;
  }

  prepareActive(event) {
    const carry = event.articulate ? 0.78 : 0.975;
    for (let index = 0; index < 5; index += 1) {
      this.formantY1[index] *= carry;
      this.formantY2[index] *= carry;
      this.formantGainScale[index] = 1;
    }
    this.presenceY1 *= carry;
    this.presenceY2 *= carry;

    const presenceBandwidth = 840;
    const presenceR = Math.exp(-Math.PI * presenceBandwidth / sampleRate);
    const presenceAngle = 2 * Math.PI
      * Math.min(sampleRate * 0.45, Math.max(80, event.style.presenceFrequency))
      / sampleRate;
    this.presenceCoefficient = 2 * presenceR * Math.cos(presenceAngle);
    this.presenceR2 = presenceR * presenceR;
    this.presenceInput = 1 - presenceR;

    this.radiationAlpha = Math.exp(
      -2 * Math.PI * Math.max(200, event.style.radiationFrequency) / sampleRate,
    );
    this.radiationMix = Math.max(
      0,
      Math.min(0.95, (10 ** (event.style.radiationGainDb / 20) - 1) * 0.52),
    );

    this.prepareNasalNotch(event.resonance || DEFAULT_RESONANCE);
    this.delaySamples = Math.max(
      1,
      Math.min(
        this.delayBuffer.length - 1,
        Math.round(event.style.doubleDelaySeconds * sampleRate),
      ),
    );
    this.coefficientCountdown = 0;
  }

  activateNext(frame) {
    while (this.queue.length && this.queue[0].startFrame <= frame) {
      const previous = this.active;
      const next = this.queue.shift();
      const previousEnd = previous ? previous.endFrame : this.lastEventEndFrame;
      const gapFrames = previousEnd >= 0
        ? Math.max(0, next.startFrame - previousEnd)
        : Number.POSITIVE_INFINITY;
      const nearContinuous = previous !== null
        || gapFrames <= Math.round(sampleRate * 0.045);

      this.active = next;
      if (!nearContinuous) this.spectralInitialized.fill(0);

      if (nearContinuous) {
        next.transitionFromHz = Math.max(20, this.currentHz);
      } else if (next.glideFromHz !== null) {
        this.currentHz = Math.max(20, next.glideFromHz);
        next.transitionFromHz = Math.max(20, next.glideFromHz);
      } else {
        const cents = this.onsetCents(next);
        this.currentHz = Math.max(20, next.targetHz * 2 ** (cents / 1200));
        next.transitionFromHz = this.currentHz;
      }

      this.prepareActive(next);
    }
  }

  onsetCents(event) {
    const karaoke = event.karaoke || DEFAULT_KARAOKE;
    const stabilityScale = 1 - clamp01(karaoke.pitchStability) * 0.72;
    const extent = (event.style.onsetPitchCents || 0) * stabilityScale;
    let hash = 2166136261;
    const text = `${event.syllable}:${event.startFrame}`;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    const random = ((hash >>> 0) % 1001) / 500 - 1;
    if (event.phraseStart) return -extent * 0.65 + random * extent * 0.2;
    return random * extent * 0.45;
  }

  glottalFlow(phase, openQuotient, speedQuotient) {
    if (phase >= openQuotient) return 0;
    const openingEnd = Math.max(0.001, openQuotient * speedQuotient);
    if (phase <= openingEnd) {
      const x = phase / openingEnd;
      return 0.5 - 0.5 * Math.cos(Math.PI * x);
    }
    const closeLength = Math.max(0.001, openQuotient - openingEnd);
    const x = (phase - openingEnd) / closeLength;
    return Math.cos(x * Math.PI * 0.5) ** 2;
  }

  coarticulationMix(event, elapsed, noteDuration) {
    const nextAvailable = event.formants.some((band) => band && band.nextHz !== null);
    if (!nextAvailable) return 0;

    const lead = Math.max(
      event.phoneme.moraicN ? 0.34 : 0.1,
      Math.min(0.42, event.phoneme.coarticulationLead || 0.2),
    );
    const start = noteDuration * (1 - lead);
    const progress = smoothstep((elapsed - start) / Math.max(0.001, noteDuration - start));
    return progress * (event.phoneme.moraicN ? 0.58 : 0.24);
  }

  harmonicCollision(frequency, bandwidth, resonance) {
    const f0 = Math.max(20, this.currentHz);
    const harmonic = Math.max(1, Math.min(18, Math.round(frequency / f0)));
    const harmonicHz = harmonic * f0;
    const threshold = Math.max(22, bandwidth * Math.max(0.2, resonance.collisionThresholdRatio));
    return clamp01(1 - Math.abs(harmonicHz - frequency) / threshold);
  }

  spectralSmoothingAlpha(milliseconds) {
    const safeMs = Math.max(2, Math.min(80, milliseconds || 24));
    const seconds = safeMs / 1000;
    const updateSeconds = 16 / sampleRate;
    return 1 - Math.exp(-updateSeconds / seconds);
  }

  updateFormantCoefficients(event, elapsed, noteDuration) {
    const phoneme = event.phoneme;
    const resonance = event.resonance || DEFAULT_RESONANCE;
    const spectral = event.spectral || DEFAULT_SPECTRAL;
    const onsetSpan = Math.max(
      0.018,
      phoneme.closureSeconds
        + phoneme.burstSeconds
        + Math.min(0.055, phoneme.fricationSeconds),
      phoneme.voicingDelaySeconds,
    );
    const transitionDuration = Math.min(
      Math.max(event.articulate ? onsetSpan + 0.045 : 0.075, 0.06),
      noteDuration * 0.46,
    );
    const onsetMix = smootherstep(elapsed / Math.max(0.001, transitionDuration));
    const noteProgress = smoothstep(elapsed / Math.max(0.001, noteDuration));
    const centering = event.phrase.centeringStart
      + (event.phrase.centeringEnd - event.phrase.centeringStart) * noteProgress;
    const phraseEnergy = event.phrase.energyStart
      + (event.phrase.energyEnd - event.phrase.energyStart) * noteProgress;
    const anticipation = this.coarticulationMix(event, elapsed, noteDuration);
    const transitionProtected = elapsed < Math.max(0.02, spectral.transitionProtectionSeconds || 0.06);
    const sustainStart = Math.max(0.02, spectral.transitionProtectionSeconds || 0.06);
    const sustainProgress = smoothstep(
      (elapsed - sustainStart) / Math.max(0.001, noteDuration - sustainStart),
    );
    const trajectoryDepth = Math.max(0.6, Math.min(1.12, spectral.trajectoryDepth || 0.9));
    const energyTilt = Math.max(-1, Math.min(1, (phraseEnergy - 0.95) / 0.16));
    const spectralTilt = energyTilt
      * Math.max(0, Math.min(0.03, spectral.spectralTiltDepth || 0.01))
      * sustainProgress
      * trajectoryDepth;
    const vibratoEnvelope = 1
      + Math.sin(2 * Math.PI * this.vibratoPhase)
        * Math.max(0, Math.min(0.015, spectral.vibratoEnvelopeDepth || 0.005))
        * sustainProgress;
    const vibratoResonance = 1
      + Math.sin(2 * Math.PI * this.vibratoPhase)
        * Math.max(0, Math.min(0.03, resonance.vibratoResonanceDepth));

    // Pass 1: calculate the instantaneous spectral-envelope targets.
    for (let index = 0; index < 5; index += 1) {
      const band = event.formants[index];
      if (!band) continue;

      const neutral = NEUTRAL_FORMANTS[index] || band.targetHz;
      let currentTarget = phoneme.moraicN
        ? band.startHz
        : band.startHz + (band.targetHz - band.startHz) * onsetMix;

      if (band.nextHz !== null && anticipation > 0) {
        currentTarget += (band.nextHz - currentTarget) * anticipation;
      }
      currentTarget += (neutral - currentTarget) * centering;

      const articulationWidth = (1 - onsetMix) * (event.articulate ? 0.72 : 0.18);
      const transitionWidth = anticipation * 0.55;
      const energyWidth = Math.abs(phraseEnergy - 0.96) * 0.6 * trajectoryDepth;
      let bandwidth = band.bandwidth * (
        1 + Math.max(0, resonance.bandwidthMotion) * (articulationWidth + transitionWidth + energyWidth)
      );

      const collision = this.harmonicCollision(currentTarget, bandwidth, resonance);
      bandwidth *= 1 + collision * Math.max(0, resonance.collisionBandwidthBoost);

      const gainFloor = Math.max(0.65, Math.min(0.98, resonance.collisionGainFloor));
      const collisionGain = 1 - collision * (1 - gainFloor);
      const energyGain = 1 + (phraseEnergy - 0.96) * Math.max(0, resonance.gainMotion) * trajectoryDepth;
      const transitionGain = 1 - anticipation * Math.max(0, resonance.gainMotion) * 0.28;
      const upperWeight = index / 4;
      const tiltGain = 1 + spectralTilt * upperWeight;

      this.spectralTargetFrequency[index] = currentTarget;
      this.spectralTargetBandwidth[index] = bandwidth;
      this.spectralRawGain[index] = Math.max(
        0.62,
        Math.min(
          1.16,
          collisionGain * energyGain * transitionGain * vibratoResonance * vibratoEnvelope * tiltGain,
        ),
      );
    }

    // Pass 2: time smoothing plus a small frequency-axis FIR across neighbouring
    // formant gain targets, approximating VocaListener2's time-frequency smoothing.
    const baseFrequencyMix = Math.max(0, Math.min(0.24, spectral.frequencySmoothing || 0.1));
    const frequencyMix = transitionProtected ? baseFrequencyMix * 0.3 : baseFrequencyMix;
    const smoothingMs = transitionProtected
      ? spectral.transitionSmoothingMs
      : spectral.timeSmoothingMs;
    const alpha = this.spectralSmoothingAlpha(smoothingMs);

    for (let index = 0; index < 5; index += 1) {
      const band = event.formants[index];
      if (!band) continue;

      const previousGain = index > 0 ? this.spectralRawGain[index - 1] : this.spectralRawGain[index];
      const nextGain = index < 4 ? this.spectralRawGain[index + 1] : this.spectralRawGain[index];
      const neighborGain = (previousGain + this.spectralRawGain[index] + nextGain) / 3;
      const gainTarget = this.spectralRawGain[index] * (1 - frequencyMix) + neighborGain * frequencyMix;
      const frequencyTarget = this.spectralTargetFrequency[index];
      const bandwidthTarget = this.spectralTargetBandwidth[index];

      if (!this.spectralInitialized[index]) {
        this.spectralFrequencyState[index] = frequencyTarget;
        this.spectralBandwidthState[index] = bandwidthTarget;
        this.spectralGainState[index] = gainTarget;
        this.spectralInitialized[index] = 1;
      } else {
        this.spectralFrequencyState[index] += (frequencyTarget - this.spectralFrequencyState[index]) * alpha;
        this.spectralBandwidthState[index] += (bandwidthTarget - this.spectralBandwidthState[index]) * alpha;
        this.spectralGainState[index] += (gainTarget - this.spectralGainState[index]) * Math.min(1, alpha * 1.18);
      }

      const smoothedFrequency = Math.min(
        sampleRate * 0.45,
        Math.max(60, this.spectralFrequencyState[index]),
      );
      const smoothedBandwidth = Math.max(20, this.spectralBandwidthState[index]);
      this.formantGainScale[index] = Math.max(0.62, Math.min(1.16, this.spectralGainState[index]));

      const r = Math.exp(-Math.PI * smoothedBandwidth / sampleRate);
      const angle = 2 * Math.PI * smoothedFrequency / sampleRate;
      this.formantCoefficient[index] = 2 * r * Math.cos(angle);
      this.formantR2[index] = r * r;
      this.formantInput[index] = 1 - r;
    }

    this.coefficientCountdown = 15;
  }

  resonator(input, gain, index) {
    const y = this.formantInput[index] * input
      + this.formantCoefficient[index] * this.formantY1[index]
      - this.formantR2[index] * this.formantY2[index];
    this.formantY2[index] = this.formantY1[index];
    this.formantY1[index] = y;
    return y * gain;
  }

  presence(input, gain) {
    const y = this.presenceInput * input
      + this.presenceCoefficient * this.presenceY1
      - this.presenceR2 * this.presenceY2;
    this.presenceY2 = this.presenceY1;
    this.presenceY1 = y;
    return y * gain;
  }

  nasalAntiFormant(input, mix) {
    if (mix <= 0) return input;
    const y = this.nasalNotchB0 * input
      + this.nasalNotchB1 * this.nasalNotchX1
      + this.nasalNotchB2 * this.nasalNotchX2
      - this.nasalNotchA1 * this.nasalNotchY1
      - this.nasalNotchA2 * this.nasalNotchY2;
    this.nasalNotchX2 = this.nasalNotchX1;
    this.nasalNotchX1 = input;
    this.nasalNotchY2 = this.nasalNotchY1;
    this.nasalNotchY1 = y;
    return input + (y - input) * clamp01(mix);
  }

  envelopeFor(event, frame) {
    const progressFrames = Math.max(1, event.endFrame - event.startFrame);
    const elapsed = Math.max(0, frame - event.startFrame) / sampleRate;
    const remaining = Math.max(0, event.endFrame - frame) / sampleRate;
    const legato = !event.articulate;
    const attack = Math.max(0.012, legato ? 0.025 : event.style.attackSeconds);
    const release = Math.max(
      0.035,
      event.phraseEnd
        ? event.style.releaseSeconds * 1.35
        : legato
          ? 0.085
          : event.style.releaseSeconds,
    );

    const rawAttackGain = Math.min(1, elapsed / attack);
    const attackGain = legato ? 0.94 + rawAttackGain * 0.06 : rawAttackGain;
    const releaseGain = Math.min(1, remaining / release);
    const shaped = Math.sin(clamp01(attackGain) * Math.PI * 0.5)
      * Math.sin(clamp01(releaseGain) * Math.PI * 0.5);
    const normalized = (frame - event.startFrame) / progressFrames;
    return shaped * clamp01(1 - Math.max(0, normalized - 0.955) * 3.2);
  }

  noiseForConsonant(consonant, noise) {
    this.fricationLowState += (noise - this.fricationLowState) * 0.075;
    const low = this.fricationLowState;
    const high = noise - low;

    if (consonant === 's' || consonant === 'z' || consonant === 't') return high;
    if (consonant === 'f') return high * 0.68 + low * 0.32;
    if (consonant === 'h') return low * 0.74 + noise * 0.26;
    if (consonant === 'k' || consonant === 'g') return high * 0.58 + noise * 0.42;
    if (consonant === 'p' || consonant === 'b') return noise * 0.72 + low * 0.28;
    return low;
  }

  phonemeExcitation(event, elapsed, noteDuration, sourceSample, noise) {
    if (!event.articulate) {
      return { sourceGain: 1, noise: 0, nasalMix: 0, aspirationMix: 0 };
    }

    const p = event.phoneme;
    if (p.moraicN) {
      const release = smoothstep(
        (elapsed - noteDuration * 0.56) / Math.max(0.001, noteDuration * 0.38),
      );
      return {
        sourceGain: 0.76 + release * 0.16,
        noise: this.noiseForConsonant('n', noise) * p.noiseMix * 0.12,
        nasalMix: p.nasalMix * (1 - release * 0.42),
        aspirationMix: 0,
      };
    }

    const closureEnd = Math.min(noteDuration * 0.3, p.closureSeconds);
    const burstEnd = closureEnd + Math.min(0.025, p.burstSeconds);
    const fricationEnd = burstEnd + Math.min(0.075, p.fricationSeconds);
    const voiceStart = Math.min(noteDuration * 0.42, p.voicingDelaySeconds);
    const voiceRamp = smoothstep((elapsed - voiceStart) / 0.028);
    let sourceGain = p.voicedMix + (1 - p.voicedMix) * voiceRamp;

    let consonantNoise = 0;
    const shapedNoise = this.noiseForConsonant(p.consonant, noise);

    if (closureEnd > 0 && elapsed < closureEnd) {
      sourceGain *= p.voicedMix > 0.2 ? 0.42 : 0.08;
    } else if (p.burstSeconds > 0 && elapsed < burstEnd) {
      const burstPosition = (elapsed - closureEnd) / Math.max(0.001, burstEnd - closureEnd);
      const burstEnvelope = Math.sin(Math.PI * clamp01(burstPosition));
      consonantNoise += shapedNoise * p.noiseMix * burstEnvelope * 0.8;
    }

    if (p.fricationSeconds > 0 && elapsed < fricationEnd) {
      const start = Math.max(closureEnd, burstEnd - p.burstSeconds * 0.25);
      const span = Math.max(0.001, fricationEnd - start);
      const position = clamp01((elapsed - start) / span);
      const frictionEnvelope = Math.sin(Math.PI * position) ** 0.7;
      consonantNoise += shapedNoise * p.noiseMix * frictionEnvelope * 0.52;
    }

    if (p.nasalMix > 0 && elapsed < Math.max(0.045, fricationEnd)) {
      sourceGain = Math.max(sourceGain, p.voicedMix * 0.78);
    }

    return {
      sourceGain: Math.max(0, Math.min(1, sourceGain)),
      noise: consonantNoise,
      nasalMix: p.nasalMix * (1 - smoothstep(elapsed / Math.max(0.04, fricationEnd + 0.035))),
      aspirationMix: p.aspirationMix * (1 - smoothstep(elapsed / Math.max(0.045, voiceStart + 0.055))),
    };
  }

  advanceModulation(rate) {
    this.lastVibratoRate = rate;
    this.vibratoPhase += rate / sampleRate;
    this.vibratoPhase -= Math.floor(this.vibratoPhase);
    this.driftPhase += 0.55 / sampleRate;
    this.driftPhase -= Math.floor(this.driftPhase);
  }

  processSample(frame) {
    this.activateNext(frame);

    const event = this.active;
    if (event && frame >= event.endFrame) {
      this.lastEventEndFrame = event.endFrame;
      this.active = null;
    }

    if (!this.active) {
      this.phase += this.currentHz / sampleRate;
      this.phase -= Math.floor(this.phase);
      this.advanceModulation(this.lastVibratoRate);
      this.envelopeState *= 0.996;
      this.outputState *= 0.998;
      this.nasalState *= 0.996;
      this.fricationLowState *= 0.996;

      for (let index = 0; index < 5; index += 1) {
        this.formantY1[index] *= 0.9935;
        this.formantY2[index] *= 0.9935;
      }
      this.presenceY1 *= 0.9935;
      this.presenceY2 *= 0.9935;
      return 0;
    }

    const active = this.active;
    const elapsed = (frame - active.startFrame) / sampleRate;
    const remaining = Math.max(0, active.endFrame - frame) / sampleRate;
    const noteDuration = Math.max(
      0.001,
      (active.endFrame - active.startFrame) / sampleRate,
    );
    const noteProgress = smoothstep(elapsed / noteDuration);

    const phraseProgress = active.phrase.progressStart
      + (active.phrase.progressEnd - active.phrase.progressStart) * noteProgress;
    const phraseEnergy = active.phrase.energyStart
      + (active.phrase.energyEnd - active.phrase.energyStart) * noteProgress;
    const style = active.style;
    const karaoke = active.karaoke || DEFAULT_KARAOKE;
    const resonance = active.resonance || DEFAULT_RESONANCE;

    if (this.coefficientCountdown <= 0) {
      this.updateFormantCoefficients(active, elapsed, noteDuration);
    } else {
      this.coefficientCountdown -= 1;
    }

    const fromHz = Math.max(
      20,
      active.transitionFromHz ?? active.glideFromHz ?? active.targetHz,
    );
    const intervalSemitones = Math.abs(12 * Math.log2(active.targetHz / fromHz));
    const glideDuration = Math.min(
      0.11,
      Math.max(0.045, 0.052 + intervalSemitones * 0.006),
      noteDuration * 0.34,
    );

    let targetHz = active.targetHz;
    if (active.transitionFromHz !== null && elapsed < glideDuration) {
      const mix = smoothstep(elapsed / Math.max(0.001, glideDuration));
      targetHz = active.transitionFromHz
        * (active.targetHz / active.transitionFromHz) ** mix;
    } else if (active.glideFromHz !== null && elapsed < glideDuration) {
      const mix = smoothstep(elapsed / Math.max(0.001, glideDuration));
      targetHz = active.glideFromHz
        * (active.targetHz / active.glideFromHz) ** mix;
    } else if (
      active.glideFromHz === null
      && elapsed < Math.min(0.06, noteDuration * 0.24)
    ) {
      const onsetDuration = Math.min(0.06, noteDuration * 0.24);
      const mix = smoothstep(elapsed / Math.max(0.001, onsetDuration));
      const onsetHz = active.targetHz * 2 ** (this.onsetCents(active) / 1200);
      targetHz = onsetHz * (active.targetHz / onsetHz) ** mix;
    }

    const scoopWindow = Math.min(0.11, noteDuration * 0.3);
    const scoopProgress = smoothstep(elapsed / Math.max(0.001, scoopWindow));
    const scoopCents = -Math.max(0, karaoke.scoopCents) * (1 - scoopProgress);
    const fallWindow = Math.min(0.1, noteDuration * 0.24);
    const fallProgress = smoothstep(
      (fallWindow - remaining) / Math.max(0.001, fallWindow),
    );
    const fallCents = -Math.max(0, karaoke.fallCents) * fallProgress;
    targetHz *= 2 ** ((scoopCents + fallCents) / 1200);

    const noise = this.randomSigned();
    this.jitterState += (noise - this.jitterState) * 0.00095;
    this.shimmerState += (noise - this.shimmerState) * 0.0007;

    this.advanceModulation(style.vibratoRateHz);
    const straightHoldRatio = Math.max(0.2, Math.min(0.96, karaoke.straightHoldRatio));
    const straightEnd = noteDuration * straightHoldRatio;
    const vibratoDelay = Math.max(
      Math.min(style.vibratoDelaySeconds, noteDuration * 0.75),
      straightEnd,
    );
    const vibratoRise = smoothstep(
      (elapsed - vibratoDelay) / Math.max(0.08, noteDuration - vibratoDelay),
    );
    const durationEligibility = karaoke.longTone
      ? 1
      : clamp01((noteDuration - 0.55) / 0.55);
    const phraseVibratoEligibility = 0.65
      + smoothstep((phraseProgress - 0.42) / 0.38) * 0.35;
    const vibratoWave = Math.sin(2 * Math.PI * this.vibratoPhase);
    const vibratoCents = vibratoWave
      * style.vibratoDepthCents
      * vibratoRise
      * durationEligibility
      * phraseVibratoEligibility
      * Math.max(0, Math.min(1, karaoke.vibratoGain));

    const instability = 1 - clamp01(karaoke.pitchStability);
    const driftCents = Math.sin(2 * Math.PI * this.driftPhase)
      * 0.55
      * (0.22 + instability * 0.78);
    const jitterCents = this.jitterState
      * style.jitterCents
      * (0.18 + instability * 0.82);

    const desiredHz = targetHz
      * 2 ** ((vibratoCents + driftCents + jitterCents) / 1200);
    const safeDesiredHz = Number.isFinite(desiredHz)
      ? Math.max(20, Math.min(2200, desiredHz))
      : active.targetHz;
    const pitchFollow = elapsed < glideDuration
      ? 0.035
      : 0.044 + clamp01(karaoke.pitchStability) * 0.008;
    this.currentHz += (safeDesiredHz - this.currentHz) * pitchFollow;

    this.phase += this.currentHz / sampleRate;
    this.phase -= Math.floor(this.phase);

    const releaseProgress = smoothstep((phraseProgress - 0.7) / 0.3);
    const highPitchAmount = clamp01((this.currentHz - 420) / 520);
    const energyAmount = Math.max(-1, Math.min(1, (phraseEnergy - 0.95) / 0.14));
    const dynamicOpenQuotient = Math.max(
      0.46,
      Math.min(
        0.82,
        style.glottalOpenQuotient
          - energyAmount * Math.max(0, resonance.energyClosureDepth)
          + releaseProgress * Math.max(0, resonance.releaseOpenBoost)
          + highPitchAmount * Math.max(0, resonance.highPitchOpenBoost),
      ),
    );
    const dynamicSpeedQuotient = Math.max(
      0.48,
      Math.min(
        0.84,
        style.glottalSpeedQuotient
          + energyAmount * Math.max(0, resonance.speedEnergyBoost)
          - releaseProgress * 0.012,
      ),
    );

    const flow = this.glottalFlow(
      this.phase,
      dynamicOpenQuotient,
      dynamicSpeedQuotient,
    );
    const derivative = flow - this.previousFlow;
    this.previousFlow = flow;

    const highPitchSoftening = clamp01((this.currentHz - 520) / 520);
    const releaseSoftening = releaseProgress * 0.46;
    const derivativeMix = 7.2 - highPitchSoftening * 1.28 - releaseSoftening;
    const rawSource = flow * (0.54 + highPitchSoftening * 0.035)
      + derivative * derivativeMix;
    this.sourceState += (rawSource - this.sourceState) * 0.62;

    const coupling = Math.max(
      0,
      Math.min(0.015, active.phrase.sourceTractCoupling),
    );
    const safeF1 = Math.max(-0.22, Math.min(0.22, this.formantY1[0]));
    const coupledSource = this.sourceState + safeF1 * coupling;

    const articulation = this.phonemeExcitation(
      active,
      elapsed,
      noteDuration,
      coupledSource,
      noise,
    );

    const tractSource = coupledSource * articulation.sourceGain;
    let vocal = 0;
    for (let index = 0; index < Math.min(5, active.formants.length); index += 1) {
      const gainScale = this.formantGainScale[index] || 1;
      vocal += this.resonator(tractSource, active.formants[index].gain * gainScale, index);
    }
    vocal += this.presence(tractSource, style.presenceGain);

    this.nasalState += (tractSource - this.nasalState) * 0.055;
    if (articulation.nasalMix > 0) {
      const antiMix = articulation.nasalMix * Math.max(0, Math.min(0.5, resonance.nasalZeroMix));
      vocal = this.nasalAntiFormant(vocal, antiMix);
      vocal = vocal * (1 - articulation.nasalMix * 0.3)
        + this.nasalState * articulation.nasalMix * 0.27;
    }

    const highpassed = this.radiationAlpha
      * (this.radiationState + vocal - this.previousRadiationInput);
    this.previousRadiationInput = vocal;
    this.radiationState = highpassed;
    vocal += highpassed * this.radiationMix;

    const phraseBreath = active.phraseStart
      ? 1
      : active.articulate
        ? 0.45
        : 0.18;
    const breathEnvelope = clamp01(elapsed / 0.055)
      * clamp01(remaining / 0.085);
    const breath = (noise - this.shimmerState)
      * style.breathLevel
      * phraseBreath
      * breathEnvelope;

    const glottalOpen = this.phase < dynamicOpenQuotient
      ? Math.sin(Math.PI * clamp01(this.phase / dynamicOpenQuotient)) ** 2
      : 0;
    const aspiration = (noise - this.jitterState)
      * style.breathLevel
      * active.phrase.aspirationDepth
      * 2.2
      * (0.22 + glottalOpen * 0.78)
      * (1 + articulation.aspirationMix * 0.75);

    const releaseBreathGain = active.phraseEnd
      ? clamp01((0.11 - remaining) / 0.11)
      : 0;
    const releaseBreath = (noise - this.shimmerState)
      * style.breathLevel
      * 0.55
      * releaseBreathGain;

    const amplitudeVibrato = 1
      + vibratoWave
        * style.intensityModDepth
        * vibratoRise
        * durationEligibility
        * phraseVibratoEligibility
        * Math.max(0, Math.min(1, karaoke.vibratoGain));
    const shimmer = 1 + this.shimmerState * style.shimmerDepth;

    const targetEnvelope = this.envelopeFor(active, frame)
      * Math.max(0.3, Math.min(1, active.velocity))
      * phraseEnergy
      * Math.max(0.85, Math.min(1.12, karaoke.dynamicGain));
    const envelopeRate = targetEnvelope > this.envelopeState
      ? active.articulate
        ? 0.0055
        : 0.0028
      : 0.0023;
    this.envelopeState += (targetEnvelope - this.envelopeState) * envelopeRate;

    let sample = (
      vocal * amplitudeVibrato * shimmer
      + breath
      + aspiration
      + releaseBreath
      + articulation.noise
    ) * this.envelopeState * 0.415;

    const readIndex = (
      this.delayWrite
      - this.delaySamples
      + this.delayBuffer.length
    ) % this.delayBuffer.length;
    const delayed = this.delayBuffer[readIndex];
    this.delayBuffer[this.delayWrite] = sample;
    this.delayWrite = (this.delayWrite + 1) % this.delayBuffer.length;
    sample += delayed * style.doubleLevel;

    if (!Number.isFinite(sample)) sample = 0;
    const absSample = Math.abs(sample);
    if (absSample > 0.72) {
      const sign = sample < 0 ? -1 : 1;
      sample = sign
        * (0.72 + (1 - Math.exp(-(absSample - 0.72) * 2.6)) * 0.18);
    }

    const driven = sample * 1.003;
    sample = driven / (1 + Math.abs(driven) * 0.035);
    this.outputState += (sample - this.outputState) * 0.62;
    return Math.max(-0.92, Math.min(0.92, this.outputState));
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    const channel = output && output[0];
    if (!channel) return true;

    for (let index = 0; index < channel.length; index += 1) {
      channel[index] = this.processSample(currentFrame + index);
    }
    return true;
  }
}

registerProcessor('sound-wave-vocal-processor', SoundWaveVocalProcessor);
