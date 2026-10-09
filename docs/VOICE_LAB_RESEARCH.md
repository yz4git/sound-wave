# VOICE LAB research notes

VOICE LAB is Sound Wave's speech-synthesis-first mode. It reuses the project's local vocal DSP stack while separating speech control into **content**, **prosody**, and **timbre**.

## 2025–2026 synthesis directions considered

### Low-latency streaming

Recent streaming TTS work increasingly optimizes time-to-first-audio by generating speech in blocks rather than waiting for a full utterance. A 2026 ultra-low-latency architecture combines block-wise generation with neural-codec decoding and reports sub-50 ms time-to-first-byte in its evaluation.

Reference:
- Su et al., *An Ultra-Low Latency, End-to-End Streaming Speech Synthesis Architecture via Block-Wise Generation and Depth-Wise Codec Decoding* (2026): https://arxiv.org/abs/2604.12438

VOICE LAB maps this idea to the browser by planning phonetic units quickly and scheduling them directly into an AudioWorklet stream with a short start lead.

### Explicit prosody control

DrawSpeech demonstrates a useful interaction idea: coarse user-specified pitch/energy sketches can control fine-grained speech prosody rather than relying only on a reference recording or a text style description.

Reference:
- Chen et al., *DrawSpeech: Expressive Speech Synthesis Using Prosodic Sketches as Control Conditions* (2025): https://arxiv.org/abs/2501.04256

VOICE LAB exposes an intonation contour and previews the resulting pitch shape before playback.

### Factorized speech representation

Recent codec/flow systems increasingly model speech attributes separately. DiFlow-TTS explicitly factorizes prosodic and acoustic attributes, while other speech-language-model work gives prosody a more explicit token representation.

References:
- Nguyen et al., *DiFlow-TTS: Discrete Flow Matching with Factorized Speech Tokens for Low-Latency Zero-Shot Text-To-Speech* (2025): https://arxiv.org/abs/2509.09631
- *PROSODYLM* discussion in COLM 2025 proceedings: https://openreview.net/pdf/6a359ebba5a3de8baa31631883a6b21c9cbc97a3.pdf

VOICE LAB follows the same product-level separation:
- CONTENT: text -> mora/phoneme timing
- PROSODY: phrase contour, duration, pitch and energy
- TIMBRE: source-filter voice character and formant shaping

### Flow matching / non-autoregressive TTS

Flow-matching TTS such as F5-TTS shows that high-quality speech generation can be organized around efficient non-autoregressive generation rather than only token-by-token autoregression.

Reference:
- *F5-TTS: A Fairytaler that Fakes Fluent and Faithful Speech with Flow Matching*: https://openreview.net/pdf?id=JiX2DuTkeU

VOICE LAB does not ship a large neural checkpoint yet. The current engine keeps the UI and data model compatible with a future WebGPU flow/codec backend.

### Browser-local speech models

By 2025, full neural TTS models such as Kokoro had been demonstrated running locally in a browser with WebGPU, showing that server-free neural synthesis is practical on capable hardware.

Reference:
- Kokoro WebGPU browser demo announcement: https://huggingface.co/posts/Xenova/620657830533509

Sound Wave's current custom engine remains much smaller and starts immediately on mobile. A future WebGPU backend should be optional so iPhone memory/startup cost does not become a requirement for the mode.

## Current engine

The Sound Wave DSP engine is fully local and contains no bundled voice recording, voicebank, cloned speaker model, or remote synthesis API. It uses:

- kana/katakana/romaji phonetic parsing
- consonant and mora timing
- dynamic source-filter coupling
- five-formant trajectories
- phrase energy and vowel centering
- spectral-envelope motion
- voice-character macros
- low-latency AudioWorklet scheduling
- real-time local WAV capture

For arbitrary Japanese text containing kanji, VOICE LAB also offers the browser/OS System TTS as a separate fallback. System voice availability and implementation vary by device.


### Japanese mora-level prosody and natural speech timing

A 2025 NICT/ICASSP system predicts Japanese fundamental frequency at the **mora level** from text and katakana rather than relying only on hand-authored accent labels. This supports treating mora-by-mora F0 as a first-class control signal in VOICE LAB instead of quantizing spoken pitch to sung semitone notes.

Reference:
- Ogura et al., *Mora-Level Prosody Prediction for Text-to-Speech Using Japanese BERT Without Accentual Labels* (ICASSP 2025): https://ast-astrec.nict.go.jp/demo_samples/bert_tts_icassp2025/

Recent expressive Japanese TTS evaluation also highlights pitch-accent sensitivity as a major determinant of naturalness and intelligibility.

Reference:
- Rackauckas & Hirschberg, *Benchmarking Expressive Japanese Character Text-to-Speech with VITS and Style-BERT-VITS2* (2025): https://arxiv.org/abs/2505.17320

VOICE LAB therefore uses:
- continuous fractional-mora F0 rather than integer semitone speech
- accent-phrase resets with local rise/declination
- phrase-final lowering and question rises
- consonant-conditioned microprosody
- longer sentence pauses than accent-phrase pauses

### Japanese high-vowel devoicing

Japanese /i/ and /u/ commonly devoice in voiceless consonant environments. Classic phonetic work and later corpus analysis show that this is not just generic volume reduction: the high-vowel mora can undergo substantial temporal compression and glottal overlap while preserving the rhythmic structure needed for intelligibility.

References:
- Kondo, *Mechanisms of vowel devoicing in Japanese*: https://www.isca-archive.org/icslp_1994/kondo94_icslp.html
- Shaw & Kawahara, *Durational Evidence That Tokyo Japanese Vowel Devoicing Is Not Gradient Reduction* (2019): https://pmc.ncbi.nlm.nih.gov/articles/PMC6476939/

VOICE LAB applies conservative devoicing only to isolated candidate morae. It reduces periodic voicing, increases aspiration/noise, shortens the mora, and avoids fully suppressing adjacent eligible morae.


### Three-axis prosody editing: pitch, energy, duration

Interspeech 2025 Japanese GST-BERT-TTS extends accent-label-free prosody prediction beyond log-F0 to **energy and duration**, explicitly treating all three as useful speech-generation controls.

Reference:
- Ogura et al., *GST-BERT-TTS: Prosody Prediction Without Accentual Labels For Multi-Speaker TTS Using BERT With Global Style Tokens* (Interspeech 2025): https://www.isca-archive.org/interspeech_2025/ogura25_interspeech.html

This aligns with broader controllable-TTS work where interpretable prosody is represented through pitch, energy, and duration rather than a single opaque style value. ProMode also reports benefits from modeling F0 and energy explicitly, while 2025 work on stochastic prosody modeling continues to use explicit pitch/energy/duration parameters for controllability.

References:
- Eren et al., *ProMode: A Speech Prosody Model Conditioned on Acoustic and Textual Inputs* (Interspeech 2025): https://www.isca-archive.org/interspeech_2025/eren25_interspeech.html
- Mayer et al., *Investigating Stochastic Methods for Prosody Modeling in Speech Synthesis* (Interspeech 2025): https://www.isca-archive.org/interspeech_2025/mayer25_interspeech.html

VOICE LAB therefore exposes three independent mora-level drawing lanes:
- PITCH: continuous F0 offset
- ENERGY: local speech intensity / phrase-energy scale
- TIMING: local mora-duration scale that also shifts following mora start times

The automatic Japanese prosody remains underneath these edits, so manual drawing acts as a correction or expressive layer instead of replacing accent-phrase timing entirely.


### Speaking-style presets as interpretable prosody layers

Recent expressive-TTS work increasingly separates a high-level speaking style from the interpretable prosodic controls that actually realize it. Interspeech 2025 work on EME-TTS connects emotional expression with local emphasis, while Lina-Style demonstrates local word-level style control and independent style-intensity control. A 2026 causal-prosody study explicitly treats emotion as acting through duration, pitch, and energy rather than as an opaque waveform-level switch.

References:
- Li et al., *EME-TTS: Unlocking the Emphasis and Emotion Link in Speech Synthesis* (Interspeech 2025): https://www.isca-archive.org/interspeech_2025/li25i_interspeech.html
- Lemerle et al., *Lina-Style: Word-Level Style Control in TTS via Interleaved Synthetic Data* (SSW 2025): https://www.isca-archive.org/ssw_2025/lemerle25_ssw.html
- Mohanty, *Causal Prosody Mediation for Text-to-Speech: Counterfactual Training of Duration, Pitch, and Energy in FastSpeech2* (2026): https://arxiv.org/abs/2603.11683

VOICE LAB follows that interaction model with high-level DELIVERY presets that are converted into explicit DSP/prosody changes:
- NEUTRAL: preserves the automatic Japanese prosody model
- CALM: narrower pitch range, lower energy, longer morae, softer attacks
- EXCITED: higher pitch/range, stronger energy, shorter morae, faster attacks
- SERIOUS: lower/darker pitch placement, firmer articulation, reduced breath
- WHISPER: reduced periodic voicing, increased aspiration/noise, lower energy
- NARRATION: restrained pitch movement, slightly longer phrase-final timing, stable energy

Each preset has a continuous STYLE INTENSITY control. The preset forms the base layer; mora-level PITCH / ENERGY / TIMING drawing remains an independent correction layer on top.


### Local delivery spans

VOICE LAB now supports local speaking-style spans inside one utterance instead of applying one DELIVERY preset to the entire line. This keeps the global delivery preset as the baseline and lets selected passages override it.

Markup syntax:
- `[whisper]...[/]`
- `[excited:120]...[/]`
- `[calm]...[/]`
- `[serious]...[/]`
- `[narration]...[/]`

The optional number is style intensity as a percentage, clamped to 0–135%.

The editor can insert these tags around the current text selection on touch devices. Tags are zero-width control metadata: they are removed from spoken text, do not create synthetic phrase boundaries, and are converted to per-mora expression controls for the local DSP engine.

For System TTS, the same markup is split into sequential speech segments. Each segment receives its own approximate rate, pitch, and volume derived from the local delivery style. This preserves local style changes without exposing the markup to the OS speech engine.

Manual PITCH / ENERGY / TIMING curves still apply after delivery selection, so a local speaking preset can be fine-tuned mora by mora.


## 2026-09 speech-quality research sweep

### 1. Source quality matters: reduce pulse-train buzz

A long-standing source-filter result remains highly relevant to lightweight browser synthesis: a plain impulse/pulse excitation produces an unnaturally strong, uniform harmonic structure. Work using the Liljencrants-Fant (LF) glottal model shows that a more realistic glottal waveform has stronger high-frequency decay and can reduce buzzy synthetic quality while retaining controllable voice quality.

References:
- Cabral et al., *Towards an improved modeling of the glottal source in statistical parametric speech synthesis*: https://www.isca-archive.org/ssw_2007/cabral07_ssw.html
- Gobl, *Modelling aspiration noise during phonation using the LF voice source model*: https://www.isca-archive.org/interspeech_2006/gobl06_interspeech.html

VOICE LAB now uses a speech-only LF-inspired source blend inside the AudioWorklet:
- lower differentiated-flow weight than the singing source
- one-pole high-frequency tilt on the source excitation
- phase-synchronous aspiration around the opening part of the glottal cycle
- expression-dependent source tilt and aspiration
- singing modes remain on the original source path

This is deliberately an LF-inspired approximation rather than a full parameter-identification implementation, keeping the processor inexpensive enough for mobile AudioWorklet execution.

### 2. Dynamic formants and coarticulation are perceptually important

Natural speech does not consist of isolated steady-state vowels. Adjacent consonants and vowels alter formant trajectories, and dynamic spectral transitions carry useful phonetic information. Japanese vowel-to-vowel studies also show that speakers coordinate articulator movement continuously across consonants, including duration changes around long consonants.

References:
- Löfqvist, *Vowel-to-vowel coarticulation in Japanese: The effect of consonant duration*: https://pmc.ncbi.nlm.nih.gov/articles/PMC2677363/
- *Dynamic Spectral Structure Specifies Vowels for Adults and Children*: https://pmc.ncbi.nlm.nih.gov/articles/PMC4315365/
- *Control of Spoken Vowel Acoustics and the Influence of Phonetic Context in Human Speech Sensorimotor Cortex*: https://pmc.ncbi.nlm.nih.gov/articles/PMC4166154/

VOICE LAB therefore increases speech-only tract-state carryover and next-vowel anticipation while leaving the singing path less coupled. The goal is to remove the perceptual impression of discrete concatenated vowel blocks.

### 3. Japanese timing: mora rhythm is not enough by itself

Recent controllable and Japanese TTS work continues to model duration explicitly. FlexSpeech treats explicit phonetic duration as a key stability mechanism, while GST-BERT-TTS predicts duration alongside F0 and energy for Japanese synthesis.

References:
- Ma et al., *FlexSpeech: Towards Stable, Controllable and Expressive Text-to-Speech* (2025): https://arxiv.org/abs/2505.05159
- Ogura et al., *GST-BERT-TTS* (Interspeech 2025): https://www.isca-archive.org/interspeech_2025/ogura25_interspeech.html

For Japanese geminates, published production measurements report short consonant closure around 54–95 ms and long consonant closure around 119–165 ms in the tested material. VOICE LAB now gives sokuon an explicit pre-closure interval plus the consonant's normal closure, producing a substantially clearer short/long consonant contrast than the previous minimal pause model.

### 4. Phrase boundaries need explicit control

A 2025 comparison of open-source TTS systems found that even modern systems can fail to express intended phrase-boundary contrasts reliably from punctuation alone. This supports keeping boundary timing and phrase-final behavior explicit rather than assuming that text punctuation automatically creates the right prosody.

Reference:
- Shim et al., *Generating Consistent Prosodic Patterns from Open-Source TTS Systems* (Interspeech 2025): https://www.isca-archive.org/interspeech_2025/shim25_interspeech.html

VOICE LAB already models accent-phrase and sentence boundaries independently; future listening review should score boundary placement separately from general naturalness.

### 5. Evaluation should be error-local, not only one MOS score

