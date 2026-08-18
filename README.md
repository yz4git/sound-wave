# SOUND WAVE

A touch-first generative rhythm game where **music theory is the game system**, not just a source of note charts.

Instead of replaying a fixed score, the player steers musical tension, groove and harmonic direction in real time. Inputs can resolve, delay, diverge or intensify the current musical state. The engine evaluates timing, intentionality and musical coherence, then adapts the next challenge to player skill.

## Core design

The live musical state is modeled as:

- phase / beat position
- groove and syncopation
- harmonic function
- tension / resolution
- voice-leading distance
- note density
- energy

The target experience is a repeating curve of **prediction → surprise → tension → resolution**, with the challenge maintained slightly above the player's estimated skill.

## Gameplay pillars

1. **No fixed note chart** — rhythm prompts are generated from musical state.
2. **Theory as mechanics** — tonic, predominant, dominant, modal color, suspensions and deceptive resolution change play.
3. **Musical mistakes** — near-misses can be reinterpreted as syncopation, approach notes or tension rather than always becoming a dead MISS.
4. **Adaptive flow** — density, syncopation and polyrhythm increase or relax based on recent accuracy and stability.
5. **Roguelike harmony builds** — run modifiers reward specific musical behaviors and create different strategies.
6. **Touch-first** — designed for iPhone Safari landscape, Web Audio and Canvas rendering.

## Implementation phases

- Phase 0 — repository foundation and architecture
- Phase 1 — music theory / harmony state engine
- Phase 2 — rhythm generation and adaptive difficulty
- Phase 3 — Web Audio synthesis / transport
- Phase 4 — scoring, flow and gameplay state
- Phase 5 — playable Canvas + touch game shell
- Phase 6 — run modifiers and progression
- Phase 7 — iPhone/PWA hardening and tests

## Stack

TypeScript, Vite, Canvas 2D, Web Audio API, Vitest. No runtime backend is required.
