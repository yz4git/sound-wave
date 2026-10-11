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
