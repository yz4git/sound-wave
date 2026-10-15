import { describe, expect, it } from 'vitest';
import { speechWaitStageFromStatus, speechWaitView } from '../src/voice/SpeechWaitStatus';

describe('VOICE LAB playback waiting feedback', () => {
  it('identifies actual work phases rather than inventing a percentage', () => {
    expect(speechWaitStageFromStatus('NEURAL HQ · CHECKING SAVED AUDIO', 'preparing')).toBe('cache');
    expect(speechWaitStageFromStatus('NEURAL HQ · LOADING KOKORO MODEL', 'generating')).toBe('loading');
    expect(speechWaitStageFromStatus('NEURAL HQ · GENERATING 1/3', 'loading')).toBe('generating');
    expect(speechWaitStageFromStatus('VOX LOCAL · RECONSTRUCTING VOICE', 'generating')).toBe('refining');
    expect(speechWaitStageFromStatus('VOXCPM2 · CONNECTING TO SERVER', 'preparing')).toBe('connecting');
    expect(speechWaitStageFromStatus('unknown stage', 'refining')).toBe('refining');
  });

  it('shows elapsed waiting time without an estimated remaining time', () => {
    const state = speechWaitView('vox-local', 'loading', 12.7);
    expect(state.headline).toContain('12秒経過');
    expect(state.headline).toContain('読み込み');
    expect(state.explanation).toContain('初回');
    expect(state.explanation).not.toMatch(/%|残り\d/);
    expect(state.attention).toBe(false);
  });

  it('warns after 30s and suggests STOP/retry after 90s, without claiming it is frozen', () => {
    const long = speechWaitView('neural', 'generating', 35);
    expect(long.attention).toBe(true);
    expect(long.explanation).toContain('まだ音声の開始を確認できていません');
    const veryLong = speechWaitView('vox-local', 'generating', 95);
    expect(veryLong.attention).toBe(true);
    expect(veryLong.explanation).toContain('止まっている可能性');
    expect(veryLong.explanation).toContain('STOP');
  });

  it('handles missing elapsed values safely', () => {
    expect(speechWaitView('neural', 'preparing', NaN).headline).toContain('0秒');
    expect(speechWaitView('neural', 'preparing', -100).headline).toContain('0秒');
    expect(speechWaitView('voxcpm2', 'connecting', 2).explanation).toContain('サーバー');
  });
});
