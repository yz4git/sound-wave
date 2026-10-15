/** A reliable on-device iOS speech path which runs *during* the tap.
 * It is native OS TTS, NOT a replacement implementation of Kokoro.
 */
export interface PlaybackEnvironment { userAgent: string; platform: string; maxTouchPoints: number }
export function isIPhoneBrowser(env: PlaybackEnvironment): boolean {
  return /iPhone|iPod|iPad/i.test(env.userAgent) ||
    (env.platform === 'MacIntel' && env.maxTouchPoints > 1);
}
export function shouldUseDeviceSpeech(
  engine: 'local' | 'neural' | 'neural-gpu' | 'system' | 'voxcpm2' | 'vox-local',
  compatibilityEnabled: boolean,
  env: PlaybackEnvironment,
): boolean {
  return compatibilityEnabled && isIPhoneBrowser(env) && engine !== 'system';
}
