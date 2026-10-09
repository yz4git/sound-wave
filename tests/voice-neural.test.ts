import { describe, expect, it } from 'vitest';
import { NeuralInferenceSingleFlight } from '../src/voice/NeuralInferenceSingleFlight';
import { nextNeuralChunkTime, streamingChunkGain } from '../src/voice/NeuralChunkPlayer';
import { splitLongNeuralText, NEURAL_MAX_UNEDITED_CHARS } from '../src/voice/NeuralLongText';
import {
  NeuralPhonemeCache,
  NeuralPhonemeMemoryCache,
  neuralPhonemeKey,
  speakWithReusablePhonemes,
  validNeuralPhonemes,
} from '../src/voice/NeuralPhonemeCache';
import {
  NeuralRenderStore,
  neuralPersistentKey,
  validNeuralStoredPCM,
  NEURAL_PERSISTENT_CACHE_LIMIT_BYTES,
} from '../src/voice/NeuralRenderStore';
import {
  KOKORO_JP_CDN,
  KOKORO_GPU_MODEL_ID,
  neuralPCMQualityGate,
  neuralWebGPUAvailable,
  neuralGPUDeviceBlockReason,
  NeuralAudioCache,
  buildNeuralProsodyPlan,
  neuralPlaybackCacheKey,
  neuralSegmentInferenceKey,
  neuralSpeedForSettings,
  neuralVoiceIdForCharacter,
} from '../src/voice/NeuralVoice';

describe('Neural HQ configuration', () => {
  it('pins the browser renderer instead of following an unversioned CDN', () => {
    expect(KOKORO_JP_CDN).toContain('kokoro-js-jp@0.2.0');
  });

  it('maps each Sound Wave character to a Japanese Kokoro voice', () => {
    expect(neuralVoiceIdForCharacter('natural')).toBe('jf_alpha');
    expect(neuralVoiceIdForCharacter('soft')).toBe('jf_tebukuro');
    expect(neuralVoiceIdForCharacter('clear')).toBe('jf_nezumi');
    expect(neuralVoiceIdForCharacter('airy')).toBe('jf_gongitsune');
    expect(neuralVoiceIdForCharacter('power')).toBe('jm_kumo');
  });

  it('uses expression duration as neural speaking-rate control with safe bounds', () => {
    const neutral = neuralSpeedForSettings(1, { preset: 'neutral', intensity: 1 });
    const calm = neuralSpeedForSettings(1, { preset: 'calm', intensity: 1 });
    const excited = neuralSpeedForSettings(1, { preset: 'excited', intensity: 1 });
    expect(neutral).toBeGreaterThan(0.8);
    expect(calm).toBeLessThan(neutral);
    expect(excited).toBeGreaterThan(neutral);
    expect(neuralSpeedForSettings(10, { preset: 'neutral', intensity: 1 })).toBe(1.55);
    expect(neuralSpeedForSettings(0.1, { preset: 'neutral', intensity: 1 })).toBe(0.62);
  });
});


