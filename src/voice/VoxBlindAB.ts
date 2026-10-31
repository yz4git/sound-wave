import { matchVoicePcmLevel, measureVoicePcm } from './VoxLocalCompare';

export type BlindTakeKind = 'original' | 'directed';
export interface BlindTakeOrder { a: BlindTakeKind; b: BlindTakeKind }
/** Randomized per session; no label revealing the original is shown until vote. */
export function randomBlindOrder(random: () => number = Math.random): BlindTakeOrder {
  return random() < 0.5
    ? { a: 'original', b: 'directed' }
    : { a: 'directed', b: 'original' };
}
export interface BlindMatchedTakes {
  original: Float32Array;
  directed: Float32Array;
  levelDifferenceDb: number;
}
/**
 * Level-match *same voice/same script* and leave pitch, speed, utterance and
 * timbre untouched. Peak safety and max gain are enforced by VoxLocalCompare.
 * This is a listening experiment, not an automatic naturalness score.
 */
export function matchBlindConversationTakes(
  original: Float32Array,
  directed: Float32Array,
): BlindMatchedTakes {
  const normalized = matchVoicePcmLevel(original, directed);
  const originalStats = measureVoicePcm(original);
  const newStats = measureVoicePcm(normalized);
  return {
    original,
    directed: normalized,
    levelDifferenceDb: originalStats.rms > 1e-6 && newStats.rms > 1e-6
      ? newStats.rmsDbfs - originalStats.rmsDbfs : 0,
  };
}
export function describeBlindVote(order: BlindTakeOrder, choice: 'a' | 'b' | 'tie'): string {
  const a = order.a === 'directed' ? '会話ディレクター＋つなぎ目改善' : '従来の読み上げ';
  const b = order.b === 'directed' ? '会話ディレクター＋つなぎ目改善' : '従来の読み上げ';
  const decision = choice === 'tie' ? '同じくらい' : choice.toUpperCase() + 'が自然';
  return `回答：${decision}。A＝${a}、B＝${b}。結果は端末内の試聴比較であり、自然さの客観スコアではありません。`;
}
