"""Local Whisper speech-to-text via faster-whisper.

We accept any audio container the browser sends (webm/opus is typical from
MediaRecorder), let faster-whisper hand it to ffmpeg/PyAV for decoding, and
return the transcript.

The model is loaded lazily on the first call so server startup stays fast.
"""
import asyncio
import io
import os
import tempfile
import threading
from pathlib import Path
from typing import Optional

# faster-whisper itself
from faster_whisper import WhisperModel


MODEL_NAME = os.getenv("WHISPER_MODEL", "base.en")        # tiny.en | base.en | small.en | medium.en
MODEL_DEVICE = os.getenv("WHISPER_DEVICE", "cpu")
MODEL_COMPUTE = os.getenv("WHISPER_COMPUTE", "int8")      # int8 is fast on CPU


_model: Optional[WhisperModel] = None
_model_lock = threading.Lock()


def _get_model() -> WhisperModel:
    global _model
    if _model is not None:
        return _model
    with _model_lock:
        if _model is None:
            _model = WhisperModel(
                MODEL_NAME,
                device=MODEL_DEVICE,
                compute_type=MODEL_COMPUTE,
            )
    return _model


def _transcribe_blocking(audio_bytes: bytes) -> dict:
    if not audio_bytes:
        return {"text": "", "segments": []}

    # faster-whisper accepts a path or a numpy array. Easiest path: write to a
    # temp file (it'll use ffmpeg internally to decode any container).
    with tempfile.NamedTemporaryFile(delete=False, suffix=".audio") as f:
        f.write(audio_bytes)
        path = f.name
    try:
        model = _get_model()
        segments, info = model.transcribe(
            path,
            language="en",
            beam_size=1,                  # greedy = fastest
            vad_filter=True,              # voice-activity filter trims silence
            vad_parameters=dict(min_silence_duration_ms=500),
            condition_on_previous_text=False,
        )
        out_segments = []
        full_text_parts = []
        for seg in segments:
            text = seg.text.strip()
            if not text:
                continue
            out_segments.append({
                "start": seg.start,
                "end": seg.end,
                "text": text,
            })
            full_text_parts.append(text)
        return {
            "text": " ".join(full_text_parts).strip(),
            "segments": out_segments,
            "language": info.language,
            "duration": info.duration,
        }
    finally:
        try:
            Path(path).unlink(missing_ok=True)
        except Exception:
            pass


async def transcribe(audio_bytes: bytes) -> dict:
    """Transcribe `audio_bytes` (any container ffmpeg can decode)."""
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _transcribe_blocking, audio_bytes)


def warmup_in_background():
    """Load the model in the background so the first user request isn't slow."""
    def _go():
        try:
            _get_model()
        except Exception:
            pass
    threading.Thread(target=_go, daemon=True).start()