describe('Neural HQ VOICE LAB adapter', () => {
  const unit = (index: number, display: string, overrides: Record<string, unknown> = {}) => ({
    index,
    display,
    syllable: display,
    vowel: 'a',
    phraseStart: index === 0,
    phraseEnd: false,
    phraseIndex: index,
    phraseCount: 4,
    accentStart: index === 0,
    accentEnd: false,
    accentIndex: index,
    accentCount: 4,
    accentPhraseIndex: 0,
    accentPhraseCount: 1,
    boundaryAfter: 'none',
    pauseAfter: 0,
    boundaryBefore: 'none',
    pauseBefore: 0,
    questionKind: 'none',
    questionFocus: false,
    sentenceAttitude: 'none',
    sentenceHesitation: false,
    attitudeFocus: false,
    suppressAttitudeInference: false,
    continuationAfter: 'none',
    continuationBefore: 'none',
    suppressContinuationInference: false,
    discourseAfter: 'none',
    discourseBefore: 'none',
    focusStrength: 0,
    quoted: false,
    parenthetical: false,
    breathBefore: 0,
    breathAfter: false,
    expressivePauseAfter: 0,
    hesitationAfter: false,
    punctuationAfter: 'none',
    punctuationCount: 0,
    filledPause: false,
    pitchAccent: index === 0 ? 'low' : 'high',
    autoRateScale: 1,
    devoiced: false,
    geminateBefore: false,
    longVowel: false,
    terminalAfter: 'none',
    ...overrides,
  }) as any;

  const timed = (u: any, overrides: Record<string, unknown> = {}) => ({
    unit: u,
    start: u.index * 0.15,
    duration: 0.15,
    pitchMidi: 60,
    energyScale: 1,
    manualPitchOffset: 0,
    manualEnergyScale: 1,
    manualDurationScale: 1,
    phrasePitchOffset: 0,
    phraseRateScale: 1,
    phraseEnergyScale: 1,
    phraseEmphasis: 0,
    phraseF0Offset: 0,
    accentF0Offset: 0,
    expression: { preset: 'neutral', intensity: 1 },
    ...overrides,
  }) as any;

  it('preserves one model-native utterance when no editor control is changed', () => {
    const units = ['こ', 'ん', 'に', 'ち'].map((text, index) => unit(index, text));
    const plan = buildNeuralProsodyPlan({
      originalText: 'こんにちは。',
      script: { units, unsupported: [], events: [] },
      timedUnits: units.map((item) => timed(item)),
      edits: {},
      globalExpression: { preset: 'neutral', intensity: 1 },
    });
    expect(plan.edited).toBe(false);
    expect(plan.segments).toHaveLength(1);
    expect(plan.segments[0]!.text).toBe('こんにちは。');
  });

  it('turns phrase timing, energy and pitch edits into bounded neural controls', () => {
    const units = ['こ', 'ん', 'に', 'ち', 'は'].map((text, index) => unit(index, text));
    const timedUnits = units.map((item, index) => timed(item, index < 4 ? {
      manualPitchOffset: 2.5,
      manualEnergyScale: 1.2,
      manualDurationScale: 1.25,
      phraseRateScale: 0.9,
      phraseEnergyScale: 1.1,
    } : {}));
    const plan = buildNeuralProsodyPlan({
      originalText: 'こんにちは。',
      script: { units, unsupported: [], events: [] },
      timedUnits,
      edits: { pitchOffsets: [2.5, 2.5, 2.5, 2.5, 0] },
      hasPhraseEdits: true,
      globalExpression: { preset: 'neutral', intensity: 1 },
    });
    expect(plan.edited).toBe(true);
    expect(plan.segments[0]!.pitchSemitones).toBeGreaterThan(0);
    expect(plan.segments[0]!.pitchSemitones).toBeLessThanOrEqual(0.65);
    expect(plan.segments[0]!.rateScale).toBeLessThan(1);
    expect(plan.segments[0]!.energyScale).toBeGreaterThan(1);
  });

  it('uses user phrase splits and pauses as neural segment boundaries', () => {
    const units = ['あ', 'り', 'が', 'と', 'う', 'ね'].map((text, index) =>
      unit(index, text, index === 2 ? { boundaryAfter: 'accent', pauseAfter: 0.16 } : {}),
    );
    const plan = buildNeuralProsodyPlan({
      originalText: 'ありがとうね',
      script: { units, unsupported: [], events: [] },
      timedUnits: units.map((item) => timed(item)),
      edits: { pauseOverrides: [null, null, 0.2, null, null, null] },
      phraseBoundaries: [{ after: 2, boundary: 'accent', pauseSeconds: 0.2 }],
      hasPhraseEdits: true,
      globalExpression: { preset: 'neutral', intensity: 1 },
    });
    expect(plan.segments.length).toBeGreaterThan(1);
    expect(plan.segments[0]!.text.endsWith('、')).toBe(true);
    expect(plan.segments[0]!.pauseAfter).toBeGreaterThan(0.1);
  });

  it('can map edited accent H/L into only a subtle quality-safe pitch bias', () => {
    const units = [
      unit(0, 'あ', { pitchAccent: 'high' }),
      unit(1, 'め', { pitchAccent: 'high' }),
      unit(2, 'だ', { pitchAccent: 'low' }),
      unit(3, 'ね', { pitchAccent: 'low' }),
    ];
    const plan = buildNeuralProsodyPlan({
      originalText: 'あめだね',
      script: { units, unsupported: [], events: [] },
      timedUnits: units.map((item) => timed(item)),
      edits: {},
      hasAccentEdits: true,
      globalExpression: { preset: 'neutral', intensity: 1 },
    });
    expect(plan.edited).toBe(true);
    expect(Math.max(...plan.segments.map((segment) => Math.abs(segment.pitchSemitones)))).toBeLessThanOrEqual(0.65);
  });
});


