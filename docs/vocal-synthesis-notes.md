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

`npm run validate:prod` verifies that the worklet exists, registers the expected processor, and contains no `createOscillator()` call.

## Vocal v20 — Human Phrase Model

Vocal v20 changes the control unit above the continuous AudioWorklet from isolated note expression toward phrase expression. The note scheduler still supplies exact pitches and timings, but a separate pure `VocalPhraseModel` now derives continuous phrase-level control trajectories and sends them with every vocal event.

### Phrase controller

`src/compose/VocalPhraseModel.ts` groups adjacent vocal events by phrase boundaries and calculates:

- normalized phrase progress for each event
- a gentle amplitude arch: softer entry, modest mid-phrase crest, softer release
- late-phrase vowel centralization amount
- pitch-synchronous aspiration depth
- a deliberately weak source–tract coupling coefficient

`ComposeAudio` caches this control map for the current vocal-line object, so the phrase analysis is not repeated for every audio sample or every scheduled note.

### Phrase-level dynamics

The worklet interpolates phrase energy inside each note instead of treating note velocity as the only amplitude control. The curve remains intentionally shallow so composition dynamics still matter, but note boundaries no longer define the whole loudness shape.

### Dynamic vowel release

The five formant targets are no longer perfectly static through the entire phrase. During the final part of a phrase they move by at most a small amount toward neutral reference resonances. This simulates the common tendency for a released vowel to relax rather than holding an exact synthetic target until silence.

The existing 16-sample coefficient-refresh interval remains unchanged for mobile efficiency.

### Pitch-synchronous aspiration

A new aspiration component gates a small amount of noise with the open portion of the same continuous glottal cycle. This means breath energy is partly synchronized with phonation instead of being only independent broadband noise. The original onset/release breath components remain, but the synchronized component is intentionally subtle.

### Weak source–tract coupling

The previous F1 resonator state is fed back into the next glottal excitation at a tightly clamped level below 0.05. This is not a full physical vocal-fold model; it is a lightweight interaction term designed to reduce the perfectly separated "oscillator then filter" character without risking resonator self-oscillation.

### Phrase-aware vibrato

Long-note vibrato is now additionally gated by phrase position. Early phrase notes stay straighter even when individually long; vibrato becomes available later in the phrase and remains continuous in phase across note boundaries.

### Validation

The production validator now requires the Human Phrase Model markers `sourceTractCoupling`, `aspirationDepth`, vowel-centering controls and phrase-energy control to be present in `dist/vocal-worklet.js`. Unit tests cover phrase-arch bounds, vowel-centering bounds, mapping every generated vocal event to a phrase control, and passing those controls through `VocalWorkletBridge`.

## Next v20 stages

The Phrase Model is deliberately the foundation rather than the final humanization pass. The next compatible stages are:

1. Japanese-style phoneme timing for `k/t/s/h/f/p/b/g/z` families and moraic `n`.
2. Continuous consonant-to-vowel and vowel-to-vowel trajectories rather than only onset-to-target formant interpolation.
3. Phrase-level breath budgeting so aspiration, onset breath and release breath share one continuous respiratory envelope.
4. Interval-aware portamento curves and consonant-dependent F0 suppression.
5. Optional lightweight generated room response after the dry vocal chain.

## Scope

This remains a procedural synthetic singer, not a neural singing-voice model, a downloaded voicebank, or an impersonation system. Vocal v20 targets human-like phrase continuity and physically motivated interactions while preserving deterministic local generation, privacy, predictable mobile cost, and the existing no-per-note-oscillator architecture.
