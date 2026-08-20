# Vocal v20.8 — Spectral Envelope Trajectory

## Goal

Reduce note-to-note timbre discontinuities without blurring Japanese consonant/vowel articulation.

v20.8 extends the continuous glottal AudioWorklet from v20.6/v20.7 with a persistent spectral-envelope state. The implementation is procedural and local; it does not copy or require proprietary VOCALOID voicebanks or algorithms.

## Literature direction

### VocaListener2

Nakano & Goto, *VocaListener2: A Singing Synthesis System Able to Mimic a User's Singing in Terms of Voice Timbre Changes as well as Pitch and Dynamics* (ICASSP 2011).

The paper represents timbre change as a time/frequency spectral transform surface and applies a time-frequency smoothing FIR to preserve continuity of spectral envelopes and reduce unnatural synthesis artifacts.

Sound Wave adapts this idea to its five-formant real-time model instead of operating on a full STRAIGHT spectral envelope.

### STRAIGHT singing conversion

Saitou et al., *Vocal conversion from speaking voice to singing voice using STRAIGHT* (Interspeech 2007).

The singing model separately controls F0, duration, and spectral envelope, including formant-amplitude modulation synchronized with vibrato.

v20.8 keeps the existing pitch/duration systems independent and adds a deliberately small vibrato-synchronous envelope component.

## Implementation

### `src/compose/VocalSpectralEnvelope.ts`

Per-note controls:

- `timeSmoothingMs` — 22–40 ms during stable vowels
- `transitionSmoothingMs` — ~7.5–11 ms for faster articulation tracking
- `frequencySmoothing` — 8–19% neighbouring-formant gain smoothing
- `transitionProtectionSeconds` — prevents timbre smoothing from smearing consonant/vowel transitions
- `spectralTiltDepth` — slow phrase-energy-dependent upper-formant trajectory
- `vibratoEnvelopeDepth` — tiny vibrato-synchronous envelope modulation, max 0.8%
- `trajectoryDepth` — caps how much the per-note timbre trajectory may move

### AudioWorklet persistent state

`public/vocal-worklet.js` now keeps five-band state for:

- formant center frequency
- bandwidth
- gain scale

Connected notes retain the previous spectral state. A real gap resets the state so the following phrase does not inherit stale vowel colour.

### Transition protection

During consonant/vowel transitions the time smoothing is deliberately fast and frequency-axis smoothing is reduced to 30% of its sustained-vowel value.

After the transition protection window, the state follows its target over 22–40 ms. This reduces abrupt timbre steps while keeping phonetic attacks readable.

### Frequency-axis smoothing

The five-formant model cannot reproduce a dense time-frequency spectral surface. Instead, v20.8 applies a lightweight three-point FIR only to dynamic formant gain targets:

`previous + current + next`

Formant center frequencies are never averaged with neighbouring formants, avoiding collapse of vowel identity.

### Continuous spectral tilt

Phrase energy produces a very small upper-formant tilt trajectory only after the sustained vowel is established. The maximum depth is about 2.1%, and Presence Reset remains untouched.

### Vibrato-envelope coupling

A separate max 0.8% spectral-envelope modulation follows the persistent vibrato phase. This is intentionally much smaller than pitch vibrato and complements the existing v20.6 resonance coupling.

## Preserved safeguards

v20.8 preserves:

- Presence Reset (`presenceGain: 0`)
- anti-crack finite/peak protection
- v20.3 register continuity
- Japanese phoneme timing and coarticulation
- nasal anti-formant
- Harmonic–Formant Collision Guard
- Dynamic Glottal Source
- karaoke-score pitch stability and late vibrato
- v20.7 consonant pre-roll and score-aligned Note-Off
- one continuous AudioWorklet glottal stream

No per-note `OscillatorNode` vocal source is reintroduced.