Speech Synthesis Workshop 2025 work argues that a single decontextualized naturalness score gives little guidance about where synthesis failed. Time-aligned error type/severity annotation is more actionable.

Reference:
- Pine et al., *Practical & Contextual Speech Synthesis Evaluation* (SSW 2025): https://www.isca-archive.org/ssw_2025/pine25_ssw.html

For VOICE LAB, practical review should separately mark:
- pronunciation/readings
- consonant identity
- vowel quality
- sokuon / long-vowel timing
- accent / F0
- phrase boundaries
- breath/voicing artifacts
- buzzy/metallic source quality
- local-style transition artifacts

### 6. Japanese neural browser TTS is now technically viable, but not the default path yet

Kokoro-82M can run locally in browsers through ONNX/Transformers.js, and Japanese voice packs exist. A browser-focused Japanese project also demonstrates a complete client-side path using Kokoro plus Open JTalk WASM for Japanese G2P.

References:
- Kokoro Web / browser work: https://github.com/xenova/kokoro-web
- Japanese browser G2P + Kokoro integration: https://github.com/nerosui/kokoro-js-jp
- Kokoro Japanese voice catalogue: https://huggingface.co/Poshshajon/Kokoro-82M/blob/main/VOICES.md
- ONNX Runtime Web browser compatibility: https://onnxruntime.ai/docs/get-started/with-javascript/web.html

The tradeoff is substantial for an iPhone-first app:
- model download is tens to hundreds of MB depending on quantization
- Japanese Open JTalk dictionary adds roughly 24 MB compressed and around 100 MB after expansion in-browser
- current ONNX Runtime Web compatibility documentation does not list Safari/iOS WebGPU as a supported execution path, leaving WASM as the safer baseline

Therefore the current recommendation is:
1. keep the fast local DSP as the always-available engine
2. continue improving its source, timing, coarticulation and Japanese front end
3. later add an explicitly optional HIGH QUALITY NEURAL engine with lazy model download and capability detection, rather than making every iPhone user pay the startup/memory cost

### 7. Japanese text reading is a separate quality problem

Sarashina2.2-TTS (2026) highlights context-dependent kanji polyphony as a major Japanese TTS problem and introduces targeted coverage of all 2,136 Joyo kanji plus a kana-space reading metric.

Reference:
- Liu et al., *Sarashina2.2-TTS: Tackling Kanji Polyphony in Japanese Speech Generation via Data Scaling and Targeted Data Synthesis* (2026): https://arxiv.org/abs/2606.25369

VOICE LAB's local DSP currently avoids guessing kanji readings. That remains preferable to silently producing a wrong reading. The next front-end quality step should be an optional browser Japanese G2P layer (Open JTalk/WASM or equivalent), with the raw kana mode retained for deterministic manual control.

### 8. On-demand Open JTalk front end for kanji + lexical pitch accent

A browser-local Japanese front end is now practical without shipping a neural TTS model. `openjtalkjs` exposes browser/WASM APIs for G2P, full-context labels, and the NJD front-end. The NJD nodes expose the surface form, kana reading/pronunciation, accent nucleus (`acc`), mora count, and accent-chain flag. This is the information VOICE LAB needs before synthesis; the existing Sound Wave DSP can remain responsible for waveform generation.

References:
- openjtalkjs browser API and NJD fields: https://www.npmjs.com/package/@keanu-thakalath/openjtalkjs
- kokoro-js-jp browser Japanese pipeline: https://github.com/nerosui/kokoro-js-jp
- @piper-plus/g2p 0.4.2 / Open JTalk dictionary handling: https://github.com/ayutaz/piper-plus/releases

Implementation choice:
- **No automatic heavy startup.** Kana/romaji still use the built-in parser immediately.
- A user explicitly taps **KANJI G2P** when the local DSP input contains kanji.
- The runtime is pinned to the known browser assets published by `kokoro-js-jp@0.2.0`.
- First use warms the verified Open JTalk dictionary archive (~24 MB transfer) plus the small browser runtime/voice assets; the browser HTTP cache is reused afterwards.
- Processing remains client-side. The source text is passed to the local Open JTalk Worker, not to a remote synthesis API.

The front end maps Open JTalk readings back into the existing Voice Script mora representation. Accent phrases are reconstructed from `chain_flag`, and `acc` is converted into explicit low/high states:
- `acc = 0`: heiban — initial low, then high with no lexical drop
- `acc = 1`: atamadaka — first mora high, then low
- `acc = n > 1`: initial low, high through the nucleus, then low

These lexical states take priority over the older generic accent-phrase arc. Generic declination, consonant microprosody, phrase-final lowering, expression presets and manual PITCH drawing are still retained at reduced strength around the lexical pattern. This prevents a short phrase-final fall from incorrectly erasing a two-mora lexical high.

Current deliberate limitation:
- Local DELIVERY markup and KANJI G2P are not combined in the first integration. The user can either analyze plain kanji text, or use kana plus local style tags. Mixing both requires retaining source-character-to-mora alignment across Open JTalk tokenization and will be implemented separately rather than guessed.

Why this is preferable to immediately switching to neural TTS:
- It addresses reading and lexical pitch accent, two Japanese-specific errors the old parser could not solve.
- It keeps the existing low-latency AudioWorklet renderer and manual prosody controls.
- It avoids making every iPhone session download a neural acoustic model.
- It creates a clean front-end boundary so a future optional neural renderer can reuse the same Japanese analysis and editing UI.

### 9. Kanji-local style alignment and persistent manual prosody

The Japanese front end now retains a source-text range for every analyzed mora. Open JTalk is still run once on the plain Japanese sentence so lexical accent and accent-phrase structure are not broken at style markup boundaries. Local DELIVERY spans are then projected back onto analyzed morae by source-text overlap.

This enables text such as `今日は[whisper]静かに話します[/]` to use Open JTalk reading/pitch accent for the full sentence while applying WHISPER only to the selected source range.

Manual PITCH / ENERGY / TIMING curves are also persisted locally per exact text signature and mora count. Only non-neutral edits are stored, recent entries are bounded, malformed values are clamped on restore, and RESET ALL removes the stored curve for the current text. The text itself is not used as the storage key; a stable local signature plus mora count prevents curves from leaking onto unrelated utterances.

### 10. Japanese timing refinement: long vowels, geminates, devoicing and boundaries

The speech planner now treats Japanese temporal contrasts relationally instead of as fixed millisecond decorations.

- **Long vowels:** the continuation mora is lengthened enough that the complete V+V: span stays clearly above a short vowel across rate changes. Japanese vowel-length perception is primarily durational, and published production studies report long/short ratios well above 2:1 in controlled speech.
- **Geminates:** sokuon pre-closure now depends on the duration of the preceding mora. This preserves a closure-to-vowel relationship across slow and fast speech rather than adding the same gap at every rate.
- **High-vowel devoicing:** devoiced /i, u/ receive stronger temporal compression in addition to reduced voicing/energy. When Open JTalk supplies a lexical-high state, the planner conservatively preserves that mora instead of fully devoicing it so the lexical accent is not erased.
- **Phrase boundaries:** punctuation pauses now compress sublinearly with speaking rate. Sentence boundaries remain perceptually stronger than internal accent-phrase boundaries at fast rates.
- **Lexical F0 transitions:** low/high changes from dictionary pitch accent use a shorter speech-only glide window. Same-state morae keep the existing smooth transition, avoiding staircase pitch.

References:
- Sano & Guillemot, *Contrast enhancement and the distribution of vowel duration in Japanese* (Journal of Phonetics 108, 2025): https://www.sciencedirect.com/science/article/pii/S0095447024000925
- Hirata, *Effects of speaking rate on the vowel length distinction in Japanese*: https://www.sciencedirect.com/science/article/pii/S0095447004000282
- Hirata & Whiton, *Effects of speaking rate on the single/geminate stop distinction in Japanese*: https://pubmed.ncbi.nlm.nih.gov/16240824/
- Kilbourn-Ceron, *Durational Evidence That Tokyo Japanese Vowel Devoicing Is Not Gradient Reduction*: https://pmc.ncbi.nlm.nih.gov/articles/PMC6476939/
- Shaw & Kawahara et al., recent Japanese geminate articulatory work: https://pubmed.ncbi.nlm.nih.gov/39785713/

### 11. Ambiguous kana long vowels, consonant-aware coarticulation and sentence finality

VOICE LAB now routes ambiguous kana sequences such as おう and えい through the existing Open JTalk front end instead of guessing from spelling alone. This preserves the lightweight built-in parser for ordinary kana while using morphological/pronunciation analysis only when orthography is insufficient to determine whether a sequence is a long vowel or a true vowel sequence.

The AudioWorklet coarticulation model also differentiates consonant classes. Postalveolar/palatal sequences such as /sh ch j y/ begin next-vowel formant movement earlier and more strongly, while /s ts/ remain more abrupt. This follows Japanese acoustic descriptions in which transitional formant structure differs across sibilant and palatal contexts.

Japanese sentence finality is now represented as a subtle voice-quality layer on phrase-final units. Declaratives receive a small amount of final F0 lowering, increased glottal closure/irregularity, amplitude reduction and release breath. Questions suppress most creak so the rising boundary remains clear. DELIVERY presets modulate the amount: SERIOUS/NARRATION allow more creak, WHISPER favors breath, and EXCITED minimizes final creak.

References:
- Venditti, *The J_ToBI model of Japanese intonation*: finality cues include final F0 lowering, segmental lengthening, creaky voice, amplitude lowering and pauses: https://www.cs.columbia.edu/~jjv/pubs/jtobi_Ch-07-final.pdf
- Japanese intonational-phrase work reporting creaky vowels at IP-final positions: https://www.researchgate.net/publication/51399721_The_Intonation_of_Gapping_and_Coordination_in_Japanese_Evidence_for_Intonational_Phrase_and_Utterance
- Japanese coarticulation / formant-transition evidence: https://pmc.ncbi.nlm.nih.gov/articles/PMC2677363/

### 12. Open JTalk full-context labels as phonology overrides

The browser Open JTalk runtime already used by VOICE LAB exposes `extractFullContext`, so the same lazily downloaded dictionary/voice assets can now provide phoneme-level context without adding another model download.

VOICE LAB uses the full-context labels conservatively:
- uppercase vowel phones (`A/E/I/O/U`) override the built-in high-vowel devoicing heuristic for analyzed text
- `cl` confirms sokuon/geminate timing before the following mora
- `pau` confirms an internal pause/boundary
- A1/A2/A3 transitions can confirm accent-phrase boundaries
- long-vowel identity remains sourced from NJD `pron`, because repeated vowel phones alone cannot safely distinguish a long vowel from a true vowel sequence

The override is applied only when the number of mora groups reconstructed from full-context labels exactly matches the Voice Script mora count. If alignment fails, the existing NJD reading/pitch-accent path remains active and the full-context hints are ignored rather than partially applied.

This is important because Open JTalk's full-context labels encode context-sensitive decisions after the pronunciation front end. In particular, uppercase vowel phones represent devoiced Japanese vowels, and `cl` represents the closure corresponding to sokuon. These are more reliable than re-deriving the same decisions from raw kana after morphological analysis has already happened.

References:
- openjtalkjs browser API: `extractFullContextAsync`, `runFrontendAsync`, and Web Worker support: https://github.com/keanu-thakalath/openjtalkjs
- pyopenjtalk full-context examples and API: https://github.com/r9y9/pyopenjtalk
- Piper/Open JTalk prosody use of A1/A2/A3 and full-context phones: https://ayousanz.hatenadiary.jp/entry/2026/04/04/002217

### 13. Editable accent nuclei on top of Open JTalk

VOICE LAB now separates automatic Japanese analysis from user correction. After Open JTalk analysis, each accent phrase is shown as a compact mobile editor. AUTO preserves the Open JTalk nucleus, ○ selects heiban, and tapping a mora sets the accent nucleus at that position.

Overrides are stored per exact plain-text signature and phrase range. They are reapplied after Open JTalk analysis but do not rerun Voice Script finalization, so full-context decisions such as vowel devoicing and sokuon remain intact. RESET ACCENT removes only the manual accent layer and returns all phrases to the original Open JTalk analysis.

This follows the practical direction used by Japanese synthesis editors: automatic morphological/accent analysis provides a strong default, while phrase-level nucleus correction remains directly editable because proper nouns, compounds and intended reading styles can differ from dictionary defaults.

### 14. Phrase structure and phrase-level performance controls

VOICE LAB now treats Open JTalk accent phrases as editable performance units instead of fixed analysis output.

The accent editor adds:
- SPLIT at any mora boundary inside an accent phrase
- JOIN at an existing non-sentence accent boundary
- phrase pitch offset in 0.25-semitone steps
- phrase rate scaling in 0.05× steps
- phrase-final pause adjustment in 25 ms steps

Boundary edits only refresh phrase/accent indexing. They do not rerun the built-in devoicing heuristic, so Open JTalk full-context decisions such as uppercase-vowel devoicing and sokuon remain intact.

Phrase pitch/rate controls are passed into the synthesis plan as separate layers beneath the mora-level PITCH / ENERGY / TIMING drawing. This keeps coarse phrase shaping and fine mora correction independent.

Phrase edits are persisted per exact plain-text signature. When a split/join changes a phrase range, overlapping accent-nucleus and phrase-shape overrides are discarded rather than silently reinterpreted on a different range.

### 15. Phrase energy, emphasis and direct F0 dragging

Phrase shaping is now split into separate controls for level and prominence.

- ENERGY scales phrase loudness without changing F0 or duration.
- EMPHASIS is a prominence macro: it raises phrase-onset/lexical-high F0 slightly, strengthens energy, shortens the glottal attack, increases articulation, and adds a very small duration expansion. This avoids treating emphasis as volume alone.
- The phrase F0 control can be dragged vertically on touch screens. Dragging uses a deterministic 36 px per semitone mapping, quantized to 0.1 semitone and clamped to ±3 semitones.

The drag interaction deliberately does not rebuild the accent editor during pointer movement. It updates the in-memory phrase shape and the drag readout only, then persists and rebuilds the synthesis plan on pointer release. This keeps pointer capture stable on iPhone Safari.

