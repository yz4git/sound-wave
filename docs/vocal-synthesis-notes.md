# Local Vocal Synthesis Notes

SOUND WAVE's local singer is intentionally lightweight and private: no cloud inference, downloaded voice model, remote voice API, recorded vocal sample, or voice cloning is required. The implementation uses Web Audio and source-filter ideas informed by classical speech/singing synthesis literature.

## Research basis

### Source-filter model

The voice is modeled as a glottal source filtered by vocal-tract resonances, followed by a lightweight approximation of lip radiation.

- Gunnar Fant's source-filter theory remains the base architecture.
- Source and vocal-tract parameters stay separate so vocal style can change independently from pitch/harmony generation.

### Glottal source

Vocal v4 moves the glottal source into an `AudioWorkletProcessor`. The worklet keeps one phase accumulator alive across note events and evaluates a Rosenberg/LF-inspired open/close pulse sample-by-sample. This removes the audible and architectural discontinuity caused by constructing a fresh `OscillatorNode` for every vocal note.

The parameters remain deliberately compact for iPhone Safari:

- open quotient controls how long the synthetic glottis remains open per cycle
- speed quotient controls the relative opening/closing shape
- glottal-flow derivative is mixed into the source to approximate radiated spectral emphasis
- pitch changes alter the phase increment without resetting the phase itself

References:
- Fant, Liljencrants & Lin glottal-flow/LF-model work.
- Perrotin, Feugère & d'Alessandro, "Perceptual equivalence of the Liljencrants-Fant and linear-filter glottal flow models", JASA 150(2), 1273 (2021), DOI: 10.1121/10.0005879.
- Degottex et al., mixed LF + noise source modeling for voice transformation and synthesis, Speech Communication 55(2), 278–294 (2013).

### Klatt formant synthesis

Dennis H. Klatt's cascade/parallel formant synthesizer motivates the resonator-based vocal tract. SOUND WAVE keeps five resonator states inside the same AudioWorklet stream and interpolates consonant-onset targets toward the selected vowel.

Reference: Dennis H. Klatt, "Software for a cascade/parallel formant synthesizer", JASA 67(3), 971–995 (1980), DOI: 10.1121/1.383940.

### Singing presence / singer's formant

A restrained presence resonator around 2.85–3.05 kHz approximates the spectral concentration associated with singer's-formant research without trying to reproduce operatic technique.

Reference: Johan Sundberg, "Level and center frequency of the singer's formant", Journal of Voice 15(2), 176–186 (2001), DOI: 10.1016/S0892-1997(01)00019-4.

### Vibrato, jitter and shimmer

Measured singing vibrato commonly falls around 5–7 Hz, so each style uses a delayed vibrato within that range. Vocal v4 keeps vibrato, low-rate pitch drift, stochastic jitter and stochastic shimmer inside the same processor state instead of starting new modulators for every note.

References:
- Ferrante, "Vibrato rate and extent in soprano voice: a survey on one century of singing", JASA 130(3), 1683–1688 (2011), DOI: 10.1121/1.3621017.
- Joint source-filter / glottal-source studies that model jitter and shimmer as part of human voice production.

## Implemented v4 architecture

### Persistent AudioWorklet singer

`public/vocal-worklet.js` registers one `sound-wave-vocal-processor`.

The processor remains alive for the AUTO COMPOSE session and owns:

- one continuous glottal phase accumulator
- current F0 and note-to-note portamento state
- five persistent vocal-tract resonator histories
- persistent ~3 kHz singing-presence resonator state
- lip-radiation/high-frequency state
- low-rate jitter and shimmer state
- breath/consonant noise state
- a local short-delay ring buffer for subtle doubling

No vocal `OscillatorNode` is created for each note. `ComposeAudio` only sends timestamped vocal events through `VocalWorkletBridge`.

### Event data

Each worklet event contains:

- target pitch and optional previous-pitch glide source
- velocity and note duration
- syllable / articulation / phrase-boundary flags
- five start/target formant bands with bandwidth and gain
- WARM / BRIGHT / AIRY glottal, vibrato, breath, radiation and doubling parameters

The main-thread scheduler still uses the existing ~120 ms lookahead, but actual vocal synthesis happens on the audio rendering thread.

### Continuous phrase behavior

- glottal phase is never reset at normal note boundaries
- melisma notes glide from the previous pitch instead of starting a new oscillator
- formant filter memories carry through adjacent notes
- phrase starts emphasize articulation/breath
- phrase endings lengthen the release
- STOP / VOCAL OFF / mode exit clears queued events without destroying the worklet node

### Mobile optimization

The five formant coefficients are not recomputed for every sample. During consonant-to-vowel movement they are refreshed every 16 samples (about 0.33 ms at 48 kHz), which keeps transitions perceptually continuous while greatly reducing expensive trigonometric work on iPhone-class CPUs.

The processor also keeps all short-delay and modulation buffers fixed-size to avoid render-thread allocation churn.

### Offline/local guarantee

`vocal-worklet.js` lives in `public/`, is copied by Vite to `dist/vocal-worklet.js`, and is included in the PWA core cache. AUTO COMPOSE therefore does not need a network connection or remote synthesis endpoint to initialize the singer after the app has been cached.

`npm run validate:prod` now verifies that the worklet exists, registers the expected processor, and contains no `createOscillator()` call.

## Scope

This remains a procedural synthetic singer, not a neural singing-voice model, a downloaded voicebank, or an impersonation system. Vocal v4 specifically targets continuity, expressive phrasing, deterministic local generation, and predictable mobile cost while preserving the privacy/locality goal.
