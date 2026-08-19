# SOUND WAVE

A touch-first generative rhythm game where **music theory is the game system**, not just a source of note charts — now paired with **JAM LAB**, a touch performance playground built from the same sound-first identity.

Instead of replaying a fixed score, the player shapes musical tension, groove and harmony while controlling visible **PRESSURE WAVES** moving toward a central core. The same four musical intents — RESOLVE / DELAY / DIVERGE / INTENSIFY — are simultaneously musical decisions and real-time game actions.

## Playable now

The current `main` contains two top-level experiences built for landscape iPhone Safari and desktop browsers:

### WAVE GAME

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

### JAM LAB

JAM LAB is a separate performance mode, not a replacement for the game. Switching into it freezes the current WAVE GAME run and suspends the game audio; switching back resumes the same run.

- **DRUM MACHINE** — 16-step sequencer with KICK / SNARE / HI-HAT / CLAP
- each sequencer cell cycles **OFF → HIT → ACCENT → OFF**
- 60–180 BPM control, 0–35% SWING, clear and deterministic shuffle tools
- a usable starter groove is present immediately
- the sequencer pattern, tempo and swing persist locally
- **FINGER DRUM** — eight low-latency multi-touch pads: KICK / SNARE / HI-HAT / CLAP / LOW TOM / HIGH TOM / BASS / STAB
- **SAMPLER** — eight pads that load `audio/*` files from the device and play them with low-latency Web Audio
- sampler assignments are stored in IndexedDB on the device when available
- the drum machine may continue playing while the player switches to FINGER DRUM or SAMPLER, so live pads and user samples can be layered over the sequenced beat
- keyboard support: Q/W/E/R + A/S/D/F for finger drums, 1–8 for sampler, Space for drum-machine transport
- all Jam modes share a touch-first landscape layout with no external audio assets required

PWA manifest, offline service worker, safe-area layout and portrait rotation guard are included.

## WAVE GAME core loop

The intended moment-to-moment loop is:

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
10. **Performance freedom** — JAM LAB lets the same product work as an instrument when the player wants to create rather than survive.
11. **Touch-first** — designed for iPhone Safari landscape, Web Audio and Canvas rendering.

## Architecture

- `src/core/music.ts` — scales, chords, harmonic function, tension, resolution and voice-leading
- `src/core/rhythm.ts` — adaptive rhythm generation, timing windows and polyrhythm
- `src/audio/SoundEngine.ts` — WAVE GAME Web Audio synthesis, intent voices, Flow layers and drops
- `src/game/PressureSystem.ts` — deterministic three-lane pressure waves, STABILITY, breaches and four-intent pressure interaction
- `src/game/GameEngine.ts` — run state, scoring, pressure integration, phrases, transport and input judgement
- `src/game/RunModifiers.ts` — theory-based roguelike bonuses and deterministic mutation choices
- `src/game/Profile.ts` — validated local persistence
- `src/ui/Renderer.ts` — Canvas rhythm orbit, three-lane pressure field, core danger and intent feedback
- `src/jam/JamMachine.ts` — pure 16-step sequencer state, tempo/swing, persistence shape and pattern operations
- `src/jam/JamAudio.ts` — low-latency synthetic drum/pad voices and user sample playback
- `src/jam/JamLab.ts` — Jam UI controller, audio scheduler, multi-touch pads, IndexedDB sample persistence and mode switching inside JAM LAB
- `src/jam/jam.css` — Jam-specific touch layout and performance feedback
- `src/main.ts` — browser runtime entrypoint; WAVE GAME lifecycle plus top-level WAVE GAME / JAM LAB switching
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
- service-worker navigation stays network-first while hashed Vite assets are cache-first; the current cache generation is `sound-wave-v8-jam-lab`.

## Next high-value phases

For WAVE GAME, the next priority is live iPhone balance tuning of wave travel time, breach damage, STABILITY recovery, INTENSIFY risk/reward and RESOLVE payoff.

For JAM LAB, the strongest next additions are pattern banks, per-track mute/solo, sampler trim/start/end controls, microphone recording, quantized live recording from finger pads into the sequencer and exporting a performance as audio — without sacrificing low touch latency.
