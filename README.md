# SOUND WAVE

A touch-first generative music game and performance playground where **music theory is the system**, not just a source of fixed note charts.

The title screen exposes four first-class experiences: **WAVE GAME / JAM LAB / RHYTHM PLAY / AUTO COMPOSE**. Leaving any experience returns to TITLE, so mode selection stays simple on iPhone landscape.

## Playable now

### WAVE GAME

- generated circular rhythm challenges rather than a fixed chart
- visible PRESSURE WAVES approach a central core through three lanes
- protect STABILITY and avoid CORE COLLAPSED
- RESOLVE / DELAY / DIVERGE / INTENSIFY alter both harmony and pressure
- higher TENSION increases musical payoff and pressure risk
- scoring combines timing, coherence, surprise, resolution and risk/reward
- theory-driven mutation choices every four bars
- eight-bar PHRASE objectives and musical drops

### JAM LAB

- **DRUM MACHINE** — 16-step KICK / SNARE / HI-HAT / CLAP sequencer
- OFF → HIT → ACCENT cells, 60–180 BPM and 0–35% SWING
- local pattern/tempo/swing persistence
- **FINGER DRUM** — eight low-latency multi-touch pads
- **SAMPLER** — eight user-sample pads loaded from device audio files
- sequencer playback can continue while finger-drumming or sampling

### RHYTHM PLAY

Short, instantly understandable 10–20 second rhythm minigames:

- **BEAT POP** — one-button pulse timing
- **ECHO PAIR** — listen to LEFT / RIGHT then reproduce the phrase
- **HOLD & RELEASE** — press, hold and release on the cue
- PERFECT / GOOD / OK / MISS timing feedback
- score, combo, timing accuracy and SUPERB / GREAT / OK / TRY AGAIN ranks

### AUTO COMPOSE

AUTO COMPOSE creates an eight-bar piece **entirely on-device**. It does not call a cloud model, remote generation API or remote voice service.

Controls:

- choose KEY from all 12 pitch classes
- choose MAJOR / MINOR / DORIAN / PHRYGIAN / MIXOLYDIAN
- set 60–180 BPM
- set melodic/rhythmic DENSITY
- toggle locally synthesized VOCAL ON/OFF
- choose WARM / BRIGHT / AIRY vocal timbre
- REGENERATE changes the local seed and immediately creates new music and a new vocal phrase
- PLAY / STOP uses Web Audio lookahead scheduling

Generated layers:

- **Harmony** — scale-derived triads follow a tonic → predominant → dominant → resolution tension curve
- **Voice leading** — candidate chords are scored to reduce unnecessary pitch movement while still allowing modal color tones
- **Melody** — strong beats prefer chord tones; weaker subdivisions use nearby scale tones
- **Bass** — follows generated chord roots and reinforces phrase structure
- **Drums** — locally generated kick/snare/hat/clap pattern follows meter and density
- **Vocal v2** — selected melody notes become deterministic sung syllables. A 36-harmonic glottal-like source is shaped by five vowel formants, a restrained ~3 kHz singing-presence branch, delayed 5–7 Hz vibrato, low-rate pitch/intensity drift, aspiration and consonant-specific onsets. Adjacent notes may continue as vowel-only melisma instead of re-articulating the consonant on every pitch.
- the backing melody is heavily ducked on vocal steps so the singer, rather than a doubled synth, carries the melodic line
- the final bar always returns to tonic so the eight-bar phrase has a clear resolution

The vocal system remains deliberately lightweight and local: it is a stylized source-filter singing synthesizer, not a downloaded neural voice model and not voice cloning. The implementation direction is documented in `docs/vocal-synthesis-notes.md`, with references to Klatt formant synthesis, source-filter/glottal-source work, singer's-formant research and vocal-vibrato measurements.

The UI shows vocal-note markers and the syllable currently being sung. Vocal settings persist locally when browser storage is available. The UI also displays the generated chord progression, current harmonic function, melody piano-roll-style events and live playback position.

## WAVE GAME core loop

1. **Read** pulse and approaching pressure.
2. **Build** tension and reward with INTENSIFY when safe.
3. **Buy time** with DELAY or **reroute** with DIVERGE.
4. **RESOLVE** at high tension to cash out amplified waves and restore STABILITY.
5. Survive the phrase, choose a mutation and push the next phrase harder.

## Product pillars

1. **Theory as mechanics** — harmonic function, tension and resolution affect play directly.
2. **No mandatory fixed chart** — WAVE GAME and AUTO COMPOSE generate their musical material locally.
3. **Pressure as music** — WAVE GAME turns harmonic tension into the threat.
4. **Performance freedom** — JAM LAB works as an instrument.
5. **Immediate rhythm fun** — RHYTHM PLAY uses tiny input vocabularies and short sessions.
6. **Local generation** — AUTO COMPOSE is deterministic/seeded TypeScript + Web Audio, including local source-filter vocal synthesis, with no server dependency.
7. **Touch-first** — designed for landscape iPhone Safari, safe areas and low-latency Web Audio.

## Architecture

- `src/core/music.ts` — scales, chords, harmonic function, tension, resolution and voice-leading
- `src/core/rhythm.ts` — adaptive rhythm generation, timing windows and polyrhythm
- `src/audio/SoundEngine.ts` — WAVE GAME synthesis
- `src/game/PressureSystem.ts` — pressure waves, STABILITY and four-intent interaction
- `src/game/GameEngine.ts` — run state, scoring, phrases, transport and input judgement
- `src/jam/JamMachine.ts` — 16-step sequencer state and pattern operations
- `src/jam/JamAudio.ts` — Jam/Rhythm Play low-latency voices and sample playback
- `src/jam/JamLab.ts` — Jam controller, scheduler and sample persistence
- `src/rhythm/RhythmPlayEngine.ts` — pure minigame timelines, judgement, scoring and ranks
- `src/rhythm/RhythmPlay.ts` — Rhythm Play browser controller
- `src/compose/AutoComposer.ts` — deterministic theory-based harmony, melody and rhythm generator
- `src/compose/VocalGenerator.ts` — deterministic melody-to-syllable phrasing plus melisma/articulation decisions
- `src/compose/VocalModel.ts` — research-informed glottal-like harmonic source, vowel formants, vibrato and style parameters
- `src/compose/ComposeAudio.ts` — chord/bass/melody/drum engine plus local source-filter singing synthesis
- `src/compose/AutoComposeMode.ts` — Auto Compose controls, vocal controls, visualization and lookahead transport
- `src/compose/compose-vocal.css` — vocal controls, syllable status and vocal-note visualization
- `docs/vocal-synthesis-notes.md` — research references and implementation rationale for the local singer
- `src/title.css` — four-mode title selection and in-mode TITLE return control
- `src/main.ts` — single browser runtime entrypoint and title/mode lifecycle

## Development

```bash
npm install
npm run dev
npm test
npm run build
npm run validate:prod
```

## Production / ChatGPT Sites

Production remains **Vite-only**:

```text
src/main.ts + src/**/*.ts + src/**/*.css
                ↓
            Vite build
                ↓
   dist/index.html + dist/assets/*
                ↓
          ChatGPT Sites
```

Rules:

- `npm run build` must succeed before deployment.
- production must use Vite-generated hashed JavaScript/CSS assets
- production must never serve `/src/main.ts` directly
- the deleted root `app.js` / root `styles.css` fallback runtime must not return
- `npm run validate:prod` verifies the production artifact
- service-worker navigation is network-first while hashed Vite assets are cache-first
- current cache generation: `sound-wave-v12-vocal-v2`