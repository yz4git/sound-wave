# SOUND WAVE

A touch-first generative rhythm game where **music theory is the game system**, not just a source of note charts.

Instead of replaying a fixed score, the player shapes musical tension, groove and harmony while controlling visible **PRESSURE WAVES** moving toward a central core. The same four musical intents — RESOLVE / DELAY / DIVERGE / INTENSIFY — are simultaneously musical decisions and real-time game actions.

## Playable now

The current `main` is an interactive game loop built for landscape iPhone Safari and desktop browsers:

- tap to unlock Web Audio and start a run
- read a generated circular rhythm field instead of a fixed chart
- watch musical PRESSURE WAVES approach the core through three converging lanes
- protect **STABILITY**; waves that reach the core damage it, break combo and reduce Flow
- reach 0% STABILITY and the run ends with **CORE COLLAPSED**, score/phrase result and one-tap restart
- use **RESOLVE / DELAY / DIVERGE / INTENSIFY** to change both the harmony and the pressure field
- only successful rhythm hits manipulate pressure; ECHO / OVERPLAY cannot spam the system
- higher TENSION increases musical payoff but also makes incoming pressure arrive faster
- hear distinct synthesized gestures for each intent plus chords, bass, percussion and Flow-driven extra layers
- build score from timing + musical coherence + surprise + resolution + pressure risk/reward
- touch-friendly timing windows target roughly ±30 ms PERFECT at the opening tempo, with wider GOOD and SYNCOPATED windows
- near misses can become **SYNCOPATED** instead of a binary miss
- repeated/empty input accumulates **OVERPLAY**, lowering Flow and later hit value
- every four bars the run pauses and offers up to three theory-driven mutations to choose from
- every eight bars form a **PHRASE** with a concrete objective; pressure goals include HOLD THE CORE and AMPLIFY → RELEASE
- clearing a phrase awards score, Flow, STABILITY recovery and a musical drop
- generated challenges can introduce syncopation and 3:4 / 5:4 polyrhythm as the player improves
- higher Flow adds musical layers and stronger accents so the arrangement itself becomes a reward
- PWA manifest, offline service worker, safe-area layout and portrait rotation guard are included

## Core loop

The intended moment-to-moment loop is:

1. **Read** the pulse and approaching pressure.
2. **Build** tension and reward with INTENSIFY when the field is safe.
3. **Buy time** with DELAY or **reroute** with DIVERGE when pressure becomes awkward.
4. **RESOLVE** at high tension to cash out amplified waves, restore some STABILITY and create the musical release.
5. Survive the phrase, choose a mutation and push the next phrase harder.

This keeps Sound Wave distinct from a normal note-hitting rhythm game: the player is not clearing a fixed chart, but continuously shaping the music into a controllable risk curve.

## Controls

| Action | Musical effect | Pressure effect |
| --- | --- | --- |
| RESOLVE | release toward tonic | clear 1–3 priority waves; high tension clears more and scores more |
| DELAY | suspend resolution | push the nearest wave back and buy time |
| DIVERGE | deceptive harmonic direction | reroute the nearest wave to another lane |
| INTENSIFY | drive toward dominant tension | amplify the nearest wave for more reward, but make it more dangerous |

Desktop keyboard: `← / ↓ / ↑ / →` or `A / S / D / F` in the same order. Mutation choices can also be selected with `1 / 2 / 3`.

## Game state

The live state models:

- beat / bar phase
- generated rhythm challenge
- harmonic function and chord state
- TENSION / resolution
- Flow / intentionality
- PRESSURE WAVES, lane, arrival time, risk and reward
- STABILITY and core danger
- adaptive player skill
- current phrase objective
- selected run mutations

The target experience is a repeating curve of **prediction → risk → surprise → tension → release**, with the difficulty adapting around player skill.

## Gameplay pillars

1. **No fixed note chart** — rhythm prompts are generated from musical state.
2. **Theory as mechanics** — harmonic choices directly alter both sound and game state.
3. **Pressure as music** — there are no conventional enemies; incoming musical pressure is the threat.
4. **Risk/reward tension** — high TENSION and amplified waves can produce larger releases, but become harder to control.
5. **Musical mistakes** — timing errors can be reframed as syncopation rather than always becoming dead misses.
6. **Intentional play** — blind subdivision spam creates OVERPLAY and cannot manipulate pressure repeatedly.
7. **Adaptive flow** — density, syncopation and polyrhythm evolve from player performance.
8. **Roguelike harmony builds** — player-chosen mutations reward different musical strategies.
9. **Phrase goals** — eight-bar objectives teach and test the pressure-control loop.
10. **Touch-first** — designed for iPhone Safari landscape, Web Audio and Canvas rendering.

## Architecture

- `src/core/music.ts` — scales, chords, harmonic function, tension, resolution and voice-leading
- `src/core/rhythm.ts` — adaptive rhythm generation, timing windows and polyrhythm
- `src/audio/SoundEngine.ts` — asset-free Web Audio synthesis, intent voices, Flow layers and drops
- `src/game/PressureSystem.ts` — deterministic three-lane pressure waves, STABILITY, breaches and four-intent pressure interaction
- `src/game/GameEngine.ts` — run state, scoring, pressure integration, phrases, transport and input judgement
- `src/game/RunModifiers.ts` — theory-based roguelike bonuses and deterministic mutation choices
- `src/game/Profile.ts` — validated local persistence
- `src/ui/Renderer.ts` — Canvas rhythm orbit, three-lane pressure field, core danger and intent feedback
- `src/main.ts` — only browser runtime entrypoint; touch/keyboard input, HUD, collapse/restart, audio lifecycle and PWA runtime
- `src/styles.css` — only application stylesheet, imported from `src/main.ts`

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
src/main.ts + src/**/*.ts + src/styles.css
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
- service-worker navigation stays network-first while hashed Vite assets are cache-first; the current cache generation is `sound-wave-v7-pressure`.

## Next high-value phases

The next priority is **live iPhone playtesting and balance tuning of the new pressure loop**: wave travel time, breach damage, STABILITY recovery, INTENSIFY risk/reward and RESOLVE payoff. After that, the strongest additions are pressure-specific mutation synergies, distinct pressure archetypes, phrase bosses, deeper harmonic/modal routes and richer procedural arrangement changes without losing touch responsiveness.
