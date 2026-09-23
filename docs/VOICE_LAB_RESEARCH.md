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
