# Vocal v20.9 — Dynamic Source–Filter Coupling

## Goal

Make the existing procedural singer behave less like an independent oscillator plus static resonators and more like a coupled voice-production system, while preserving the stability improvements from v20.1–v20.8.

v20.9 does **not** add a second vocal source or a new presence EQ. It computes a conservative source/filter interaction plan per vocal event and maps it into the existing continuous AudioWorklet controls.

## Literature direction

The design follows public source–filter interaction literature, especially work by Ingo Titze and collaborators:

- Titze, *Theory of Glottal Airflow and Source-Filter Interaction in Speaking and Singing* (Acta Acustica, 2004).
- Titze, *Nonlinear source–filter coupling in phonation: Theory* (JASA 123(5), 2008), DOI 10.1121/1.2832337.
- Titze & Story, *Acoustic interactions of the voice source with the lower vocal tract* (JASA 101(4), 1997), DOI 10.1121/1.418246.

These works describe how vocal-tract impedance can shape glottal flow and efficiency, but also note possible instabilities when F0/harmonics cross formants. Sound Wave therefore uses deliberately bounded coupling and reduces feedback as F0 rises.

## Implementation

### `src/compose/VocalSourceFilterCoupling.ts`

Per-note controls:

- `tractFeedbackDepth` — bounded F1/F2 feedback contribution into the existing source–tract coupling path.
- `sourceTiltDepth` — increases glottal softening for open vowels and high F0.
- `openQuotientOffset` — vowel/energy/release-dependent glottal-open adjustment.
- `speedQuotientOffset` — energy/release-dependent glottal speed adjustment.
- `aspirationCoupling` — links open/release phonation to breath/aspiration depth.
- `highPitchCompensation` — progressively suppresses feedback and excessive resonance at high F0.
- `filterLoad` — vowel-dependent load used to slightly broaden/soften the filter response.
- `spectralCouplingDepth` — couples v20.8 spectral-envelope motion back into source-shaping intensity.

### Vowel openness

The five current vowels use a conservative openness proxy:

- `a`: 1.00
- `o`: 0.76
- `e`: 0.62
- `u`: 0.42
- `i`: 0.28

This affects source tilt, open quotient, filter load, and aspiration, not pitch.

### High-F0 safety

As target F0 rises:

- `highPitchCompensation` increases,
- `tractFeedbackDepth` decreases,
- source softening increases,
- resonance gain motion and vibrato-resonance coupling are reduced slightly.

This is intentionally aligned with v20.2 Anti-Crack and v20.3 Register Continuity rather than maximising acoustic feedback.

### Source shaping

The bridge maps the control into the existing AudioWorklet parameters:

- `glottalOpenQuotient`
- `glottalSpeedQuotient`
- `breathLevel`
- `phrase.sourceTractCoupling`

No new per-sample oscillator or expensive physical solver is introduced.

### Filter shaping

The same control also influences:

- v20.8 `spectralTiltDepth`
- v20.8 `trajectoryDepth`
- `frequencySmoothing`
- resonance `bandwidthMotion`
- resonance `gainMotion`
- upper-formant gain by a small vowel-dependent load

This makes source and filter respond to the same vocal state rather than evolving independently.

## Preserved safeguards

v20.9 preserves:

- Presence Reset (`presenceGain: 0`)
- one continuous AudioWorklet glottal stream
- anti-crack finite/peak protection
- register continuity
- Japanese phoneme timing/coarticulation
- nasal anti-formant
- Harmonic–Formant Collision Guard
- karaoke-score pitch stability and late vibrato
- v20.7 consonant pre-roll and score-aligned Note-Off
- v20.8 spectral-envelope trajectory and gap reset

The implementation deliberately avoids a strong nonlinear feedback loop because the current five-formant real-time model is not a full physical vocal-tract impedance solver.