describe('Neural HQ natural segmentation', () => {
  const makeUnit = (index: number, overrides: Record<string, unknown> = {}) => ({
    index,
    display: ['こ','れ','は','と','て','も','し','ぜ','ん','な','お','ん','せ','い','で','す','よ','ね','ま','だ'][index % 20]!,
    syllable: 'a',
    vowel: 'a',
    phraseStart: index === 0,
    phraseEnd: false,
    phraseIndex: index,
    phraseCount: 40,
    accentStart: false,
    accentEnd: false,
    accentIndex: index,
    accentCount: 40,
    accentPhraseIndex: 0,
    accentPhraseCount: 1,
    boundaryAfter: 'none',
    pauseAfter: 0,
    boundaryBefore: 'none',
    pauseBefore: 0,
    questionKind: 'none',
    questionFocus: false,
    sentenceAttitude: 'none',
    sentenceHesitation: false,
    attitudeFocus: false,
    suppressAttitudeInference: false,
    continuationAfter: 'none',
    continuationBefore: 'none',
    suppressContinuationInference: false,
    discourseAfter: 'none',
    discourseBefore: 'none',
    focusStrength: 0,
    quoted: false,
    parenthetical: false,
    breathBefore: 0,
    breathAfter: false,
    expressivePauseAfter: 0,
    hesitationAfter: false,
    punctuationAfter: 'none',
    punctuationCount: 0,
    filledPause: false,
    pitchAccent: index < 7 ? 'high' : 'low',
    autoRateScale: 1,
    devoiced: false,
    geminateBefore: false,
    longVowel: false,
    terminalAfter: 'none',
    ...overrides,
  }) as any;

  const makeTimed = (unit: any, overrides: Record<string, unknown> = {}) => ({
    unit,
    start: unit.index * 0.13,
    duration: 0.13,
    pitchMidi: 60,
    energyScale: 1,
    manualPitchOffset: 0,
    manualEnergyScale: 1,
    manualDurationScale: 1,
    phrasePitchOffset: 0,
    phraseRateScale: 1,
    phraseEnergyScale: 1,
    phraseEmphasis: 0,
    phraseF0Offset: 0,
    accentF0Offset: 0,
    expression: { preset: 'neutral', intensity: 1 },
    ...overrides,
  }) as any;

  it('does not cut at an edited H-to-L accent nucleus by itself', () => {
    const units = Array.from({ length: 14 }, (_, index) =>
      makeUnit(index, index === 13 ? { boundaryAfter: 'sentence', punctuationAfter: 'period' } : {}),
    );
    const plan = buildNeuralProsodyPlan({
      originalText: 'これはとてもしぜんなおんせいです。',
      script: { units, unsupported: [], events: [] },
      timedUnits: units.map((unit) => makeTimed(unit)),
      edits: {},
      hasAccentEdits: true,
      globalExpression: { preset: 'neutral', intensity: 1 },
    });
    expect(plan.segments).toHaveLength(1);
  });

  it('keeps small neighboring control changes inside one neural phrase', () => {
    const units = Array.from({ length: 12 }, (_, index) =>
      makeUnit(index, index === 11 ? { boundaryAfter: 'sentence', punctuationAfter: 'period' } : {}),
    );
    const timedUnits = units.map((unit, index) => makeTimed(unit, {
      manualPitchOffset: index % 2 === 0 ? 0.5 : 0,
      manualEnergyScale: index % 3 === 0 ? 1.08 : 1,
      manualDurationScale: index % 4 === 0 ? 1.08 : 1,
    }));
    const plan = buildNeuralProsodyPlan({
      originalText: 'これはとてもしぜんなおんせい。',
      script: { units, unsupported: [], events: [] },
      timedUnits,
      edits: { pitchOffsets: timedUnits.map((item) => item.manualPitchOffset) },
      globalExpression: { preset: 'neutral', intensity: 1 },
    });
    expect(plan.segments).toHaveLength(1);
  });

  it('prefers a natural comma boundary for long edited speech', () => {
    const units = Array.from({ length: 24 }, (_, index) =>
      makeUnit(index, index === 18
        ? {
            boundaryAfter: 'accent',
            pauseAfter: 0.16,
            punctuationAfter: 'comma',
          }
        : index === 23
          ? { boundaryAfter: 'sentence', punctuationAfter: 'period' }
          : {}),
    );
    const plan = buildNeuralProsodyPlan({
      originalText: 'ながいぶんしょうですが、ここでしぜんにくぎります。',
      script: { units, unsupported: [], events: [] },
      timedUnits: units.map((unit) => makeTimed(unit, { manualPitchOffset: 0.25 })),
      edits: { pitchOffsets: units.map(() => 0.25) },
      globalExpression: { preset: 'neutral', intensity: 1 },
    });
    expect(plan.segments.length).toBe(2);
    expect(plan.segments[0]!.endUnit).toBe(18);
    expect(plan.segments[0]!.text.endsWith('、')).toBe(true);
  });

  it('does not inject a comma on the hard safety cut', () => {
    const units = Array.from({ length: 38 }, (_, index) =>
      makeUnit(index, index === 37 ? { boundaryAfter: 'sentence', punctuationAfter: 'period' } : {}),
    );
    const plan = buildNeuralProsodyPlan({
      originalText: 'かなりながいれんぞくしたぶんしょうをそのままよませるためのてすとです。',
      script: { units, unsupported: [], events: [] },
      timedUnits: units.map((unit) => makeTimed(unit, { manualEnergyScale: 1.05 })),
      edits: { energyScales: units.map(() => 1.05) },
      globalExpression: { preset: 'neutral', intensity: 1 },
    });
    expect(plan.segments.length).toBe(2);
    expect(plan.segments[0]!.endUnit).toBe(33);
    expect(plan.segments[0]!.text.endsWith('、')).toBe(false);
  });
});


