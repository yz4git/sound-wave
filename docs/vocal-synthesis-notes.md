# Local Vocal Synthesis Notes

SOUND WAVE's local singer is intentionally lightweight: no cloud inference, downloaded voice model, or recorded vocal sample is required. The implementation uses Web Audio and a source-filter approximation informed by classical speech/singing synthesis literature.

## Research basis

### Source-filter model

The voice is modeled as a harmonically rich glottal-like source filtered by vocal-tract resonances. The implementation uses a custom `PeriodicWave` with style-dependent spectral tilt, then a parallel bank of formant resonators.

- Gunnar Fant, acoustic theory/source-filter work on speech production.
- Oxford Phonetics source-filter overview: glottal vibration creates the voiced source and the vocal tract shapes its spectrum through resonances.

### Klatt formant synthesis

Dennis H. Klatt's 1980 cascade/parallel formant synthesizer describes time-varying formant parameters and resonator-based synthesis. SOUND WAVE uses the same broad idea in a Web Audio-friendly form: five time-varying formant bands plus separate aspiration/consonant components.

Reference: Dennis H. Klatt, "Software for a cascade/parallel formant synthesizer", Journal of the Acoustical Society of America 67(3), 971–995 (1980), DOI: 10.1121/1.383940.

### Glottal source shape

The Liljencrants-Fant (LF) family of glottal models is widely used to describe glottal flow. SOUND WAVE does not implement a full LF waveform because of browser/runtime cost; instead it uses an LF-inspired harmonically rich source with style-dependent spectral tilt and a stronger second harmonic.

Reference: Perrotin, Feugère & d'Alessandro, "Perceptual equivalence of the Liljencrants-Fant and linear-filter glottal flow models", JASA 150(2), 1273 (2021), DOI: 10.1121/10.0005879.

### Singing presence / singer's formant

Singing research describes a strong spectral envelope peak around 3 kHz, often associated with clustering of upper formants in classical singing. SOUND WAVE adds a restrained broad presence branch around 2.85–3.05 kHz rather than trying to reproduce an operatic voice exactly.

Reference: Johan Sundberg, "Level and center frequency of the singer's formant", Journal of Voice 15(2), 176–186 (2001), DOI: 10.1016/S0892-1997(01)00019-4.

### Vocal vibrato

Measured singing vibrato commonly falls around 5–7 Hz. SOUND WAVE uses style-dependent rates inside that range and deliberately smaller pitch extents than many classical measurements so the result remains suitable for electronic/pop-style backing.

References:
- Ferrante, "Vibrato rate and extent in soprano voice: a survey on one century of singing", JASA 130(3), 1683–1688 (2011), DOI: 10.1121/1.3621017.
- "Characterization of Source-Filter Interactions in Vocal Vibrato Using a Neck-Surface Vibration Sensor: A Pilot Study" (2022), which summarizes typical classically trained F0 vibrato rates around 5–7 Hz.

## Implemented v2 model

- 36-harmonic custom glottal-like source with spectral tilt.
- Five vowel formants with separate bandwidths and gains.
- Formant transitions during consonant onsets (`m/n/l/r/y`).
- Separate ~3 kHz singing-presence branch.
- Delayed 5.15–5.85 Hz vibrato with style-dependent pitch depth.
- Low-rate pitch drift and intensity modulation.
- Continuous aspiration noise, stronger for AIRY.
- Voiced nasal onsets for M/N and lightweight articulatory attacks for L/R/Y.
- Legato/melisma continuation: adjacent notes reuse the current vowel instead of replaying a consonant every pitch.
- Backing melody is ducked strongly on vocal steps so the singer, not a doubled synth, carries the pitch.

## Scope

This remains a lightweight procedural singer, not a neural singing-voice model and not an impersonation system. The design goal is a clearly vocal, expressive synthetic singer that runs locally and responsively in iPhone Safari.
