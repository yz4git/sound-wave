import { describe, expect, it } from 'vitest';
import { isIPhoneBrowser, shouldUseDeviceSpeech, type PlaybackEnvironment } from '../src/voice/IPhoneSpeechPolicy';

const iPhone: PlaybackEnvironment = {
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_6 like Mac OS X) AppleWebKit/605.1.15',
  platform: 'iPhone', maxTouchPoints: 5,
};
const iPadDesktop: PlaybackEnvironment = {
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15',
  platform: 'MacIntel', maxTouchPoints: 5,
};
const desktop: PlaybackEnvironment = {
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6)',
  platform: 'MacIntel', maxTouchPoints: 0,
};

describe('reliable iOS speech routing', () => {
  it('recognizes native iPhone and desktop-mode iPad', () => {
    expect(isIPhoneBrowser(iPhone)).toBe(true);
    expect(isIPhoneBrowser(iPadDesktop)).toBe(true);
    expect(isIPhoneBrowser(desktop)).toBe(false);
  });
  it('takes direct system TTS instead of entering broken iPhone Kokoro processing when compatibility is ON', () => {
    for (const engine of ['vox-local', 'neural', 'neural-gpu', 'local', 'voxcpm2'] as const) {
      expect(shouldUseDeviceSpeech(engine, true, iPhone)).toBe(true);
    }
    expect(shouldUseDeviceSpeech('system', true, iPhone)).toBe(false);
  });
  it('retains explicit opt-in to quality neural synthesis and normal desktop behavior', () => {
    expect(shouldUseDeviceSpeech('vox-local', false, iPhone)).toBe(false);
    expect(shouldUseDeviceSpeech('neural', false, iPadDesktop)).toBe(false);
    expect(shouldUseDeviceSpeech('vox-local', true, desktop)).toBe(false);
  });
});
