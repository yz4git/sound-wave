#!/usr/bin/env python3
"""Private GPU adapter for official inclusionAI Ming-3.0-TTS Japanese synthesis.

This does NOT run in Safari. Start within the official Ming-3.0-tts Python
environment on Linux/CUDA behind an HTTPS reverse proxy. The server loads
only ONE configured model variant. No remote API credentials are embedded.
The official reference generation has not been validated on a live GPU here.
"""
from __future__ import annotations

import asyncio
import hmac
import os
import sys
import tempfile
import threading
import wave
from pathlib import Path

from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

REPO = Path(os.environ.get("MING_REPO_PATH", "")).expanduser().resolve()
WEIGHTS = Path(os.environ.get("MING_MODEL_PATH", "")).expanduser().resolve()
VARIANT = os.environ.get("MING_TTS_VARIANT", "0.5b")
TOKEN = os.environ.get("MING_TTS_API_TOKEN", "")
ORIGIN = os.environ.get("MING_TTS_CORS_ORIGIN", "https://yz4git.github.io")
MAX_REF_BYTES = 8 * 1024 * 1024
MAX_OUT_BYTES = 12 * 1024 * 1024
if len(TOKEN) < 24:
    raise RuntimeError("Set a random MING_TTS_API_TOKEN of at least 24 characters")
if VARIANT not in ("0.5b", "tiny"):
    raise RuntimeError("MING_TTS_VARIANT must be 0.5b or tiny")
if not (REPO / "ming_tts.py").is_file() or not WEIGHTS.is_dir():
    raise RuntimeError("Set MING_REPO_PATH and MING_MODEL_PATH to official local checkout/weights")
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))
_model = None
_model_lock = threading.Lock()
_inference_lock = asyncio.Semaphore(1)
app = FastAPI(
    title="Private Ming-3.0-TTS Japanese reference synthesizer",
    docs_url=None, redoc_url=None, openapi_url=None,
)
app.add_middleware(
    CORSMiddleware, allow_origins=[ORIGIN], allow_methods=["POST"],
    allow_headers=["Authorization", "Content-Type"], allow_credentials=False,
)


def _check_wav(path: Path) -> None:
    try:
        with wave.open(str(path), "rb") as sample:
            if sample.getnchannels() not in (1, 2):
                raise ValueError("Reference WAV must be mono or stereo")
            if sample.getsampwidth() != 2:
                raise ValueError("Reference WAV must be PCM16 (16-bit)")
            rate = sample.getframerate()
            seconds = sample.getnframes() / rate
            if rate < 8000 or rate > 48000 or seconds < .5 or seconds > 20:
                raise ValueError("Reference must be 0.5-20 seconds at 8-48kHz")
    except (wave.Error, OSError, ZeroDivisionError) as exc:
        raise ValueError("Invalid PCM16 WAV reference") from exc


def _get_model():
    global _model
    with _model_lock:
        if _model is None:
            if VARIANT == "0.5b":
                from ming_tts import MingTTS
                _model = MingTTS(str(WEIGHTS), device="cuda:0")
            else:
                from ming_tiny import MingTinyTTS
                _model = MingTinyTTS.from_pretrained(str(WEIGHTS), device="cuda:0")
        return _model


def _generate(text: str, reference_text: str, reference: bytes) -> bytes:
    with tempfile.TemporaryDirectory(prefix="ming-tts-audit-") as root:
        reference_path = Path(root) / "reference.wav"
        target = Path(root) / "output.wav"
        reference_path.write_bytes(reference)
        _check_wav(reference_path)
        model = _get_model()
        if VARIANT == "0.5b":
            model.synthesize(
                task="MULTILINGUAL", text=text, language_id="Japanese",
                prompt_wav_path=str(reference_path), prompt_text=reference_text,
                use_spk_emb=True, output_path=str(target),
            )
        else:
            model.generate(
                task="multilingual", text=text, target_language="Japanese",
                prompt_wav=str(reference_path), prompt_text=reference_text,
                output_path=str(target),
            )
        if not target.is_file():
            raise RuntimeError("Ming produced no WAV")
        if target.stat().st_size > MAX_OUT_BYTES:
            raise ValueError("Ming WAV output exceeds 12MB")
        return target.read_bytes()


@app.post("/api/ming-tts")
async def generate(
    text: str = Form(...), prompt_text: str = Form(...),
    variant: str = Form(...), audio: UploadFile = File(...),
    authorization: str = Header(default=""),
) -> Response:
    if not authorization.startswith("Bearer ") or not hmac.compare_digest(
        authorization[len("Bearer "):], TOKEN,
    ):
        raise HTTPException(status_code=401, detail="Unauthorized")
    if variant != VARIANT:
        raise HTTPException(status_code=400, detail=f"Server is configured for {VARIANT}")
    if not (1 <= len(text.strip()) <= 420 and 1 <= len(prompt_text.strip()) <= 420):
        raise HTTPException(status_code=400, detail="Both Japanese texts must be 1-420 chars")
    if audio.content_type not in ("audio/wav", "audio/x-wav", "application/octet-stream"):
        raise HTTPException(status_code=415, detail="Reference must be 16-bit PCM WAV")
    parts: list[bytes] = []
    size = 0
    try:
        while chunk := await audio.read(1024 * 1024):
            size += len(chunk)
            if size > MAX_REF_BYTES:
                raise HTTPException(status_code=413, detail="Reference file too large")
            parts.append(chunk)
    finally:
        await audio.close()
    if size < 44:
        raise HTTPException(status_code=400, detail="Reference WAV is empty")
    try:
        async with _inference_lock:
            result = await asyncio.to_thread(_generate, text.strip(), prompt_text.strip(), b"".join(parts))
        return Response(
            content=result, media_type="audio/wav",
            headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"},
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Ming GPU inference unavailable") from exc


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=7872, workers=1)