describe('Neural HQ instant replay cache', () => {
  const expression = { preset: 'neutral' as const, intensity: 1 };
  const options = {
    character: 'natural' as const,
    rate: 1,
    energy: 1,
    pitch: 60,
    tone: 0,
    expression,
  };
  const plan = {
    edited: false,
    segments: [{
      text: 'こんにちは。',
      startUnit: 0,
      endUnit: 4,
      rateScale: 1,
      energyScale: 1,
      pitchSemitones: 0,
      pauseAfter: 0,
      expression,
    }],
  };

  it('reuses the exact same key when text and voice settings are unchanged', () => {
    expect(neuralPlaybackCacheKey(plan, options)).toBe(
      neuralPlaybackCacheKey(structuredClone(plan), { ...options }),
    );
  });

  it('invalidates on text, voice, rate, energy, pitch, delivery and edited pause', () => {
    const base = neuralPlaybackCacheKey(plan, options);
    const different = [
      neuralPlaybackCacheKey({ ...plan, segments: [{ ...plan.segments[0]!, text: 'こんばんは。' }] }, options),
      neuralPlaybackCacheKey(plan, { ...options, character: 'soft' as const }),
      neuralPlaybackCacheKey(plan, { ...options, rate: 1.1 }),
      neuralPlaybackCacheKey(plan, { ...options, energy: 0.9 }),
      neuralPlaybackCacheKey(plan, { ...options, pitch: 61 }),
      neuralPlaybackCacheKey(plan, { ...options, tone: 0.2 }),
      neuralPlaybackCacheKey(plan, { ...options, expression: { preset: 'calm' as const, intensity: 1 } }),
      neuralPlaybackCacheKey({ ...plan, edited: true, segments: [{ ...plan.segments[0]!, pauseAfter: 0.14 }] }, options),
      neuralPlaybackCacheKey({ ...plan, edited: true, segments: [{ ...plan.segments[0]!, pitchSemitones: 0.3 }] }, options),
    ];
    expect(new Set(different).size).toBe(different.length);
    expect(different.every((key) => key !== base)).toBe(true);
  });

  it('evicts least recently used recordings but keeps the recently replayed one', () => {
    const cache = new NeuralAudioCache(1024, 2);
    const record = (count: number) => ({ audio: new Float32Array(count), sampleRate: 24000 });
    cache.set('a', record(12));
    cache.set('b', record(12));
    expect(cache.get('a')).not.toBeNull();
    cache.set('c', record(12));
    expect(cache.get('a')).not.toBeNull();
    expect(cache.get('b')).toBeNull();
    expect(cache.get('c')).not.toBeNull();
    expect(cache.size).toBe(2);
    expect(cache.bytes).toBe(96);
  });

  it('keeps total stored PCM under the iPhone memory limit and skips oversized audio', () => {
    const cache = new NeuralAudioCache(80, 4);
    const record = (count: number) => ({ audio: new Float32Array(count), sampleRate: 24000 });
    cache.set('a', record(12));
    cache.set('b', record(12));
    expect(cache.bytes).toBeLessThanOrEqual(80);
    expect(cache.get('a')).toBeNull();
    cache.set('too-long', record(21));
    expect(cache.get('too-long')).toBeNull();
    expect(cache.bytes).toBeLessThanOrEqual(80);
  });

  it('does not retain empty or invalid PCM entries', () => {
    const cache = new NeuralAudioCache();
    cache.set('empty', { audio: new Float32Array(), sampleRate: 24000 });
    cache.set('invalid', { audio: new Float32Array(2), sampleRate: Number.NaN });
    expect(cache.size).toBe(0);
  });
});


