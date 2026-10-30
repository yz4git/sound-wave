#!/usr/bin/env python3
"""Opt-in local Haas-ASR adapter for SOUND WAVE audio intelligibility QA.

Runs on a separate Linux NVIDIA CUDA machine; NOT on iPhone/GitHub Pages.
Requires the Haas-ASR environment, fastapi, uvicorn, python-multipart.
Place behind an HTTPS reverse proxy with authentication and restrictive CORS.
Never expose the port directly to the internet.
"""
from __future__ import annotations

import asyncio
import hmac
import io
import os
import threading

import haas_asr
from fastapi import FastAPI, File, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

MODEL_ID = os.environ.get("HAAS_MODEL_ID", "third-intelligence/Haas-ja-v1.0")
TOKEN = os.environ.get("HAAS_API_TOKEN", "")
ORIGIN = os.environ.get("HAAS_CORS_ORIGIN", "https://yz4git.github.io")
MAX_WAV_BYTES = 10 * 1024 * 1024
MAX_AUDIO_SECONDS = 60
_lock = threading.Lock()
_model = None

if not TOKEN or len(TOKEN) < 20:
    raise RuntimeError("Set a secret HAAS_API_TOKEN with at least 20 characters before starting.")

app = FastAPI(title="SOUND WAVE optional Haas audio audit", docs_url=None, redoc_url=None, openapi_url=None)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[ORIGIN],
    allow_methods=["POST"],
    allow_headers=["Authorization", "Content-Type"],
    allow_credentials=False,
)


def _run_inference(audio_bytes: bytes) -> str:
    global _model
    with _lock:
        if _model is None:
            _model = haas_asr.load_model(MODEL_ID, device="cuda")
        pcm = haas_asr.load_audio(io.BytesIO(audio_bytes))
        if pcm.size == 0 or pcm.size > MAX_AUDIO_SECONDS * 16000:
            raise ValueError("Audio must be between 0 and 60 seconds.")
        if pcm.size <= 30 * 16000:
            return _model.transcribe([pcm], batch_size=1, verbose=False)[0].text.strip()
        return haas_asr.transcribe_longform(_model, pcm, batch_size=1)


@app.post("/api/transcribe")
async def transcribe(
    audio: UploadFile = File(...),
    authorization: str = Header(default=""),
) -> dict[str, str]:
    if not authorization.startswith("Bearer ") or not hmac.compare_digest(
        authorization[len("Bearer "):], TOKEN
    ):
        raise HTTPException(status_code=401, detail="Unauthorized")
    if audio.content_type not in ("audio/wav", "audio/x-wav", "application/octet-stream"):
        raise HTTPException(status_code=415, detail="WAV required")
    try:
        chunks: list[bytes] = []
        size = 0
        while chunk := await audio.read(1024 * 1024):
            size += len(chunk)
            if size > MAX_WAV_BYTES:
                raise HTTPException(status_code=413, detail="WAV too large")
            chunks.append(chunk)
        if size < 44:
            raise HTTPException(status_code=400, detail="Invalid WAV")
        text = await asyncio.to_thread(_run_inference, b"".join(chunks))
        return {"text": text}
    except HTTPException:
        raise
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(status_code=400, detail="Could not decode or transcribe WAV") from exc
    finally:
        await audio.close()


if __name__ == "__main__":
    import uvicorn

    # The connection from GitHub Pages requires an HTTPS reverse proxy.
    uvicorn.run(app, host="127.0.0.1", port=7869)
