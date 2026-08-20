# AUTO COMPOSE v2 — Genre Style Engine

AUTO COMPOSE v2 adds a two-level `GENRE → SUBGENRE` selector. The selection is not cosmetic: one profile controls composition, arrangement and vocal phrasing together while keeping generation deterministic and local.

## Initial genres

### J-POP
- 王道J-POP
- アイドルポップ
- アニソン系
- シティポップ
- バラード
- ロック寄りJ-POP

### ROCK
- POP ROCK
- ALTERNATIVE
- HARD ROCK
- PUNK
- EMO
- INDIE ROCK

### K-POP
- DANCE POP
- GIRL GROUP
- BOY GROUP
- R&B POP
- ELECTRO POP
- BALLAD

### GAME MUSIC
- JRPG
- BATTLE
- BOSS BATTLE
- RACING
- PUZZLE
- ADVENTURE

## What a style profile controls

Each `GenreStyleProfile` supplies:

- recommended BPM range
- density bias
- four-bar chord-degree candidate sets
- modal/color degree preferences
- melody density
- syncopation
- leap probability
- long-note probability
- kick/snare/hat/clap drive
- bass/chord/melody arrangement drive
- recommended vocal style (`warm`, `bright`, `airy`)
- vocal energy
- vocal articulation

The same seed remains deterministic for the same genre/subgenre and user settings.

## UI behavior

- `GENRE` selects a top-level family.
- `SUBGENRE` is repopulated from that genre.
- changing genre/subgenre moves BPM to the midpoint of the profile's recommended range.
- changing genre/subgenre selects the profile's recommended vocal timbre.
- BPM, density, key, mode and voice remain manually adjustable afterward.
- old v1 localStorage settings migrate to `J-POP / 王道J-POP` when no genre fields exist.

## Composition behavior

`AutoComposer.ts` reads the selected profile before generating:

- harmony candidates differ per four-bar phrase position
- strong beats still prefer chord tones
- weak/eighth/offbeat note probability is style-dependent
- melodic leap and long-note rates are style-dependent
- drum placement uses genre-family rules, with subgenre profile intensity values

Examples:

- ROCK emphasizes 8-beat hats, backbeat snare and shorter/stronger harmonic attacks.
- K-POP emphasizes dance kick placement, clap layering and syncopation.
- GAME MUSIC battle/racing profiles increase rhythmic subdivision and melodic activity.
- J-POP keeps clear vocal-centered backbeats and balanced melodic density.

## Arrangement behavior

`ComposeAudio.ts` uses the same profile for local Web Audio synthesis:

- chord attack/sustain and oscillator balance
- bass waveform/filter/level
- melody brightness/level
- kick/snare/hat/clap timbre
- vocal phrase energy and consonant articulation

Vocal v20.1 Presence Reset remains intact. Genre identity is not produced by restoring a fixed presence EQ boost.

## Vocal behavior

`VocalGenerator.ts` adapts:

- sung-note density
- offbeat vocal probability
- melisma probability
- phrase-gap behavior
- long-note extension probability

The existing v20 register continuity, Japanese phoneme/coarticulation, karaoke-score phrasing and v20.6 dynamic resonance/glottal model remain downstream of this style layer.

## PWA

Genre Style Engine generation uses cache generation:

`sound-wave-auto-compose-v2-genre-style-engine`