describe('Neural HQ generation acceleration', () => {
  it('reuses model inference when only playback gain or pause changes', () => {
    const first = neuralSegmentInferenceKey('こんにちは。', 'jf_alpha', 1);
    const same = neuralSegmentInferenceKey('こんにちは。', 'jf_alpha', 1);
    expect(same).toBe(first);
    // No ENERGY or PAUSE argument is present in the key by design.
    const finalA = ['こんにちは。', 0.1, 0.92];
    const finalB = ['こんにちは。', 0.25, 1.13];
    expect(finalA).not.toEqual(finalB);
    expect(neuralSegmentInferenceKey(finalA[0] as string, 'jf_alpha', 1))
      .toBe(neuralSegmentInferenceKey(finalB[0] as string, 'jf_alpha', 1));
  });

  it('rerenders when phonetic text, speaker or actual model speed changes', () => {
    const base = neuralSegmentInferenceKey('こんにちは。', 'jf_alpha', 1);
    expect(neuralSegmentInferenceKey('こんばんは。', 'jf_alpha', 1)).not.toBe(base);
    expect(neuralSegmentInferenceKey('こんにちは。', 'jf_nezumi', 1)).not.toBe(base);
    expect(neuralSegmentInferenceKey('こんにちは。', 'jf_alpha', 1.08)).not.toBe(base);
  });

  it('keeps the segment LRU constrained to a small iPhone-friendly footprint', () => {
    const cache = new NeuralAudioCache(256, 2);
    cache.set('one', { audio: new Float32Array(24), sampleRate: 24_000 });
    cache.set('two', { audio: new Float32Array(24), sampleRate: 24_000 });
    cache.get('one');
    cache.set('three', { audio: new Float32Array(24), sampleRate: 24_000 });
    expect(cache.get('one')).not.toBeNull();
    expect(cache.get('two')).toBeNull();
    expect(cache.get('three')).not.toBeNull();
  });
});


describe('WebGPU Kokoro experimentation', () => {
  it('uses the patched fp32 model, not the known-broken stock WebGPU graph', () => {
    expect(KOKORO_GPU_MODEL_ID).toContain('Kokoro-82M-v1.0-ONNX-webgpu');
    expect(KOKORO_GPU_MODEL_ID).not.toContain('onnx-community/');
    expect(neuralWebGPUAvailable()).toBe(false);
  });

  it('detects nonsensical ONNX GPU output before playback', () => {
    const good = new Float32Array(4096);
    for (let i = 0; i < good.length; i += 1) good[i] = Math.sin(i * 0.3) * 0.15;
    expect(neuralPCMQualityGate(good)).toBe(true);
    const nan = good.slice();
    nan[0] = NaN;
    expect(neuralPCMQualityGate(nan)).toBe(false);
    const exploding = good.slice();
    exploding[0] = 300000;
    expect(neuralPCMQualityGate(exploding)).toBe(false);
    expect(neuralPCMQualityGate(new Float32Array(4096))).toBe(false);
    expect(neuralPCMQualityGate(new Float32Array(4))).toBe(false);
  });

  it('separates GPU fp32 and CPU q8 cache identities', () => {
    const options = {
      character: 'natural' as const,
      rate: 1,
      energy: 0.9,
      pitch: 60,
      tone: 0,
      expression: { preset: 'neutral' as const, intensity: 1 },
    };
    const plan = {
      edited: false,
      segments: [{ text: 'こんにちは。', startUnit: 0, endUnit: 3,
        rateScale: 1, energyScale: 1, pitchSemitones: 0, pauseAfter: 0,
        expression: options.expression }],
    };
    expect(neuralPlaybackCacheKey(plan, options)).not.toBe(
      neuralPlaybackCacheKey(plan, { ...options, backend: 'webgpu' }),
    );
    expect(neuralSegmentInferenceKey('こんにちは。', 'jf_alpha', 1, 'wasm'))
      .not.toBe(neuralSegmentInferenceKey('こんにちは。', 'jf_alpha', 1, 'webgpu'));
  });
});


describe('Mobile GPU crash prevention', () => {
  const baseline = {
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15',
    platform: 'MacIntel',
    maxTouchPoints: 0,
    deviceMemory: 16,
    hasWebGPU: true,
  };

  it('blocks iPhone and iPad including iPadOS masquerading as desktop Safari', () => {
    expect(neuralGPUDeviceBlockReason({
      ...baseline,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X)',
      platform: 'iPhone',
    })).toContain('IPHONE');
    expect(neuralGPUDeviceBlockReason({
      ...baseline,
      userAgent: 'Mozilla/5.0 (iPad; CPU OS 26_0 like Mac OS X)',
      platform: 'iPad',
    })).toContain('IPAD');
    expect(neuralGPUDeviceBlockReason({ ...baseline, maxTouchPoints: 5 }))
      .toContain('IPHONE');
  });

  it('blocks low-memory and WebGPU-unavailable devices before model allocation', () => {
    expect(neuralGPUDeviceBlockReason({ ...baseline, deviceMemory: 4 })).toContain('MEMORY');
    expect(neuralGPUDeviceBlockReason({ ...baseline, hasWebGPU: false })).toContain('NOT AVAILABLE');
    expect(neuralGPUDeviceBlockReason(baseline)).toBeNull();
  });
});


