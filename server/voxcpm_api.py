"""Minimal VoxCPM2 HTTP speech endpoint for Sound Wave Voice Lab.

Run with a single process: uvicorn server.voxcpm_api:app --host 0.0.0.0 --port 8000
The official VoxCPM2 weights are loaded on the first request, not on import.
"""
from __future__ import annotations

import hmac
import io
import os
import threading
from typing import Annotated

from fastapi import FastAPI, Header, HTTPException
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, Field

MODEL_ID = "openbmb/VoxCPM2"
ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.environ.get(
        "VOXCPM_ALLOWED_ORIGINS",
        "https://yz4git.github.io,http://localhost:5173",
    ).split(",")
    if origin.strip()
]
API_TOKEN = os.environ.get("VOXCPM_API_TOKEN", "")
app = FastAPI(title="Sound Wave VoxCPM2 Bridge", version="1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "Authorization"],
)

_model = None
_inference_lock = threading.Lock()


class SpeechRequest(BaseModel):
    text: str = Field(min_length=1, max_length=420)
    voice_description: str = Field(default="", max_length=240)
    inference_timesteps: int = Field(default=10, ge=4, le=24)


def _authorized(header: str | None) -> bool:
    if not API_TOKEN:
        return True
    if not header or not header.startswith("Bearer "):
        return False
    return hmac.compare_digest(header[7:], API_TOKEN)


@app.get("/health")
def health() -> dict:
    return {
        "ok": True,
        "model": MODEL_ID,
        "loaded": _model is not None,
        "busy": _inference_lock.locked(),
    }


def _synthesize(request: SpeechRequest) -> bytes:
    global _model
    if not _inference_lock.acquire(blocking=False):
        raise HTTPException(status_code=429, detail="VoxCPM2 is generating audio for another request")
    try:
        # Lazy import avoids boot-time GPU allocations just to serve /health.
        if _model is None:
            from voxcpm import VoxCPM

            _model = VoxCPM.from_pretrained(MODEL_ID, load_denoiser=False)

        import soundfile as sf

        text = request.text.strip()
        if not text:
            raise HTTPException(status_code=422, detail="Speech text is empty")
        description = request.voice_description.strip().replace("(", " ").replace(")", " ")
        # Official VoxCPM2 Voice Design format: a parenthesized instruction
        # immediately preceding the text to be spoken.
        prompt = f"({description}) {text}" if description else text
        audio = _model.generate(
            text=prompt,
            cfg_value=2.0,
            inference_timesteps=request.inference_timesteps,
        )
        stream = io.BytesIO()
        sf.write(stream, audio, _model.tts_model.sample_rate, format="WAV", subtype="PCM_16")
        return stream.getvalue()
    finally:
        _inference_lock.release()


@app.post("/v1/speech")
async def speech(
    request: SpeechRequest,
    authorization: Annotated[str | None, Header()] = None,
) -> Response:
    if not _authorized(authorization):
        raise HTTPException(status_code=401, detail="Valid server token required")
    if len(request.text.strip()) > 420:
        raise HTTPException(status_code=422, detail="Text too long")
    # Use a worker so health checks and CORS are responsive during inference.
    wav = await run_in_threadpool(_synthesize, request)
    return Response(
        content=wav,
        media_type="audio/wav",
        headers={"Cache-Control": "no-store", "X-TTS-Model": "VoxCPM2"},
    )
