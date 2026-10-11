# VOX LOCAL — serverless, original Sound Wave voice engine

The **VOX LOCAL · NO SERVER** engine in Voice Lab is a standalone on-device
voice *rendering pipeline*. It does **not** send text or audio to an inference
server, and it does not run VoxCPM2 weights.

## Architecture

Reference: [OpenBMB/VoxCPM](https://github.com/OpenBMB/VoxCPM), especially
VoxCPM2's text-conditioned voice design and separation between speech planning
and acoustic decoding. Rather than transplanting the original 2B-parameter
diffusion system, this iPhone-oriented implementation adopts a small local
multi-stage scheme:

1. **Voice design parser (original)**: Japanese and English descriptive
   phrases map to a bounded profile of speaker, delivery, pitch, speed,
   low-frequency warmth, upper-band clarity, air/breath and emphasis.
2. **Local speech scaffold (shared)**: the already supported `kokoro-js-jp`
   / Kokoro-82M quantized WASM model supplies intelligible Japanese/English
   audio; existing Japanese G2P, phoneme, and PCM caches are reused. No model
   duplication in JS memory, no new dependency and no cloud TTS endpoint.
3. **Acoustic reconstruction (original)**: envelope-following multiband
   shaping, restrained upper-frequency excitation, deterministic breath
   texture where speech is voiced, small micro-dynamic refinement and
   sample-safe limiting. The base neural articulation is preserved.
4. **Browser PCM playback + WAV (original)**: voice samples are rendered
   locally, played with Web Audio and exported to 16-bit mono PCM WAV.
   Fast/balanced run at the native 24kHz from the base model. Studio mode
   employs band-limited resampling to 48kHz. **Upsampling does not
   synthesize real new 48kHz model detail.**

This is neither VoxCPM2 itself nor an original fully trained 2B parameter
zero-shot TTS model. Inference quality and speaker range remain limited by
the shared Kokoro model. Natural-language descriptions are recognized through
a controlled multilingual keyword vocabulary, not a general semantic encoder.
Voice cloning is not included. It would be inaccurate to advertise these
features as equivalent to VoxCPM2's.

## Try on iPhone

Visit [Sound Wave](https://yz4git.github.io/sound-wave/latest.html),
open **VOICE LAB**, choose **VOX LOCAL · NO SERVER**, and type any Japanese
text. Try these voice descriptions:

- `温かい、低音の男性の声。落ち着いてゆっくり話す`
- `明るく元気で明瞭な女性の声。テンポよく話す`
- `柔らかなささやき声、息混じりで穏やかな話し方`
- `A calm and warm narrator, deep and slow voice`

Press **SPEAK**. If the model is not already cached, the first use downloads
the shared Kokoro-JP WASM + ONNX assets from the model hosts. Thereafter
inference happens **on device**, with no server URL or paid inference API.
This is **serverless synthesis**, not a guarantee that every asset is already
available offline from a cold install; iOS may evict browser caches.

Choose **STUDIO · UPSAMPLED 48kHz** for a 48kHz WAV, or **BALANCED · 24kHz**
for lower iPhone CPU/memory use. Exported audio uses the current text and
voice design, never an older take with different settings.

## Performance / privacy

- Voice description and prior voice controls remain in the existing on-device
  settings storage. Generated audio is kept in a bounded memory cache, and
  the original Kokoro cache is reused.
- The voice description parser and PCM post-processing make no network calls.
  The shared pretrained model's download on first use is a normal external
  request; it may not succeed in airplane mode if not cached.
- `STOP` invalidates in-flight rendering and stops locally playing audio.
- Running very long text and Studio upsampling can take longer on older
  phones; start with a sentence and Balanced mode.
- The original remote VoxCPM2 server mode remains optional, but is **not
  required** to use Vox Local.


## A/B quality review (October 2026)

VOICE LAB now has **A · NEURAL HQ BASE** and **B · VOX LOCAL** buttons
inside the Vox Local panel. A and B render exactly the same spoken text,
using the *same selected neural speaker, speaking speed, expression and
pronunciation*. The raw Kokoro output is produced **once** and reused by the
second side. A is the raw model output; B is the refined sound design, with
RMS level approximately matched so a louder sample does not seem better.

The A/B panel displays measurable **RMS level difference**, **peak level
for each output**, and **waveform change percentage**. The latter is a
normalized RMS signal difference, **not a voice-quality, intelligibility or
similarity score**. In STUDIO, analysis uses the common native sample rate
before upsampling for a valid matched comparison.

Changes after the initial code review:

- Removed continuous unfiltered random noise from ordinary voices. Breathy
  and whisper designs receive only a much quieter band-shaped transitional
  component, to avoid unnecessary hiss throughout voiced segments.
- Added high-frequency sibilance-aware gain to avoid excessive /s/ and /sh/
  edge enhancement, especially for Japanese.
- Reduced aggressive treble and loudness boosts to retain model-native
  phonemes, attacks and sentence cadence.
- Matched output RMS against the identical original take, and constrained
  sample peaks without hard volume maximization.
- Added regressions for silence, clipping, cache reuse, description changes
  and identical-reference PCM comparison.

These are **engineering and signal-level checks**. Test automation currently
does not include a recorded human listening panel or real iPhone headphone
measurements; a listening verdict must not be inferred from the waveform
difference number. User preference and device playback can be evaluated
using the built-in A/B buttons.

Use the same sentence, switch A/B several times, and assess especially:
(1) sibilant roughness, (2) consonant intelligibility, (3) naturalness of
phrase endings, and (4) whether the voice description causes a desirable
speaker/delivery change. Note that these are design improvements atop the
same Kokoro backbone, not a claim of VoxCPM2-grade synthesis.
