import json
import html
import base64
import asyncio
from typing import Optional

from fastapi import FastAPI, Request, UploadFile, File, HTTPException
from fastapi.responses import StreamingResponse, JSONResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles

from .config import settings
from .llm import client as llm_client, TUTOR_SYSTEM_PROMPT, sanitize_for_speech
from .uploads import process_upload
from . import tts as tts_engine
from . import stt as stt_engine


app = FastAPI(title=settings.APP_NAME)
app.mount("/static", StaticFiles(directory=str(settings.STATIC_DIR)), name="static")


@app.on_event("startup")
async def _startup():
    # Pre-warm Whisper model in the background so the first /api/stt is fast,
    # and pre-render filler audio for the default voice so the first user
    # send-message gets immediate audio (no awkward silence).
    stt_engine.warmup_in_background()
    tts_engine.warm_fillers_in_background([settings.DEFAULT_VOICE])


def _render_index() -> str:
    path = settings.TEMPLATE_DIR / "index.html"
    raw = path.read_text(encoding="utf-8")

    options_html = []
    for m in settings.AVAILABLE_MODELS:
        selected = " selected" if m["id"] == settings.DEFAULT_MODEL else ""
        options_html.append(
            f'<option value="{html.escape(m["id"])}"{selected}>{html.escape(m["label"])}</option>'
        )

    voices_html = []
    for v in settings.AVAILABLE_VOICES:
        selected = " selected" if v["id"] == settings.DEFAULT_VOICE else ""
        voices_html.append(
            f'<option value="{html.escape(v["id"])}" '
            f'data-gender="{html.escape(v.get("gender","M"))}"{selected}>{html.escape(v["label"])}</option>'
        )

    avatars_html = []
    for a in settings.AVAILABLE_AVATARS:
        avatars_html.append(
            f'<option value="{html.escape(a["url"])}" '
            f'data-body="{html.escape(a.get("body","M"))}" '
            f'data-gender="{html.escape(a.get("gender","M"))}" '
            f'data-default-voice="{html.escape(a.get("default_voice",""))}">'
            f'{html.escape(a["label"])}</option>'
        )

    out = raw.replace("{{ app_name }}", html.escape(settings.APP_NAME))
    out = out.replace("{{MODEL_OPTIONS}}", "\n            ".join(options_html))
    out = out.replace("{{VOICE_OPTIONS}}", "\n            ".join(voices_html))
    out = out.replace("{{AVATAR_OPTIONS}}", "\n            ".join(avatars_html))
    out = out.replace("{{DEFAULT_AVATAR_URL}}", html.escape(settings.DEFAULT_AVATAR_URL))
    return out


@app.get("/", response_class=HTMLResponse)
async def index():
    return HTMLResponse(_render_index())


@app.get("/api/health")
async def health():
    return {
        "ok": True,
        "has_key": bool(settings.OPENROUTER_API_KEY),
        "default_model": settings.DEFAULT_MODEL,
        "default_voice": settings.DEFAULT_VOICE,
    }


@app.get("/api/voices")
async def voices():
    return {"voices": settings.AVAILABLE_VOICES, "default": settings.DEFAULT_VOICE}


@app.post("/api/upload")
async def upload(file: UploadFile = File(...)):
    try:
        info = await process_upload(file)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Upload failed: {e}")
    return JSONResponse(info)


@app.post("/api/tts")
async def tts(request: Request):
    body = await request.json()
    text: str = (body.get("text") or "").strip()
    voice: Optional[str] = body.get("voice") or settings.DEFAULT_VOICE
    rate: str = body.get("rate") or "+8%"
    pitch: str = body.get("pitch") or "+0Hz"
    align: bool = bool(body.get("align", True))
    if not text:
        raise HTTPException(status_code=400, detail="Empty text")

    text = sanitize_for_speech(text)
    if not text.strip():
        raise HTTPException(status_code=400, detail="Empty text after sanitization")

    try:
        result = await tts_engine.synthesize(text, voice=voice, rate=rate, pitch=pitch, align=align)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"TTS failed: {e}")
    return JSONResponse({
        "audio_b64": base64.b64encode(result["audio"]).decode("ascii"),
        "mime": result["mime"],
        "boundaries": result["boundaries"],
        "voice": voice,
    })


