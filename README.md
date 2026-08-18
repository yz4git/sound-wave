# SOUND WAVE

A touch-first generative rhythm game where **music theory is the game system**, not just a source of note charts.

Instead of replaying a fixed score, the player steers musical tension, groove and harmonic direction in real time. Inputs can resolve, delay, diverge or intensify the current musical state. The engine evaluates timing, intentionality and musical coherence, then adapts the next challenge to player skill.

## Playable now

The current `main` is an interactive MVP built for landscape iPhone Safari and desktop browsers:

- tap to unlock Web Audio and start the run
- read a generated circular rhythm field instead of a fixed chart
- use **RESOLVE / DELAY / DIVERGE / INTENSIFY** to change the harmony in real time
- hear synthesized chords, bass, percussion and action feedback with no external audio assets
- build score and combo from timing + musical coherence + surprise + resolution
- near misses can become **SYNCOPATED** instead of a binary miss
- each rhythm target scores only once; repeated input becomes a zero-score **ECHO**, preventing tap-spam exploits while still allowing harmonic expression
- player timing, syncopation, density, polyrhythm and stability skill estimates adapt during play and persist between sessions
- every four bars can unlock theory-driven run mutations such as `RESONANT RELEASE`, `OFFBEAT ENGINE`, `OVERDRIVE` and `POLY CORE`
- generated challenges can introduce syncopation and 3:4 / 5:4 polyrhythm as the player improves
- PWA manifest, offline service worker, safe-area layout and portrait rotation guard are included

## Controls

Touch:

| Action | Musical effect |
| --- | --- |
| RESOLVE | release harmonic tension toward tonic |
| DELAY | suspend the expected resolution |
| DIVERGE | choose a deceptive harmonic direction |
| INTENSIFY | drive toward dominant tension |

Desktop keyboard: `← / ↓ / ↑ / →` or `A / S / D / F` in the same order.

## Core design

The live musical state models:

- phase / beat position
- groove and syncopation
- harmonic function
- tension / resolution
- voice-leading distance
- note density
- energy

The target experience is a repeating curve of **prediction → surprise → tension → resolution**, with challenge maintained slightly above the player's estimated skill.

## Gameplay pillars

1. **No fixed note chart** — rhythm prompts are generated from musical state.
2. **Theory as mechanics** — tonic, predominant, dominant, modal color, suspensions and deceptive resolution change play.
3. **Musical mistakes** — timing errors can be reinterpreted musically instead of always becoming a dead MISS.
4. **Adaptive flow** — density, syncopation and polyrhythm increase or relax based on recent accuracy and stability.
5. **Roguelike harmony builds** — run modifiers reward specific musical behaviors and create different strategies.
6. **Touch-first** — designed for iPhone Safari landscape, Web Audio and Canvas rendering.

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

## Architecture

- `src/core/music.ts` — scales, chords, harmonic function, tension, resolution and voice-leading
- `src/core/rhythm.ts` — player skill model, seeded challenge generation, timing judgement and polyrhythm
- `src/audio/SoundEngine.ts` — asset-free Web Audio synthesis
- `src/game/GameEngine.ts` — deterministic gameplay state, scoring, transport and input judgement
- `src/game/RunModifiers.ts` — theory-based roguelike bonuses
- `src/game/Profile.ts` — validated local persistence
- `src/ui/Renderer.ts` — Canvas 2D rhythm orbit, harmonic wave field and feedback
- `src/main.ts` — the only browser runtime entrypoint; touch/keyboard input, audio lifecycle, PWA runtime and frame loop
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
- Only the generated `dist/` artifact should be used as the production site payload.
- `dist/index.html` must reference Vite-generated hashed JavaScript and CSS under `dist/assets/`.
- Production must never serve `/src/main.ts` directly.
- The temporary root `app.js` and root `styles.css` fallback runtime were removed; gameplay logic exists only in the TypeScript source tree.
- `npm run validate:prod` verifies that the built artifact contains Vite bundles, PWA files and no fallback-runtime references.
- The service worker uses network-first navigation plus cache-first hashed Vite assets, so a new deployment discovers new bundle names without keeping an old HTML shell indefinitely.

GitHub Actions runs tests, creates the production Vite build and validates the resulting `dist/` artifact on pushes to `main` and on pull requests.

## Stack

TypeScript, Vite, Canvas 2D, Web Audio API, Vitest. No runtime backend or external audio assets are required.

## Next high-value phases

The strongest next steps are device latency calibration, intentional modifier choice instead of automatic acquisition, deeper harmonic/modal routes, phrase-level goals/boss structures, richer synthesis, and live iPhone playtesting/tuning of timing windows and adaptive difficulty.