describe('Neural HQ reusable persistent stages', () => {
  it('distinguishes versioned completed-take data and raw generated phrase data', () => {
    const key = neuralSegmentInferenceKey('こんにちは。', 'jf_alpha', 1);
    expect(neuralPersistentKey('segment', key)).not.toBe(neuralPersistentKey('final', key));
    expect(neuralPersistentKey('segment', key)).toBe(neuralPersistentKey('segment', key));
    expect(NEURAL_PERSISTENT_CACHE_LIMIT_BYTES).toBe(24 * 1024 * 1024);
  });

  it('rejects empty/huge/malformed waveform data before persistent writes', () => {
    expect(validNeuralStoredPCM({
      audio: new Float32Array(24000), sampleRate: 24000,
    })).toBe(true);
    expect(validNeuralStoredPCM({
      audio: new Float32Array(0), sampleRate: 24000,
    })).toBe(false);
    expect(validNeuralStoredPCM({
      audio: new Float32Array(24000), sampleRate: 0,
    })).toBe(false);
    expect(validNeuralStoredPCM({
      audio: new Float32Array(512), sampleRate: 24000,
    }, 2047)).toBe(false);
  });

  it('degrades safely to memory-only caching when IndexedDB is unavailable', async () => {
    const store = new NeuralRenderStore(1024, 2, undefined);
    expect(store.available).toBe(false);
    expect(await store.get('missing')).toBeNull();
    expect(await store.has('missing')).toBe(false);
    expect(await store.put('x', {
      audio: new Float32Array(8), sampleRate: 24000,
    })).toBe(false);
  });
});


describe('Neural HQ Kokoro-internal phoneme / token reuse', () => {
  function testSynthesis() {
    const calls = { speak: 0, tokenize: 0, infer: 0 };
    const privateKokoro = {
      tokenizer(phonemes: string, _settings: { truncation: boolean }) {
        calls.tokenize += 1;
        return { input_ids: { phonemes, dims: [1, phonemes.length + 2] } };
      },
      async generate_from_ids(ids: { phonemes: string }, options: { voice: string; speed: number }) {
        calls.infer += 1;
        expect(ids.phonemes).toBe('koɴ niʨiwa');
        expect(options.speed).toBeGreaterThan(0);
        return { audio: new Float32Array(2400).fill(0.15), sampling_rate: 24000 };
      },
    };
    const client = {
      tts: privateKokoro,
      async speak(_text: string, voice: string, speed: number) {
        calls.speak += 1;
        const ids = privateKokoro.tokenizer('koɴ niʨiwa', { truncation: true });
        return privateKokoro.generate_from_ids(ids.input_ids, { voice, speed });
      },
    };
    return { client, calls };
  }

  it('captures exactly the Kokoro tokenizer phonemes on first pass', async () => {
    const cache = new NeuralPhonemeCache(null);
    const { client, calls } = testSynthesis();
    const first = await speakWithReusablePhonemes(client, cache, 'こんにちは。', 'jf_alpha', 1);
    expect(first.reusedPhonemes).toBe(false);
    expect(first.capturedPhonemes).toBe(true);
    expect(calls.speak).toBe(1);
    expect(calls.tokenize).toBe(1);

    // Changing speaker and speed still reuses the identical phoneme+ID tensor.
    const second = await speakWithReusablePhonemes(client, cache, 'こんにちは。', 'jm_kumo', 1.18);
    expect(second.reusedPhonemes).toBe(true);
    expect(calls.speak).toBe(1);
    expect(calls.tokenize).toBe(1);
    expect(calls.infer).toBe(2);
    expect(await cache.get('こんにちは。')).toBe('koɴ niʨiwa');
  });

  it('restores saved phonemes into a newly loaded model without Open JTalk', async () => {
    const cache = new NeuralPhonemeCache(null);
    const first = testSynthesis();
    await speakWithReusablePhonemes(first.client, cache, 'こんにちは。', 'jf_alpha', 1);
    const restarted = testSynthesis();
    const result = await speakWithReusablePhonemes(restarted.client, cache, 'こんにちは。', 'jf_alpha', 0.9);
    expect(result.reusedPhonemes).toBe(true);
    expect(restarted.calls.speak).toBe(0);
    expect(restarted.calls.tokenize).toBe(1);
  });

  it('falls back to the stable official speak API when internals are absent', async () => {
    const cache = new NeuralPhonemeCache(null);
    let calls = 0;
    const client = { async speak() {
      calls++;
      return { audio: new Float32Array(2048).fill(0.2), sampling_rate: 24000 };
    } };
    const result = await speakWithReusablePhonemes(client, cache, '音声です。', 'jf_alpha', 1);
    expect(result.reusedPhonemes).toBe(false);
    expect(calls).toBe(1);
  });

  it('ignores malformed values and version-separates persistent keys', async () => {
    const cache = new NeuralPhonemeCache(null);
    expect(validNeuralPhonemes('こんにちは。', 'koɴ niʨiwa')).toBe(true);
    expect(validNeuralPhonemes('こんにちは。', '')).toBe(false);
    expect(validNeuralPhonemes('こんにちは。', '\\u0000')).toBe(false);
    expect(neuralPhonemeKey('こんにちは')).not.toBe(neuralPhonemeKey('こんにちは。'));
    expect(await cache.put('こんにちは。', 'koɴ niʨiwa')).toBe(false);
    expect(await cache.get('こんにちは。')).toBe('koɴ niʨiwa');
  });

  it('keeps a bounded in-memory LRU for phonemes', () => {
    const memory = new NeuralPhonemeMemoryCache(512, 2);
    memory.put('a', 'a');
    memory.put('b', 'b');
    expect(memory.get('a')).toBe('a');
    memory.put('c', 'c');
    expect(memory.get('b')).toBeNull();
    expect(memory.size).toBe(2);
    expect(memory.bytes).toBeLessThanOrEqual(512);
  });
});