Existing phrase edits saved before ENERGY/EMPHASIS were introduced remain compatible: missing energy defaults to 1.0 and missing emphasis defaults to 0.

### 16. Phrase emphasis presets and three-point F0 curves

Phrase editing now has two faster layers above the existing numeric buttons.

- Four emphasis presets are available per phrase: 弱調 / 通常 / 強調 / 最重要.
- The presets change ENERGY and expressive EMPHASIS together while leaving phrase rate, pause, base pitch and manual mora drawing untouched.
- Each phrase exposes a three-point F0 curve with START / PEAK / END handles. The curve is added on top of the whole-phrase F0 offset and under the mora-level hand-drawn pitch lane.
- START→PEAK and PEAK→END are linearly interpolated across the phrase. Curve points are quantized to 0.1 semitone and clamped to ±2.5 semitones.
- Curve dragging follows the same iPhone-safe rule as whole-phrase F0 dragging: update in-memory/readout during pointer movement, persist and rebuild only on pointer release.

The storage format remains backward compatible. Phrase edits saved before three-point curves were added load with START=PEAK=END=0.0 semitone.

### 17. Smooth phrase F0 interpolation

The three-point phrase curve now uses smoothstep interpolation on START→PEAK and PEAK→END instead of straight linear ramps.

- START, PEAK and END remain the same persisted values, so existing phrase edits require no migration.
- Each half-curve eases to zero slope at its handles. This removes the audible and visual hard corner at PEAK while keeping the requested handle values exact.
- The editor preview is sampled from the same interpolation function used by synthesis, so the drawn curve matches the actual per-mora F0 offsets rather than displaying a simpler approximation.
- Touch dragging, quantization and ±2.5 semitone limits are unchanged.

This is intentionally a small synthesis-layer improvement: it reduces mechanical phrase contour changes without changing Open JTalk accent nuclei, manual mora pitch drawing or phrase-level base F0.

### 18. Accent-focused phrase emphasis

Phrase EMPHASIS now uses one shared prominence profile instead of independent fixed multipliers for pitch, duration and level.

- A Japanese lexical accent nucleus is detected conservatively as a HIGH mora followed by LOW, or a HIGH mora at an accent-phrase end.
- The accent nucleus receives the strongest emphasis response.
- Accent-phrase starts receive the next strongest response, followed by other lexical HIGH morae and then unaccented morae.
- The same prominence profile drives F0 lift, duration expansion, energy, attack shortening, articulation and source spectral tilt.
- Manual mora PITCH / ENERGY / TIMING edits remain the final user layer and are not overwritten.
- Phrase ENERGY remains separate: ENERGY changes level without implicitly changing F0 or duration, while EMPHASIS is intentionally multi-dimensional.

This keeps the existing emphasis presets and saved phrase data compatible while making 強調 / 最重要 sound less like uniform gain and more like localized spoken prominence.

### 19. Sentence-final contour and delivery-aware finality

VOICE LAB now separates sentence-final F0 shape from final voice quality.

- QUESTION no longer waits until the last mora for a large pitch jump. The rise begins across roughly the final 40% of the sentence and uses a smoothstep envelope into the final target.
- NATURAL declaratives use a smaller smooth terminal lowering across the final portion of the phrase rather than applying the entire drop to one last mora.
- The final mora has a dedicated finality profile beneath manual mora edits. It can make small coordinated changes to F0, duration, energy and release without overwriting the user's PITCH / ENERGY / TIMING drawing.
- NATURAL / FLAT / RISING / FALLING / QUESTION each use different final creak, breath, release and micro-fall behavior.
- DELIVERY presets also shape the ending: SERIOUS strengthens grounded finality, CALM lengthens and softens release, EXCITED keeps more terminal energy, WHISPER favors breath over creak, and NARRATION uses a measured longer release.
- Rising and question endings explicitly cap creak and disable terminal micro-fall, even under SERIOUS delivery, so the ending remains perceptually open.

The lexical Open JTalk accent contour remains underneath this layer. Manual phrase F0 curves and mora-level drawing remain above it, preserving direct editorial control.

### 20. Punctuation-aware AUTO intonation and sentence resets

VOICE LAB now has an AUTO intonation mode that resolves each sentence independently from punctuation.

- `？` / `?` selects QUESTION for that sentence.
- `！` / `!` selects an EXCLAIM contour with a compact energetic ending rather than reusing the full manual FALLING contour.
- `。` / `.` / newline selects NATURAL declarative shaping.
- Mixed terminal punctuation gives question marks highest priority, then exclamation, then statement.
- The detected terminal is copied to every mora in the sentence so sentence-internal F0 planning and sentence-final voice quality use the same intent.
- Global declination is no longer based on the absolute unit index across the whole text. It restarts from zero at every sentence boundary.
- Manual NATURAL / FLAT / RISING / FALLING / QUESTION selections still override punctuation. Existing saved manual selections remain valid.
- New Voice Lab settings default to AUTO, while older saved settings are not silently rewritten.

This layer stays beneath phrase F0 curves and mora-level PITCH / ENERGY / TIMING edits, so punctuation can provide a useful baseline without taking control away from manual editing.

### 21. Boundary reset and content-question prosody

Two additional sentence-level behaviors are layered under manual editing.

- Accent boundaries now expose the previous boundary and pause duration to the following mora.
- A comma-like boundary produces a small F0 reset on the next accent-phrase start. The reset scales with pause length, so Japanese comma punctuation is clearly audible while tiny Open JTalk chain boundaries do not create exaggerated pitch jumps.
- AUTO questions are split conservatively into YES/NO and CONTENT questions.
- Common Japanese interrogatives such as なに / なんで / だれ / どこ / いつ / どう / なぜ / どれ / どちら / いくら / どの are detected from the mora sequence, including Open JTalk readings generated from kanji.
- YES/NO questions keep the stronger sentence-final rise.
- CONTENT questions put a small prominence boost on the interrogative word and use a much smaller terminal rise, keeping the ending open without forcing every question into the same contour.
- Manual QUESTION still uses the explicit full question contour and does not get reclassified.

These are intentionally conservative heuristics. Open JTalk lexical accent, phrase shape controls and mora-level PITCH / ENERGY / TIMING remain independent layers above the automatic baseline.

### 22. Connective-clause continuation prosody

VOICE LAB now treats common Japanese connective endings as continuation cues instead of ordinary phrase closures.

- Kana/romaji fallback detects conservative multi-mora connective patterns only when they occur at an accent boundary: けど / けれど, ので / から, なら / たら, ても / でも / のに.
- Open JTalk analysis additionally uses frontend token surfaces, allowing single-mora connective particles such as が and し to be recognized without confusing ordinary lexical morae.
- Connective phrase endings receive a small continuation F0 lift and modest duration extension instead of fully closing.
- The following clause receives a small F0 reset and energy recovery, with a sharper pitch transition so the new clause is perceptually distinct.
- Connective boundaries keep the phrase-energy envelope more open and use less spectral centering than ordinary phrase endings.
- Existing commas and manually edited pauses remain authoritative; connective logic only raises very short automatically inferred pauses to a subtle continuation pause.

The automatic continuation layer stays below Open JTalk lexical accent, phrase-shape controls, emphasis and mora-level PITCH / ENERGY / TIMING edits.

### 23. Discourse particles, focus and phrase downstep

VOICE LAB now uses Open JTalk frontend part-of-speech metadata for a small discourse-prosody layer.

- Open JTalk NJD nodes expose `pos`, `pos_group1`, and `pos_group2`, allowing particles with the same surface form to be separated by function.
- Topic `は` (and topic-like `も`) receives a small boundary and following-clause F0 reset. The preceding lexical material gets only mild prominence.
- Subject `が` when tagged as a case particle stays tightly connected to the predicate, while the preceding lexical token receives stronger focus prominence in F0, energy and duration.
- Connective `が` remains a continuation marker only when Open JTalk tags it as a conjunctive particle. Case-particle `が` is no longer confused with it.
- Ambiguous `から` is treated as causal continuation only when POS supports a conjunctive reading; source-case `から` is left alone.
- Quotation `と` tagged as a quotation case particle creates a small quotation boundary and controlled reset before the reporting clause.
- Enumeration `や` / compatible list particles create a light open boundary and reset for the next list item.
- Focus prominence is intentionally small: a fractional-semitone F0 lift with modest energy and duration support, not a singing-style accent.
- Accent phrases now carry an ordinal within each sentence. A gentle capped downstep accumulates across later accent phrases, while topic/connective/list resets partially reopen the contour.

All discourse effects remain below manual phrase controls and mora-level PITCH / ENERGY / TIMING edits. If Open JTalk POS metadata is absent, the engine falls back to the older conservative surface heuristics rather than inventing detailed particle roles.

### 24. Focus particles, quoted/parenthetical speech, and breath planning

VOICE LAB now adds a lightweight information-structure and speaking-scope layer on top of Open JTalk analysis.

- Focus particles `こそ / さえ / しか / だけ / まで / ばかり` are recognized only when Open JTalk POS supports a focus-like particle reading.
- The lexical token immediately before the focus particle receives graded prominence. `こそ` is strongest, followed by `さえ`, `しか`, `だけ`, `まで`, and `ばかり`.
- Focus is realized as a small F0 lift plus modest energy and duration support. Strong focus also slows the focused token by about 1.5%, preserving speech naturalness rather than turning it into a sung accent.
- Japanese quotation marks and common quote characters are retained as non-spoken scope metadata. Quoted material uses slightly slower pacing and a small pitch/energy opening, while the quote marks themselves are never spoken.
- Parenthetical material is also retained as non-spoken scope metadata. It is spoken slightly faster, with lower energy and a small F0 reduction so it reads as an aside rather than a new main clause.
- Quote and parenthetical boundaries create small phrase transitions without overriding sentence punctuation inside the scope.
- Long sentences now choose automatic breath locations only from existing accent boundaries. The planner waits for a sufficiently long mora span, avoids arbitrary word-internal cuts, and raises the selected pause to a restrained inhalation-sized gap.
- Planned breath boundaries receive a small breath release in the speech source. Rate scaling preserves a usable breathing pause even during faster delivery.
- Automatic scope rate is multiplied underneath manual phrase-rate editing, so user timing remains the final control layer.

This keeps the lightweight DSP engine deterministic while making longer Japanese passages more readable and less uniformly paced.

### 25. Hesitation timing, filled pauses, and emotion-aware focus

VOICE LAB now models a small set of expressive timing cues that sit between lexical prosody and manual editing.

- `…`, repeated `……`, ASCII `...`, and long dashes such as `――` are treated as hesitation pauses rather than sentence endings.
- Hesitation markers keep the utterance inside the same sentence contour, add a rate-aware expressive pause, slightly lower the outgoing F0, lengthen the preceding mora, reduce its energy, and leave a small breath release.
- Conservative Japanese filled pauses `えーと`, `ええと`, and sokuon `えっと` are detected from mora structure. Plain `えと` is not treated as a filler.
- Filled-pause morae are spoken roughly 10% slower with lower energy and a restrained lower pitch placement, followed by a short hesitation gap.
- Focus particles can now create a short pre-focus hold when the focused lexical token is not sentence-initial. This is stored separately from grammatical phrase boundaries so it does not invent a new accent phrase.
- Manual pause overrides remain the final timing layer: an explicit pause edit replaces automatic boundary, breath, hesitation, and pre-focus timing at that position.
- Emotional delivery now reacts to contextual focus rather than applying the same focus realization under every preset. EXCITED makes focus more pitch- and energy-forward, SERIOUS keeps pitch steadier and adds weight through energy/duration, WHISPER keeps focus restrained, and NARRATION adds a smaller controlled pitch/energy lift.
- EXCITED also receives an additional onset lift for exclamatory sentences, making punctuation and delivery cooperate instead of acting as unrelated layers.

These heuristics are intentionally conservative and deterministic. They improve conversational rhythm without requiring a neural language model, while keeping all phrase and mora editing controls authoritative.

### 26. Sentence-final attitude, onset breath, and per-take microvariation

VOICE LAB now treats several Japanese sentence-final particles as pragmatic attitude cues beneath manual prosody editing.

- `ね` is modeled as a shared/confirming ending: slightly open pitch, longer release, reduced terminal fall, and a touch of breath.
- `よ` is modeled as assertive: slightly firmer energy, shorter release, and a more closed terminal shape.
- `よね` uses the shared profile rather than stacking two separate endings.
- `かな` is modeled as wondering: a larger but still speech-like terminal lift, longer duration, softer energy, and a more open/breathy release.
- `かも` is modeled as uncertain: lower energy, longer release, mild lift, and the most breath of the supported attitude endings.
- Explicit `？` / `！` punctuation still wins over these statement-attitude heuristics. Attitude particles do not replace question/exclamation intonation.
- Open JTalk POS metadata suppresses attitude inference for lexical items whose reading happens to end in `ね / よ / かな / かも`; for example a noun reading `かも` is not treated as uncertain speech when POS identifies it as a noun.

Longer sentence starts now receive a very short pre-phonation breath lead. This is skipped for short utterances and parenthetical asides, and the first voiced unit receives a small breathier onset rather than a separate spoken token.

Playback also has bounded per-take humanization. The score/prosody plan remains deterministic, but each playback take receives only tiny seeded variation: about ±1.6 cents of pitch, ±1.2% velocity, ±2.5% attack, and ±1.5 ms timing. The same unit/take pair is deterministic for testing, while successive takes avoid being bit-for-bit identical in delivery. Manual pitch, energy, duration, phrase controls, and pause edits remain the controlling layers.

### 27. Compound attitude + punctuation and context delivery ramps

VOICE LAB now composes pragmatic sentence-final attitude with explicit punctuation instead of forcing one layer to replace the other.

