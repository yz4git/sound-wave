export type VoiceImprintQualityLabel = 'excellent' | 'good' | 'fair' | 'poor';

export interface VoiceImprintQuality {
  score: number;
  label: VoiceImprintQualityLabel;
  activeSpeechRatio: number;
  clippingRate: number;
  pitchSpreadSemitones: number;
  rmsDb: number;
}

export interface VoiceIdentityImprint {
  version: 1;
  formantGain: readonly [number, number, number, number, number];
  sourceTiltScale: number;
  presenceFrequencyScale: number;
  presenceGainScale: number;
  breathScale: number;
  radiationGainDb: number;
  medianF0Hz: number;
  suggestedPitchMidi: number;
  confidence: number;
  analyzedSeconds: number;
  /** Added after v1 launch; omitted legacy profiles remain valid. */
  quality?: VoiceImprintQuality;
}

export interface VoiceImprintAnalysis {
  imprint: VoiceIdentityImprint;
  voicedFrameCount: number;
  spectralFrameCount: number;
  quality: VoiceImprintQuality;
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const center = sorted[middle] ?? 0;
  return sorted.length % 2 === 1
    ? center
    : ((sorted[middle - 1] ?? center) + center) * 0.5;
}

function frameRms(samples: Float32Array, start: number, size: number): number {
  let sum = 0;
  const end = Math.min(samples.length, start + size);
  const count = Math.max(1, end - start);
  for (let i = start; i < end; i += 1) {
    const sample = samples[i] ?? 0;
    sum += sample * sample;
  }
  return Math.sqrt(sum / count);
}

function qualityLabel(score: number): VoiceImprintQualityLabel {
  if (score >= 0.86) return 'excellent';
  if (score >= 0.7) return 'good';
  if (score >= 0.5) return 'fair';
  return 'poor';
}

function levelScore(rmsDb: number): number {
  if (rmsDb < -48 || rmsDb > -1) return 0.2;
  if (rmsDb < -32) return clamp((rmsDb + 48) / 16, 0.2, 1);
  if (rmsDb > -6) return clamp((-1 - rmsDb) / 5, 0.2, 1);
  return 1;
}

/**
 * Mirrors Irodori's reference preprocessing boundary: analyze a stable
 * 48 kHz mono representation regardless of the original recording rate.
 * Linear interpolation is sufficient here because this data feeds coarse
 * conditioning statistics, not the audible output path.
 */
export function resampleVoiceReference(
  samples: Float32Array,
  sourceRate: number,
  targetRate: number = 48_000,
): Float32Array {
  if (!Number.isFinite(sourceRate) || sourceRate <= 0 || !Number.isFinite(targetRate) || targetRate <= 0) {
    throw new Error('Invalid reference sample rate');
  }
  if (samples.length === 0) return new Float32Array();
  if (Math.abs(sourceRate - targetRate) < 0.5) return samples.slice();

  const targetLength = Math.max(1, Math.round(samples.length * targetRate / sourceRate));
  const output = new Float32Array(targetLength);
  const scale = sourceRate / targetRate;
  for (let i = 0; i < targetLength; i += 1) {
    const sourcePosition = i * scale;
    const left = Math.min(samples.length - 1, Math.floor(sourcePosition));
    const right = Math.min(samples.length - 1, left + 1);
    const mix = sourcePosition - left;
    output[i] = (samples[left] ?? 0) * (1 - mix) + (samples[right] ?? 0) * mix;
  }
  return output;
}