describe('Kokoro phoneme reuse diagnostics and safe fallback', () => {
  it('reports token-ID reuse for same-text new-speed inference', async () => {
    const cache = new NeuralPhonemeCache(null);
    const calls: string[] = [];
    const kokoro = {
      tokenizer: (text: string) => ({ input_ids: { text } }),
      generate_from_ids: async (_ids: unknown) => ({
        audio: new Float32Array(900).fill(0.13),
        sampling_rate: 24000,
      }),
    };
    const model = {
      tts: kokoro,
      async speak(text: string) {
        const input = kokoro.tokenizer(text);
        return kokoro.generate_from_ids(input.input_ids);
      },
    };
    await speakWithReusablePhonemes(model, cache, 'あいう', 'jf_alpha', 1);
    const result = await speakWithReusablePhonemes(
      model, cache, 'あいう', 'jm_kumo', 1.2,
      (source) => calls.push(source),
    );
    expect(result.reusedPhonemes).toBe(true);
    expect(calls).toEqual(['token-ids']);
  });

  it('uses official speak if cached direct inference fails', async () => {
    const cache = new NeuralPhonemeCache(null);
    await cache.put('音声', 'oɴseː');
    let directAttempts = 0;
    let stableAttempts = 0;
    const client = {
      tts: {
        tokenizer: (text: string) => ({ input_ids: { text } }),
        async generate_from_ids() {
          directAttempts++;
          throw new Error('old token interface');
        },
      },
      async speak() {
        stableAttempts++;
        return { audio: new Float32Array(500).fill(0.1), sampling_rate: 24000 };
      },
    };
    const result = await speakWithReusablePhonemes(
      client, cache, '音声', 'jf_alpha', 1,
    );
    expect(result.reusedPhonemes).toBe(false);
    expect(directAttempts).toBe(1);
    expect(stableAttempts).toBe(1);
  });
});


describe('Neural HQ shared in-flight model inference', () => {
  it('runs a matching key once even when two requests overlap', async () => {
    const pending = new NeuralInferenceSingleFlight<number>();
    let callCount = 0;
    let finish: (value: number) => void = () => { throw Error('not started'); };
    const work = () => {
      callCount++;
      return new Promise<number>((resolve) => { finish = resolve; });
    };
    const a = pending.run('same voice + text + speed', work);
    const b = pending.run('same voice + text + speed', work);
    expect(a).toBe(b);
    expect(pending.has('same voice + text + speed')).toBe(true);
    await Promise.resolve();
    expect(callCount).toBe(1);
    finish(42);
    expect(await a).toBe(42);
    expect(await b).toBe(42);
    expect(pending.size).toBe(0);
  });

  it('does not merge different speaker or speed keys', async () => {
    const pending = new NeuralInferenceSingleFlight<number>();
    const a = pending.run('alpha@1.0', async () => 1);
    const b = pending.run('kumo@1.0', async () => 2);
    const c = pending.run('alpha@1.1', async () => 3);
    expect(await Promise.all([a, b, c])).toEqual([1, 2, 3]);
    expect(pending.size).toBe(0);
  });

  it('retries a failed inference and does not keep rejected work', async () => {
    const pending = new NeuralInferenceSingleFlight<number>();
    await expect(pending.run('failed', async () => {
      throw new Error('offline');
    })).rejects.toThrow('offline');
    expect(pending.size).toBe(0);
    expect(await pending.run('failed', async () => 7)).toBe(7);
  });
});