- `ね？` keeps QUESTION intonation while adding a shared/confirmation attitude: a slightly larger terminal lift, longer open release, softer energy, and extra breath.
- `よ！` keeps EXCLAIM intonation while adding assertive attitude: stronger energy, a tighter release, and a small additional pitch/closure push.
- `かな……` keeps WONDER attitude while hesitation punctuation lowers the terminal lift, lengthens the final mora/release, softens energy, and increases breath.
- `かも？` can remain uncertain while still functioning as a question; the uncertainty layer stays softer and breathier than a plain yes/no question.
- Open JTalk POS disambiguation remains authoritative for lexical lookalikes, so noun readings are not promoted into pragmatic endings simply because their morae resemble `ね / よ / かな / かも`.

Context delivery now ramps rate and energy during the latter part of a sentence instead of applying only an abrupt final-mora change.

- shared questions gradually slow and soften near the ending;
- assertive exclamations gradually gain energy and, especially under EXCITED delivery, a small amount of forward rate;
- wondering and uncertain endings gradually slow and soften;
- trailing hesitation strengthens that deceleration/softening;
- CALM and WHISPER slightly deepen the late-sentence slowdown, while SERIOUS adds a little weight to assertive endings.

The ramp sits below manual phrase and mora controls. Manual PITCH / ENERGY / TIMING still multiply or offset the automatically planned delivery last, so the automatic context layer improves the baseline without taking control away from editing.

### 28. Nonverbal speech events and repair/rethink timing

VOICE LAB now separates a small set of nonverbal and discourse-repair cues from the spoken mora stream.

- `（笑）` / `[laugh]` becomes a light two-pulse laugh event. The label itself is removed before kana parsing, Open JTalk analysis, System TTS, and export.
- `（ため息）` / `[sigh]` becomes a low-energy breathy sigh with a downward pitch trajectory and longer release.
- `（息）` / `[inhale]` becomes a short mostly-unvoiced inhale-like breath event before the next speech segment. If an explicit inhale is present at sentence start, the automatic onset breath is not duplicated.
- `（言い直し）` / `[restart]` is intentionally silent: it inserts a short repair pause, resets inter-mora glide, and gives the next phrase a small fresh pitch/energy onset.
- `（思い直し）` / `[rethink]` is also silent but longer and more reflective: the next phrase starts slightly lower, softer, and slower.

Speech events carry both a text offset and an after-mora position. Local-delivery markup strips their labels from plain text, and Open JTalk analysis remaps the preserved text offsets onto analyzed mora ranges. This keeps event timing stable even when kanji expands to a different number of morae.

The playback plan now exposes timed speech events separately from timed morae. Laugh, sigh, and inhale events are synthesized through the same AudioWorklet source-filter engine but use strongly reduced voicing, increased aspiration/noise, no harmony/doubling, and conservative levels. Restart/rethink remain silence-plus-prosody events rather than fake spoken words.

Manual mora PITCH / ENERGY / TIMING and phrase controls still sit above the automatic repair transition. WAV export uses the same event scheduler as live playback, so nonverbal events are rendered consistently in exported audio.

### 29. Playcheck-driven speech quality pass

A live Voice Lab playcheck exposed five practical weaknesses, and the local speech path now addresses all five.

- Spoken-only presence shaping now raises F2/F3/F4/F5 support, the dedicated presence resonator, radiation brightness, and fricative/noisy-consonant energy. This is applied in VoiceSynth after the shared singing model is built, so AUTO COMPOSE singing timbre is not globally brightened.
- The neutral speech source uses less low-pass spectral tilt, while CALM and WHISPER remain intentionally softer. EXCITED/SERIOUS preserve more upper spectral detail.
- Natural Japanese F0 motion was widened at the accent-phrase and sentence-arc layers. QUESTION logic remains separate, but ordinary declaratives no longer collapse as easily into a near-flat ~1-semitone contour.
- `かな……` / uncertain-wondering hesitation now propagates a sentence-level hesitation flag to the last several morae. The lead-in progressively lowers F0, slows rate, reduces energy, lengthens the ending, and increases breath rather than relying mostly on the silent ellipsis gap.
- Repair events no longer stack a full punctuation pause plus an event pause. `（言い直し）` and `（思い直し）` merge the grammatical pause into the repair timing, keeping restart near conversational repair length while rethink remains deliberately longer.
- Laugh/sigh events are quieter and closer to surrounding speech. Sigh has a slower attack, longer release, less voiced/formant energy, a shorter post-event gap, and leaves extra breath on the next spoken unit for a smoother sigh-to-speech handoff. Laugh is also reduced in level and gap.
- First-use Open JTalk loading is non-blocking for SPEAK. Ambiguous kana such as `おんせい / ごうせい` plays immediately through the lightweight local kana path while the dictionary initializes in the background. Kanji plays immediately through SYSTEM TTS while Open JTalk initializes. Once analysis is ready, subsequent takes automatically use precise local Open JTalk reading/accent. Explicit JAPANESE G2P and WAV export may still wait because their purpose is precision rather than instant preview.

Regression coverage now includes widened natural F0 range, upper-formant speech presence, merged repair timing, softened nonverbal events, multi-mora hesitation, and first-use playback strategy.

### 30. Second live playcheck: brightness shelf verification

A second production-artifact playcheck used the real VOICE LAB UI and exported WAV through the shipping local DSP. It confirmed the previous timing/prosody fixes and exposed that multiplying the shared singer-presence control was ineffective because the base vocal models intentionally set singer presence to zero.

The speech path now uses three separate, speech-only brightness layers:

- moderate F3/F4/F5 and consonant-noise reinforcement inside VoiceSynth,
- a small high-harmonic/source presence layer plus high-passed air in the AudioWorklet,
- a gentle post-tract high shelf keyed from the speech presence amount, so vowel-heavy phrases keep upper harmonics after the tract/final mix.

An intentionally stronger formant/radiation experiment was rejected after re-recording because it did not improve the measured upper-band balance. The retained shelf configuration increased 1–5 kHz energy in the verification samples by roughly 16% for a neutral sentence, 13% for a vowel-heavy short phrase, and 9% for a sibilant-heavy phrase versus the preceding build, while output peaks remained comfortably below clipping.

The same playcheck reconfirmed the repair timing fix: punctuation + repair markers no longer stack into ~0.5 s dead gaps. Restart and rethink remain distinct, with restart around the low-0.2 s range and rethink around the low-0.3 s range in the tested default delivery.

### 30. Speech tract continuity and glottal-source humanization

VOICE LAB now adds a speech-only continuity layer below the existing mora/prosody plan.

- Connected spoken morae preserve more resonator state across boundaries through a dedicated formant-carry control. Singing leaves this control unset.
- Consonant-to-vowel formant motion can be stretched independently from note duration, reducing the impression that one vowel shape is abruptly replaced by the next.
- The consonant/noise path and voiced source now overlap briefly at the CV boundary. As voicing ramps in, frication/noise fades instead of ending as a separate block.
- Speech-only microvariation adds two deterministic slow F0 components plus a very small jitter term. The planned pitch curve is unchanged; this only prevents perfectly periodic phonation.
- A tiny open-quotient modulation changes the glottal pulse shape over time without introducing audible vibrato.
- CALM/WHISPER favor more tract carry and longer transitions. EXCITED keeps faster articulation and slightly more source irregularity.
- These parameters are injected only by VoiceSynth. AUTO COMPOSE singing events keep all speech-naturalness fields undefined, so the singing model remains unchanged.

Static AudioWorklet regression coverage now checks syntax and the presence of the speech-only DSP paths in addition to TypeScript-level profile tests.

### 31. Research-driven hybrid speech architecture (2024–2026 literature pass)

This pass reviewed recent controllable speech, neural source-filter, articulatory DDSP, time-varying timbre, and fast flow-matching work and mapped only the parts that fit VOICE LAB's browser-local, editable architecture.

#### Verified research references

- **HiFi-Glot: High-Fidelity Neural Formant Synthesis with Differentiable Resonant Filters** — arXiv:2409.14823, revised 2026-02-16. The model keeps a source-filter architecture but replaces the impoverished analytic excitation with a neural glottal source while retaining directly controllable resonant formants. This strongly supports keeping VOICE LAB's explicit tract controls instead of replacing the whole engine with an opaque waveform model.
- **Fast, High-Quality and Parameter-Efficient Articulatory Synthesis using Differentiable DSP** — arXiv:2409.02451. This system synthesizes speech from low-dimensional articulatory trajectories, F0 and loudness using a Harmonic-plus-Noise DDSP generator. It reports MOS 3.74, 4.9x faster CPU inference than its HiFi-CAR baseline, and shows that a 0.4M-parameter model can remain competitive with a much larger 9M baseline.
- **TVTSyn: Content-Synchronous Time-Varying Timbre for Streaming Voice Conversion and Anonymization** — arXiv:2602.09389. The central idea is that timbre should vary with content rather than remain one static global speaker vector. This motivates content-synchronous timbre changes in VOICE LAB at mora granularity.
- **CtrlSpeech: Coarse-to-Fine Control for Expressive Speech Synthesis** — arXiv:2608.08362. Phone-aligned pitch, loudness and duration controls validate the usefulness of VOICE LAB's existing mora-level PITCH / ENERGY / TIMING editing model.
- **Fast F5-TTS / Empirically Pruned Step Sampling** — arXiv:2505.19931. Seven-step flow-matching inference can retain comparable quality while substantially reducing sampling cost on a desktop GPU. This is a future HQ-refiner candidate, not part of the default browser DSP path yet.
- **Ultra-lightweight Neural Differential DSP Vocoder For High Quality Speech Synthesis** — arXiv:2401.10460. It demonstrates that a jointly optimized DDSP vocoder can approach neural-vocoder quality with extremely low compute, reinforcing a future small-control-network path rather than a full large neural decoder.

#### Implemented from this research pass

1. **Six-dimensional articulatory state**
   - Each mora now carries an implicit state for jaw opening, tongue frontness, tongue height, lip rounding, velum opening, and larynx height.
   - Japanese vowel identity supplies the main state; consonant place/manner modifies it.
   - The state is converted into physically coherent F1–F5 scaling, bandwidth change, nasal coupling, source body and source damping.
   - This replaces a purely independent-formant view with a compact vocal-tract control layer.

2. **Explicit Harmonic-plus-Noise balance**
   - Periodic and aperiodic energy now have separate speech-only gains in the AudioWorklet.
   - Vowels favor harmonic energy, fricatives increase noise energy, nasals reduce noise, and stops use only a small aperiodic increase.
   - This mirrors the H+N separation used by articulatory DDSP systems while preserving the current source-filter engine.

3. **Content-synchronous timbre**
   - The articulatory state changes every mora and now modulates formant placement, nasal coupling, body resonance and source damping.
   - Therefore the same global NATURAL / SOFT / CLEAR / AIRY / POWER character no longer has a perfectly static timbre across different phonetic content.
   - This is a deterministic, interpretable approximation of the time-varying-timbre principle rather than a learned memory/attention model.

4. **Neural-source-ready separation**
   - Glottal-source controls, vocal-tract controls, harmonic/noise balance, prosody and manual editing remain separate.
   - That separation is intentional so a future small neural glottal-source or control-residual model can replace only the weak analytic component without removing PITCH / ENERGY / TIMING / accent / phrase editing.

#### Deliberately not implemented yet

- A trained neural glottal source like HiFi-Glot requires model weights and training/inference infrastructure; adding it blindly would increase download size and remove the current instant/offline path.
- A flow-matching waveform refiner is promising for an optional HQ mode, but the published Fast F5-TTS speed results are GPU-oriented and do not by themselves establish that a 7-step refiner is suitable for iPhone Safari/WebGPU.
- A learned TVT memory is deferred until there is an on-device model small enough to justify its cost. The current deterministic mora-synchronous timbre layer provides the architectural hook.

The practical target remains a hybrid system: Open JTalk / editable prosody -> compact articulatory+timbre control frame -> explicit glottal/H+N source -> controllable resonant tract -> optional future neural residual/refiner.

### 32. Browser HQ path and neural-ready control frames

Further research/implementation work adds two architectural pieces for a future compact neural HQ mode without changing the default offline DSP workflow.

- Every spoken mora can now be represented as one `VoiceSpeechControlFrame`: planned F0, energy, duration, six-dimensional articulatory state, character/expression timbre, and Harmonic/Noise balance. The shipping DSP consumes the same quantities today; a future tiny residual network can therefore predict corrections to these frames instead of replacing prosody/manual editing.
- The speech glottal source now supports a Voice-Lab-only 2x internal evaluation. Midpoint and endpoint glottal-flow values are averaged before differentiation, reducing alias-prone sharp closure excitation at small computational cost. Singing leaves this field undefined.

Browser deployment constraints matter for the future neural stage. Current ONNX Runtime Web documentation supports WASM across iOS/Safari, while its browser support table does not list WebGPU for Safari/iOS. Therefore an optional neural HQ model should target WASM as the compatibility baseline and enable WebGPU only after runtime capability detection on supported browsers. The default local DSP path must remain available with no neural-model download.

The intended future model boundary is deliberately narrow:

`Open JTalk / editable prosody -> mora control frame -> optional small neural residual or neural glottal source -> existing H+N / resonant tract AudioWorklet`

This keeps CtrlSpeech-like fine-grained pitch/loudness/duration control, HiFi-Glot-style source/tract separation, and DDSP-style efficient waveform generation in one architecture.

### 33. A/B HQ residual path

VOICE LAB now exposes two local rendering qualities while preserving exactly the same text, prosody, accent, phrase, and mora editing layers.

- **FAST DSP** keeps the analytic source-filter path, uses 1x glottal-source evaluation, and disables the post-tract residual refiner.
- **HQ REFINE** uses 2x glottal-source evaluation and a mora-aware three-band residual stage after the tract. Low-band BODY, mid-band PRESENCE, and high-band AIR residuals are derived from the same mora control frame used by the main synthesizer.
- Vowel-like frames receive more body and restrained air; noisy/fricative frames receive more presence/air. The residual stage is intentionally small so it cannot override manual PITCH / ENERGY / TIMING or the explicit tract model.
- HQ is still deterministic DSP, not a trained neural model. The label deliberately avoids claiming neural inference.