function estimateF0(
  samples: Float32Array,
  start: number,
  size: number,
  sampleRate: number,
): { hz: number; confidence: number } {
  const stride = Math.max(1, Math.round(sampleRate / 8000));
  const effectiveRate = sampleRate / stride;
  const count = Math.floor(size / stride);
  if (count < 128) return { hz: 0, confidence: 0 };

  const decimated = new Float32Array(count);
  let mean = 0;
  for (let i = 0; i < count; i += 1) {
    const value = samples[start + i * stride] ?? 0;
    decimated[i] = value;
    mean += value;
  }
  mean /= count;

  let energy = 0;
  for (let i = 0; i < count; i += 1) {
    const value = (decimated[i] ?? 0) - mean;
    decimated[i] = value;
    energy += value * value;
  }
  if (energy / count < 1e-7) return { hz: 0, confidence: 0 };

  const minLag = Math.max(2, Math.floor(effectiveRate / 330));
  const maxLag = Math.min(count - 8, Math.ceil(effectiveRate / 70));
  let bestLag = 0;
  let best = -1;
  const correlations = new Float32Array(maxLag + 1);

  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let corr = 0;
    let left = 0;
    let right = 0;
    const limit = count - lag;
    for (let i = 0; i < limit; i += 1) {
      const a = decimated[i] ?? 0;
      const b = decimated[i + lag] ?? 0;
      corr += a * b;
      left += a * a;
      right += b * b;
    }
    const normalized = corr / Math.sqrt(Math.max(1e-12, left * right));
    correlations[lag] = normalized;
    if (normalized > best) {
      best = normalized;
      bestLag = lag;
    }
  }

  if (bestLag <= 0 || best < 0.28) return { hz: 0, confidence: Math.max(0, best) };

  // Periodic signals also peak at 2×, 3× ... the true period. Picking only the
  // absolute maximum causes common octave-down errors, so prefer the earliest
  // strong local maximum close to the best correlation.
  const strongThreshold = Math.max(0.42, best * 0.86);
  for (let lag = minLag + 1; lag < maxLag; lag += 1) {
    const value = correlations[lag] ?? -1;
    if (
      value >= strongThreshold
      && value >= (correlations[lag - 1] ?? -1)
      && value >= (correlations[lag + 1] ?? -1)
    ) {
      bestLag = lag;
      break;
    }
  }

  const chosen = correlations[bestLag] ?? best;
  return {
    hz: effectiveRate / bestLag,
    confidence: clamp((chosen - 0.28) / 0.62, 0, 1),
  };
}

function goertzelPower(
  samples: Float32Array,
  start: number,
  size: number,
  sampleRate: number,
  frequency: number,
): number {
  const omega = 2 * Math.PI * frequency / sampleRate;
  const coefficient = 2 * Math.cos(omega);
  let q0 = 0;
  let q1 = 0;
  let q2 = 0;

  for (let i = 0; i < size; i += 1) {
    const phase = size <= 1 ? 0 : i / (size - 1);
    const window = 0.5 - 0.5 * Math.cos(2 * Math.PI * phase);
    const value = (samples[start + i] ?? 0) * window;
    q0 = coefficient * q1 - q2 + value;
    q2 = q1;
    q1 = q0;
  }
  return Math.max(0, q1 * q1 + q2 * q2 - coefficient * q1 * q2);
}

function validVoiceImprintQuality(value: unknown): value is VoiceImprintQuality {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<VoiceImprintQuality>;
  const finite = (number: unknown): number is number => typeof number === 'number' && Number.isFinite(number);
  return (
    finite(candidate.score) && candidate.score >= 0 && candidate.score <= 1
    && (candidate.label === 'excellent' || candidate.label === 'good' || candidate.label === 'fair' || candidate.label === 'poor')
    && finite(candidate.activeSpeechRatio) && candidate.activeSpeechRatio >= 0 && candidate.activeSpeechRatio <= 1
    && finite(candidate.clippingRate) && candidate.clippingRate >= 0 && candidate.clippingRate <= 1
    && finite(candidate.pitchSpreadSemitones) && candidate.pitchSpreadSemitones >= 0 && candidate.pitchSpreadSemitones <= 24
    && finite(candidate.rmsDb) && candidate.rmsDb >= -120 && candidate.rmsDb <= 6
  );
}

export function validVoiceIdentityImprint(value: unknown): value is VoiceIdentityImprint {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<VoiceIdentityImprint>;
  if (candidate.version !== 1 || !Array.isArray(candidate.formantGain) || candidate.formantGain.length !== 5) {
    return false;
  }
  const finite = (number: unknown): number is number => typeof number === 'number' && Number.isFinite(number);
  return candidate.formantGain.every((number) => finite(number) && number >= 0.86 && number <= 1.14)
    && finite(candidate.sourceTiltScale) && candidate.sourceTiltScale >= 0.86 && candidate.sourceTiltScale <= 1.14
    && finite(candidate.presenceFrequencyScale) && candidate.presenceFrequencyScale >= 0.94 && candidate.presenceFrequencyScale <= 1.06
    && finite(candidate.presenceGainScale) && candidate.presenceGainScale >= 0.86 && candidate.presenceGainScale <= 1.14
    && finite(candidate.breathScale) && candidate.breathScale >= 0.88 && candidate.breathScale <= 1.16
    && finite(candidate.radiationGainDb) && Math.abs(candidate.radiationGainDb) <= 0.8
    && finite(candidate.medianF0Hz) && candidate.medianF0Hz >= 65 && candidate.medianF0Hz <= 360
    && finite(candidate.suggestedPitchMidi) && candidate.suggestedPitchMidi >= 40 && candidate.suggestedPitchMidi <= 82
    && finite(candidate.confidence) && candidate.confidence >= 0 && candidate.confidence <= 1
    && finite(candidate.analyzedSeconds) && candidate.analyzedSeconds >= 0.5 && candidate.analyzedSeconds <= 30
    && (candidate.quality === undefined || validVoiceImprintQuality(candidate.quality));
}

