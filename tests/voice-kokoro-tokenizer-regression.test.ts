import { describe, expect, it, vi } from 'vitest';
import {
  speakWithReusablePhonemes,
  type KokoroSpeechClient,
  type KokoroLowLevel,
} from '../src/voice/NeuralPhonemeCache';

const audio = () => ({ audio: new Float32Array([0.02, 0.1, 0.02]), sampling_rate: 24_000 });
const cache = {
  get: vi.fn(async () => null),
  put: vi.fn(async () => true),
};

describe('Kokoro browser tokenizer regression: u.call is not a function', () => {
  it('uses only upstream speak() on iPhone, never inspects or replaces tokenizer', async () => {
    const speak = vi.fn(async () => audio());
    const client: KokoroSpeechClient = { speak };
    Object.defineProperty(client, 'tts', {
      get: () => { throw new Error('private tokenizer must not be accessed on iOS'); },
    });
    const result = await speakWithReusablePhonemes(
      client, cache, 'こんにちは', 'jf_alpha', 1, undefined, true,
    );
    expect(result.audio).toBeInstanceOf(Float32Array);
    expect(result.reusedPhonemes).toBe(false);
    expect(result.capturedPhonemes).toBe(false);
    expect(speak).toHaveBeenCalledExactlyOnceWith('こんにちは', 'jf_alpha', 1);
  });

  it('handles callable tokenizer proxies with no .call method using Reflect.apply', async () => {
    let invoked = false;
    const tokenizer = function (_phonemes: string, _options: { truncation: boolean }) {
      invoked = true;
      return { input_ids: [1, 2, 3] };
    };
    // Some bundled callable-proxy functions lack Function.prototype.call.
    Object.setPrototypeOf(tokenizer, null);
    expect((tokenizer as unknown as { call?: unknown }).call).toBeUndefined();

    const tts = {
      tokenizer: tokenizer as KokoroLowLevel['tokenizer'],
      generate_from_ids: vi.fn(async () => audio()),
    };
    const client: KokoroSpeechClient = {
      tts,
      speak: vi.fn(async () => {
        tts.tokenizer('ipa-phonemes', { truncation: true });
        return audio();
      }),
    };
    const result = await speakWithReusablePhonemes(
      client, { get: async () => null, put: async () => true },
      'こんにちは', 'jf_alpha', 1,
    );
    expect(invoked).toBe(true);
    expect(result.audio.length).toBeGreaterThan(0);
    expect(client.speak).toHaveBeenCalledTimes(1);
  });

  it('does not silently turn a genuine official-speak failure into a success', async () => {
    const client: KokoroSpeechClient = {
      speak: async () => { throw new Error('G2P worker unavailable'); },
    };
    await expect(speakWithReusablePhonemes(
      client, cache, 'こんにちは', 'jf_alpha', 1, undefined, true,
    )).rejects.toThrow('G2P worker unavailable');
  });
});
