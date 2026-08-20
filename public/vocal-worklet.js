const NEUTRAL_FORMANTS = [500, 1500, 2500, 3500, 4500];

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function smoothstep(value) {
  const x = clamp01(value);
  return x * x * (3 - 2 * x);
}

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
    this.presenceY1 = 0;
    this.presenceY2 = 0;
    this.presenceCoefficient = 0;
    this.presenceR2 = 0;
    this.presenceInput = 0;
    this.previousRadiationInput = 0;
    this.radiationState = 0;
    this.radiationAlpha = 0.9;
    this.radiationMix = 0;
    this.noiseSeed = 0x6d2b79f5;
    this.jitterState = 0;
    this.shimmerState = 0;
    this.consonantNoiseState = 0;
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
      return;
    }
    if (data.type !== 'schedule' || !data.event) return;
    const event = data.event;
    const scheduled = {
      ...event,
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

  prepareActive(event) {
    const carry = event.articulate ? 0.78 : 0.975;
    for (let index = 0; index < 5; index += 1) {
      this.formantY1[index] *= carry;
      this.formantY2[index] *= carry;
    }
    this.presenceY1 *= carry;
    this.presenceY2 *= carry;

    const presenceBandwidth = 840;
    const presenceR = Math.exp(-Math.PI * presenceBandwidth / sampleRate);
    const presenceAngle = 2 * Math.PI * Math.min(sampleRate * 0.45, Math.max(80, event.style.presenceFrequency)) / sampleRate;
    this.presenceCoefficient = 2 * presenceR * Math.cos(presenceAngle);
    this.presenceR2 = presenceR * presenceR;
    this.presenceInput = 1 - presenceR;
    this.radiationAlpha = Math.exp(-2 * Math.PI * Math.max(200, event.style.radiationFrequency) / sampleRate);
    this.radiationMix = Math.max(0, Math.min(0.95, (10 ** (event.style.radiationGainDb / 20) - 1) * 0.52));
    this.delaySamples = Math.max(1, Math.min(this.delayBuffer.length - 1, Math.round(event.style.doubleDelaySeconds * sampleRate)));
    this.coefficientCountdown = 0;
  }

  activateNext(frame) {
    while (this.queue.length && this.queue[0].startFrame <= frame) {
      const previous = this.active;
      const next = this.queue.shift();
      const previousEnd = previous ? previous.endFrame : this.lastEventEndFrame;
      const gapFrames = previousEnd >= 0 ? Math.max(0, next.startFrame - previousEnd) : Number.POSITIVE_INFINITY;
      const nearContinuous = previous !== null || gapFrames <= Math.round(sampleRate * 0.045);

      this.active = next;
      if (nearContinuous) {
        // Keep the actual running F0 and glide into the next target. This also
        // covers articulated adjacent syllables, which used to hard-reset F0
        // and could sound like a brief voice flip or crack.
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
    const extent = event.style.onsetPitchCents || 0;
    let hash = 2166136261;
    const text = `${event.syllable}:${event.startFrame}`;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    const random = (((hash >>> 0) % 1001) / 500 - 1);
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

  updateFormantCoefficients(event, elapsed, noteDuration) {
    const transitionDuration = Math.min(event.articulate ? 0.145 : 0.09, noteDuration * 0.44);
    const transition = clamp01(elapsed / Math.max(0.001, transitionDuration));
    const eased = transition * transition * transition * (transition * (transition * 6 - 15) + 10);
    const noteProgress = smoothstep(elapsed / Math.max(0.001, noteDuration));
    const centering = event.phrase.centeringStart
      + (event.phrase.centeringEnd - event.phrase.centeringStart) * noteProgress;

    for (let index = 0; index < 5; index += 1) {
      const band = event.formants[index];
      if (!band) continue;
      const neutral = NEUTRAL_FORMANTS[index] || band.targetHz;
      const centeredTarget = band.targetHz + (neutral - band.targetHz) * centering;
      const frequency = band.startHz + (centeredTarget - band.startHz) * eased;
      const r = Math.exp(-Math.PI * Math.max(20, band.bandwidth) / sampleRate);
      const angle = 2 * Math.PI * Math.min(sampleRate * 0.45, Math.max(60, frequency)) / sampleRate;
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
    const y = this.presenceInput * input + this.presenceCoefficient * this.presenceY1 - this.presenceR2 * this.presenceY2;
    this.presenceY2 = this.presenceY1;
    this.presenceY1 = y;
    return y * gain;
  }

  envelopeFor(event, frame) {
    const progressFrames = Math.max(1, event.endFrame - event.startFrame);
    const elapsed = Math.max(0, frame - event.startFrame) / sampleRate;
    const remaining = Math.max(0, event.endFrame - frame) / sampleRate;
    const legato = !event.articulate;
    const attack = Math.max(0.012, legato ? 0.025 : event.style.attackSeconds);
    const release = Math.max(0.035, event.phraseEnd ? event.style.releaseSeconds * 1.35 : legato ? 0.085 : event.style.releaseSeconds);
    const rawAttackGain = Math.min(1, elapsed / attack);
    const attackGain = legato ? 0.94 + rawAttackGain * 0.06 : rawAttackGain;
    const releaseGain = Math.min(1, remaining / release);
    const shaped = Math.sin(clamp01(attackGain) * Math.PI * 0.5)
      * Math.sin(clamp01(releaseGain) * Math.PI * 0.5);
    const normalized = (frame - event.startFrame) / progressFrames;
    return shaped * clamp01(1 - Math.max(0, normalized - 0.955) * 3.2);
  }

  consonant(event, elapsed, sourceSample, noise) {
    if (!event.articulate || elapsed < 0 || elapsed > 0.075) return 0;
    const initial = String(event.syllable || '').charAt(0).toLowerCase();
    const fade = 1 - elapsed / 0.075;
    this.consonantNoiseState += (noise - this.consonantNoiseState) * 0.06;
    const softNoise = this.consonantNoiseState;
    if (initial === 'm' || initial === 'n') return sourceSample * fade * (initial === 'm' ? 0.12 : 0.09);
    if (initial === 'l') return (sourceSample * 0.04 + softNoise * 0.004) * fade;
    if (initial === 'r') return (sourceSample * 0.03 + softNoise * 0.006) * fade;
    if (initial === 'y') return sourceSample * fade * 0.03;
    return 0;
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
    const noteDuration = Math.max(0.001, (active.endFrame - active.startFrame) / sampleRate);
    const noteProgress = smoothstep(elapsed / noteDuration);
    const phraseProgress = active.phrase.progressStart
      + (active.phrase.progressEnd - active.phrase.progressStart) * noteProgress;
    const phraseEnergy = active.phrase.energyStart
      + (active.phrase.energyEnd - active.phrase.energyStart) * noteProgress;
    const style = active.style;
    if (this.coefficientCountdown <= 0) this.updateFormantCoefficients(active, elapsed, noteDuration);
    else this.coefficientCountdown -= 1;

    const glideDuration = Math.min(0.075, noteDuration * 0.3);
    let targetHz = active.targetHz;
    if (active.transitionFromHz !== null && elapsed < glideDuration) {
      const mix = clamp01(elapsed / Math.max(0.001, glideDuration));
      const eased = mix * mix * (3 - 2 * mix);
      targetHz = active.transitionFromHz * (active.targetHz / active.transitionFromHz) ** eased;
    } else if (active.glideFromHz !== null && elapsed < glideDuration) {
      const mix = clamp01(elapsed / Math.max(0.001, glideDuration));
      const eased = mix * mix * (3 - 2 * mix);
      targetHz = active.glideFromHz * (active.targetHz / active.glideFromHz) ** eased;
    } else if (active.glideFromHz === null && elapsed < Math.min(0.06, noteDuration * 0.24)) {
      const mix = elapsed / Math.max(0.001, Math.min(0.06, noteDuration * 0.24));
      const eased = mix * mix * (3 - 2 * mix);
      const onsetHz = active.targetHz * 2 ** (this.onsetCents(active) / 1200);
      targetHz = onsetHz * (active.targetHz / onsetHz) ** eased;
    }

    const noise = this.randomSigned();
    this.jitterState += (noise - this.jitterState) * 0.00095;
    this.shimmerState += (noise - this.shimmerState) * 0.0007;
    this.advanceModulation(style.vibratoRateHz);
    const vibratoEligibility = Math.max(0, Math.min(1, (noteDuration - 0.55) / 0.55));
    const phraseVibratoEligibility = smoothstep((phraseProgress - 0.42) / 0.38);
    const vibratoDelay = Math.min(style.vibratoDelaySeconds, noteDuration * 0.62);
    const vibratoRise = clamp01((elapsed - vibratoDelay) / 0.26);
    const vibratoWave = Math.sin(2 * Math.PI * this.vibratoPhase);
    const vibratoCents = vibratoWave * style.vibratoDepthCents
      * vibratoRise * vibratoEligibility * phraseVibratoEligibility;
    const driftCents = Math.sin(2 * Math.PI * this.driftPhase) * 0.55;
    const jitterCents = this.jitterState * style.jitterCents;
    const desiredHz = targetHz * 2 ** ((vibratoCents + driftCents + jitterCents) / 1200);
    const safeDesiredHz = Number.isFinite(desiredHz) ? Math.max(20, Math.min(2200, desiredHz)) : active.targetHz;
    this.currentHz += (safeDesiredHz - this.currentHz) * 0.035;

    this.phase += this.currentHz / sampleRate;
    this.phase -= Math.floor(this.phase);
    const flow = this.glottalFlow(this.phase, style.glottalOpenQuotient, style.glottalSpeedQuotient);
    const derivative = flow - this.previousFlow;
    this.previousFlow = flow;
    const rawSource = flow * 0.54 + derivative * 7.2;
    this.sourceState += (rawSource - this.sourceState) * 0.62;

    // Keep source–tract coupling subtle and peak-safe. Rare large F1 states can
    // otherwise feed back as a short crack even when the average coupling is low.
    const coupling = Math.max(0, Math.min(0.015, active.phrase.sourceTractCoupling));
    const safeF1 = Math.max(-0.22, Math.min(0.22, this.formantY1[0]));
    const coupledSource = this.sourceState + safeF1 * coupling;

    let vocal = 0;
    for (let index = 0; index < Math.min(5, active.formants.length); index += 1) {
      vocal += this.resonator(coupledSource, active.formants[index].gain, index);
    }
    vocal += this.presence(coupledSource, style.presenceGain);

    const highpassed = this.radiationAlpha * (this.radiationState + vocal - this.previousRadiationInput);
    this.previousRadiationInput = vocal;
    this.radiationState = highpassed;
    vocal += highpassed * this.radiationMix;

    const phraseBreath = active.phraseStart ? 1 : active.articulate ? 0.45 : 0.18;
    const breathEnvelope = clamp01(elapsed / 0.055) * clamp01(remaining / 0.085);
    const breath = (noise - this.shimmerState) * style.breathLevel * phraseBreath * breathEnvelope;

    const openQuotient = Math.max(0.1, style.glottalOpenQuotient);
    const glottalOpen = this.phase < openQuotient
      ? Math.sin(Math.PI * clamp01(this.phase / openQuotient)) ** 2
      : 0;
    const aspiration = (noise - this.jitterState) * style.breathLevel
      * active.phrase.aspirationDepth * 2.2 * (0.22 + glottalOpen * 0.78);

    const releaseBreathGain = active.phraseEnd ? clamp01((0.11 - remaining) / 0.11) : 0;
    const releaseBreath = (noise - this.shimmerState) * style.breathLevel * 0.55 * releaseBreathGain;
    const consonant = this.consonant(active, elapsed, coupledSource, noise);
    const amplitudeVibrato = 1 + vibratoWave * style.intensityModDepth
      * vibratoRise * vibratoEligibility * phraseVibratoEligibility;
    const shimmer = 1 + this.shimmerState * style.shimmerDepth;
    const targetEnvelope = this.envelopeFor(active, frame)
      * Math.max(0.3, Math.min(1, active.velocity)) * phraseEnergy;
    const envelopeRate = targetEnvelope > this.envelopeState
      ? active.articulate ? 0.0055 : 0.0028
      : 0.0023;
    this.envelopeState += (targetEnvelope - this.envelopeState) * envelopeRate;
    let sample = (vocal * amplitudeVibrato * shimmer + breath + aspiration + releaseBreath + consonant)
      * this.envelopeState * 0.415;

    const readIndex = (this.delayWrite - this.delaySamples + this.delayBuffer.length) % this.delayBuffer.length;
    const delayed = this.delayBuffer[readIndex];
    this.delayBuffer[this.delayWrite] = sample;
    this.delayWrite = (this.delayWrite + 1) % this.delayBuffer.length;
    sample += delayed * style.doubleLevel;

    if (!Number.isFinite(sample)) sample = 0;
    const absSample = Math.abs(sample);
    if (absSample > 0.72) {
      const sign = sample < 0 ? -1 : 1;
      sample = sign * (0.72 + (1 - Math.exp(-(absSample - 0.72) * 2.6)) * 0.18);
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
