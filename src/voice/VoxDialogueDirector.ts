/**
 * Conservative Japanese dialogue-act hints for the existing Kokoro voice.
 * No external service or new inference model is required.
 * These are deterministic, explainable cues—not semantic understanding by an LLM.
 */
export type DialogueAct =
  | 'question' | 'acknowledgement' | 'reassurance' | 'celebration'
  | 'caution' | 'explanation' | 'statement';

export interface DialogueCue {
  act: DialogueAct;
  confidence: 'high' | 'low';
  rate: number;
  energy: number;
  pitchSemitones: number;
}

const NEUTRAL: DialogueCue = {
  act: 'statement', confidence: 'low', rate: 1, energy: 1, pitchSemitones: 0,
};

export function classifyJapaneseDialogue(text: string): DialogueCue {
  // Strip punctuation and whitespace only for matching speech acts.
  const source = text.normalize('NFKC').trim();
  if (!source) return NEUTRAL;
  const unquoted = source.replace(/^[「『（\s]+/u, '').replace(/[」』）\s]+$/u, '');
  const plain = unquoted.replace(/[。！？!?]+$/u, '').trim();
  // Do not treat isolated particles or a sentence containing 'なんで'
  // inside a noun as a high-confidence question without supporting cues.
  const isQuestion = /[?？]$/u.test(unquoted)
    || /(?:ですか|ますか|でしょうか|ませんか|なのか|だろうか|なの\s*|かな)$/u.test(plain)
    || /^(?:なぜ|どうして|どこ|いつ|誰|だれ|いくつ|いくら|どんな|どうやって)/u.test(plain);
  if (isQuestion) return {
    act: 'question', confidence: 'high', rate: 0.982, energy: 1.01, pitchSemitones: 0.09,
  };
  if (/^(?:はい|うん|ええ|なるほど|そうですね|そうなんですね|そうですか|了解です|わかりました|確かに)(?:[。、！!\s]|$)/u.test(plain) || /^(?:はい|うん|なるほど|そうですね|そうなんですね|了解です|わかりました|確かに)$/u.test(plain)) {
    return { act: 'acknowledgement', confidence: 'high', rate: 0.965, energy: 0.98, pitchSemitones: -0.04 };
  }
  if (/(?:大丈夫ですよ|安心してください|無理しないで|心配しないで|ご安心ください)/u.test(plain)) {
    return { act: 'reassurance', confidence: 'high', rate: 0.968, energy: 0.96, pitchSemitones: -0.08 };
  }
  if (/(?:やった[！!]?|すごい[！!]?|おめでとう|よかったね|うれしい|嬉しい)/u.test(plain)) {
    return { act: 'celebration', confidence: 'high', rate: 1.035, energy: 1.045, pitchSemitones: 0.10 };
  }
  if (/(?:気をつけて|危険です|注意して|待ってください|やめてください)/u.test(plain)) {
    return { act: 'caution', confidence: 'high', rate: 0.975, energy: 1.045, pitchSemitones: 0.02 };
  }
  if (/^(?:まず|次に|つまり|例えば|たとえば|理由は|結論として|一方で)/u.test(plain)) {
    return { act: 'explanation', confidence: 'high', rate: 0.985, energy: 1.005, pitchSemitones: -0.02 };
  }
  return NEUTRAL;
}

export function dialogueCueMultiplier(text: string): DialogueCue {
  const cue = classifyJapaneseDialogue(text);
  return cue.confidence === 'high' ? cue : NEUTRAL;
}
