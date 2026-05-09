import json
import re
from typing import AsyncIterator, Optional
import httpx
from .config import settings


TUTOR_SYSTEM_PROMPT = """You are LiveTutor — a warm, patient, one-on-one human tutor in a live voice class.

Everything you say will be read aloud by a text-to-speech engine and shown as on-screen captions. Speak the way a real person would speak, NOT the way an AI types.

ABSOLUTE RULES — never violate these:
1. NEVER use markdown of any kind. NO asterisks (*), NO underscores (_), NO backticks (`), NO pound signs (#), NO square brackets [], NO angle brackets <>, NO bullet points, NO numbered lists with "1." or "2.", NO code fences, NO tables.
2. NEVER use emojis or special unicode symbols (❌🎉✨📚 etc.). Use only plain letters, numbers, and ordinary punctuation.
3. NEVER use parenthetical asides like "(see below)" or "(for example)" — say it as a normal sentence: "for example, ...".
4. NEVER write LaTeX, math symbols, or HTML.
5. NEVER use slash-separated alternatives like "and/or", "he/she". Pick one and say it.
6. Pronounce numbers, units, math, and code in plain English. "two times three equals six", "for loop", "x equals five", not "2 * 3 = 6".

STYLE:
- Sound like a friendly tutor at a whiteboard. Conversational, encouraging, present-tense.
- Keep each turn to 1–4 spoken sentences. The student can ask for more.
- Vary sentence length. Use everyday words. Contractions are good — "you're", "let's", "we'll".
- Frequently invite the student to engage: "does that make sense?", "want me to show an example?", "ready for the next bit?".
- If teaching a topic, break it into bite-sized lessons. Teach one idea at a time, then check in.
- Encourage. Celebrate small wins.

You can see attached images and read attached documents — refer to them in plain language.

Begin every fresh conversation with a brief friendly greeting and ask what they would like to learn today."""


# ── Sanitizer: strips formatting characters from streamed text before TTS ─
# Operates on partial chunks too (we keep markdown-removal idempotent and
# stateless so it works on arbitrary token boundaries).
_BACKTICK_RE = re.compile(r"`+")
_BOLD_ITALIC_RE = re.compile(r"[*_~]{1,3}")           # *, **, ***, _, __, ~, ~~
_HEADER_RE = re.compile(r"^#{1,6}\s*", flags=re.MULTILINE)
_BULLET_RE = re.compile(r"^\s*[-•*]\s+", flags=re.MULTILINE)
_NUMBERED_RE = re.compile(r"^\s*\d+[\.\)]\s+", flags=re.MULTILINE)
_LINK_RE = re.compile(r"\[([^\]]+)\]\(([^)]+)\)")     # [text](url) → text
_BRACKETED_NOTE_RE = re.compile(r"\[(?:[^\]]+)\]")    # [aside] → drop
_HTML_TAG_RE = re.compile(r"<[^>]+>")
_EMOJI_RE = re.compile(
    "["                                                 # broad emoji ranges
    "\U0001F300-\U0001FAFF"
    "\U00002600-\U000027BF"
    "\U0001F600-\U0001F64F"
    "\U0001F680-\U0001F6FF"
    "\U0001F900-\U0001F9FF"
    "]",
    flags=re.UNICODE,
)
_ASCII_ARROW_RE = re.compile(r"->|=>")
_AND_OR_RE = re.compile(r"\band\s*/\s*or\b", flags=re.IGNORECASE)
_SLASH_PAIR_RE = re.compile(r"\b(\w+)\s*/\s*(\w+)\b")  # generic word-pair slash
_MULTI_WS_RE = re.compile(r"[ \t]{2,}")


def sanitize_for_speech(text: str) -> str:
    """Strip markdown / special-char garnish. Result is plain spoken English."""
    if not text:
        return text
    s = text
    s = _LINK_RE.sub(r"\1", s)
    s = _BRACKETED_NOTE_RE.sub("", s)
    s = _HTML_TAG_RE.sub("", s)
    s = _BACKTICK_RE.sub("", s)
    s = _BOLD_ITALIC_RE.sub("", s)
    s = _HEADER_RE.sub("", s)
    s = _BULLET_RE.sub("", s)
    s = _NUMBERED_RE.sub("", s)
    s = _EMOJI_RE.sub("", s)
    s = _ASCII_ARROW_RE.sub("to", s)
    s = _AND_OR_RE.sub("and or", s)
    s = _SLASH_PAIR_RE.sub(r"\1 or \2", s)
    s = _MULTI_WS_RE.sub(" ", s)
    return s


def _provider_for(model: str) -> Optional[list]:
    for m in settings.AVAILABLE_MODELS:
        if m["id"] == model:
            return m.get("provider")
    return None


class OpenRouterClient:
    def __init__(self):
        self.api_key = settings.OPENROUTER_API_KEY
        self.base_url = settings.OPENROUTER_BASE_URL

    def _headers(self) -> dict:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": settings.SITE_URL,
            "X-Title": settings.APP_NAME,
        }

    async def stream_chat(
        self,
        messages: list,
        model: Optional[str] = None,
        temperature: float = 0.7,
    ) -> AsyncIterator[str]:
        chosen_model = model or settings.DEFAULT_MODEL
        payload = {
            "model": chosen_model,
            "messages": messages,
            "temperature": temperature,
            "stream": True,
        }
        provider_order = _provider_for(chosen_model)
        if provider_order:
            payload["provider"] = {"order": provider_order, "allow_fallbacks": True}

        async with httpx.AsyncClient(timeout=httpx.Timeout(60.0, read=120.0)) as client:
            async with client.stream(
                "POST",
                f"{self.base_url}/chat/completions",
                headers=self._headers(),
                json=payload,
            ) as response:
                if response.status_code != 200:
                    body = await response.aread()
                    raise RuntimeError(
                        f"OpenRouter error {response.status_code}: {body.decode('utf-8', errors='replace')}"
                    )

                async for line in response.aiter_lines():
                    if not line or line.startswith(":"):
                        continue
                    if not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if data == "[DONE]":
                        break
                    try:
                        obj = json.loads(data)
                    except json.JSONDecodeError:
                        continue
                    choices = obj.get("choices") or []
                    if not choices:
                        continue
                    delta = choices[0].get("delta") or {}
                    content = delta.get("content")
                    if content:
                        yield content


client = OpenRouterClient()
