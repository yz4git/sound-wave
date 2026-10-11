/**
 * Fair A/B checks for Vox Local. Both samples originate from one *identical*
 * Kokoro inference, then the custom sound is loudness-matched to the native
 * Neural HQ buffer. Metrics measure signal properties, not subjective quality.
 */
export interface VoicePcmStats {
  rms: number;
  rmsDbfs: number;
  peak: number;
  peakDbfs: number;
  clippedSamples: number;
}

const db = (linear: number): number => 20 * Math.log10(Math.max(1e-8, linear));

export function measureVoicePcm(signal: Float32Array): VoicePcmStats {
  if (!signal.length) return {
    rms: 0, rmsDbfs: -160, peak: 0, peakDbfs: -160, clippedSamples: 0,
  };
  let sum = 0, peak = 0, clippedSamples = 0;
  for (const sample of signal) {
    const s = Number.isFinite(sample) ? sample : 0;
    sum += s * s;
    peak = Math.max(peak, Math.abs(s));
    if (Math.abs(s) >= 0.999) clippedSamples++;
  }
  const rms = Math.sqrt(sum / signal.length);
  return { rms, rmsDbfs: rms > 0 ? db(rms) : -160,
    peak, peakDbfs: peak > 0 ? db(peak) : -160, clippedSamples };
}

export function matchVoicePcmLevel(
  reference: Float32Array,
  candidate: Float32Array,
): Float32Array {
  if (!candidate.length) return new Float32Array();
  const base = measureVoicePcm(reference);
  const source = measureVoicePcm(candidate);
  const out = new Float32Array(candidate.length);
  if (base.rms < 1e-6 || source.rms < 1e-6) {
    out.set(candidate);
    return out;
  }
  // A/B avoids the "louder sounds better" bias. Limit how much normalization
  // can boost model noise, and prevent any peak from exceeding 0.98.
  const gain = Math.min(
    1.6,
    Math.max(0.625, base.rms / source.rms),
    0.98 / Math.max(1e-6, source.peak),
  );
  for (let i = 0; i < candidate.length; i++) {
    const v = candidate[i] ?? 0;
    out[i] = Math.max(-0.98, Math.min(0.98, (Number.isFinite(v) ? v : 0) * gain));
  }
  return out;
}

export interface VoxLocalABMetrics {
  reference: VoicePcmStats;
  local: VoicePcmStats;
  levelDifferenceDb: number;
  waveformDifferencePercent: number;
  comparedSamples: number;
}

export function analyzeVoxLocalAB(
  reference: Float32Array,
  local: Float32Array,
): VoxLocalABMetrics {
  const a = measureVoicePcm(reference);
  const b = measureVoicePcm(local);
  const n = Math.min(reference.length, local.length);
  let deltaPower = 0, basePower = 0;
  for (let i = 0; i < n; i++) {
    const x = Number.isFinite(reference[i]) ? reference[i]! : 0;
    const y = Number.isFinite(local[i]) ? local[i]! : 0;
    deltaPower += (x - y) ** 2;
    basePower += x * x;
  }
  return {
    reference: a, local: b,
    levelDifferenceDb: a.rms > 1e-6 && b.rms > 1e-6
      ? b.rmsDbfs - a.rmsDbfs : 0,
    waveformDifferencePercent: n && basePower > 1e-10
      ? 100 * Math.sqrt(deltaPower / basePower) : 0,
    comparedSamples: n,
  };
}