@app.post("/api/filler")
async def filler(request: Request):
    """Return a short pre-rendered filler ('Hmm…', 'Okay so…') in the requested
    voice, served from cache so playback can start immediately when the user
    sends a message."""
    body = await request.json()
    voice = body.get("voice") or settings.DEFAULT_VOICE
    item = await tts_engine.get_filler(voice)
    if not item:
        raise HTTPException(status_code=503, detail="Filler not yet available")
    return JSONResponse({
        "audio_b64": base64.b64encode(item["audio"]).decode("ascii"),
        "mime": item["mime"],
        "boundaries": item.get("boundaries", []),
        "text": item["text"],
        "voice": voice,
    })


@app.post("/api/stt")
async def stt(file: UploadFile = File(...)):
    """Transcribe an uploaded audio blob (webm/opus from MediaRecorder, or any
    container ffmpeg can decode). Returns the recognized text."""
    try:
        data = await file.read()
        if not data:
            raise HTTPException(status_code=400, detail="Empty audio")
        result = await stt_engine.transcribe(data)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"STT failed: {e}")
    return JSONResponse(result)


def _model_supports_vision(model: str) -> bool:
    for m in settings.AVAILABLE_MODELS:
        if m["id"] == model:
            return bool(m.get("vision"))
    s = (model or "").lower()
    return any(k in s for k in ("vision", "gemini", "gpt-4", "claude", "gemma-3", "gemma-4"))


def _build_messages(history: list, user_text: str, attachments: list, model_supports_vision: bool) -> list:
    messages = [{"role": "system", "content": TUTOR_SYSTEM_PROMPT}]

    trimmed = history[-settings.MAX_HISTORY_MESSAGES:] if history else []
    for m in trimmed:
        role = m.get("role")
        content = m.get("content", "")
        if role in ("user", "assistant") and content:
            messages.append({"role": role, "content": content})

    text_parts = []
    image_blocks = []

    for att in attachments or []:
        kind = att.get("kind")
        if kind == "image" and att.get("data_url"):
            if model_supports_vision:
                image_blocks.append({"type": "image_url", "image_url": {"url": att["data_url"]}})
            else:
                text_parts.append(f"[Student attached image '{att.get('name','image')}' but the current model can't view images.]")
        elif kind == "text":
            name = att.get("name", "file")
            body = att.get("text", "")
            text_parts.append(f"[Attached file: {name}]\n{body}\n[end of {name}]")
        else:
            text_parts.append(att.get("text", ""))

    if user_text:
        text_parts.append(user_text)

    if image_blocks:
        user_content = []
        if text_parts:
            user_content.append({"type": "text", "text": "\n\n".join(p for p in text_parts if p)})
        user_content.extend(image_blocks)
        messages.append({"role": "user", "content": user_content})
    else:
        messages.append({"role": "user", "content": "\n\n".join(p for p in text_parts if p)})

    return messages


def _pick_model_for_request(requested: str, attachments: list) -> str:
    has_image = any((a or {}).get("kind") == "image" for a in (attachments or []))
    if not has_image:
        return requested
    if _model_supports_vision(requested):
        return requested
    for m in settings.AVAILABLE_MODELS:
        if m.get("vision"):
            return m["id"]
    return requested


@app.post("/api/chat")
async def chat(request: Request):
    body = await request.json()
    user_text: str = (body.get("message") or "").strip()
    history: list = body.get("history") or []
    attachments: list = body.get("attachments") or []
    requested_model: str = body.get("model") or settings.DEFAULT_MODEL
    model = _pick_model_for_request(requested_model, attachments)

    if not user_text and not attachments:
        raise HTTPException(status_code=400, detail="Empty message")
    if not settings.OPENROUTER_API_KEY:
        raise HTTPException(status_code=500, detail="OPENROUTER_API_KEY is not configured")

    supports_vision = _model_supports_vision(model)
    messages = _build_messages(history, user_text, attachments, supports_vision)

    async def event_stream():
        try:
            yield f"data: {json.dumps({'type': 'start', 'model': model, 'requested_model': requested_model})}\n\n"
            async for chunk in llm_client.stream_chat(messages, model=model):
                clean = sanitize_for_speech(chunk)
                if clean:
                    yield f"data: {json.dumps({'type': 'token', 'text': clean})}\n\n"
            yield f"data: {json.dumps({'type': 'done'})}\n\n"
        except asyncio.CancelledError:
            return
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'error': str(e)})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