The residual stage is the intended replacement boundary for a future compact ONNX model. A learned model can consume `VoiceSpeechControlFrame` values and predict only residual corrections, while FAST DSP remains an offline/no-download fallback.

Both modes use the same WAV export path, so A/B comparisons can be made from exported files as well as live playback. AUTO COMPOSE singing remains isolated: all speech residual and oversampling fields stay undefined outside VoiceSynth.

### 34. HQ continuity pass: smoothed residuals, closure shaping, and articulatory anticipation

The HQ path now treats speech quality as a continuous trajectory rather than a sequence of independent mora-local EQ states.

- **Cross-mora residual smoothing:** HQ BODY / PRESENCE / AIR targets now move with a ~14 ms smoothing time. This prevents audible timbre steps when adjacent morae have different articulatory/noise profiles. FAST keeps zero residual processing.
- **HQ closure smoothing:** the asymmetric glottal derivative is smoothed by about 0.42 ms only in HQ. This preserves closure definition while reducing brittle, overly sharp excitation before the tract model.
- **Articulatory residual targeting:** HQ residual values now depend on jaw opening, tongue frontness/height, lip rounding, phoneme noise balance, and the selected timbre profile rather than only a simple vowel/noise split.
- **Next-mora tract anticipation:** anticipatory `nextHz` formant targets use the next mora's own six-dimensional articulatory state. For example, /a/→/i/ now moves toward the /i/ tongue/frontness-derived tract target instead of scaling the next vowel with the current /a/ tract state.

These changes keep manual mora controls authoritative and remain deterministic. AUTO COMPOSE singing still leaves all HQ residual/closure-smoothing fields undefined.

Regression coverage now checks FAST/HQ smoothing separation, articulatory residual adaptation, singing isolation, and next-mora articulatory formant anticipation.

### 35. Vocal-tract length and consonant transient pass

This pass adds two speech-quality controls that are largely independent from F0/prosody.

- **Continuous VTL control:** Voice Lab exposes a `VTL` slider from shorter/brighter to longer/deeper tract. It scales the speech formant trajectory and presence center without changing the planned F0. Character preset, TONE, manual VTL, and articulatory larynx height all contribute to one bounded vocal-tract-length profile.
- Nasal anti-formant frequency follows the same VTL scaling, so long/short tract settings do not leave the nasal cavity resonance fixed at an inconsistent spectral position.
- Next-mora formant anticipation keeps each mora's own articulatory correction while also applying the current/next VTL profile, preserving continuous tract motion across vowel transitions.

Stop and nasal consonants now use Voice-Lab-only transient controls:

- `/k t p/` have place-sensitive burst gain and burst sharpness rather than one identical sine-shaped noise pulse.
- `/b d g/` add gradual closure prevoicing near the end of the closure interval before release, with different strengths by consonant.
- Burst excitation is front-loaded and decays rapidly, combining the consonant-shaped noise with a smaller broadband component instead of using one symmetric burst envelope.
- `/n m N/` get a stronger nasal onset and slower nasal release. Moraic `ん` keeps the longest release; `/m/` is slightly stronger/longer than `/n/`.
- The nasal smoothing path now follows nasal strength, helping the nasal pole/anti-formant transition connect into the following vowel instead of behaving like an on/off effect.

All transient fields remain undefined in AUTO COMPOSE singing events. The speech-only path therefore gains more realistic Japanese consonant onsets without changing the singing model.

### 36. HQ glottal microstructure and vowel-dependent source–tract coupling

This pass reduces the remaining perfectly periodic / synthetic quality without turning normal speech into obvious vocal fry.

- **Cycle-to-cycle amplitude microvariation:** HQ updates a deterministic target once per glottal cycle, then follows it smoothly sample-by-sample. The modulation depth stays below roughly two percent, so it breaks exact periodicity without audible tremolo. FAST keeps it disabled.
- **Very light subharmonic component:** HQ adds a tiny half-rate glottal derivative component. It is pitch-gated so the effect fades away at higher F0, and phrase-finality raises it only modestly. Serious delivery can carry slightly more; excited delivery slightly less. This is intended as microstructure, not a constant creaky-voice effect.
- **Vowel-dependent source–tract coupling:** the speech source receives a small feedback contribution from the F1 resonator. Open/back vowels such as /a/ and /o/ use more coupling than /i/ and /e/, adding body without changing the planned F0 or explicit formant targets.
- These controls are HQ-only and remain undefined in AUTO COMPOSE singing events.

The design deliberately keeps subharmonic depth very low. Strong period doubling sounds stylistic and should remain part of explicit delivery/finality controls rather than the neutral voice baseline.

### 37. Lessons from `Corvelis/irodori-tts-coreml` (reviewed at commit `948f17d`)

`irodori-tts-coreml` is an Apache-2.0 community Core ML runtime for Irodori-TTS v4.1 Small MF. The most useful ideas for VOICE LAB are not its multi-gigabyte model files, but the productization strategy around few-step inference, model staging, input-length routing, and repeatable quality validation.

#### What was adopted

- **Length-aware inference strategy.** Irodori preserves a short-utterance path and switches long single Japanese sentences to a different four-step MeanFlow schedule. VOICE LAB now classifies each plan as `SHORT`, `NORMAL`, `LONG·4STEP`, or `MULTI`.
- **Four-step schedule metadata.** Normal/short/multi plans use four equal refinement intervals; long single sentences use `[0.125, 0.125, 0.25, 0.5]`, matching the front-loaded four-step interval allocation used by the Core ML runtime. In VOICE LAB this metadata controls deterministic DSP stability/coarticulation rather than pretending to run MeanFlow.
- **Long single-sentence stability.** Long one-sentence HQ rendering slightly increases residual smoothing, closure smoothing, and tract carry while reducing cycle-to-cycle phonation variation. This avoids accumulated timbre jitter without flattening prosody.
- **Short-utterance protection.** Irodori removes a terminal full stop from model conditioning only for very short Japanese inputs to avoid excess allocation. VOICE LAB keeps punctuation for intonation, but shortens only the final silence for short utterances, preserving the linguistic cue while avoiding a sluggish tail.
- **Fixed quality corpus.** A reusable VOICE LAB benchmark suite now covers short speech, neutral speech, questions, hesitation, sibilants, stops, nasals, repair/rethink events, long single sentences, and multi-sentence input. CI checks finite plans, non-flat pitch motion, repair gaps, question behavior, and strategy selection.
- **Strategy visibility.** Local playback status now shows `SHORT`, `NORMAL`, `LONG·4STEP`, or `MULTI`, making the active HQ routing observable instead of hidden.

#### What was deliberately not copied

- The Core ML model bundle is about 2.99 GB in the standard form and about 1.96 GB in its INT8 variant. That is appropriate for a native iOS/macOS app with Core ML, but not for the current Safari/PWA default path.
- The Core ML runtime uses a text encoder, speaker encoder, duration model, cached context, a MeanFlow DiT, staged DACVAE decoding, and AudioSeal. VOICE LAB does not claim to reproduce those neural components with DSP.
- Reference-audio voice cloning and caption-conditioned Voice Design require the trained Irodori model. VOICE LAB keeps its deterministic character/expression controls until a genuinely small browser-compatible model is available.
- AudioSeal is not added to the current browser DSP path. If a future neural/native synthesis backend is distributed, provenance/watermark requirements should be reviewed together with that model's license and deployment mode.

#### Native/iPhone lesson for a future optional backend

Irodori's v0.2.0 runtime shows that stage-specific precision and selective quantization can preserve quality better than quantizing everything indiscriminately: its large text encoder is stored as INT8 while computation/output remain FP32, the DiT uses mixed precision, and decoder stages keep their validated precision. If VOICE LAB later gets a native Core ML companion, it should follow the same principle: compress the memory-heavy conditioning model first, keep the small quality-critical source/decoder layers at higher precision, and validate every model variant separately.

The current browser architecture remains:

`Open JTalk -> editable prosody -> adaptive utterance strategy -> mora control frame -> articulatory/timbre/H+N source-filter DSP -> optional HQ residual`

A future native Core ML backend would be an additional engine, not a replacement for the instant no-download browser path.


### 38. Separated speaker identity conditioning inspired by Irodori

The next adopted idea is the separation between a stable reference/speaker condition and a changing delivery instruction. Sound Wave still does not perform neural reference-audio cloning; instead the procedural voice now has a compact deterministic identity vector.

- `VoiceIdentityConditioning` stores a stable five-band spectral fingerprint, source tilt, presence placement/gain, breath baseline, and radiation bias for each voice character.
- The vector is keyed by character, tone, and tract length and cached for the utterance.
- Expression presets no longer modify the `VoiceCharacter` tone input itself. Calm, excited, serious, whisper, and narration become relative delivery deltas layered on top of the same character anchor.
- Formant energy, source tilt, breath, and upper-presence receive conservative identity corrections while pitch, timing, articulation, aspiration, phrase finality, and local expression remain in the delivery layer.
- The target is perceptual continuity: changing expression should sound more like the same speaker changing delivery and less like switching synthetic characters.
- This remains local deterministic DSP. It does not ingest a person's recording, create a neural speaker embedding, or claim voice cloning.


### 39. Local Voice Imprint: reference-derived DSP identity without cloning

VOICE LAB can now analyze an authorized reference recording locally and derive a compact speaker-tendency vector without uploading or persisting the source audio.

- The browser decodes the selected audio locally and downmixes it to mono. Up to 20 seconds are analyzed; 3–10 seconds of clear single-speaker speech remains the recommended input.
- A small frame sampler estimates median F0 with normalized autocorrelation and calculates coarse five-band spectral energy using Goertzel analysis. High-band spectral flatness estimates breath/noise tendency, while upper-band centroid/energy estimate presence placement and strength.
- The resulting `VoiceIdentityImprint` contains only bounded numeric controls: five spectral gains, source tilt, presence center/gain, breath baseline, radiation bias, reference F0, confidence, and analyzed duration.
- The original audio bytes are not written to localStorage. Only the compact numeric imprint is persisted.
- Imprint controls are blended conservatively into the selected NATURAL / SOFT / CLEAR / AIRY / POWER identity according to analysis confidence. Character controls remain authoritative rather than being replaced by the recording.
- A sufficiently confident reference also initializes the PITCH control from its median F0; the user can freely edit pitch afterward.
- Delivery/expression remains separate. CALM / EXCITED / SERIOUS / WHISPER / NARRATION therefore operate on top of the same imported identity tendency instead of rewriting it.

This is intentionally not neural voice cloning, speaker embedding inference, or impersonation. It is a low-dimensional DSP matching aid designed for privacy, offline use, predictable mobile cost, and editable synthesis.


### 40. Irodori-style reference normalization, cache reuse, and quality gating

A second pass over `irodori-tts-coreml` focused on the reference-registration path rather than the neural model itself. Irodori decodes reference audio to 48 kHz mono Float32 before hashing/conditioning, reuses prepared reference features by content digest, and recommends clear 3–10 second single-speaker clips without long silence or clipping. VOICE LAB now mirrors those operational ideas in the lightweight DSP path.

- **48 kHz mono normalization.** Imported audio is first downmixed and resampled to 48 kHz before any Voice Imprint statistics are computed. This makes the extracted F0/spectral controls less dependent on whether an iPhone recording arrived at 44.1, 48, or another supported rate.
- **Normalized-content SHA-256 cache.** The normalized Float32 reference is hashed with Web Crypto. Up to six recent numeric Imprints are cached by digest, so selecting the same acoustic content can skip repeated Goertzel/F0 feature extraction. As in Irodori, normalization still happens before the cache decision.
- **No source-audio persistence.** The cache stores only the compact numeric `VoiceIdentityImprint`; it does not retain the selected recording bytes.
- **Reference quality report.** Analysis now measures active-speech ratio, clipping rate, RMS level, and median F0 dispersion. Severe clipping is rejected, while silence-heavy or unstable references reduce the confidence used to blend the Imprint into the procedural character.
- **3–10 second preference.** Duration contributes to the quality score: 3–10 seconds gets full duration credit, very short clips are trusted less, and long clips receive a modest penalty rather than being treated as automatically better.
- **Observable quality.** The UI reports EXCELLENT / GOOD / FAIR / POOR with F0 and confidence, and explicitly states that the reference is normalized to 48 kHz mono.
- **Legacy compatibility.** Existing version-1 Imprints remain valid; the new quality block is optional when loading older saved settings.

This preserves the same privacy boundary as the earlier Voice Imprint feature: there is no neural speaker embedding, no model fine-tuning, and no network upload. Irodori's registration design is used as an engineering pattern for normalization, caching, and input-quality control rather than as a claim of equivalent voice cloning.


### 41. Continuous sentence chunks for long-form speech

Irodori's streaming guidance treats completed sentences as the right unit for a conversational TTS queue: feed confirmed sentences in order, keep one engine alive, and keep the playback buffer continuous rather than tearing the engine/player down for every sentence. Its text path also bisects overlong model inputs near punctuation instead of silently truncating them.

VOICE LAB now applies the same long-form principle to its deterministic AudioWorklet architecture.

- **Sentence-aware processing chunks.** Multi-sentence scripts expose one processing chunk per sentence. This is metadata and stability routing only; playback is still scheduled into one persistent AudioWorklet.
- **Natural bisection of oversized sentences.** A sentence above 36 mora units is recursively split near the midpoint, preferring accent boundaries, planned breaths, connective endings, and discourse-list/subject boundaries. If none is available, a balanced midpoint is used.
- **No speaker reset.** All chunks share the same cached `VoiceIdentityConditioning`, Voice Imprint, character controls, output bus, and AudioWorklet state.
- **Internal-fragment continuity.** A chunk created only because one sentence is long gets slightly stronger formant carry and vowel-transition smoothing at its entry. F0 is not reset there.
- **Real sentence restart.** A new sentence clears the previous F0 glide state so it can begin cleanly, while retaining the same timbre/identity condition.
- **Reduced per-chunk randomness.** Deterministic pitch/velocity/attack/timing microvariation is attenuated in long-form mode, especially at chunk starts, so each sentence does not sound like a separately randomized take.
- **HQ stability by chunk.** Residual smoothing and phonation variation are made more conservative for long-form chunks without changing the user's mora-level PITCH / ENERGY / TIMING edits.
- **Document continuity.** Sentence-final creak/breath is softened for non-final sentences in a document. The last sentence keeps the full requested finality.
- **Visible routing.** Playback status now reports the chunk count when more than one long-form chunk is active.

