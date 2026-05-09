"""Edge TTS + Whisper-based forced alignment.

The browser calls /api/tts with text + voice. We:
  1. Synthesize audio with Microsoft Edge TTS (free, neural voices).
  2. Run faster-whisper on the audio with word_timestamps=True to get
     real per-word start/end times that match the actual waveform.
  3. Return audio + word-level timing.

The avatar feeds the word timings to TalkingHead.js so the visemes
fire on the actual phonemes instead of being smeared evenly across each
sentence (which is what we did before — the source of the "lip sync
looks off" feedback).

We also pre-render and cache a small library of filler utterances
("Mm-hmm…", "Right, let me think") that the frontend plays immediately
when the user sends a message — so the avatar reacts in 150ms instead
of waiting for the LLM + TTS round-trip.
"""
import asyncio
import io
import os
import random
import tempfile
import threading
from pathlib import Path
from typing import Optional

import edge_tts

from .config import settings


_voice_cache: Optional[set] = None
_voice_cache_lock = asyncio.Lock()

# Filler audio is cached in memory keyed by (voice, text).
_filler_cache: dict = {}
_filler_cache_lock = asyncio.Lock()

FILLER_PHRASES = [
    "Hmm, let me think.",
    "Right, okay.",
    "Sure, one second.",
    "Mm-hmm.",
    "Got it.",
    "Okay, so.",
    "Alright.",
    "Let me see.",
]


async def _known_voices() -> set:
    global _voice_cache
    if _voice_cache is not None:
        return _voice_cache
    async with _voice_cache_lock:
        if _voice_cache is None:
            try:
                voices = await edge_tts.list_voices()
                _voice_cache = {v["ShortName"] for v in voices}
            except Exception:
                _voice_cache = set()
    return _voice_cache


async def _synthesize_once(text: str, voice: str, rate: str, pitch: str) -> dict:
    com = edge_tts.Communicate(text, voice, rate=rate, pitch=pitch)
    audio = bytearray()
    sentence_boundaries: list = []
    async for chunk in com.stream():
        kind = chunk.get("type")
        if kind == "audio":
            audio.extend(chunk.get("data", b""))
        elif kind == "SentenceBoundary":
            sentence_boundaries.append({
                "text": chunk.get("text", ""),
                "offset_ms": chunk.get("offset", 0) / 10_000,
                "duration_ms": chunk.get("duration", 0) / 10_000,
                "kind": "sentence",
            })
    if len(audio) < 200:
        raise RuntimeError("Edge TTS returned no audio")
    return {"audio": bytes(audio), "mime": "audio/mpeg", "sentences": sentence_boundaries}


def _whisper_align(audio_bytes: bytes) -> list:
    """Run faster-whisper on TTS audio to extract real word-level timings.

    Returns a list of {text, offset_ms, duration_ms, kind: 'word'}.
    Returns [] on failure (caller will fall back to even distribution).
    """
    try:
        from . import stt as stt_engine
    except Exception:
        return []
    try:
        model = stt_engine._get_model()
    except Exception:
        return []

    with tempfile.NamedTemporaryFile(delete=False, suffix=".mp3") as f:
        f.write(audio_bytes)
        path = f.name
    try:
        segments, _info = model.transcribe(
            path,
            language="en",
            beam_size=1,
            word_timestamps=True,
            condition_on_previous_text=False,
        )
        out = []
        for seg in segments:
            for w in (seg.words or []):
                txt = (w.word or "").strip()
                if not txt:
                    continue
                start_ms = float(w.start) * 1000.0
                end_ms = float(w.end) * 1000.0
                out.append({
                    "text": txt,
                    "offset_ms": start_ms,
                    "duration_ms": max(60.0, end_ms - start_ms),
                    "kind": "word",
                })
        return out
    except Exception:
        return []
    finally:
        try: Path(path).unlink(missing_ok=True)
        except Exception: pass


async def synthesize(
    text: str,
    voice: Optional[str] = None,
    rate: str = "+8%",
    pitch: str = "+0Hz",
    align: bool = True,
    max_retries: int = 3,
) -> dict:
    """Synthesize text → {'audio', 'mime', 'boundaries'} with retries.

    boundaries is a mix of:
      - 'word' entries (from Whisper, accurate per-word timing) when align=True
      - 'sentence' entries (always present, from Edge TTS)
    """
    text = (text or "").strip()
    if not text:
        return {"audio": b"", "mime": "audio/mpeg", "boundaries": []}

    voice = voice or settings.DEFAULT_VOICE
    valid = await _known_voices()
    if valid and voice not in valid:
        voice = settings.DEFAULT_VOICE

    last_err: Optional[Exception] = None
    result = None
    for attempt in range(max_retries):
        try:
            result = await _synthesize_once(text, voice, rate, pitch)
            break
        except Exception as e:
            last_err = e
            await asyncio.sleep(0.15 * (attempt + 1))
    if result is None:
        raise RuntimeError(f"Edge TTS failed after {max_retries} attempts: {last_err}")

    boundaries = list(result["sentences"])
    if align:
        loop = asyncio.get_running_loop()
        word_timings = await loop.run_in_executor(None, _whisper_align, result["audio"])
        if word_timings:
            boundaries = word_timings + boundaries

    return {"audio": result["audio"], "mime": result["mime"], "boundaries": boundaries}


# ─── Filler cache ──────────────────────────────────────────────────────────
async def get_filler(voice: str) -> dict:
    """Return a random pre-rendered filler for the given voice. Caches per voice."""
    voice = voice or settings.DEFAULT_VOICE
    async with _filler_cache_lock:
        cache = _filler_cache.setdefault(voice, [])
        if not cache:
            for phrase in FILLER_PHRASES:
                try:
                    item = await synthesize(phrase, voice=voice, rate="+8%", align=False)
                    cache.append({"text": phrase, **item})
                except Exception:
                    pass
        if not cache:
            return {}
        return random.choice(cache)


def warm_fillers_in_background(voices: list):
    """Pre-render filler audio for the given voices in a background thread."""
    async def _go():
        for v in voices:
            try:
                await get_filler(v)
            except Exception:
                pass
    def _runner():
        try:
            asyncio.run(_go())
        except Exception:
            pass
    threading.Thread(target=_runner, daemon=True).start()
