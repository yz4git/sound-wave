import { describe, expect, it } from 'vitest';
import {
  isVoxCpmWav,
  voxCpmApiBase,
  voxCpmSpeechPayload,
  voxCpmSpeechUrl,
  voxCpmVoicePrompt,
} from '../src/voice/VoxCpmRemote';

describe('VoxCPM2 remote model adapter', () => {
  it('keeps only secure URLs (local loopback is the exception)', () => {
    expect(voxCpmApiBase(' https://tts.example.com/ ')).toBe('https://tts.example.com');
    expect(voxCpmSpeechUrl('https://tts.example.com')).toBe('https://tts.example.com/v1/speech');
    expect(voxCpmSpeechUrl('https://tts.example.com/v1')).toBe('https://tts.example.com/v1/speech');
    expect(voxCpmSpeechUrl('https://tts.example.com/v1/speech')).toBe('https://tts.example.com/v1/speech');
    expect(voxCpmSpeechUrl('http://localhost:8000')).toBe('http://localhost:8000/v1/speech');
    expect(() => voxCpmApiBase('')).toThrow('SERVER URL');
    expect(() => voxCpmApiBase('http://remote.example.com')).toThrow('HTTPS');
    expect(() => voxCpmApiBase('file:///etc/passwd')).toThrow('HTTPS');
    expect(() => voxCpmApiBase('https://person:pass@host.example.com/')).toThrow('CREDENTIALS');
  });

  it('passes bounded real model generation instructions', () => {
    expect(voxCpmSpeechPayload({
      text: '  こんにちは！  ',
      voiceDescription: 'Soft Japanese voice',
      inferenceTimesteps: 16,
    })).toEqual({
      text: 'こんにちは！',
      voice_description: 'Soft Japanese voice',
      inference_timesteps: 16,
    });
    expect(voxCpmSpeechPayload({
      text: 'Hello', voiceDescription: '', inferenceTimesteps: 100,
    }).inference_timesteps).toBe(24);
    expect(() => voxCpmSpeechPayload({
      text: ' ', voiceDescription: '', inferenceTimesteps: 10,
    })).toThrow('420 CHARACTERS');
    expect(() => voxCpmSpeechPayload({
      text: 'a'.repeat(421), voiceDescription: '', inferenceTimesteps: 10,
    })).toThrow('420 CHARACTERS');
  });

  it('turns Voice Lab timbre/rate/delivery into soft instructions', () => {
    const prompt = voxCpmVoicePrompt({
      description: 'A Japanese narrator',
      rate: 1.25,
      pitch: 70,
      energy: 0.65,
      expression: 'whisper',
      character: 'natural',
    });
    expect(prompt).toContain('A Japanese narrator');
    expect(prompt).toContain('speaking briskly');
    expect(prompt).toContain('high pitch');
    expect(prompt).toContain('speaking softly');
    expect(prompt).toContain('whisper');
    expect(prompt.length).toBeLessThanOrEqual(240);
  });

  it('rejects non-WAV payloads even if the server responds 200', () => {
    expect(isVoxCpmWav(new TextEncoder().encode('not a wave').buffer)).toBe(false);
    const wave = new Uint8Array(44);
    wave.set(new TextEncoder().encode('RIFF'), 0);
    wave.set(new TextEncoder().encode('WAVE'), 8);
    expect(isVoxCpmWav(wave.buffer)).toBe(true);
    wave[0] = 0;
    expect(isVoxCpmWav(wave.buffer)).toBe(false);
  });
});
