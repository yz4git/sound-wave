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