describe('Natural long-text neural segmentation for reusable inference', () => {
  it('preserves normal short sentences as exactly one model-native input', () => {
    const line = 'こんにちは。自然な声を維持します。';
    expect(splitLongNeuralText(line)).toEqual([line]);
    expect(splitLongNeuralText('')).toEqual([]);
  });

  it('only splits long text at full sentence boundaries when possible', () => {
    const first = '長い文章を自然に読み上げるための第一文です。'.repeat(5);
    const second = '次の文章もそのまま保持して再利用できます。'.repeat(2);
    const text = first + second;
    const chunks = splitLongNeuralText(text);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every(x => Array.from(x).length <= NEURAL_MAX_UNEDITED_CHARS)).toBe(true);
    expect(chunks.join('')).toBe(text);
    expect(chunks[0]!.endsWith('。')).toBe(true);
  });

  it('avoids tiny remainders and respects Japanese comma boundaries', () => {
    const text = '新しい文章を読み上げます、'.repeat(14) + 'おしまい。';
    const chunks = splitLongNeuralText(text);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.slice(0, -1).every(x => x.endsWith('、'))).toBe(true);
    expect(chunks.join('')).toBe(text);
  });

  it('keeps spaces and line breaks intact across long-text chunks', () => {
    const text = ('これから読む長い文章です。  次の行へ移ります。\n').repeat(12).trim();
    const chunks = splitLongNeuralText(text);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join('')).toBe(text);
    expect(chunks.every(x => Array.from(x).length <= NEURAL_MAX_UNEDITED_CHARS)).toBe(true);
  });

  it('does not truncate a very long text without punctuation', () => {
    const text = 'かきくけこ'.repeat(75);
    const chunks = splitLongNeuralText(text);
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.join('')).toBe(text);
    expect(chunks.every(x => Array.from(x).length <= NEURAL_MAX_UNEDITED_CHARS)).toBe(true);
  });

  it('retains one native generation for an ordinary unedited plan', () => {
    const text = '自然な短い文です。';
    const plan = buildNeuralProsodyPlan({
      originalText: text,
      script: { units: [], unsupported: [], events: [] },
      timedUnits: [],
      edits: {},
      globalExpression: { preset: 'neutral', intensity: 1 },
    });
    expect(plan.edited).toBe(false);
    expect(plan.segments).toHaveLength(1);
    expect(plan.segments[0]!.text).toBe(text);
  });

  it('divides long unedited plans into cacheable complete sentences', () => {
    const text = '文末を保持した日本語の長い文章です。'.repeat(16);
    const plan = buildNeuralProsodyPlan({
      originalText: text,
      script: { units: [], unsupported: [], events: [] },
      timedUnits: [],
      edits: {},
      globalExpression: { preset: 'neutral', intensity: 1 },
    });
    expect(plan.segments.length).toBeGreaterThan(1);
    expect(plan.segments.map(x => x.text).join('')).toBe(text);
  });
});


describe('Neural HQ streaming first-sentence audio', () => {
  it('starts the very first neural chunk immediately rather than waiting for all chunks', () => {
    expect(nextNeuralChunkTime(3, null, 0)).toBeCloseTo(3.012);
    expect(nextNeuralChunkTime(6, 5, 0)).toBeCloseTo(6.012);
  });

  it('schedules an 8ms crossfade when the next phrase is ready early', () => {
    expect(nextNeuralChunkTime(2, 5, 0)).toBeCloseTo(4.992);
    expect(nextNeuralChunkTime(2, 5, 0.2)).toBeCloseTo(5.2);
  });

  it('bounds output gain to prevent streaming PCM from clipping', () => {
    expect(streamingChunkGain({
      audio: new Float32Array([0.9, -0.91, 0.2]),
      sampleRate: 24000,
      gain: 1.15,
      pauseAfter: 0,
    })).toBeCloseTo(0.985 / 0.91);
    expect(streamingChunkGain({
      audio: new Float32Array([0.2, -0.2]),
      sampleRate: 24000,
      gain: 0.8,
      pauseAfter: 0,
    })).toBeCloseTo(0.8);
    expect(streamingChunkGain({
      audio: new Float32Array([NaN]),
      sampleRate: 24000,
      gain: 1,
      pauseAfter: 0,
    })).toBe(0);
  });
});
