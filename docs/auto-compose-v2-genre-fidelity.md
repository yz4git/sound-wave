# AUTO COMPOSE v2 — Genre Fidelity Pass

This pass moves genre selection beyond scalar profile differences and gives each genre an arrangement grammar.

## J-POP

- verse → pre-chorus → chorus energy curve
- Royal-Road-oriented chorus harmony for mainstream/idol/anime profiles
- chorus register lift and stronger melodic density
- city pop uses offbeat chord stabs and root/fifth bass motion
- ballad uses sustained harmony, sparse drums and longer vocal phrases

## ROCK

- riff → verse → pre → chorus → break → chorus form
- root + fifth power-chord pulses
- eighth-note driving bass
- strong 2/4 backbeat and transition fills
- punk keeps power-pulse/eighth-drive almost throughout
- indie reduces drum density and returns to sustained/pulsed harmony

## K-POP

- verse → pre → drop → post-chorus → break → drop form for dance-oriented styles
- pre sections reduce kick energy and subdivide hats to build tension
- drop/post sections use offbeat chord stabs, syncopated sub/808-style bass and repeated hooks
- R&B pop lowers density while retaining syncopated bass/chord placement
- ballad switches to verse → pre → chorus form instead of forcing a drop

## GAME MUSIC

- motif → development → climax → turnaround → loop form
- motif memory can replay/transposed-replay melodic material against new chord roots
- battle/boss/racing use ostinato bass and denser percussion
- puzzle uses sparse drums and arpeggio pulses
- battle/JRPG/racing endings can lead with dominant harmony back into the loop tonic

## Shared engine changes

`GenreArrangement.ts` provides one `ArrangementBar` per generated bar with:

- section role
- energy
- melody/vocal/drum density scales
- register lift
- motif memory key + repeat probability
- chord pattern
- bass pattern
- transition-fill flag

`AutoComposer.ts` uses this plan for harmony, melody, motif reuse and drums.
`ComposeAudio.ts` renders the plan as sustained/pulsed/offbeat/power/arpeggio chord patterns plus root/fifth/eighth/syncopated/ostinato bass patterns.
`VocalGenerator.ts` follows section-level vocal density, melisma and phrase-energy behavior while keeping Vocal v20.x synthesis unchanged.

PWA cache generation: `sound-wave-auto-compose-v2-genre-fidelity`.