This differs from Irodori's neural PCM streaming implementation: Sound Wave still pre-schedules its lightweight DSP events. The adopted idea is the stable long-form boundary and state-management model—natural text chunks, one persistent voice identity, one continuous playback path.


### 42. System-TTS parity pass: reduce spectral hype, improve consonant timing

A parity review against the SYSTEM TTS path highlighted a structural difference: the procedural engine had been obtaining intelligibility partly through large broadband/presence boosts (especially F3–F5 and sibilant noise), while system voices tend to keep a fuller vowel body and make consonants readable through better class-specific timing and spectral shape.

The browser environment used for repository work cannot capture and audition the user's iPhone system voice directly, so this pass does not claim a literal iPhone recording ABX test. The comparison is grounded in the app's two synthesis paths, the deterministic DSP parameters, and regression metrics; the UI still exposes SYSTEM TTS for direct device-side A/B listening.

Changes:
- F3–F5 speech-only boost was reduced substantially, preserving F1/F2 body.
- The global post-tract high shelf is capped lower.
- Sibilants, affricates, and /f h/ now have separate noise/frication/air profiles instead of one generic "fricative" multiplier.
- Frication now uses a fast attack and earlier decay to avoid a long synthetic hiss tail.
- Neutral/falling sentence-final creak and breath were reduced; serious delivery retains extra closure but no longer over-creaks.
- SYSTEM TTS voice selection now prefers exact ja-JP, local voices, and premium/enhanced/Siri-labelled voices where the browser exposes them, while de-prioritizing compact voices.
- Tests now enforce bounded sibilant brightness and class ordering instead of requiring the previous oversized high-frequency boost.

The target is not to imitate a proprietary system voice. It is to close the perceptual gap in the categories where the procedural path was objectively overemphasized: high-frequency spectral tilt, fricative persistence, and terminal phonation.


### 43. 2026 broad TTS survey: what can materially improve Voice Lab next

A broad literature/code pass covered modern flow/LM TTS, Japanese-specialized systems, source-filter vocoders, browser inference, and evaluation. The important conclusion is that VOICE LAB should not chase one architecture. The best path is a two-tier design:

1. **Instant DSP** remains the default: tiny, deterministic, editable, offline, and immediate.
2. **Optional Neural HQ** can be loaded on capable devices for final rendering/listening, while sharing the same Japanese G2P/prosody editor and reference-conditioning UI.

#### A. Highest-value improvements that fit the current AudioWorklet DSP

**1. WORLD-style banded aperiodicity**

WORLD's core representation separates speech into F0, harmonic spectral envelope, and an aperiodicity envelope. VOICE LAB currently has harmonic/noise controls, but most aperiodicity is still represented as a small number of global noise/aspiration scalars.

Next step:
- add 4–6 time-varying aperiodicity bands (roughly low/body, mid, presence, sibilance, air);
- compute each band's voiced/noisy ratio from consonant class, devoicing, expression, phrase position, and Voice Imprint;
- crossfade the bands per 5–10 ms control frame rather than per mora only;
- keep pitch-periodic excitation and unvoiced excitation separate until the final tract/filter stage.

This is likely the highest-return DSP change because it improves breathiness, fricatives, devoiced /i,u/, aspiration, and the transition between voiced and unvoiced regions without globally brightening the voice.

**2. Full LF-style glottal source with an Rd-like voice-quality coordinate**

Modern neural source-filter systems still benefit from explicit periodic excitation and F0 control. The classic LF model gives a physically meaningful glottal pulse shape instead of relying only on open quotient / speed quotient heuristics.

Next step:
- implement a numerically stable LF or LF-inspired derivative source in the AudioWorklet;
- expose one compact voice-quality coordinate analogous to Rd, with safe bounds;
- map DELIVERY and TIMBRE onto that coordinate;
- extend Voice Imprint with glottal estimates such as spectral tilt, harmonic-to-noise ratio / cepstral prominence proxies, and closure sharpness;
- use the current source/filter coupling as a modulation around the LF source rather than as the primary pulse shape.

**3. Japanese phrase + accent superposition layer**

The Fujisaki/Hirose model represents log-F0 as a base plus phrase and accent components. This remains a useful engineering representation for Japanese because it prevents implausible frame-to-frame pitch wiggle and maps naturally to accent phrases.

Next step:
- preserve the existing mora-level lexical accent;
- add a phrase command / declination component over each accent phrase;
- add an accent command component around the lexical accent nucleus;
- let user pitch-draw edits become residuals on top of this structured contour;
- scale phrase/accent command strength with speaking rate and expression.

This should improve the current gap between "correct accent" and "natural Japanese intonation".

**4. Keep punctuation as an explicit prosody channel**

Style-Bert-VITS2's Japanese frontend deliberately reconstructs punctuation after extracting Open JTalk accent information because punctuation type/count otherwise disappears. This is directly applicable to VOICE LAB.

Next step:
- represent comma, period, question mark, exclamation, ellipsis, dash, repeated punctuation, and brackets as explicit prosody tokens;
- do not collapse repeated marks into the same pause;
- feed punctuation tokens to pause duration, boundary tone, breath probability, energy reset, and expression intensity;
- keep lexical pitch accent in a separate channel from punctuation/prosody.

**5. Formant-locus transitions rather than only vowel-to-vowel interpolation**

Consonant identity is strongly carried by CV transitions. The current tract system already interpolates formants, but the target should depend more strongly on consonant place/manner.

Next step:
- add per-consonant F1/F2/F3 locus targets;
- interpolate from the locus into the vowel target over the consonant-specific transition;
- use shorter transitions for stops, longer ones for approximants /j,w,r/, and noisy overlays for fricatives;
- vary formant bandwidth and damping during the transition, not only center frequency.

**6. Anti-aliasing / periodicity discipline from modern vocoders**

BigVGAN's AMP blocks and PeriodWave both reinforce the lesson that periodic structure must be modeled explicitly and that high-frequency aliasing hurts perceptual quality.

For VOICE LAB:
- oversample only the glottal excitation / sharp closure path when HQ is active;
- low-pass before downsampling;
- avoid adding broadband brightness after the tract merely to recover clarity;
- prefer periodic-source quality plus consonant-specific aperiodicity over generic high shelves.

#### B. Japanese-specialized neural references

**Style-Bert-VITS2 / JP-Extra**

Important transferable ideas:
- phones and pitch-accent tones are parallel inputs;
- punctuation is retained as a distinct sequence;
- text/style context and speaker identity are separated;
- manual accent correction is a first-class feature.

A 2025 Japanese expressive-TTS benchmark reported Style-BERT-VITS2 JP Extra near human ground-truth naturalness on its evaluated character datasets. This makes it a valuable Japanese quality reference, even when its complete stack is too heavy or license-sensitive for direct inclusion.

**VOICEVOX / AivisSpeech**

Useful product-design lessons:
- accent phrases are editable objects rather than hidden model state;
- devoicing, accent nucleus, pause boundaries, question endings, and kana pronunciation can be inspected and corrected;
- AivisSpeech uses ONNX Runtime for Style-Bert-VITS2-family inference, confirming that a Japanese neural path can be packaged without PyTorch.

#### C. Browser/local neural candidates

**Kokoro 82M**
- 82M-parameter TTS;
- ONNX / Transformers.js browser implementations exist;
- quantized q8/q4 variants are available;
- official Kokoro has Japanese voices and a Japanese G2P path;
- however Japanese training data/voice quality is weaker than its best English voices and there have been Japanese G2P/inference issues in the ecosystem.

Recommendation: useful as a **browser neural baseline** and integration prototype, not yet the default Japanese quality target.

**Piper / sherpa-onnx / piper-plus**
- proven ONNX/WASM browser TTS path;
- sherpa-onnx documents WASM TTS builds;
- community piper-plus adds Open JTalk and Japanese browser support.

Recommendation: useful to benchmark model-load time, offline caching, worker architecture, and iPhone memory behavior. Expected ceiling is lower than the latest large TTS models, so use mainly as deployment research.

**MOSS-TTS-Nano 100M**
- released in 2026;
- about 100M parameters;
- ONNX CPU version;
- 48 kHz output and streaming;
- Japanese among its supported languages;
- project demonstrates browser-side ONNX integration and reports CPU-friendly inference.

This is currently the most interesting *technical* fit for VOICE LAB's optional Neural HQ tier. However, its repository/model licensing is not sufficiently clear for redistribution at the time of this survey. Do not ship or bundle weights until the license is explicit and compatible.

**Qwen3-TTS**
- 0.6B / 1.7B family;
- Japanese among ten languages;
- 3-second voice cloning and instruction-based control;
- 12 Hz / 25 Hz speech tokenizers;
- streaming design with reported first-packet latency down to about 97 ms;
- Apache-2.0 code.

Recommendation: architecture/reference target, but too large for the primary iPhone-browser path today. Its low-rate speech-token design is especially worth following for future smaller distilled models.

#### D. Modern architecture lessons worth borrowing, not porting literally

**F5-TTS / flow matching**
- simple non-autoregressive flow-matching speech generation;
- inference-time sampling schedule matters significantly (Sway Sampling);
- reinforces the idea that a small number of well-placed refinement passes can outperform uniform refinement.

This validates VOICE LAB's current nonuniform HQ refinement idea, but a true F5 port would require a large learned model.

**CosyVoice 2 / 3**
- chunk-aware causal flow matching enables streaming and offline generation in one system;
- later work improves tokenizer supervision using ASR/emotion/language/audio-event/speaker tasks;
- post-training reward models are used to improve content, speaker, and prosody quality.

Transferable idea: define explicit chunk-state and quality signals, and evaluate pronunciation/prosody separately rather than with one generic quality score.

**BigVGAN / PeriodWave**
- periodic inductive bias matters;
- anti-aliasing around nonlinear/periodic operations matters;
- waveform refinement should preserve periodicity rather than smear it.

**SiFi-GAN / HN-uSFGAN / NSF**
- explicit F0 source plus learned/filter path remains useful even in high-quality neural vocoders;
- harmonic + noise decomposition is a strong bridge between VOICE LAB's controllable DSP and modern learned vocoders.

#### E. Evaluation: stop relying only on "sounds better"

Future changes should use a repeatable evaluation pack.

Minimum regression corpus:
- vowels /a i u e o/ at multiple pitches;
- stop contrasts /k t p g d b/;
- fricatives /s sh z j f h/;
- moraic nasal and geminate;
- devoiced /i,u/ contexts;
- heiban / atamadaka / nakadaka / odaka words;
- questions, exclamations, ellipses, repeated punctuation;
- long accent phrases and multi-sentence paragraphs;
- neutral, calm, serious, excited, whisper;
- Voice Imprint on/off.

Recommended automated metrics:
- UTMOS/UTMOSv2 for predicted naturalness;
- ASR CER/WER for intelligibility;
- F0 contour / DTW-style pitch similarity for prosody;
- spectral centroid / high-band energy to catch over-bright sibilants;
- voiced/unvoiced transition timing;
- speaker embedding similarity when a reference voice is explicitly supplied.

Automated scores are not substitutes for listening. Keep an iPhone A/B panel against SYSTEM TTS and a small set of fixed reference clips.

#### F. Recommended implementation order

1. **Banded aperiodicity + LF source** — highest expected improvement per unit of browser cost.
2. **Japanese phrase/accent superposition + punctuation lane** — highest Japanese naturalness gain without a model download.
3. **Consonant formant-locus / bandwidth transitions** — improves articulation without restoring harsh high-frequency boosts.
4. **Objective evaluation harness** — prevents quality regressions and makes later tuning measurable.
5. **Optional browser Neural HQ prototype** — benchmark Kokoro and/or another clearly licensed small ONNX model behind a feature flag.
6. **Re-evaluate MOSS-TTS-Nano licensing** — technically promising for Japanese/iPhone, but do not redistribute until licensing is clear.
7. **Track distilled Qwen3-TTS / CosyVoice-class models** — strong future candidates when sub-200M browser-friendly derivatives appear.

The important architectural principle is to keep the existing editable prosody/timbre layer even if a neural renderer is added. The neural renderer should consume the same structured Japanese analysis rather than replacing the editor with an opaque text-to-waveform button.


### 44. LF-style source and banded aperiodicity implementation

The first high-impact items from the 2026 survey are now implemented in the realtime browser renderer.

- **HQ-only LF-style source.** Spoken HQ events now carry an LF-style blend and an Rd-like voice-quality coordinate. The AudioWorklet uses a stable realtime approximation with an explicit opening, closure, and return phase. It is deliberately described as LF-style rather than a bit-for-bit implementation of the canonical analytic LF equations.
- **Delivery-aware Rd.** Serious/excited speech receives a tighter source; calm/whisper receives a softer, more open source. Neutral sits between them. The existing character/tone controls remain independent.
- **WORLD-inspired four-band aperiodicity.** White excitation is split by continuous one-pole crossover states into low, mid, presence, and air bands before entering the tract.
- **Phoneme-specific band weights.** Vowels retain mostly periodic energy with a small low/mid aperiodic component. Sibilants emphasize presence/air, affricates emphasize mid/presence, /f h/ emphasize mid/air, nasals remain low-heavy, and devoiced Japanese /i,u/ strongly increase presence/air aperiodicity.
- **No generic brightness compensation.** Aperiodic energy is injected before the vocal tract at a conservative level, so intelligibility can increase without restoring the harsh global high-shelf behavior removed in the previous parity pass.
- **FAST compatibility.** FAST DSP keeps the old source path: LF blend and banded aperiodicity are both zero there.
- **Cost control.** The extra work is three one-pole states plus a few arithmetic operations per sample in HQ. Existing 2x source evaluation remains the only oversampling step.

