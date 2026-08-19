# SOUND WAVE

A touch-first generative rhythm game where **music theory is the game system**, not just a source of note charts — now expanded with **JAM LAB** for free performance and **RHYTHM PLAY** for short, simple rhythm minigames.

Instead of replaying a fixed score, the player shapes musical tension, groove and harmony while controlling visible **PRESSURE WAVES** moving toward a central core. The same product can also be used as a beat-making instrument or as a collection of quick one/two-input rhythm challenges.

## Playable now

The current `main` contains three top-level experiences built for landscape iPhone Safari and desktop browsers:

### WAVE GAME

- tap to unlock Web Audio and start a run
- read a generated circular rhythm field instead of a fixed chart
- watch musical PRESSURE WAVES approach the core through three converging lanes
- protect **STABILITY**; waves that reach the core damage it, break combo and reduce Flow
- reach 0% STABILITY and the run ends with **CORE COLLAPSED**, score/phrase result and one-tap restart
- use **RESOLVE / DELAY / DIVERGE / INTENSIFY** to change both harmony and the pressure field
- only successful rhythm hits manipulate pressure; ECHO / OVERPLAY cannot spam the system
- higher TENSION increases musical payoff but also makes incoming pressure arrive faster
- build score from timing + musical coherence + surprise + resolution + pressure risk/reward
- every four bars choose a theory-driven mutation
- every eight bars form a PHRASE with a concrete objective

### JAM LAB

JAM LAB is a separate performance mode. Switching into it freezes the current WAVE GAME run and suspends the game audio; switching back resumes the same run.

- **DRUM MACHINE** — 16-step sequencer with KICK / SNARE / HI-HAT / CLAP
- each cell cycles **OFF → HIT → ACCENT → OFF**
- 60–180 BPM, 0–35% SWING, clear and deterministic shuffle tools
- pattern, tempo and swing persist locally
- **FINGER DRUM** — eight low-latency multi-touch pads
- **SAMPLER** — eight user-sample pads loaded from device audio files
- the sequencer may continue while switching to FINGER DRUM or SAMPLER, enabling layered live performance

### RHYTHM PLAY

RHYTHM PLAY is the simplest entry point: short 10–20 second minigames with only one or two actions and immediate timing feedback.

- **BEAT POP** — one-button game; tap when the orbiting pulse lands on the beat
- **ECHO PAIR** — listen to a four-hit LEFT / RIGHT call, then reproduce it as a response phrase
- **HOLD & RELEASE** — press on the HOLD cue, keep holding, then release exactly on the flash
- mobile-friendly PERFECT / GOOD / OK / MISS timing windows
- score, combo, timing accuracy and final **SUPERB / GREAT / OK / TRY AGAIN** rank
- deterministic call patterns for testability, but fresh pattern seeds during play
- touch vibration and low-latency synthesized feedback
- keyboard fallback for desktop play
- leaving RHYTHM PLAY freezes its current minigame; returning resumes from the same timing position

PWA manifest, offline service worker, safe-area layout and portrait rotation guard are included.

## WAVE GAME core loop

1. **Read** the pulse and approaching pressure.
2. **Build** tension and reward with INTENSIFY when the field is safe.
3. **Buy time** with DELAY or **reroute** with DIVERGE when pressure becomes awkward.
4. **RESOLVE** at high tension to cash out amplified waves, restore some STABILITY and create the musical release.
5. Survive the phrase, choose a mutation and push the next phrase harder.

This keeps Sound Wave distinct from a normal note-hitting rhythm game: the player is not clearing a fixed chart, but continuously shaping the music into a controllable risk curve.

## WAVE GAME controls

| Action | Musical effect | Pressure effect |
| --- | --- | --- |
| RESOLVE | release toward tonic | clear 1–3 priority waves; high tension clears more and scores more |
| DELAY | suspend resolution | push the nearest wave back and buy time |
| DIVERGE | deceptive harmonic direction | reroute the nearest wave to another lane |
| INTENSIFY | drive toward dominant tension | amplify the nearest wave for more reward, but make it more dangerous |

