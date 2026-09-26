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