This is an intentionally lightweight bridge between classic source-filter synthesis and modern harmonic/noise neural vocoders. It preserves deterministic editing, offline browser execution, and the existing Voice Imprint / prosody pipeline.


### 45. Consonant formant-locus transitions

The next source-filter quality pass improves CV transitions without adding any new per-sample DSP stage.

- **Digraph-aware loci.** The onset-locus lookup now recognizes /sh/, /ch/, /ts/, and /j/ explicitly instead of using only the first character of the romanized syllable. This fixes the previous case where "shi" collapsed to plain /s/ and "chi" had no dedicated onset locus.
- **Expanded Japanese onset table.** Separate acoustic transition anchors now exist for voiced stops, palato-alveolar fricatives/affricates, /w/, /v/, Japanese /r/, nasals, bilabials, velars, and coronals.
- **Place/manner-specific transition time.** Stops move rapidly into the vowel; fricatives/affricates retain their locus longer; /j,w,r/ retain moving resonance cues longest.
- **Per-band transition bandwidth.** Coronal/affricate upper formants broaden during the onset, bilabials remain softer, glides stay narrower, and nasals widen lower resonances.
- **No extra high shelf.** The clarity gain comes from the trajectory of F1/F2/F3 and their bandwidth, not from adding broadband treble.
- **Near-zero runtime cost.** The existing AudioWorklet interpolation is reused; the new work is event-time parameter selection only.

This complements the LF-style source and banded aperiodicity: the source now has more realistic periodic/noisy structure, while the tract carries a stronger consonant-place cue into each vowel.


### 46. Two-layer Japanese F0: phrase baseline + accent command

VOICE LAB now separates Japanese pitch generation into explicit long- and short-time-scale layers instead of mixing sentence shape and lexical accent in one contour formula.

- **Phrase layer.** A Fujisaki/Hirose-inspired engineering approximation provides a sentence-start phrase command that decays smoothly, sentence-level declination, partial resets at accent-phrase boundaries, and phrase-by-phrase downstep.
- **Accent layer.** Lexical Open JTalk H/L labels remain authoritative when present. H plateaus now decline gently inside the accent phrase; initial L and post-nucleus L use different targets. Kana-only inferred accent phrases retain a smaller L→H contour.
- **Layer independence.** Supplying lexical accent no longer collapses the sentence phrase contour to a fraction of its normal range. This prevents the common failure mode where pronunciation is lexically correct but the whole sentence sounds locally stepped and globally flat.
- **Terminal layer.** Question, content-question, exclamation, explicit rise/fall, and declarative final lowering are applied after the phrase/accent layers. They no longer have to distort lexical H/L targets to create sentence modality.
- **Boundary/discourse layer.** Comma resets, connective continuation, topic/list/quote cues, focus, hesitation, and sentence attitude remain separate residual motion.
- **Microprosody layer.** Consonant-induced tiny F0 perturbations remain small and independent.
- **Neural-ready metadata.** Each planned spoken mora now exposes `phraseF0Offset` and `accentF0Offset` separately, so a future Neural HQ renderer can consume the same structured Japanese prosody instead of reverse-engineering one flattened F0 value.
- **Manual edits stay last.** User PITCH drawing, phrase pitch edits, expression offsets, and emphasis remain additive after the structured automatic contour.

This is not a numerical implementation of the original Fujisaki equations. It borrows the important decomposition—slow phrase command plus faster accent command—while preserving the existing deterministic semitone-domain editor and Open JTalk accent labels.


### 47. Explicit punctuation prosody tokens

Punctuation is now preserved as a first-class prosody channel instead of collapsing immediately into pause duration and sentence type.

- Each spoken mora can carry `punctuationAfter` and bounded `punctuationCount`.
- Supported tokens distinguish comma, period, question, exclamation, ellipsis, dash, semicolon, middle-dot/slash, and line break.
- Repeated marks such as `？？` and `！！！` retain bounded strength rather than becoming identical to a single mark or growing without limit.
- Ellipsis and dash are no longer only `expressivePauseAfter`; they also keep their token identity.
- Tail prosody is token-specific:
  - comma stays slightly open and softer;
  - period lowers and settles;
  - question adds a small terminal lift on top of sentence-question intonation;
  - exclamation shortens and energizes;
  - ellipsis lengthens, lowers energy, and adds breath;
  - dash creates interruption tension rather than a generic long pause.
- Restart prosody is also token-specific. The first mora after punctuation can receive a small pitch/energy/rate reset, so a comma continuation does not restart like a full stop and a dash restarts more abruptly.
- Punctuation breath is added to the existing finality model instead of replacing expression/attitude.
- Repeated punctuation is deliberately conservative: it changes delivery strength but never creates extreme pitch or gain values.

This follows the useful Style-Bert-VITS2 frontend lesson that punctuation carries information lost by lexical accent extraction. In VOICE LAB it remains an explicit deterministic control lane, independent from lexical H/L, phrase F0, sentence modality, and manual PITCH edits.


### 48. Dynamic clarity unmasking without treble hype

A clarity-specific HQ pass now targets masking rather than simply adding more high-frequency energy.

- **Consonant-onset vocal ducking.** During the short consonant portion of a CV mora, the periodic vocal-tract source is reduced by a small amount. Frication/burst energy is left intact, so the consonant edge is easier to hear without increasing noise gain.
- **Dynamic low-mid cleanup.** Two cheap one-pole states isolate a broad low-mid body band (roughly the region where F1/body energy can mask articulation). HQ removes only a conservative fraction of this band.
- **Presence focusing.** The existing post-tract presence shelf is no longer equally strong through the vowel body. HQ keeps more of it on consonant cues and backs it off on sustained vowel portions, reducing "bright haze".
- **Character aware.** The CLEAR character gets the strongest unmasking, NATURAL remains moderate, SOFT/AIRY/POWER are less aggressive.
- **Expression aware.** Whisper deliberately reduces clarity processing because its identity depends on diffuse aperiodic energy and aggressive unmasking would make it papery.
- **FAST untouched.** All new clarity parameters are zero in FAST mode.
- **Very low runtime cost.** The additional per-sample work is two one-pole states and a small number of multiplies; there is no FFT, convolution, or new model.

This stage complements the earlier naturalness pass: articulation is made easier to hear by reducing simultaneous masking energy, not by restoring the harsh global high-frequency boosts that were removed during SYSTEM TTS parity tuning.


### 49. Optional Neural HQ renderer: Kokoro 82M + browser Open JTalk

The largest quality step is now architectural rather than another DSP tuning pass. VOICE LAB adds an optional **NEURAL HQ** renderer while preserving the existing deterministic DSP renderer and SYSTEM TTS for direct A/B comparison.

Why this renderer:
- Kokoro 82M is small enough to have practical quantized ONNX browser builds and its model family is Apache-2.0.
- `kokoro-js-jp` provides a browser-only Japanese path: Kokoro synthesis plus Open JTalk WASM G2P, without a server/container.
- The integration is pinned to `kokoro-js-jp@0.2.0` instead of floating latest, so deployments remain reproducible.
- The model is loaded as q8 only after the user explicitly selects NEURAL HQ and presses SPEAK. The normal game and DSP path pay zero model memory/network cost.
- Japanese dictionary assets remain lazy inside the library and are fetched on the first Japanese utterance.
- The current stable backend is WASM. WebGPU is deliberately not forced yet because Safari support and ONNX operator/backend behavior can vary; quality is unchanged by using WASM.
- iOS playback uses an already-unlocked Web Audio context and the returned PCM rather than relying on a delayed HTMLMediaElement `play()` call after model download.

Current control mapping:
- VOICE character selects one of five Japanese Kokoro voices.
- RATE and DELIVERY affect neural speaking speed.
- ENERGY controls playback gain.
- DSP-specific hand-drawn F0, VTL, source/filter parameters, and Voice Imprint remain DSP-only for now.

This is a true dual-renderer architecture: DSP remains immediate/editable and lightweight; Neural HQ is the higher-naturalness final-listen path. Future work can pass the structured phrase/accent/punctuation representation into a neural conditioning or post-render alignment layer rather than discarding the editor.

MOSS-TTS-Nano was also reviewed as a technically strong ~100M multilingual ONNX/browser candidate, but its upstream repository explicitly says to treat it as not licensed for redistribution until a root LICENSE is published. It is therefore not bundled or dynamically integrated at this stage.


### 50. VOICE LAB controls on Neural HQ without discarding model quality

Neural HQ now consumes the existing VOICE LAB editor through a conservative adapter instead of treating Kokoro as an opaque text box.

Quality-first rules:
- **Unedited speech stays exactly model-native.** If no VOICE LAB edit is active, the original text is sent to Kokoro in one utterance exactly as before.
- **Editing creates the fewest practical neural segments.** Natural sentence boundaries, explicit SPLIT/PAUSE, local-delivery changes, or materially different control regions can create segments. Minor frame/mora differences are averaged rather than generating every mora independently.
- **RATE / TIMING are model-native.** Per-region timing is converted into Kokoro speed before inference.
- **ENERGY / EMPHASIS are model-native + clean gain staging.** Expression and phrase energy feed segment gain, with final peak normalization rather than clipping.
- **LOCAL DELIVERY is preserved.** Different tagged expression spans can use different neural speed/energy behavior while keeping the selected Kokoro speaker identity.
- **PITCH DRAW / phrase pitch use a safe adapter.** Kokoro exposes no direct F0 conditioning. Large DSP-style pitch shifting would damage the neural timbre, so manual/phrase pitch is compressed through a tanh curve to about ±0.65 semitone. Global PITCH/TONE plus local edits are finally bounded to ±0.75 semitone.
- **Pitch duration compensation.** The tiny pitch shift is performed with cubic PCM resampling, while model speaking speed is changed inversely before synthesis so edited pitch does not unintentionally stretch/compress the phrase.
- **Accent nucleus edits affect a subtle neural pitch envelope.** They can create a bounded H/L bias and, when necessary, one quality-safe boundary around a user-edited H→L nucleus. They do not attempt to force Kokoro with unsupported hidden model controls.
- **SPLIT/JOIN/PAUSE map to real neural phrase boundaries.** A split can add a Japanese comma cue plus an explicit residual silence; JOIN removes that artificial boundary.
- **Independent segments use an 8 ms equal-power crossfade** when no pause is requested, avoiding clicks and hard seams.
- **VTL and Voice Imprint remain DSP-only.** Kokoro 82M has fixed speaker embeddings and no supported tract-length or arbitrary reference-speaker conditioning API. Faking either with heavy formant processing would defeat the goal of preserving Neural HQ quality.

The adapter therefore moves the controls that can be represented cleanly, and deliberately refuses destructive approximations for controls the model does not expose.


### 51. Natural Neural HQ segmentation: linguistic boundaries before control changes

The first VOICE LAB-to-Neural adapter over-segmented edited speech. It could start a new Kokoro inference pass at an edited H→L accent nucleus, at a small PITCH/ENERGY/TIMING discontinuity, or after only 16 mora. Each restart is acoustically clean, but repeated model prosody resets can sound like unnatural phrase chopping.

The segmentation policy is now quality-first:

- H→L accent nuclei **never split by themselves**.
- Small neighboring PITCH, ENERGY, TIMING, and phrase-control differences are averaged inside the current neural phrase.
- Natural boundaries are preferred: explicit comma/punctuation, connective/discourse boundaries, sufficiently long linguistic pauses, sentence ends, and user SPLIT.
- LOCAL DELIVERY changes remain explicit boundaries because they request a different delivery style, but short fragments are avoided when possible.
- Long edited speech is allowed to continue for roughly 18+ mora and waits for a natural boundary.
- A hard safety cut is delayed to 34 mora.
- Hard safety cuts receive **no synthetic Japanese comma**, preventing an audible comma where the writer did not put one.
- Synthetic comma cues are limited to user or language-visible phrase boundaries.

This restores more of Kokoro's native phrase planning while keeping VOICE LAB controls useful.


### 52. Instant same-sentence Neural HQ replay

Neural HQ previously called `tts.speak()` every time the user pressed SPEAK, even when replaying the same text with unchanged settings. The q8 ONNX inference cost dominated replay latency.

- After a successful first render, final edited/un-edited mono PCM and its sample rate are stored in a **session-only LRU cache**.
- A replay of the same voice, text, rate, energy, global pitch/tone, global delivery, and every neural prosody segment uses the cached waveform immediately, skipping both model loading and Kokoro inference.
- The cache key incorporates Kokoro integration version, speaker, full segment text and order, rate/energy/pitch/pause, and local expression. Changing edits automatically misses the cache; restoring settings can hit an older entry.
- Because the **final waveform** is cached, repeat playback preserves the original neural timbre, pitch compensation, edited pause timing, and crossfades exactly.
- A conservative **24 MiB / 8 recordings** LRU limit bounds Float32 PCM memory on iPhone. Oldest unused recordings are evicted; oversized clips simply use the uncached path.
- Cache survives STOP, engine switches and VOICE LAB deactivation while the app remains open, but is intentionally not persisted into localStorage, IndexedDB or a service worker.
- The first synthesis still requires the model and Japanese dictionary. Repeat playback avoids inference, but AudioContext may need a fast `resume()` after iOS suspension.

No additional TTS model, post-processing effect, network transfer or voice-quality change was introduced.


### 53. Faster Neural HQ generation without changing q8 quality

Neural HQ now reduces both cold perceived delay and repeat inference cost while preserving the exact Kokoro q8 / WASM sound.

