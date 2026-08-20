# Local Vocal Synthesis Notes

SOUND WAVE's local singer is intentionally lightweight: no cloud inference, downloaded voice model, or recorded vocal sample is required. The implementation uses Web Audio and a source-filter approximation informed by classical speech/singing synthesis literature.

## Research basis

### Source-filter model

The voice is modeled as a glottal source filtered by vocal-tract resonances, followed by a lightweight approximation of lip radiation.

- Gunnar Fant's source-filter theory remains the base architecture.
- The local singer keeps source and vocal-tract parameters separate so voice quality can change without changing the generated melody.

### Glottal source

Earlier versions used a generic harmonic spectrum. Vocal v3 instead builds a periodic glottal pulse from explicit open-quotient and speed-quotient parameters, then derives the oscillator harmonics from that pulse.

This is still lighter than a full sample-by-sample LF solver, but it moves the source toward the LF/Rosenberg family of physiologically motivated glottal models while keeping iPhone Safari cost low.

References:
- Fant, Liljencrants & Lin glottal-flow/LF-model work.
- Perrotin, Feugère & d'Alessandro, "Perceptual equivalence of the Liljencrants-Fant and linear-filter glottal flow models", JASA 150(2), 1273 (2021), DOI: 10.1121/10.0005879.
- Degottex et al., mixed LF + noise source modeling for voice transformation and synthesis, Speech Communication 55(2), 278–294 (2013).

### Klatt formant synthesis

Dennis H. Klatt's cascade/parallel formant synthesizer motivates the time-varying resonator approach. SOUND WAVE uses five vowel formants with consonant-to-vowel transitions.

Reference: Dennis H. Klatt, "Software for a cascade/parallel formant synthesizer", JASA 67(3), 971–995 (1980), DOI: 10.1121/1.383940.

### Singing presence / singer's formant

A restrained presence branch around 2.85–3.05 kHz approximates the spectral concentration associated with singer's-formant research without trying to reproduce operatic technique.

Reference: Johan Sundberg, "Level and center frequency of the singer's formant", Journal of Voice 15(2), 176–186 (2001), DOI: 10.1016/S0892-1997(01)00019-4.

### Vibrato, jitter and shimmer

Measured singing vibrato commonly falls around 5–7 Hz, so each style uses a delayed vibrato within that range. Vocal v3 also adds small stochastic F0 perturbation (jitter) and amplitude perturbation (shimmer). The amounts are deliberately restrained so the result sounds humanized rather than unstable.

References:
- Ferrante, "Vibrato rate and extent in soprano voice: a survey on one century of singing", JASA 130(3), 1683–1688 (2011), DOI: 10.1121/1.3621017.
- Joint source-filter / glottal-source studies that explicitly model jitter and shimmer as part of human voice production.

## Implemented v3 model

- Glottal-pulse-derived 48-harmonic `PeriodicWave` with style-specific open quotient, speed quotient and spectral tilt.
- Five vowel formants with separate bandwidth/gain control.
- Consonant-to-vowel formant transitions for M/N/L/R/Y.
- ~3 kHz singing-presence branch.
- High-shelf lip-radiation approximation after the vocal-tract envelope.
- Delayed 5.15–5.85 Hz vibrato.
- Low-rate deterministic pitch drift plus stochastic jitter.
- Stochastic shimmer on source amplitude.
- Continuous aspiration, stronger at phrase starts and in AIRY style.
- Voiced nasal onsets for M/N and lightweight articulatory attacks for L/R/Y.
- Phrase boundaries for breath/release shaping.
- Legato/melisma continuation with short pitch glides from the previous note instead of hard re-triggering every pitch.
- Subtle 9–16 ms local doubling for body/width without external convolution or samples.
- Backing melody reduced to 16% level on vocal notes so the singer carries the pitch.

## Scope

This remains a procedural synthetic singer, not a neural singing-voice model, a downloaded voicebank, or a voice-cloning system. The design target is a clearly vocal and increasingly expressive synthetic singer that remains fully local and responsive in iPhone Safari.
