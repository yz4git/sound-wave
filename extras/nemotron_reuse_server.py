#!/usr/bin/env python3
"""Optional private NVIDIA NemotronLabs RE-USE GPU sidecar for SOUND WAVE.

This is an independently authored adaptor around NVIDIA's *official*
inference.py CLI. It does not bundle weights or run in an iPhone browser.
Use the official model environment and host behind an HTTPS reverse proxy.
Model inference needs a compatible Linux/NVIDIA GPU; not tested on real GPU here.
"""
from __future__ import annotations

import asyncio
import hmac
import os
import subprocess
import sys
import tempfile
import wave
from pathlib import Path

from fastapi import FastAPI, File, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

MODEL_DIR = Path(os.environ.get("REUSE_MODEL_DIR", "")).expanduser().resolve()
TOKEN = os.environ.get("REUSE_API_TOKEN", "")
ALLOWED_ORIGIN = os.environ.get("REUSE_CORS_ORIGIN", "https://yz4git.github.io")
DEFAULT_CONFIG = (
    "recipes/USEMamba_30x1_lr_00002_norm_05_vq_065_nfft_320_hop_40_NRIR_012_"
    "pha_0005_com_04_early_001.yaml"
)
MAX_BYTES = 12 * 1024 * 1024
MAX_SECONDS = 20.0
RATES = {8000, 16000, 22050, 24000, 32000, 44100, 48000}

if len(TOKEN) < 24:
    raise RuntimeError("REUSE_API_TOKEN must have at least 24 random characters")
if not MODEL_DIR.is_dir() or not (MODEL_DIR / "inference.py").is_file():
    raise RuntimeError("REUSE_MODEL_DIR must point to the official downloaded RE-USE model folder")
if not (MODEL_DIR / DEFAULT_CONFIG).is_file():
    raise RuntimeError("Official RE-USE recipe is missing: " + DEFAULT_CONFIG)

app = FastAPI(
    title="SOUND WAVE private RE-USE GPU repair", docs_url=None, redoc_url=None, openapi_url=None,
)
app.add_middleware(
    CORSMiddleware, allow_origins=[ALLOWED_ORIGIN],
    allow_methods=["POST"], allow_headers=["Authorization", "Content-Type"],
    allow_credentials=False,
)
# Model weights and a GPU are expensive; serialize requests inside one worker.
_lock = asyncio.Semaphore(1)


def _check_wav(path: Path, max_duration: float = MAX_SECONDS) -> None:
    try:
        with wave.open(str(path), "rb") as wav:
            if wav.getnchannels() != 1 or wav.getsampwidth() != 2:
                raise ValueError("Expected mono PCM16 WAV")
            if wav.getframerate() not in RATES:
                raise ValueError("Unsupported RE-USE audio sample rate")
            seconds = wav.getnframes() / wav.getframerate()
            if seconds < 0.2 or seconds > max_duration:
                raise ValueError("Audio must be between 0.2 and 20 seconds")
    except (EOFError, wave.Error, OSError) as exc:
        raise ValueError("Invalid WAV input") from exc


def _enhance(wav_bytes: bytes) -> bytes:
    with tempfile.TemporaryDirectory(prefix="soundwave-reuse-") as temp:
        root = Path(temp)
        input_dir, output_dir = root / "input", root / "output"
        input_dir.mkdir()
        output_dir.mkdir()
        input_path = input_dir / "input.wav"
        input_path.write_bytes(wav_bytes)
        _check_wav(input_path)
        # No shell, no user-supplied arguments or filenames. Execute official
        # inference.py with absolute per-request input/output folders.
        command = [
            sys.executable, str(MODEL_DIR / "inference.py"),
            "--input_folder", str(input_dir),
            "--output_folder", str(output_dir),
            "--config", str(MODEL_DIR / DEFAULT_CONFIG),
        ]
        subprocess.run(
            command, cwd=MODEL_DIR, check=True, timeout=240,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            env={**os.environ, "PYTHONUNBUFFERED": "1"},
        )
        candidates = sorted(output_dir.rglob("*.wav"))
        if len(candidates) != 1:
            raise RuntimeError("Official inference did not create exactly one WAV file")
        enhanced = candidates[0]
        _check_wav(enhanced, max_duration=21)
        if enhanced.stat().st_size > MAX_BYTES:
            raise RuntimeError("Enhanced WAV exceeds 12MB")
        return enhanced.read_bytes()


@app.post("/api/enhance")
async def enhance(
    audio: UploadFile = File(...), authorization: str = Header(default=""),
) -> Response:
    if not authorization.startswith("Bearer ") or not hmac.compare_digest(
        authorization[len("Bearer "):], TOKEN,
    ):
        raise HTTPException(401, "Unauthorized")
    if audio.content_type not in ("audio/wav", "audio/x-wav", "application/octet-stream"):
        raise HTTPException(415, "Mono WAV required")
    parts: list[bytes] = []
    size = 0
    try:
        while chunk := await audio.read(1024 * 1024):
            size += len(chunk)
            if size > MAX_BYTES:
                raise HTTPException(413, "Audio too large")
            parts.append(chunk)
    finally:
        await audio.close()
    if size < 44:
        raise HTTPException(400, "Invalid WAV")
    try:
        async with _lock:
            result = await asyncio.to_thread(_enhance, b"".join(parts))
        return Response(
            content=result, media_type="audio/wav",
            headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"},
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(504, "RE-USE GPU inference timed out") from exc
    except (RuntimeError, subprocess.CalledProcessError, OSError) as exc:
        raise HTTPException(503, "RE-USE inference unavailable (check private GPU logs)") from exc


if __name__ == "__main__":
    import uvicorn
    # TLS and access control must terminate in a separate reverse proxy.
    uvicorn.run(app, host="127.0.0.1", port=7871, workers=1)
