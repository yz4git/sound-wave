import { describe, expect, it } from 'vitest';
import {
  auditCharacterErrors, auditCompareJapanese, auditNormalizeJapanese,
  auditSpeechSilence, parseHaasTranscript, validateHaasAuditEndpoint,
} from '../src/voice/HaasAudit';

describe('Haas-inspired Japanese intelligibility checks', () => {
  it('handles exact recognition and Japanese punctuation', () => {
    const value = auditCompareJapanese('今日は、いい天気ですね。', '今日はいい天気ですね');
    expect(value.strict.cer).toBe(0);
    expect(value.kanaFlexible.cer).toBe(0);
  });
  it('normalizes fullwidth and kana without rewriting kanji', () => {
    expect(auditNormalizeJapanese('ＡＩ　カタカナ！',true)).toBe('aiかたかな');
    expect(auditCompareJapanese('カタカナ', 'かたかな').strict.cer).toBeGreaterThan(0);
    expect(auditCompareJapanese('カタカナ', 'かたかな').kanaFlexible.cer).toBe(0);
    expect(auditCompareJapanese('今日', 'きょう').kanaFlexible.cer).toBeGreaterThan(0);
  });
  it('reports substitution deletion and insertion separately', () => {
    expect(auditCharacterErrors('あいう','あえう').substitutions).toBe(1);
    expect(auditCharacterErrors('あいう','あう').deletions).toBe(1);
    expect(auditCharacterErrors('あう','あいう').insertions).toBe(1);
  });
  it('treats empty output as a complete recognition failure', () => {
    expect(auditCharacterErrors('こんにちは','').cer).toBe(1);
    expect(auditCharacterErrors('','').cer).toBe(0);
  });
  it('measures quiet intervals without modifying speech samples', () => {
    const sr=24000, data=new Float32Array(sr*3);
    for(let i=0;i<sr;i++)data[i]=0.12*Math.sin(i*.1);
    for(let i=sr*2;i<sr*3;i++)data[i]=0.11*Math.sin(i*.1);
    const original=Float32Array.from(data);
    const report=auditSpeechSilence(data,sr);
    expect(report.durationSeconds).toBe(3);
    expect(report.quietRatio).toBeGreaterThan(.3);
    expect(report.quietRatio).toBeLessThan(.4);
    expect(report.longGaps).toBe(1);
    expect(report.longestGapSeconds).toBeCloseTo(1,1);
    expect(data).toEqual(original);
  });
  it('requires explicit HTTPS without embedding credentials', () => {
    expect(validateHaasAuditEndpoint('https://haas.example.org/api/transcribe').hostname).toBe('haas.example.org');
    expect(()=>validateHaasAuditEndpoint('http://haas.example.org/api/transcribe')).toThrow('HTTPS');
    expect(()=>validateHaasAuditEndpoint('https://user:secret@haas.example.org/api/transcribe')).toThrow();
    expect(()=>validateHaasAuditEndpoint('https://localhost/api/transcribe')).toThrow();
  });
  it('accepts only a nonempty bounded transcript from an optional server', () => {
    expect(parseHaasTranscript({text:'こんにちは'})).toBe('こんにちは');
    expect(()=>parseHaasTranscript({message:'error'})).toThrow();
    expect(()=>parseHaasTranscript({text:'  '})).toThrow();
  });
});
