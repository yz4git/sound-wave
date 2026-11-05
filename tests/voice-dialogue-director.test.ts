import { describe, expect, it } from 'vitest';
import { classifyJapaneseDialogue, dialogueCueMultiplier } from '../src/voice/VoxDialogueDirector';

describe('Japanese dialogue act v3: conservative, punctuation-led Kokoro cues', () => {
  it('distinguishes an acknowledgement from an explicit question', () => {
    expect(classifyJapaneseDialogue('そうですか。').act).toBe('acknowledgement');
    expect(classifyJapaneseDialogue('そうなんですか。').act).toBe('acknowledgement');
    expect(classifyJapaneseDialogue('そうですか？').act).toBe('question');
    expect(classifyJapaneseDialogue('「そうですか？」').act).toBe('question');
    expect(classifyJapaneseDialogue('本当ですか？').act).toBe('question');
  });

  it('does not overread reported or quoted questions as live questions', () => {
    expect(classifyJapaneseDialogue('「なぜ？」と聞きました。').act).toBe('statement');
    expect(classifyJapaneseDialogue('なぜ失敗したかを説明します。').act).toBe('statement');
    expect(classifyJapaneseDialogue('「どうして？」と聞いたのです。').act).toBe('statement');
    expect(classifyJapaneseDialogue('なんでそうなの？').act).toBe('question');
    expect(classifyJapaneseDialogue('どうしてそうなの。').act).toBe('question');
  });

  it('gives gratitude restrained warmth, without affecting other acts', () => {
    const thanks = classifyJapaneseDialogue('ありがとうございます。');
    expect(thanks.act).toBe('gratitude');
    expect(thanks.confidence).toBe('high');
    expect(thanks.rate).toBeGreaterThan(0.94);
    expect(thanks.rate).toBeLessThan(1);
    expect(thanks.energy).toBeLessThan(1);
    expect(classifyJapaneseDialogue('ありがとうね！').act).toBe('gratitude');
    expect(classifyJapaneseDialogue('どうもありがとう。').act).toBe('gratitude');
    expect(classifyJapaneseDialogue('助かりました。').act).toBe('gratitude');
    expect(classifyJapaneseDialogue('やった！').act).toBe('celebration');
    expect(classifyJapaneseDialogue('安心してください。').act).toBe('reassurance');
    expect(classifyJapaneseDialogue('まず理由を説明します。').act).toBe('explanation');
  });

  it('leaves unrelated utterances model-native rather than inventing intent', () => {
    const cue = dialogueCueMultiplier('今日は天気がいいですね。');
    expect(cue.act).toBe('statement');
    expect(cue.confidence).toBe('low');
    expect(cue.rate).toBe(1);
    expect(cue.energy).toBe(1);
    expect(cue.pitchSemitones).toBe(0);
    expect(dialogueCueMultiplier('').act).toBe('statement');
  });
});