export function analyzeVoiceImprint(
  samples: Float32Array,
  sampleRate: number,
): VoiceImprintAnalysis {
  if (!Number.isFinite(sampleRate) || sampleRate < 8000) {
    throw new Error('Unsupported reference sample rate');
  }
  const seconds = samples.length / sampleRate;
  if (seconds < 0.5) throw new Error('Reference audio is too short');
  if (samples.length === 0) throw new Error('Reference audio is empty');

  const frameSize = Math.min(4096, Math.max(1024, 2 ** Math.floor(Math.log2(sampleRate * 0.085))));
  const usableLength = Math.min(samples.length, Math.floor(sampleRate * 20));
  const globalRms = frameRms(samples, 0, usableLength);
  if (globalRms < 0.0025) throw new Error('Reference audio is too quiet');
  const rmsDb = 20 * Math.log10(Math.max(globalRms, 1e-12));

  let clippedSamples = 0;
  for (let i = 0; i < usableLength; i += 1) {
    if (Math.abs(samples[i] ?? 0) >= 0.985) clippedSamples += 1;
  }
  const clippingRate = clippedSamples / Math.max(1, usableLength);
  if (clippingRate > 0.03) throw new Error('Reference audio is heavily clipped');

  const candidateCount = Math.min(36, Math.max(8, Math.floor(usableLength / frameSize)));
  const starts: number[] = [];
  for (let i = 0; i < candidateCount; i += 1) {
    const progress = candidateCount <= 1 ? 0 : i / (candidateCount - 1);
    const start = Math.floor(progress * Math.max(0, usableLength - frameSize));
    if (frameRms(samples, start, frameSize) >= Math.max(0.0035, globalRms * 0.32)) {
      starts.push(start);
    }
  }
  if (starts.length < 3) throw new Error('Reference audio needs more clear speech');
  const activeSpeechRatio = starts.length / candidateCount;

  const selected = starts.length <= 18
    ? starts
    : starts.filter((_, index) => index % Math.ceil(starts.length / 18) === 0).slice(0, 18);

  const f0Values: number[] = [];
  const f0Confidence: number[] = [];
  for (const start of selected) {
    const estimate = estimateF0(samples, start, frameSize, sampleRate);
    if (estimate.hz >= 65 && estimate.hz <= 360 && estimate.confidence >= 0.18) {
      f0Values.push(estimate.hz);
      f0Confidence.push(estimate.confidence);
    }
  }
  if (f0Values.length < 2) throw new Error('Could not find stable voiced speech');

  const medianF0Hz = median(f0Values);
  const pitchSpreadSemitones = median(
    f0Values.map((hz) => Math.abs(12 * Math.log2(hz / medianF0Hz))),
  );

  const nyquistLimit = sampleRate * 0.45;
  const frequencies: number[] = [];
  for (let hz = 180; hz <= Math.min(5600, nyquistLimit); hz += 90) frequencies.push(hz);
  if (frequencies.length < 20) throw new Error('Reference sample rate is too low');

  const bandRanges: readonly [number, number][] = [
    [180, 700],
    [700, 1400],
    [1400, 2400],
    [2400, 3600],
    [3600, 5600],
  ];
  const bandEnergy = [0, 0, 0, 0, 0];
  let highLogSum = 0;
  let highLinearSum = 0;
  let highCount = 0;
  let presenceWeighted = 0;
  let presenceEnergy = 0;

  for (const start of selected) {
    for (const frequency of frequencies) {
      const power = goertzelPower(samples, start, frameSize, sampleRate, frequency) + 1e-12;
      for (let band = 0; band < bandRanges.length; band += 1) {
        const range = bandRanges[band];
        if (range && frequency >= range[0] && frequency < range[1]) {
          bandEnergy[band] = (bandEnergy[band] ?? 0) + power;
          break;
        }
      }
      if (frequency >= 2700) {
        const magnitude = Math.sqrt(power);
        highLogSum += Math.log(Math.max(1e-12, magnitude));
        highLinearSum += magnitude;
        highCount += 1;
      }
      if (frequency >= 1800 && frequency <= 4800) {
        presenceWeighted += frequency * power;
        presenceEnergy += power;
      }
    }
  }

  const bandDb = bandEnergy.map((energy) => 10 * Math.log10(energy + 1e-12));
  const meanDb = bandDb.reduce((sum, value) => sum + value, 0) / bandDb.length;
  const formantGain = bandDb.map((value) => (
    clamp(1 + (value - meanDb) * 0.0105, 0.92, 1.08)
  )) as [number, number, number, number, number];

  const lowDb = ((bandDb[0] ?? meanDb) + (bandDb[1] ?? meanDb)) * 0.5;
  const highDb = ((bandDb[3] ?? meanDb) + (bandDb[4] ?? meanDb)) * 0.5;
  const tiltDb = lowDb - highDb;
  const sourceTiltScale = clamp(1 + (tiltDb - 8) * 0.0065, 0.92, 1.08);

  const highGeometric = highCount > 0 ? Math.exp(highLogSum / highCount) : 0;
  const highArithmetic = highCount > 0 ? highLinearSum / highCount : 1;
  const flatness = clamp(highGeometric / Math.max(1e-12, highArithmetic), 0, 1);
  const breathScale = clamp(0.94 + flatness * 0.18, 0.94, 1.12);

  const centroid = presenceEnergy > 0 ? presenceWeighted / presenceEnergy : 3000;
  const presenceFrequencyScale = clamp(centroid / 3000, 0.96, 1.04);
  const presenceDb = ((bandDb[3] ?? meanDb) + (bandDb[4] ?? meanDb)) * 0.5;
  const presenceGainScale = clamp(1 + (presenceDb - meanDb) * 0.007, 0.92, 1.08);
  const brightnessDb = highDb - lowDb;
  const radiationGainDb = clamp(brightnessDb * 0.055, -0.65, 0.65);

  const suggestedPitchMidi = clamp(69 + 12 * Math.log2(medianF0Hz / 440), 40, 82);
  const voicedRatio = f0Values.length / selected.length;
  const pitchConfidence = median(f0Confidence);
  const durationConfidence = clamp(seconds / 3, 0, 1);
  const baseConfidence = clamp(
    voicedRatio * 0.42 + pitchConfidence * 0.4 + durationConfidence * 0.18,
    0,
    1,
  );

  const durationScore = seconds < 3
    ? clamp(seconds / 3, 0.28, 1)
    : seconds <= 10
      ? 1
      : clamp(1 - (seconds - 10) / 40, 0.72, 1);
  const activityScore = clamp((activeSpeechRatio - 0.18) / 0.57, 0, 1);
  const clippingScore = clamp(1 - clippingRate / 0.012, 0, 1);
  const pitchStabilityScore = clamp(1 - Math.max(0, pitchSpreadSemitones - 1.6) / 8, 0.45, 1);
  const qualityScore = clamp(
    durationScore * 0.2
      + activityScore * 0.28
      + clippingScore * 0.23
      + pitchStabilityScore * 0.18
      + levelScore(rmsDb) * 0.11,
    0,
    1,
  );
  const quality: VoiceImprintQuality = {
    score: qualityScore,
    label: qualityLabel(qualityScore),
    activeSpeechRatio,
    clippingRate,
    pitchSpreadSemitones,
    rmsDb,
  };
  const confidence = clamp(baseConfidence * (0.58 + qualityScore * 0.42), 0, 1);

  const imprint: VoiceIdentityImprint = {
    version: 1,
    formantGain,
    sourceTiltScale,
    presenceFrequencyScale,
    presenceGainScale,
    breathScale,
    radiationGainDb,
    medianF0Hz,
    suggestedPitchMidi,
    confidence,
    analyzedSeconds: Math.min(seconds, 20),
    quality,
  };

  return {
    imprint,
    voicedFrameCount: f0Values.length,
    spectralFrameCount: selected.length,
    quality,
  };
}
