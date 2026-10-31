import { describe, expect, it } from 'vitest';
import { classifyJapaneseDialogue, dialogueCueMultiplier } from '../src/voice/VoxDialogueDirector';
import { cleanNeuralJoinEdges } from '../src/voice/VoxSeamlessJoin';
import { matchBlindConversationTakes, randomBlindOrder, describeBlindVote } from '../src/voice/VoxBlindAB';
import { planVoxConversation } from '../src/voice/VoxConversation';
import { neuralPlaybackCacheKey } from '../src/voice/NeuralVoice';
import type { NeuralProsodyPlan, NeuralProsodySegment } from '../src/voice/NeuralVoice';

const segment = (text:string):NeuralProsodySegment => ({
  text, startUnit:0,endUnit:0,rateScale:1,energyScale:1,pitchSemitones:0,pauseAfter:0,
  expression:{preset:'neutral',intensity:1},
});

describe('Japanese dialogue act to conservative model-native prosody', () => {
  it('recognizes polite questions and a question without explicit punctuation', () => {
    expect(classifyJapaneseDialogue('何をしていますか？').act).toBe('question');
    expect(classifyJapaneseDialogue('どこへ行きますか。').act).toBe('question');
    expect(classifyJapaneseDialogue('明日行きますか').act).toBe('question');
  });
  it('recognizes acknowledgements, reassurance, celebration, caution and explanations', () => {
    expect(classifyJapaneseDialogue('なるほど。').act).toBe('acknowledgement');
    expect(classifyJapaneseDialogue('ご安心ください。').act).toBe('reassurance');
    expect(classifyJapaneseDialogue('おめでとうございます！').act).toBe('celebration');
    expect(classifyJapaneseDialogue('気をつけてください。').act).toBe('caution');
    expect(classifyJapaneseDialogue('まず結論から説明します。').act).toBe('explanation');
  });
  it('leaves unsupported/ambiguous utterances neutral', () => {
    expect(classifyJapaneseDialogue('昨日、公園に行きました。').act).toBe('statement');
    expect(dialogueCueMultiplier('昨日、公園に行きました。').pitchSemitones).toBe(0);
  });
  it('preserves user-edited pitch/energy and full Japanese words', () => {
    const raw:NeuralProsodyPlan = {
      edited:true,
      segments:[{...segment('ご安心ください。'), pitchSemitones:0.3, energyScale:1.08}],
    };
    const out=planVoxConversation(raw,'natural');
    expect(out.segments).toHaveLength(1);
    expect(out.segments[0]!.pitchSemitones).toBe(.3);
    expect(out.segments[0]!.energyScale).toBe(1.08);
    expect(out.segments[0]!.text).toBe('ご安心ください。');
  });
  it('nudges automatic delivery but never applies excessive pitch/energy gain', () => {
    const raw:NeuralProsodyPlan = {edited:false,segments:[segment('どうしましたか？'),segment('大丈夫ですよ。')]};
    const out=planVoxConversation(raw,'natural');
    expect(out.segments).toHaveLength(2);
    expect(out.segments[0]!.pitchSemitones).toBeGreaterThan(0);
    expect(out.segments[1]!.pitchSemitones).toBeLessThan(0);
    expect(out.segments.every(x=>Math.abs(x.pitchSemitones)<0.2)).toBe(true);
    expect(planVoxConversation(raw,'off')).toBe(raw);
  });
  it('versions the final PCM cache separately for join processing', () => {
    const plan:NeuralProsodyPlan={edited:false,segments:[segment('こんにちは。')]};
    const options={ character:'natural' as const, rate:1,energy:1,pitch:60,tone:0, expression: {preset:'neutral' as const,intensity:1}};
    expect(neuralPlaybackCacheKey(plan,{...options,conversationTiming:true}))
      .not.toBe(neuralPlaybackCacheKey(plan,{...options,conversationTiming:false}));
  });
});

describe('Speech boundary cleanup (not phoneme editing)', () => {
  const sr=24000;
  it('trims excess near-digital silence at joins but never internal pauses', () => {
    const audio=new Float32Array(sr*2);
    for(let i=Math.floor(.4*sr);i<Math.floor(1.5*sr);i++)audio[i]=Math.sin(i*.1)*.2;
    const before=Float32Array.from(audio);
    const joined=cleanNeuralJoinEdges(audio,sr,1,3);
    expect(joined.audio.length).toBeLessThan(audio.length);
    expect(joined.removedLeadSeconds).toBeGreaterThan(0);
    expect(joined.removedTailSeconds).toBeGreaterThan(0);
    expect(audio).toEqual(before);
    expect(joined.audio.some(v=>Math.abs(v)>.18)).toBe(true);
  });
  it('preserves short natural breaths and single-utterance PCM identity', () => {
    const audio=new Float32Array(sr);
    for(let i=Math.round(.06*sr);i<Math.round(.88*sr);i++)audio[i]=Math.sin(i*.2)*.15;
    expect(cleanNeuralJoinEdges(audio,sr,1,2).audio).toBe(audio);
    expect(cleanNeuralJoinEdges(audio,sr,0,1).audio).toBe(audio);
  });
  it('rejects invalid index and sample rate without touching audio', () => {
    const audio=new Float32Array(sr).fill(0.1);
    expect(cleanNeuralJoinEdges(audio,0,0,2).audio).toBe(audio);
    expect(cleanNeuralJoinEdges(audio,sr,-1,2).audio).toBe(audio);
  });
});

describe('Blind naturalness comparison', () => {
  it('randomizes A/B identity and only reveals after the vote', () => {
    expect(randomBlindOrder(()=>0.1)).toEqual({a:'original',b:'directed'});
    expect(randomBlindOrder(()=>0.9)).toEqual({a:'directed',b:'original'});
    expect(describeBlindVote({a:'directed',b:'original'},'a')).toContain('A＝会話ディレクター');
    expect(describeBlindVote({a:'original',b:'directed'},'tie')).toContain('同じくらい');
  });
  it('level matches while preserving original samples and preventing clipping', () => {
    const old=new Float32Array(1000).fill(.12);
    const modern=new Float32Array(1200).fill(.04);
    const copy=Float32Array.from(modern);
    const matched=matchBlindConversationTakes(old,modern);
    expect(matched.original).toBe(old);
    expect(matched.directed.length).toBe(1200);
    expect(matched.directed[0]!).toBeGreaterThan(.04);
    expect(matched.directed[0]!).toBeLessThanOrEqual(.98);
    expect(modern).toEqual(copy);
    expect(Number.isFinite(matched.levelDifferenceDb)).toBe(true);
  });
});
