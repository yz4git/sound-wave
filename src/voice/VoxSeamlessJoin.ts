/**
 * Segment-boundary cleanup modeled on natural-speech / audiobook joining.
 *
 * Only removes excessive near-digital silence OUTSIDE recognized audio.
 * Never detects or edits an internal breath, word, phoneme or Japanese accent.
 * Default NEURAL HQ and VOX LOCAL "off" paths bypass this module.
 */
export interface SeamlessEdgeResult {
  audio: Float32Array;
  removedLeadSeconds: number;
  removedTailSeconds: number;
}
function quietSamplesAtEdge(pcm: Float32Array, sr: number, fromStart: boolean): number {
  const block = Math.max(1, Math.round(sr * 0.01));
  const maxSamples = Math.min(pcm.length, Math.round(sr * 0.6));
  let quiet = 0;
  while (quiet + block <= maxSamples) {
    const a = fromStart ? quiet : pcm.length - quiet - block;
    let sum = 0, peak = 0;
    for (let i = a; i < a + block; i++) {
      const value = pcm[i] ?? 0;
      sum += value * value;
      peak = Math.max(peak, Math.abs(value));
    }
    if (Math.sqrt(sum / block) > 0.0016 || peak > 0.006) break;
    quiet += block;
  }
  return quiet;
}
export function cleanNeuralJoinEdges(
  audio: Float32Array,
  sampleRate: number,
  index: number,
  total: number,
): SeamlessEdgeResult {
  const identity = { audio, removedLeadSeconds: 0, removedTailSeconds: 0 };
  if (total < 2 || !audio.length || !Number.isFinite(sampleRate)
    || sampleRate < 8000 || sampleRate > 96000
    || !Number.isInteger(index) || index < 0 || index >= total) return identity;
  // First phrase may have intentional pre-roll; only later segment starts.
  const leadQuiet = index > 0 ? quietSamplesAtEdge(audio, sampleRate, true) : 0;
  // Final phrase should preserve its native ending.
  const tailQuiet = index < total - 1 ? quietSamplesAtEdge(audio, sampleRate, false) : 0;
  // Keep 85ms of natural lead-in and 120ms release (breaths / consonants).
  // Only touch tails if there was >200ms of true silence.
  const leadTrim = leadQuiet > sampleRate * 0.19
    ? Math.min(Math.round(sampleRate * 0.18), Math.max(0, leadQuiet - Math.round(sampleRate * 0.085)))
    : 0;
  const tailTrim = tailQuiet > sampleRate * 0.22
    ? Math.min(Math.round(sampleRate * 0.22), Math.max(0, tailQuiet - Math.round(sampleRate * 0.12)))
    : 0;
  if (!leadTrim && !tailTrim) return identity;
  if (audio.length - leadTrim - tailTrim < Math.round(sampleRate * 0.11)) return identity;
  const trimmed = audio.slice(leadTrim, audio.length - tailTrim);
  // The removed portion was confirmed quiet; do not resample or amplify.
  return {
    audio: trimmed,
    removedLeadSeconds: leadTrim / sampleRate,
    removedTailSeconds: tailTrim / sampleRate,
  };
}
