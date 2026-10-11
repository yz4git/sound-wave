# VoxCPM2 in SOUND WAVE VOICE LAB

## What the new engine does

The **VOXCPM2 · 48kHz** tab is a real optional backend for the
[OpenBMB/VoxCPM](https://github.com/OpenBMB/VoxCPM) **VoxCPM2** multilingual
2B-parameter TTS model. It is not a rebranding of Kokoro/Neural HQ.
Sound Wave DSP, Neural HQ, GPU Beta, and system TTS are unchanged.

iPhone Safari can select the model, design a voice by text, send speech to a
trusted inference service, play its 48kHz WAV result, replay identical takes
locally within the page, and export the generated WAV. **The model itself does
not run in Safari.** GPU/server compute and several gigabytes of memory are
required for a practical implementation; model weights are not added to the
GitHub Pages site.

## Start a private inference service

On a Python 3.10–3.12 machine with sufficient GPU memory (VoxCPM2 typically
needs around 8 GB VRAM; more headroom is recommended):

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r server/requirements.txt
export VOXCPM_ALLOWED_ORIGINS='https://yz4git.github.io,http://localhost:5173'
export VOXCPM_API_TOKEN='a-long-random-secret'
uvicorn server.voxcpm_api:app --host 127.0.0.1 --port 8000 --workers 1
```

The app's default allowlist permits the production GitHub Pages origin and
local Vite. Override to your actual allowed origins for a custom deployment.

For use from an iPhone or GitHub Pages, place the server behind an HTTPS
reverse proxy / private HTTPS tunnel. Use **a trusted server**, since all
submitted text goes to that server. Do not expose the backend publicly without
access controls, request limits, and appropriate authentication.

In VOICE LAB:
1. Choose **VOXCPM2 · 48kHz**.
2. Enter the server base URL (e.g. `https://tts.example.com`, NOT the full
   `/v1/speech` path); the app will call `POST /v1/speech`.
3. Set a voice description such as "A gentle Japanese female narrator". This
   is combined with soft suggestions from character, rate, pitch, energy and
   delivery. Unlike the local DSP editor, VoxCPM2 does **not** support exact
   per-mora F0 or timing curves.
4. Optionally enter the server bearer token. It stays in memory only and is
   not saved to persistent storage.
5. Tap **SPEAK**. Use **STOP** to cancel an active request or playback.
6. Tap **EXPORT WAV** after a successful generation. Changed settings require
   generating a new take first.

The bridge exposes `GET /health` and `POST /v1/speech` with JSON:

```json
{
  "text": "こんにちは、音声のテストです。",
  "voice_description": "A gentle Japanese narrator",
  "inference_timesteps": 10
}
```

The successful response is a standard PCM 16-bit WAV. The server performs
real `VoxCPM.generate` inference; it does not fall back to system TTS.
If inference fails, an error is shown and existing engines remain selectable.

## Important boundaries

- A server URL is **required**. Without one, VOXCPM2 does not synthesize.
- Japanese support is in VoxCPM**2**. VoxCPM1.5/0.5B models focus on English
  and Chinese and should not be silently offered as equivalent Japanese voices.
- The browser only caches the most recent WAV in page memory; it never
  stores API tokens in localStorage. It sends texts to the configured service,
  so avoid confidential content unless you own/trust that endpoint.
- `https://yz4git.github.io/sound-wave/` cannot run the Python server by
  itself: GitHub Pages is static hosting.
- Use voices and references with permission, and clearly label synthetic audio
  when relevant.

The interface has been built for model integration but deployment/server-side
model inference must be verified on the actual target server.
