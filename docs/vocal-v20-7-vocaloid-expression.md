# Vocal v20.7 — VOCALOID-Informed Score-Aligned Expression

This update does **not** copy or reimplement proprietary VOCALOID code. It adapts design principles described in public singing-synthesis literature to Sound Wave's existing procedural AudioWorklet singer.

## Sources used as design references

- Hideki Kenmochi, Hayato Ohshita, “VOCALOID — Commercial singing synthesizer based on sample concatenation”, INTERSPEECH 2007.
  - Describes score-driven sample selection/concatenation, pitch conversion and timbre manipulation.
  - Notes that sample timing is arranged so the vowel onset of a syllable is strictly at Note-On.
  - https://www.isca-archive.org/interspeech_2007/kenmochi07_interspeech.html
- Yamaha, explanation of the singing-synthesis invention used in VOCALOID (Japanese patent 4153220).
  - Describes separating sustained and transition portions and preserving transition material as much as possible while mainly transforming the sustained portion.
  - https://archive.yamaha.com/ja/news_release/2013/13051701.html
- Jordi Bonada, Alex Loscos, “Sample-based singing voice synthesizer by spectral concatenation”, SMAC 2003.
  - Describes phonetic articulation/stationary units plus low-level expression such as attacks, releases, note transitions and vibrato.
  - Describes spreading spectral discontinuities around transition frames rather than making a hard junction.
  - https://mtg.upf.edu/node/322
- Tomoyasu Nakano, Masataka Goto, “VocaListener2”.
  - Extends pitch/dynamics imitation with continuous timbre-change trajectories and spectral-envelope smoothing.
  - https://staff.aist.go.jp/t.nakano/PAPER/ICASSP201105nakano.pdf
- Yamaha VOCALOID:AI technology overview.
  - Describes timbre, pitch and timing deviation as learned singing features, including note connection and vibrato behaviour.
  - https://www.yamaha.com/ja/tech-design/research/technologies/aisynth/

## v20.7 implementation

### 1. Score-aligned consonant pre-roll

The existing Japanese phoneme model already contains closure, burst, frication and voicing-delay durations. v20.7 derives a bounded pre-roll from those values.

- vowel-only onset: `0 ms`
- articulated consonant: derived from closure/burst/frication or voicing delay
- safety maximum: `65 ms`
- moraic `N`: no artificial pre-roll

The AudioWorklet event is scheduled earlier by the pre-roll, while its duration is extended by exactly the same amount. The original note end therefore stays unchanged.

The practical goal is that consonantal preparation happens before the score beat and the vowel nucleus arrives around the original Note-On instead of making the whole syllable sound late.

### 2. Transition preservation

`VocaloidExpressionControl.transitionPreservation` keeps the initial articulation/transition region comparatively stable. Stronger resonance/timbre motion is reserved for long stationary vowels rather than being applied equally to every note boundary.

This follows the public VOCALOID description of preserving transition portions while transforming sustained portions more aggressively.

### 3. Sustain-weighted timbre motion

`VocaloidExpressionControl.sustainTimbreMotion` scales the existing v20.6 dynamic resonance controls.

- short articulated notes: reduced timbre motion
- long articulated notes: progressively more motion
- legato/melisma continuation: slightly more continuous motion

The existing v20.6 Harmonic–Formant Collision Guard and Dynamic Glottal Source remain intact.

### 4. Small time-context dynamics trajectory

Phrase starts and endings receive small deterministic energy scaling:

- phrase start: slightly softer onset
- sustained middle: near-neutral or a tiny rise on long notes
- phrase end: softer release

The magnitude is intentionally small so v20.5 pitch stability and the karaoke-score-inspired long-tone behaviour remain dominant.

### 5. Bounded spectral-envelope colour motion

A tiny upper-formant gain scale (`0.975..1.025`) is derived from phrase energy and distributed progressively toward the upper formants. This is a lightweight local approximation of time-varying timbre trajectories; it does not restore the removed fixed presence EQ.

## Preserved behaviour

v20.7 keeps:

- v20.1 Presence Reset
- v20.2 Anti-Crack
- v20.3 Register Continuity
- v20.4 Japanese phoneme timing and coarticulation
- v20.5 karaoke-score-inspired stable pitch/late vibrato
- v20.6 Dynamic Resonance & Glottal Control
- one continuous AudioWorklet glottal stream
- no remote inference and no voicebank download

## PWA cache

`sound-wave-v20-7-vocaloid-expression`
