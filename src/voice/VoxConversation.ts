import type { NeuralProsodyPlan, NeuralProsodySegment } from './NeuralVoice';

/**
 * A lightweight conversation-oriented rhythm layer, not a learned prosody
 * predictor or a replacement for Kokoro's actual acoustic model.
 *
 * We keep full sentences in the upstream model whenever possible. Only
 * existing inference chunks are adjusted, so there are no new word cuts,
 * invented fillers, or removed punctuation.
 */
export type VoxConversationStyle = 'off' | 'natural' | 'relaxed' | 'lively';
export const VOX_CONVERSATION_VERSION = 'natural-conversation-v1';

const bound = (x: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, Number.isFinite(x) ? x : 1));

export function conversationBoundaryPause(
  text: string,
  style: VoxConversationStyle,
): number {
  if (style === 'off') return 0;
  const t = text.trimEnd();
  const stops = /[。．.!！？?][」』）】\s]*$/u.test(t);
  const comma = /[、，,;；：:][」』）】\s]*$/u.test(t);
  const line = /\n\s*$/u.test(text);
  if (line) return style === 'relaxed' ? 0.25 : style === 'lively' ? 0.14 : 0.19;
  if (stops) return style === 'relaxed' ? 0.21 : style === 'lively' ? 0.10 : 0.15;
  if (comma) return style === 'relaxed' ? 0.13 : style === 'lively' ? 0.045 : 0.08;
  // Only existing chunks: do not create arbitrary pauses inside words.
  return 0;
}

function pacingFactor(
  segment: NeuralProsodySegment,
  index: number,
  total: number,
  style: VoxConversationStyle,
): number {
  if (style === 'off') return 1;
  const text = segment.text.trim();
  const question = /[？?][」』）】]*$/u.test(text);
  const excitement = /[！!][」』）】]*$/u.test(text);
  // Measured changes are intentionally subtle, never a mechanical
  // oscillation over syllables or a pitch alteration that changes timbre.
  const base = style === 'lively' ? 1.04 : style === 'relaxed' ? 0.965 : 1.0;
  const terminal = question ? 0.975 : excitement ? 1.025 : 1;
  const conversationalEntry = total > 1 && index === 0 ? 0.99 : 1;
  const shortResponse = text.length <= 8 ? 0.99 : 1;
  return bound(base * terminal * conversationalEntry * shortResponse, 0.93, 1.08);
}

/** Keeps model-native utterances, explicit user edits, and original text intact. */
export function planVoxConversation(
  plan: NeuralProsodyPlan,
  style: VoxConversationStyle,
): NeuralProsodyPlan {
  if (style === 'off' || plan.segments.length === 0) return plan;
  const segments = plan.segments.map((segment, index) => {
    const last = index === plan.segments.length - 1;
    const pause = last ? segment.pauseAfter : Math.max(
      segment.pauseAfter,
      conversationBoundaryPause(segment.text, style),
    );
    return {
      ...segment,
      rateScale: bound(
        segment.rateScale * pacingFactor(segment, index, plan.segments.length, style),
        0.64, 1.55,
      ),
      pauseAfter: pause,
    };
  });
  return { ...plan, segments };
}

/** Count audibly silent samples only at a boundary; do not scan for, insert or
 * relocate pauses within spoken syllables, where phoneme alignment is unknown.
 */
export function measureTrailingQuietSeconds(
  input: Float32Array,
  sampleRate: number,
  threshold = 0.0016,
): number {
  if (!Number.isFinite(sampleRate) || sampleRate < 8000 || input.length === 0) return 0;
  const maxSamples = Math.min(input.length, Math.round(sampleRate * 0.5));
  const block = Math.max(1, Math.round(sampleRate * 0.005));
  let quiet = 0;
  for (let end = input.length; end > input.length - maxSamples; end -= block) {
    const start = Math.max(input.length - maxSamples, end - block);
    let peak = 0;
    for (let i = start; i < end; i++) peak = Math.max(peak, Math.abs(input[i] ?? 0));
    if (peak > threshold) break;
    quiet += end - start;
  }
  return quiet / sampleRate;
}

/**
 * Preserve Kokoro's natural tail and subtract any existing silence from the
 * supplemental pause; prevents the double-pause / robotic start-stop effect.
 * Called per emitted segment, after the real model returned audio.
 */
export function effectiveConversationPause(
  desiredPause: number,
  pcm: Float32Array,
  sampleRate: number,
): number {
  const alreadyQuiet = measureTrailingQuietSeconds(pcm, sampleRate);
  return bound(Math.max(0, desiredPause - alreadyQuiet), 0, 0.5);
}
