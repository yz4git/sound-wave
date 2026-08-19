# SOUND WAVE

A touch-first generative rhythm game where **music theory is the game system**, not just a source of note charts.

Instead of replaying a fixed score, the player steers musical tension, groove and harmonic direction in real time. Inputs can resolve, delay, diverge or intensify the current musical state. The engine evaluates timing, intentionality and musical coherence, then adapts the next challenge to player skill.

## Playable now

The current `main` is an interactive MVP built for landscape iPhone Safari and desktop browsers:

- tap to unlock Web Audio and start the run
- read a generated circular rhythm field instead of a fixed chart
- use **RESOLVE / DELAY / DIVERGE / INTENSIFY** to change the harmony in real time
- hear distinct synthesized gestures for each intent plus chords, bass, percussion and flow-driven extra layers
- build score and combo from timing + musical coherence + surprise + resolution
- touch-friendly timing windows target roughly ±30 ms PERFECT at the opening tempo, with wider GOOD and SYNCOPATED windows
- near misses can become **SYNCOPATED** instead of a binary miss
- repeated/empty input accumulates **OVERPLAY**, lowering Flow and the value of later hits so subdivision spam cannot outperform intentional play
- each rhythm target scores only once; repeated input becomes **ECHO** / **OVERPLAY**
- player timing, syncopation, density, polyrhythm and stability skill estimates adapt during play and persist between sessions
- every four bars the run pauses and offers up to three theory-driven mutations to choose from
- every eight bars form a **PHRASE** with a concrete objective and clear/miss result; clearing a phrase awards score, Flow and a musical drop
- generated challenges can introduce syncopation and 3:4 / 5:4 polyrhythm as the player improves
- higher Flow adds musical layers and stronger accents so the arrangement itself becomes a reward
- PWA manifest, offline service worker, safe-area layout and portrait rotation guard are included

## Controls

Touch:

| Action | Musical effect |
| --- | --- |
| RESOLVE | release harmonic tension toward tonic |
| DELAY | suspend the expected resolution |
| DIVERGE | choose a deceptive harmonic direction |
| INTENSIFY | drive toward dominant tension |

Desktop keyboard: `← / ↓ / ↑ / →` or `A / S / D / F` in the same order. Mutation choices can also be selected with `1 / 2 / 3`.

## Core design

The live musical state models:

- phase / beat position
- groove and syncopation
- harmonic function
- tension / resolution
- voice-leading distance
- note density
- energy
- Flow / intentionality pressure
- current phrase objective
- selected run mutations

The target experience is a repeating curve of **prediction → surprise → tension → resolution**, with challenge maintained slightly above the player's estimated skill.

## Gameplay pillars

1. **No fixed note chart** — rhythm prompts are generated from musical state.
2. **Theory as mechanics** — tonic, predominant, dominant, modal color, suspensions and deceptive resolution change play.
3. **Musical mistakes** — timing errors can be reinterpreted musically instead of always becoming a dead MISS.
4. **Intentional play** — blind subdivision spam creates OVERPLAY and loses Flow/value.
5. **Adaptive flow** — density, syncopation and polyrhythm increase or relax based on recent accuracy and stability.
6. **Roguelike harmony builds** — player-chosen run modifiers reward different musical behaviors.
7. **Phrase goals** — eight-bar objectives turn freeform music shaping into a run with clear short-term purpose.
8. **Touch-first** — designed for iPhone Safari landscape, Web Audio and Canvas rendering.

## Implemented phases

- Phase 0 — repository foundation and architecture
- Phase 1 — music theory / harmony state engine + tests
- Phase 2 — seeded rhythm generation + adaptive difficulty + tests
- Phase 3 — Web Audio synthesis engine
- Phase 4 — scoring / flow / gameplay state + tests
- Phase 5 — playable Canvas rhythm field + touch controls
- Phase 6 — music-theory run modifiers and four-bar progression
- Phase 7 — iPhone/PWA hardening + GitHub Actions CI
- Phase 8 — tempo-safe bar transport + persistent adaptive player profile
- Phase 9 — one-target/one-score anti-spam judgement + ECHO behavior
- Phase 10 — Vite-only production pipeline and Sites deployment hardening
- Phase 11 — mobile timing windows, OVERPLAY anti-spam pressure, eight-bar phrase goals and three-choice mutation draft
- Phase 12 — intent-specific synthesis, Flow-driven arrangement layers and phrase-clear drop feedback

## Architecture

- `src/core/music.ts` — scales, chords, harmonic function, tension, resolution and voice-leading
- `src/core/rhythm.ts` — player skill model, seeded challenge generation, mobile timing windows and polyrhythm
- `src/audio/SoundEngine.ts` — asset-free Web Audio synthesis, intent voices, Flow layers and drops
- `src/game/GameEngine.ts` — gameplay state, scoring, intentionality pressure, phrases, transport and input judgement
- `src/game/RunModifiers.ts` — theory-based roguelike bonuses and deterministic mutation choices
- `src/game/Profile.ts` — validated local persistence
- `src/ui/Renderer.ts` — Canvas 2D rhythm orbit, harmonic wave field and feedback
- `src/main.ts` — the only browser runtime entrypoint; touch/keyboard input, mutation UI, audio lifecycle, PWA runtime and frame loop
- `src/styles.css` — the only application stylesheet, imported from `src/main.ts`

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

The canonical pipeline is:

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
- Only the generated `dist/` artifact should be used as the production client payload inside the Sites-compatible deployment artifact.
- `dist/index.html` must reference Vite-generated hashed JavaScript and CSS under `dist/assets/`.
- Production must never serve `/src/main.ts` directly.
- The temporary root `app.js` and root `styles.css` fallback runtime were removed; gameplay logic exists only in the TypeScript source tree.
- `npm run validate:prod` verifies that the built artifact contains Vite bundles, PWA files and no fallback-runtime references.
- The service worker uses network-first navigation plus cache-first hashed Vite assets, so a new deployment discovers new bundle names without keeping an old HTML shell indefinitely.

GitHub Actions runs tests, creates the production Vite build and validates the resulting `dist/` artifact on pushes to `main` and on pull requests.

## Stack

TypeScript, Vite, Canvas 2D, Web Audio API, Vitest. No runtime backend or external audio assets are required.

## Next high-value phases

The strongest next steps are live iPhone playtesting/tuning, optional device latency calibration, deeper harmonic/modal routes, phrase bosses and longer-run structure, richer mutation synergies, and more advanced procedural arrangement changes without losing touch responsiveness.