Desktop keyboard: `← / ↓ / ↑ / →` or `A / S / D / F` in the same order. Mutation choices can also be selected with `1 / 2 / 3`.

## Product pillars

1. **No fixed note chart** — WAVE GAME rhythm prompts are generated from musical state.
2. **Theory as mechanics** — harmonic choices directly alter both sound and game state.
3. **Pressure as music** — incoming musical pressure is the threat instead of conventional enemies.
4. **Risk/reward tension** — high TENSION and amplified waves can produce larger releases, but become harder to control.
5. **Musical mistakes** — timing errors can be reframed as syncopation rather than always becoming dead misses.
6. **Intentional play** — blind subdivision spam creates OVERPLAY and cannot manipulate pressure repeatedly.
7. **Performance freedom** — JAM LAB turns the product into an instrument.
8. **Immediate rhythm fun** — RHYTHM PLAY uses very small input vocabularies and short sessions.
9. **Touch-first** — designed for iPhone Safari landscape, Web Audio and Canvas/CSS rendering.

## Architecture

- `src/core/music.ts` — scales, chords, harmonic function, tension, resolution and voice-leading
- `src/core/rhythm.ts` — adaptive rhythm generation, timing windows and polyrhythm
- `src/audio/SoundEngine.ts` — WAVE GAME Web Audio synthesis, intent voices, Flow layers and drops
- `src/game/PressureSystem.ts` — deterministic three-lane pressure waves, STABILITY, breaches and four-intent pressure interaction
- `src/game/GameEngine.ts` — run state, scoring, pressure integration, phrases, transport and input judgement
- `src/game/RunModifiers.ts` — theory-based roguelike bonuses and deterministic mutation choices
- `src/game/Profile.ts` — validated local persistence
- `src/ui/Renderer.ts` — Canvas rhythm orbit, pressure field, core danger and intent feedback
- `src/jam/JamMachine.ts` — pure 16-step sequencer state, tempo/swing and persistence
- `src/jam/JamAudio.ts` — low-latency synthetic drum/pad voices and user sample playback; also reused by RHYTHM PLAY for lightweight cue voices
- `src/jam/JamLab.ts` — Jam UI controller, scheduler, multi-touch pads and IndexedDB sample persistence
- `src/rhythm/RhythmPlayEngine.ts` — pure minigame timelines, timing judgement, scoring and ranks
- `src/rhythm/RhythmPlay.ts` — Rhythm Play controller, cue scheduling, touch/hold/left-right input and result flow
- `src/rhythm/rhythm.css` — playful minigame presentation and iPhone landscape layout
- `src/main.ts` — browser runtime entrypoint and top-level WAVE GAME / JAM LAB / RHYTHM PLAY switching
- `src/styles.css` — main WAVE GAME stylesheet imported from `src/main.ts`

## Development

```bash
npm install
npm run dev
npm test
npm run build
npm run validate:prod
```

## Production / ChatGPT Sites

Production is **Vite-only**. Source files are never deployed as the runnable application.

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
- Use the generated `dist/` client artifact inside the Sites-compatible deployment artifact.
- `dist/index.html` must reference Vite-generated hashed JavaScript and CSS under `dist/assets/`.
- Production must never serve `/src/main.ts` directly.
- The old root `app.js` / root `styles.css` fallback runtime must not return.
- `npm run validate:prod` verifies Vite bundles, PWA files and absence of fallback-runtime references.
- service-worker navigation stays network-first while hashed Vite assets are cache-first; the current cache generation is `sound-wave-v9-rhythm-play`.

## Next high-value phases

For WAVE GAME, the next priority is live iPhone balance tuning of wave travel time, breach damage, STABILITY recovery, INTENSIFY risk/reward and RESOLVE payoff.

For JAM LAB, strong next additions are pattern banks, mute/solo, sampler trim, microphone recording, quantized live recording and audio export.

For RHYTHM PLAY, the strongest expansion is additional short minigames with new one/two-input ideas, a shuffled mini-game run, medals/best scores and adaptive tempo — while keeping every individual game instantly understandable.
