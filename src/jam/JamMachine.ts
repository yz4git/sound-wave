export type JamMode = 'drum-machine' | 'finger-drum' | 'sampler';

export type JamVoice =
  | 'kick'
  | 'snare'
  | 'hat'
  | 'clap'
  | 'tom-low'
  | 'tom-high'
  | 'bass'
  | 'stab';

export type SequencerVoice = Extract<JamVoice, 'kick' | 'snare' | 'hat' | 'clap'>;

export interface JamTrigger {
  voice: JamVoice;
  velocity: number;
}

export interface JamState {
  mode: JamMode;
  bpm: number;
  swing: number;
  playing: boolean;
  step: number;
  pattern: Record<SequencerVoice, number[]>;
}

export interface SavedJamState {
  bpm: number;
  swing: number;
  pattern: Record<SequencerVoice, number[]>;
}

export const JAM_STEPS = 16;
export const SEQUENCER_VOICES: readonly SequencerVoice[] = ['kick', 'snare', 'hat', 'clap'] as const;
export const FINGER_DRUM_VOICES: readonly JamVoice[] = [
  'kick',
  'snare',
  'hat',
  'clap',
  'tom-low',
  'tom-high',
  'bass',
  'stab',
] as const;

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

function emptyTrack(): number[] {
  return Array.from({ length: JAM_STEPS }, () => 0);
}

function defaultPattern(): Record<SequencerVoice, number[]> {
  const kick = emptyTrack();
  const snare = emptyTrack();
  const hat = emptyTrack();
  const clap = emptyTrack();

  for (const index of [0, 4, 8, 12]) kick[index] = index === 0 ? 1 : 0.82;
  for (const index of [4, 12]) snare[index] = 0.92;
  for (let index = 0; index < JAM_STEPS; index += 2) hat[index] = index % 4 === 2 ? 0.62 : 0.48;
  clap[12] = 0.72;

  return { kick, snare, hat, clap };
}

export function createJamState(): JamState {
  return {
    mode: 'drum-machine',
    bpm: 112,
    swing: 0.08,
    playing: false,
    step: 0,
    pattern: defaultPattern(),
  };
}

export function setJamMode(state: JamState, mode: JamMode): JamState {
  return { ...state, mode };
}

export function setJamTempo(state: JamState, bpm: number): JamState {
  return { ...state, bpm: clamp(Math.round(bpm), 60, 180) };
}

export function setJamSwing(state: JamState, swing: number): JamState {
  return { ...state, swing: clamp(swing, 0, 0.35) };
}

export function toggleJamTransport(state: JamState): JamState {
  return { ...state, playing: !state.playing };
}

export function stopJamTransport(state: JamState): JamState {
  return { ...state, playing: false, step: 0 };
}

export function clearJamPattern(state: JamState): JamState {
  return {
    ...state,
    pattern: {
      kick: emptyTrack(),
      snare: emptyTrack(),
      hat: emptyTrack(),
      clap: emptyTrack(),
    },
  };
}

export function cycleStepVelocity(state: JamState, voice: SequencerVoice, step: number): JamState {
  const index = clamp(Math.trunc(step), 0, JAM_STEPS - 1);
  const current = state.pattern[voice][index] ?? 0;
  const next = current <= 0 ? 0.72 : current < 0.95 ? 1 : 0;
  const track = [...state.pattern[voice]];
  track[index] = next;
  return {
    ...state,
    pattern: { ...state.pattern, [voice]: track },
  };
}

export function jamStepDurationMs(bpm: number): number {
  return 60000 / clamp(bpm, 60, 180) / 4;
}

export function swingDelayMs(state: Pick<JamState, 'bpm' | 'swing'>, step: number): number {
  if (step % 2 === 0) return 0;
  return jamStepDurationMs(state.bpm) * clamp(state.swing, 0, 0.35);
}

export function triggersForStep(state: JamState, step = state.step): JamTrigger[] {
  const index = ((Math.trunc(step) % JAM_STEPS) + JAM_STEPS) % JAM_STEPS;
  const triggers: JamTrigger[] = [];
  for (const voice of SEQUENCER_VOICES) {
    const velocity = state.pattern[voice][index] ?? 0;
    if (velocity > 0) triggers.push({ voice, velocity });
  }
  return triggers;
}

export function advanceJamStep(state: JamState): JamState {
  return { ...state, step: (state.step + 1) % JAM_STEPS };
}

export function randomizeJamPattern(state: JamState, seed = Date.now()): JamState {
  let value = seed >>> 0;
  const random = (): number => {
    value += 0x6d2b79f5;
    let x = value;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };

  const pattern = {} as Record<SequencerVoice, number[]>;
  for (const voice of SEQUENCER_VOICES) {
    pattern[voice] = Array.from({ length: JAM_STEPS }, (_, index) => {
      const downbeat = index % 4 === 0;
      const threshold = voice === 'kick' ? 0.38 : voice === 'snare' ? 0.2 : voice === 'hat' ? 0.48 : 0.13;
      const enabled = random() < threshold + (downbeat && voice === 'kick' ? 0.36 : 0);
      if (!enabled) return 0;
      return random() > 0.72 ? 1 : 0.58 + random() * 0.25;
    });
  }

  return { ...state, pattern };
}

export function serializeJamState(state: JamState): string {
  const saved: SavedJamState = {
    bpm: state.bpm,
    swing: state.swing,
    pattern: state.pattern,
  };
  return JSON.stringify(saved);
}

export function restoreJamState(serialized: string | null): JamState {
  const fallback = createJamState();
  if (!serialized) return fallback;
  try {
    const parsed = JSON.parse(serialized) as Partial<SavedJamState>;
    if (!parsed.pattern || typeof parsed.pattern !== 'object') return fallback;
    const pattern = {} as Record<SequencerVoice, number[]>;
    for (const voice of SEQUENCER_VOICES) {
      const source = parsed.pattern[voice];
      if (!Array.isArray(source) || source.length !== JAM_STEPS) return fallback;
      pattern[voice] = source.map((value) => clamp(Number(value) || 0, 0, 1));
    }
    return {
      ...fallback,
      bpm: clamp(Math.round(Number(parsed.bpm) || fallback.bpm), 60, 180),
      swing: clamp(Number(parsed.swing) || 0, 0, 0.35),
      pattern,
    };
  } catch {
    return fallback;
  }
}
