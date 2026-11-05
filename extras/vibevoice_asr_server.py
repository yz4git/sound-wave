#!/usr/bin/env python3
"""Optional VibeVoice-ASR GPU adapter for Sound Wave's own 4-speaker WAV.

Loads Microsoft's official public VibeVoice-ASR-7B weights on a private Linux
CUDA host. No original model code or weights are copied into this repository.
No GPU has been attached for a real inference test in this environment.
"""
from __future__ import annotations

import asyncio
import hmac
import os
import sys
import tempfile
import wave
from pathlib import Path

from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

ROOT = Path(os.environ.get("VIBE_ASR_REPO", "")).expanduser().resolve()
MODEL = os.environ.get("VIBE_ASR_MODEL", "microsoft/VibeVoice-ASR")
TOKEN = os.environ.get("VIBE_ASR_TOKEN", "")
ORIGIN = os.environ.get("VIBE_ASR_CORS_ORIGIN", "https://yz4git.github.io")
MAX_WAV = 12 * 1024 * 1024
MAX_SECONDS = 120
if len(TOKEN) < 24:
    raise RuntimeError("VIBE_ASR_TOKEN must be a 24+ character random secret")
if not (ROOT / "vibevoice" / "processor" / "vibevoice_asr_processor.py").is_file():
    raise RuntimeError("VIBE_ASR_REPO must be a checkout of microsoft/VibeVoice")
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

app = FastAPI(title="Private VibeVoice-ASR evaluator",docs_url=None,redoc_url=None,openapi_url=None)
app.add_middleware(
    CORSMiddleware, allow_origins=[ORIGIN], allow_methods=["POST"],
    allow_headers=["Authorization","Content-Type"], allow_credentials=False,
)
_lock = asyncio.Semaphore(1)
_engine = None


def _validate_wav(data: bytes) -> None:
    with tempfile.TemporaryDirectory(prefix="vibe-check-") as folder:
        path = Path(folder) / "input.wav"
        path.write_bytes(data)
        try:
            with wave.open(str(path), "rb") as reader:
                rate = reader.getframerate()
                seconds = reader.getnframes() / max(1, rate)
                if reader.getnchannels() != 1 or reader.getsampwidth() != 2:
                    raise ValueError("Mono PCM16 WAV required")
                if rate < 8000 or rate > 48000 or seconds <= .15 or seconds > MAX_SECONDS:
                    raise ValueError("WAV must be 0.15-120 seconds at 8-48kHz")
        except (wave.Error, EOFError, OSError) as exc:
            raise ValueError("Invalid WAV") from exc


def _load_engine():
    global _engine
    if _engine is None:
        import torch
        from vibevoice.modular.modeling_vibevoice_asr import VibeVoiceASRForConditionalGeneration
        from vibevoice.processor.vibevoice_asr_processor import VibeVoiceASRProcessor

        processor = VibeVoiceASRProcessor.from_pretrained(
            MODEL, language_model_pretrained_name="Qwen/Qwen2.5-7B",
        )
        network = VibeVoiceASRForConditionalGeneration.from_pretrained(
            MODEL, dtype=torch.bfloat16, device_map=None,
            attn_implementation="sdpa", trust_remote_code=True,
        ).to("cuda")
        network.eval()
        _engine = (processor, network)
    return _engine


def _recognize(data: bytes, context: str) -> list[dict]:
    import torch

    with tempfile.TemporaryDirectory(prefix="vibe-asr-") as folder:
        path = Path(folder) / "dialogue.wav"
        path.write_bytes(data)
        proc, model = _load_engine()
        inputs = proc(
            audio=str(path), sampling_rate=None, return_tensors="pt",
            padding=True, add_generation_prompt=True,
            context_info=context or None,
        )
        inputs = {k:(v.to("cuda") if isinstance(v,torch.Tensor) else v) for k,v in inputs.items()}
        with torch.inference_mode():
            outputs = model.generate(
                **inputs, max_new_tokens=1536, do_sample=False,
                pad_token_id=proc.pad_id,
                eos_token_id=proc.tokenizer.eos_token_id,
            )
        input_length = inputs["input_ids"].shape[1]
        decoded = proc.decode(outputs[0,input_length:],skip_special_tokens=True)
        parsed = proc.post_process_transcription(decoded)
        if not isinstance(parsed,list):
            raise ValueError("VibeVoice-ASR returned an invalid transcript")
        # Only explicit structured observations, no transcript hallucinations.
        result = []
        for entry in parsed[:80]:
            if not isinstance(entry,dict):
                continue
            if not all(k in entry for k in ("start_time","end_time","speaker_id","text")):
                continue
            try:
                start = float(entry["start_time"])
                end = float(entry["end_time"])
            except (TypeError,ValueError):
                continue
            speaker = str(entry["speaker_id"])
            text = str(entry["text"])
            if not (0 <= start < end <= MAX_SECONDS+.7):
                continue
            if not (speaker.strip() and text.strip() and len(text)<=550):
                continue
            result.append({
                "start_time":start,"end_time":end,
                "speaker_id":speaker[:50],"text":text,
            })
        return result


@app.post("/api/vibe-asr")
async def transcribe(
    audio: UploadFile = File(...), hotwords: str = Form(default=""),
    authorization: str = Header(default=""),
) -> JSONResponse:
    if not authorization.startswith("Bearer ") or not hmac.compare_digest(
        authorization[7:],TOKEN,
    ):
        raise HTTPException(401,"Unauthorized")
    if len(hotwords)>160:
        raise HTTPException(400,"Hotwords must be under 160 characters")
    if audio.content_type not in ("audio/wav","audio/x-wav","application/octet-stream"):
        raise HTTPException(415,"Send PCM WAV audio")
    parts: list[bytes] = []
    length = 0
    try:
        while chunk := await audio.read(512*1024):
            length += len(chunk)
            if length>MAX_WAV:
                raise HTTPException(413,"WAV over 12MB")
            parts.append(chunk)
    finally:
        await audio.close()
    data = b"".join(parts)
    if len(data)<44:
        raise HTTPException(400,"Invalid audio")
    try:
        _validate_wav(data)
        async with _lock:
            segments = await asyncio.to_thread(_recognize,data,hotwords.strip())
        return JSONResponse(
            {"segments":segments},headers={"Cache-Control":"no-store"},
        )
    except ValueError as exc:
        raise HTTPException(400,str(exc)) from exc
    except Exception as exc:
        raise HTTPException(503,"VibeVoice GPU inference unavailable; inspect server logs") from exc


if __name__=="__main__":
    import uvicorn
    # Terminate TLS and apply rate limits at a separate reverse proxy.
    uvicorn.run(app,host="127.0.0.1",port=7873,workers=1)
