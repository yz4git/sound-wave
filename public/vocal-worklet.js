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
    this.lastVibratoRate = 5.2;
    this.delayBuffer = new Float32Array(4096);
    this.delayWrite = 0;
    this.delaySamples = 512;
    this.coefficientCountdown = 0;
    this.port.onmessage = (message) => this.handleMessage(message.data);
  }

  handleMessage(data) {
    if (!data || typeof data.type !== 'string') return;
    if (data.type === 'clear') {
      this.queue.length = 0;
      this.active = null;
      this.envelopeState = 0;
      return;
    }
    if (data.type !== 'schedule' || !data.event) return;
    const event = data.event;
    const scheduled = {
      ...event,
      startFrame: Math.max(currentFrame, Math.round(event.when * sampleRate)),
      endFrame: Math.max(currentFrame + 1, Math.round((event.when + event.duration) * sampleRate)),
    };
    this.queue.push(scheduled);
    this.queue.sort((a, b) => a.startFrame - b.startFrame);
  }

  randomSigned() {
    this.noiseSeed = (Math.imul(this.noiseSeed, 1664525) + 1013904223) >>> 0;
    return this.noiseSeed / 4294967296 * 2 - 1;
  }

  prepareActive(event) {
    const carry = event.articulate ? 0.72 : 0.96;
    for (let index = 0; index < 5; index += 1) {
      this.formantY1[index] *= carry;
      this.formantY2[index] *= carry;
    }
    this.presenceY1 *= carry;
    this.presenceY2 *= carry;

    const presenceBandwidth = 760;
    const presenceR = Math.exp(-Math.PI * presenceBandwidth / sampleRate);
    const presenceAngle = 2 * Math.PI * Math.min(sampleRate * 0.45, Math.max(80, event.style.presenceFrequency)) / sampleRate;
    this.presenceCoefficient = 2 * presenceR * Math.cos(presenceAngle);
    this.presenceR2 = presenceR * presenceR;
    this.presenceInput = 1 - presenceR;
    this.radiationAlpha = Math.exp(-2 * Math.PI * Math.max(200, event.style.radiationFrequency) / sampleRate);
    this.radiationMix = Math.max(0, Math.min(1.05, (10 ** (event.style.radiationGainDb / 20) - 1) * 0.56));
    this.delaySamples = Math.max(1, Math.min(this.delayBuffer.length - 1, Math.round(event.style.doubleDelaySeconds * sampleRate)));
    this.coefficientCountdown = 0;
  }

  activateNext(frame) {
    while (this.queue.length && this.queue[0].startFrame <= frame) {
      const previous = this.active;
      const next = this.queue.shift();
      const continuousLegato = previous !== null && previous.endFrame >= frame && next.glideFromHz !== null;
      this.active = next;
      if (!continuousLegato) {
        if (next.glideFromHz !== null) this.currentHz = Math.max(20, next.glideFromHz);
        else {
          const cents = this.onsetCents(next);
          this.currentHz = Math.max(20, next.targetHz * 2 ** (cents / 1200));
        }
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
    return (((hash >>> 0) % 1001) / 500 - 1) * extent;
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
    const transitionDuration = Math.min(event.articulate ? 0.13 : 0.075, noteDuration * 0.42);
    const transition = Math.max(0, Math.min(1, elapsed / Math.max(0.001, transitionDuration)));
    const eased = transition * transition * transition * (transition * (transition * 6 - 15) + 10);
    for (let index = 0; index < 5; index += 1) {
      const band = event.formants[index];
      if (!band) continue;
      const frequency = band.startHz + (band.targetHz - band.startHz) * eased;
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
    const attack = Math.max(0.01, legato ? 0.02 : event.style.attackSeconds);
    const release = Math.max(0.03, event.phraseEnd ? event.style.releaseSeconds * 1.22 : legato ? 0.075 : event.style.releaseSeconds);
    const rawAttackGain = Math.min(1, elapsed / attack);
    const attackGain = legato ? 0.9 + rawAttackGain * 0.1 : rawAttackGain;
    const releaseGain = Math.min(1, remaining / release);
    const shaped = Math.sin(Math.min(1, Math.max(0, attackGain)) * Math.PI * 0.5)
      * Math.sin(Math.min(1, Math.max(0, releaseGain)) * Math.PI * 0.5);
    const normalized = (frame - event.startFrame) / progressFrames;
    return shaped * Math.max(0, Math.min(1, 1 - Math.max(0, normalized - 0.95) * 3.5));
  }

  consonant(event, elapsed, sourceSample, noise) {
    if (!event.articulate || elapsed < 0 || elapsed > 0.065) return 0;
    const initial = String(event.syllable || '').charAt(0).toLowerCase();
    const fade = 1 - elapsed / 0.065;
    this.consonantNoiseState += (noise - this.consonantNoiseState) * 0.08;
    const softNoise = this.consonantNoiseState;
    if (initial === 'm' || initial === 'n') return sourceSample * fade * (initial === 'm' ? 0.15 : 0.11);
    if (initial === 'l') return (sourceSample * 0.045 + softNoise * 0.006) * fade;
    if (initial === 'r') return (sourceSample * 0.038 + softNoise * 0.008) * fade;
    if (initial === 'y') return sourceSample * fade * 0.035;
    return 0;
  }

  advanceModulation(rate) {
    this.lastVibratoRate = rate;
    this.vibratoPhase += rate / sampleRate;
    this.vibratoPhase -= Math.floor(this.vibratoPhase);
    this.driftPhase += 0.63 / sampleRate;
    this.driftPhase -= Math.floor(this.driftPhase);
  }

  processSample(frame) {
    this.activateNext(frame);
    const event = this.active;
    if (event && frame >= event.endFrame) this.active = null;

    if (!this.active) {
      this.phase += this.currentHz / sampleRate;
      this.phase -= Math.floor(this.phase);
      this.advanceModulation(this.lastVibratoRate);
      this.envelopeState *= 0.9955;
      this.outputState *= 0.997;
      for (let index = 0; index < 5; index += 1) {
        this.formantY1[index] *= 0.993;
        this.formantY2[index] *= 0.993;
      }
      this.presenceY1 *= 0.993;
      this.presenceY2 *= 0.993;
      return 0;
    }

    const active = this.active;
    const elapsed = (frame - active.startFrame) / sampleRate;
    const noteDuration = Math.max(0.001, (active.endFrame - active.startFrame) / sampleRate);
    const style = active.style;
    if (this.coefficientCountdown <= 0) this.updateFormantCoefficients(active, elapsed, noteDuration);
    else this.coefficientCountdown -= 1;

    const glideDuration = Math.min(0.07, noteDuration * 0.28);
    let targetHz = active.targetHz;
    if (active.glideFromHz !== null && elapsed < glideDuration) {
      const mix = Math.max(0, Math.min(1, elapsed / Math.max(0.001, glideDuration)));
      const eased = mix * mix * (3 - 2 * mix);
      targetHz = active.glideFromHz * (active.targetHz / active.glideFromHz) ** eased;
    } else if (active.glideFromHz === null && elapsed < Math.min(0.055, noteDuration * 0.22)) {
      const mix = elapsed / Math.max(0.001, Math.min(0.055, noteDuration * 0.22));
      const eased = mix * mix * (3 - 2 * mix);
      const onsetHz = active.targetHz * 2 ** (this.onsetCents(active) / 1200);
      targetHz = onsetHz * (active.targetHz / onsetHz) ** eased;
    }

    const noise = this.randomSigned();
    this.jitterState += (noise - this.jitterState) * 0.00125;
    this.shimmerState += (noise - this.shimmerState) * 0.0009;
    this.advanceModulation(style.vibratoRateHz);
    const vibratoEligibility = Math.max(0, Math.min(1, (noteDuration - 0.42) / 0.46));
    const vibratoDelay = Math.min(style.vibratoDelaySeconds, noteDuration * 0.58);
    const vibratoRise = Math.max(0, Math.min(1, (elapsed - vibratoDelay) / 0.2));
    const vibratoWave = Math.sin(2 * Math.PI * this.vibratoPhase);
    const vibratoCents = vibratoWave * style.vibratoDepthCents * vibratoRise * vibratoEligibility;
    const driftCents = Math.sin(2 * Math.PI * this.driftPhase) * 1.0;
    const jitterCents = this.jitterState * style.jitterCents;
    const desiredHz = targetHz * 2 ** ((vibratoCents + driftCents + jitterCents) / 1200);
    this.currentHz += (desiredHz - this.currentHz) * 0.055;

    this.phase += this.currentHz / sampleRate;
    this.phase -= Math.floor(this.phase);
    const flow = this.glottalFlow(this.phase, style.glottalOpenQuotient, style.glottalSpeedQuotient);
    const derivative = flow - this.previousFlow;
    this.previousFlow = flow;
    const rawSource = flow * 0.47 + derivative * 8.6;
    this.sourceState += (rawSource - this.sourceState) * 0.72;
    const glottalSource = this.sourceState;

    let vocal = 0;
    for (let index = 0; index < Math.min(5, active.formants.length); index += 1) {
      vocal += this.resonator(glottalSource, active.formants[index].gain, index);
    }
    vocal += this.presence(glottalSource, style.presenceGain);

    const highpassed = this.radiationAlpha * (this.radiationState + vocal - this.previousRadiationInput);
    this.previousRadiationInput = vocal;
    this.radiationState = highpassed;
    vocal += highpassed * this.radiationMix;

    const phraseBreath = active.phraseStart ? 1.05 : active.articulate ? 0.52 : 0.2;
    const breathEnvelope = Math.max(0, Math.min(1, elapsed / 0.05)) * Math.max(0, Math.min(1, (noteDuration - elapsed) / 0.075));
    const breath = (noise - this.shimmerState) * style.breathLevel * phraseBreath * breathEnvelope;
    const consonant = this.consonant(active, elapsed, glottalSource, noise);
    const amplitudeVibrato = 1 + vibratoWave * style.intensityModDepth * vibratoRise * vibratoEligibility;
    const shimmer = 1 + this.shimmerState * style.shimmerDepth;
    const targetEnvelope = this.envelopeFor(active, frame) * Math.max(0.3, Math.min(1, active.velocity));
    const envelopeRate = targetEnvelope > this.envelopeState
      ? active.articulate ? 0.007 : 0.0035
      : 0.0027;
    this.envelopeState += (targetEnvelope - this.envelopeState) * envelopeRate;
    let sample = (vocal * amplitudeVibrato * shimmer + breath + consonant) * this.envelopeState * 0.405;

    const readIndex = (this.delayWrite - this.delaySamples + this.delayBuffer.length) % this.delayBuffer.length;
    const delayed = this.delayBuffer[readIndex];
    this.delayBuffer[this.delayWrite] = sample;
    this.delayWrite = (this.delayWrite + 1) % this.delayBuffer.length;
    sample += delayed * style.doubleLevel;

    const driven = sample * 1.01;
    sample = driven / (1 + Math.abs(driven) * 0.035);
    this.outputState += (sample - this.outputState) * 0.74;
    return Math.max(-0.95, Math.min(0.95, this.outputState));
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