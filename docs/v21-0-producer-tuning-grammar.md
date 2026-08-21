# Vocal v21.0 — Producer Tuning Grammar

## Goal

Translate practical VOCALOID-producer tuning habits into deterministic, lightweight rules that work with Sound Wave's local continuous AudioWorklet singer.

The goal is not to imitate any individual producer or copy a proprietary VOCALOID algorithm.  The implementation combines public VOCALOID documentation, public producer interviews, and common tuning practices into bounded controls that preserve the stability improvements from v20.1–v20.9.

## Practical findings applied

### Separate controls instead of one global "naturalness" knob

VOCALOID documentation exposes consonant length (Velocity), Dynamics, Pitch Bend, Air/Breathiness, Mouth, Attack, Expression/Power and timing as distinct controls.  v21.0 mirrors that separation instead of adding a global presence/EQ layer.

### Consonants and note timing need independent treatment

Producer interviews and VOCALOID documentation repeatedly point to consonant timing, phrase timing and Japanese-specific details such as small-tsu handling as areas that require manual attention.  v21.0 therefore adds a small role-aware consonant lead and scales closure/frication/VOT separately from the score note duration.

The original musical Note-Off remains fixed.

### Ornaments should be selective

Practical tuning guides commonly recommend using scoops, note splits and tail accents only where they help the phrase.  v21.0 uses a deterministic selector so only a subset of phrase heads/tails receive extra scoop/fall depth.

### Long notes carry more expression than passing notes

Long tones receive slightly more vibrato.  Short notes stay straighter and more pitch-stable, preserving the karaoke-score-inspired baseline.

### Dynamics are phrase-shaped

Phrase heads receive a small dynamic lift, while phrase ends generally relax.  Hook/climax regions inferred from the current 8-bar arrangement grammar receive a small additional lift.

### Air and attack are automated independently

Phrase starts, phrase ends and sparse sections receive small Air changes.  Rock/K-pop biases use a faster attack; ballads use more Air.

### Genre biases stay bounded

The controller contains conservative J-pop, Rock, K-pop and Game Music biases for consonant length, attack, Air, ornament probability, vibrato and pitch micro-instability.  The current bridge uses a J-pop-safe default; the API is ready to receive explicit Genre Style / Arrangement context later without changing the DSP contract.

## Implementation

### `src/compose/ProducerTuning.ts`

Per-note controls:

- `timingLeadSeconds`
- `consonantLengthScale`
- `dynamicsStartScale`
- `dynamicsEndScale`
- `attackTimeScale`
- `airScale`
- `mouthScale`
- `articulationScale`
- `scoopCentsAdd`
- `fallCentsAdd`
- `vibratoScale`
- `jitterScale`
- `vocalPocket`
- semantic role (`plain`, `phrase-head`, `long-tone`, `phrase-tail`, `hook`)

### Bridge mapping

`VocalWorkletBridge` maps the producer controls into existing v20.x systems:

- consonant closure/frication/VOT timing
- v20.7 consonant pre-roll
- karaoke scoop/fall/vibrato
- phrase energy contour
- breath/Air
- attack time
- tiny F1/F2 mouth-opening proxy
- consonant articulation/noise
- jitter amount

No second oscillator or external sample is introduced.

## Stability rules

- scoop addition <= 5.5 cents from this layer
- fall addition <= 3.5 cents from this layer
- total bridge scoop/fall remain hard-clamped
- producer jitter never exceeds the existing style jitter baseline by more than 5%
- timing lead <= 12 ms beyond the existing phoneme pre-roll
- Note-Off remains unchanged
- F1/F2 mouth shift <= about 3.5%
- Presence Reset remains `presenceGain: 0`

## Preserved systems

v21.0 preserves:

- v20.1 Presence Reset
- v20.2 Anti-Crack
- v20.3 Register Continuity
- Japanese phoneme timing/coarticulation
- karaoke-score pitch stability and late vibrato
- v20.6 Dynamic Resonance & Glottal Control
- v20.7 score-aligned consonant pre-roll
- v20.8 Spectral Envelope Trajectory
- v20.9 Dynamic Source–Filter Coupling
- one continuous AudioWorklet glottal source