- **Start loading on engine selection.** When the user activates/selects NEURAL HQ, the model fetch/initialization begins immediately rather than waiting for SPEAK. This overlaps model preparation with user text editing. Persistent NEURAL HQ selection also warms when opening VOICE LAB. The Japanese Open JTalk dictionary remains lazy until first Japanese speech, avoiding an unrequested ~100MB memory cost.
- **Second-level segment inference cache.** Beyond the existing full-waveform instant replay cache (24 MiB), raw neural segments use a 12 MiB / 24-entry LRU. The key includes model/version, speaker, exact text and effective model speed.
- **Reuse unaffected phrases.** When a user changes a local pause, energy, emphasis or edits one phrase, unchanged Kokoro segments can bypass ONNX inference. Pitch or rate adjustments properly invalidate segments only when they change effective model speed.
- **No extra model.** This retains q8 WASM as the stable iPhone baseline. In particular, loading fp32 WebGPU and a second model automatically on iPhone was rejected for now due to larger weights, browser backend differences and quality/memory risks.
- **Same audio quality.** Cached raw PCM is reused before the existing tiny pitch compensation, clean gain, and click-safe merge. A full replay still short-circuits at the final waveform cache.
- **Memory bound.** Two capped RAM-only caches use up to 36 MiB of retained final + raw PCM. No IndexedDB, network uploads or server execution.

An architectural opportunity for further improvement is live incremental per-sentence playback (time-to-first-sound) or a manually controlled WebGPU experiment with verified audio output and memory budget; neither should replace the stable q8 iPhone path without device A/B testing.


### 54. Hardware accelerated Neural HQ: WebGPU opt-in

iOS Safari 26 supports WebGPU, but stock Kokoro fp32 exhibits catastrophic incorrect amplitudes in ONNX Runtime WebGPU's vocoder ConvTranspose. Thus the default SOUND WAVE Neural HQ remains q8 WASM.

- The new GPU BETA path explicitly requests an Apache-2.0 model with the vocoder transposed-convolution operators rewritten to match regular convolutions (`DevAmarnadhCG/Kokoro-82M-v1.0-ONNX-webgpu`), and loads it using `kokoro-js-jp@0.2.0` with `{dtype:'fp32',device:'webgpu',modelId:...}`.
- No GPU weights download happens unless the user explicitly selects and plays with GPU BETA. Full-precision weights are ~326 MB and browser GPU memory may need substantially more than that.
- A fail-closed numeric PCM validation rejects NaN/Infinity, abnormally large peaks and degenerate silence; an error switches the request to the stable CPU q8 path rather than playing corrupt noise.
- Cached final and per-segment speech for GPU and CPU have separate keys. GPU-fallback speech remains cached under its requested GPU identity to avoid repeating a failed inference.
- Synthesis metrics report backend, generated audio duration, elapsed time, and real-time factor (RTF). Only on-device measurement can show whether this is actually faster on the user's iPhone.
- Safari JavaScript cannot directly invoke Apple's Core ML / Neural Engine in a GitHub Pages app. A native iOS host is required for that hardware provider.

Do not replace the stable CPU q8 default until an actual iPhone A/B test verifies sound quality, latency, memory and thermal behavior.


### 55. Crash prevention after GPU BETA release

A reported iPhone Safari tab/process crash followed introduction of experimental fp32 WebGPU rendering. Root cause cannot be proved from browser-free CI or without iOS crash logs, but a high-memory OOM is plausible because the patched ONNX graph (~326 MB) requires GPU buffers, activations and concurrent Open JTalk resources. This is not catchable as a JavaScript exception if WebKit terminates the process.

Safe mitigation:
- iPhone/iPadOS are now blocked **before** loading the large fp32 graph. Detect iPadOS desktop mode through `MacIntel + maxTouchPoints > 1`.
- WebGPU-unavailable devices and browsers reporting less than 8 GB available device memory are blocked too.
- The GPU BETA switch stays visible but disabled, with a reason in its accessible title, while the stable CPU q8 NEURAL HQ remains playable.
- Previously saved `neural-gpu` selection is automatically migrated to `neural` on affected devices.
- Renderer validates GPU permission again before allocating and routes blocked requests to CPU q8.
- On capable desktops, a tab-local `sessionStorage` in-flight marker records GPU model load/inference. If the tab reloads while this marker remains, the GPU Beta engine is quarantined for the rest of that tab session and saved selection is restored to CPU. This is a best-effort crash marker, not diagnostic proof.
- The old CPU fallback remains for catchable GPU errors; the preventative memory gate is required for the uncatchable mobile termination case.
- Normal q8 CPU sound, editing, caches and DSP remain unchanged.

Future iOS acceleration should use a purpose-built native Core ML/Metal/MLX execution path or a verified lower-memory WebGPU graph. Current fp16/q4f16 GPU variants of this Kokoro vocoder have reported NaNs, so blindly switching precision is not a safety fix.


### 56. Reusable Neural HQ render stages with device-local persistent PCM

The browser Neural HQ path separates stable expensive work from cheap per-edit/per-play operations:

1. **Model + Japanese dictionary:** Transformers.js/Kokoro/Open JTalk manage their own browser asset cache; these assets are not duplicated into Sound Wave's local DB. Loading an ONNX session and Japanese dictionaries after a cold app restart still has runtime costs.
2. **Model-native inference by segment:** The immutable identifier includes the pinned model/frontend version, execution backend, character/voice, exact utterance text and effective Kokoro model speed. A raw Float32 segment is cached both in a capped RAM LRU and a **new IndexedDB persistent LRU**. Returning to the app after a reload can therefore skip Japanese G2P, tokenizer and ONNX inference for saved material.
3. **Cheap post-render adjustments:** Volume, emphasis gain, explicit pause, safe pitch resampling, crossfade and merge are reapplied from raw generated PCM. Changing only such settings does not require running neural inference. Model speed really changes neural acoustic timing and still requires inference when no matching generated segment exists.
4. **Finished voice:** The complete waveform also has an exact settings/plan key and is stored in IndexedDB. The next open can play it without initializing the heavyweight Kokoro model at all.
5. **Resource bounds:** Persistent store is maximum 24 MiB, 24 waveform entries, 8 MiB per clip, with accessed-time LRU eviction. RAM caches remain independently bounded. IndexedDB failures (including Safari private-mode or quota restrictions) silently fall back to RAM only. No speech text or waveform is uploaded to our server.
6. **Only stable CPU q8 persists:** Experimental GPU Beta is deliberately excluded from persistent speech storage on iPhone (and remains device-blocked) to avoid additional high-memory interactions. Backend/version identity prevents PCM mix-ups.
7. **Responsiveness:** IDB reads are async; writes are queued and do not delay playback. STOP interrupts stale work safely.

Trade-off: Different expression/rate settings may alter Kokoro's actual generated acoustic style or speed, so those may still require fresh model inference. The model does not expose an officially supported "phonemes + prosody tensor" direct conditioning interface through kokoro-js-jp. Persisting fake reusable model internals would risk quality/stability. Storing raw model-native waveform segments is the safe practical reusable intermediate representation.

A cached full take after restarting Voice Lab is not contingent on loading the model. If the browser evicts cached storage, normal Kokoro synthesis remains the fallback.


### 57. Persistent Open JTalk reading/accent intermediate data

VOICE LAB now saves the exact output of Japanese pronunciation parsing separately from neural PCM and ONNX weights. This makes the first expensive language stage reusable across reopens.

- **Cache contents:** script mora structure, frontend token readings, source ranges, accent phrases, full-context labels and match flag. All of these are produced by Open JTalk and are necessary to reconstruct VOICE LAB's accent/prosody editor faithfully.
- **Versioned identity:** original plain text + pinned Open JTalk dictionary/frontend version + VOICE LAB mapping version. A different sentence or future mapper version cannot accidentally receive the old pronunciation.
- **Cache before worker:** `analyzeJapaneseText` probes a persistent analysis store before downloading or initializing Open JTalk WASM and before executing `runFrontend` / `extractFullContext`. Exact cache hits return without starting any Japanese-analysis worker.
- **Restore editing:** When VOICE LAB opens or matching text is re-entered, its analysis can be restored asynchronously, guarded against outdated text edits. The existing phrase/accessory accent overrides are rebuilt from the restored original analysis.
- **Size:** IndexedDB cap 2 MiB / 64 analysis items / 200 KiB per item, with disk LRU and a small 400 KiB / 12-item RAM LRU. This is separate from the 24 MiB PCM limit.
- **Fallback:** If IndexedDB is blocked/private/evicted, RAM still works for the session and the existing Open JTalk worker can run normally.
- **Critical limitation:** Kokoro's `kokoro-js-jp@0.2.0` `speak(text)` publicly performs its own G2P/tokenization internally; it does not accept VOICE LAB's saved intermediate phonetic tensors through that API. This update speeds **VOICE LAB's G2P/analysis and editor restoration**, not the first unseen Kokoro ONNX inference. Existing raw/final PCM caching remains the primary neural latency reduction. Passing phoneme tensors into the neural model requires a verified library/model interface, not an unsafe fabricated mapping.


### 58. Kokoro-native phoneme and token caching across edits (iPhone-safe)

Inspection of pinned `kokoro-js-jp@0.2.0` source revealed that its Japanese implementation calls its own Open JTalk frontend to produce a phoneme string, then `KokoroTTS.tokenizer(phonemes)` and `generate_from_ids(input_ids)`. These phonemes are **different** from the independently stored VOICE LAB accent/prosody metadata. The upstream package has no public `speakFromPhonemes` API.

A guarded adapter now observes (without changing) the phoneme string and returned tokenizer IDs on the **first normal Kokoro `speak()`** for a phrase. It stores the exact Kokoro-native phonemes in a separate, versioned IndexedDB LRU (512 KiB / 128 phrases) and caches the runtime's original Tensor IDs in a per-model WeakMap (48 items). On the next request for the same phrase with a *different* speaker or generation speed, it uses the cached IDs and calls Kokoro's own `generate_from_ids`, skipping Open JTalk, the dictionary's frontend call and tokenizer. Following a page reload, the saved phoneme string is re-tokenized using Kokoro's own tokenizer, still skipping Japanese WASM G2P. The normal full-PCM and segment-PCM caches continue to take priority and avoid all inference where possible.

Safety:
- No handwritten phoneme table or guessed token IDs are used. Only actual outputs from the pinned Kokoro runtime enter this adapter.
- If `client.tts.tokenizer` or `generate_from_ids` is unavailable, the code falls back to the official `speak()` method.
- If a saved-phoneme direct invocation fails, normal Kokoro `speak()` is used for the current request.
- Serialization ensures interception of the library tokenizer cannot overlap between interrupted/repeated speech generations.
- Only phonemes, **not live tensors, runtime state, models or weights**, are persisted; ONNX Tensor objects are cached in RAM strictly per corresponding model instance.
- Disk write is asynchronous and bounded. Storage failures keep the regular TTS path available.
- The stable iPhone q8/WASM backend is unchanged. GPU BETA stays blocked on iOS.
- This reduces preprocessing/re-tokenization latency on new acoustic variants, **not the ONNX inference cost itself**. The most dramatic speed wins for identical parameters are still the persisted final/segment PCM caches.

The temporary tokenizer interception is coupled to the pinned library internals and must be removed if the upstream library exposes a documented token-cache API.


### 59. Coalescing repeated in-flight neural requests

A rapid second SPEAK while Kokoro ONNX was still inferring previously cancelled the first playback and then repeated the same expensive inference: the original result was discarded because playback generation changed.

A per-segment `NeuralInferenceSingleFlight` now maps an exact model+speaker+text+speed identity to its in-flight inference promise. New matching playback subscribes to the existing work instead of running a second ONNX call. The shared promise caches validated raw PCM *before* checking whether the initiating playback was stopped. Playback still observes the generation token so stale requests never speak unexpectedly. The map holds only pending jobs, and errors are removed for clean retry. Actual synthesizer calls remain serial to avoid overlapping tokenizer hooks and CPU/memory pressure on iPhone.

This does not make a genuinely new ONNX inference faster; it eliminates a particularly expensive duplicate-work path during repeated SPEAK, cancellations and quick setting reversions.


### 60. Natural long-text segmentation and PCM reuse

Long *unedited* text was previously always submitted to Kokoro as one inference pass. The pinned upstream tokenizer uses `truncation: true`; sufficiently long Japanese speech can silently lose its ending. It also invalidated the entire saved PCM when even one sentence was changed.

For text over 112 Unicode code points, a conservative splitter now groups complete Japanese sentences to stay below a safe token budget while minimizing Kokoro prosody resets. Prefer natural `。！？` and newline boundaries; exceptionally long uninterrupted sentences use commas, spaces, then `Intl.Segmenter('ja', word)` before a last-resort split without inserting punctuation. The original short-text neural path is unchanged. Every new segment uses the existing raw-PCM, persistent phoneme and shared inference caches; editing one long sentence can reuse the others. Segment boundaries are added only when the text is long enough to risk truncation, preserving the previously prioritized natural sound of short utterances.

The change improves correctness and **subsequent** latency for long passages. Total first-generation ONNX computation is not claimed to be faster on iPhone; the main objective is avoiding lost text and wasted re-generation.


### 61. Progressive first-sentence audio for long Neural HQ passages

The previously implemented natural long-text segmentation makes full passages cacheable and lossless, but playback still waited until every segment was inferred and concatenated. With serial WASM ONNX on iPhone, that created substantial time-to-first-sound for several sentences.

The new progressive player starts an AudioBufferSourceNode **immediately after the first natural sentence is rendered**, while the remaining sentences are generated and cached by the same serial inference path. Segments are queued on one AudioContext timeline with 8ms overlaps when ready, short edge fades and conservative per-segment gain ceiling to avoid audible clicks or clipping. Any inference underrun schedules the next segment as soon as it is ready. The final merged PCM is still produced and persisted for future instant replay.

Guardrails:
- Progressive audio runs only for *new long unedited CPU q8 plans with 2+ segments*. Short speech, edited prosody plans, GPU experiment and saved complete takes stay on the exact original playback path.
- STOP or replacement speech cancels all scheduled buffers and prevents stale onStart/onEnd callbacks. Generation tokens still gate all playback. No extra ONNX sessions or concurrent model inference are created, avoiding iPhone memory spikes.
- User-visible metrics distinguish full render time from first-audio latency, when supported.
- No claim that ONNX itself computes faster. The benefit is faster first audible speech and lower latency before hearing long text.
