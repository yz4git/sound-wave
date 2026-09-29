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
