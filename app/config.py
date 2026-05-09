import os
from pathlib import Path
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")


class Settings:
    OPENROUTER_API_KEY: str = os.getenv("OPENROUTER_API_KEY", "")
    DEFAULT_MODEL: str = os.getenv("DEFAULT_MODEL", "meta-llama/llama-3.3-70b-instruct")
    APP_HOST: str = os.getenv("APP_HOST", "127.0.0.1")
    APP_PORT: int = int(os.getenv("APP_PORT", "8000"))
    APP_NAME: str = os.getenv("APP_NAME", "LiveTutor AI")
    SITE_URL: str = os.getenv("SITE_URL", "http://localhost:8000")

    OPENROUTER_BASE_URL: str = "https://openrouter.ai/api/v1"

    UPLOAD_DIR: Path = BASE_DIR / "uploads"
    STATIC_DIR: Path = BASE_DIR / "static"
    TEMPLATE_DIR: Path = BASE_DIR / "templates"

    MAX_UPLOAD_BYTES: int = 8 * 1024 * 1024
    MAX_HISTORY_MESSAGES: int = 30

    DEFAULT_VOICE: str = os.getenv("DEFAULT_VOICE", "en-US-AndrewNeural")

    DEFAULT_PROVIDER_ORDER: list = ["groq", "cerebras", "sambanova"]

    AVAILABLE_MODELS: list = [
        {
            "id": "meta-llama/llama-3.3-70b-instruct",
            "label": "Llama 3.3 70B  ·  Groq  (~200ms TTFT)",
            "vision": False,
            "provider": ["groq"],
        },
        {
            "id": "meta-llama/llama-3.1-8b-instruct",
            "label": "Llama 3.1 8B  ·  Cerebras  (fastest, smaller)",
            "vision": False,
            "provider": ["cerebras", "groq"],
        },
        {
            "id": "qwen/qwen-3-32b",
            "label": "Qwen 3 32B  ·  Cerebras  (fast, smart)",
            "vision": False,
            "provider": ["cerebras", "groq"],
        },
        {
            "id": "openai/gpt-4o-mini",
            "label": "GPT-4o mini  ·  vision  (~1s TTFT)",
            "vision": True,
        },
        {
            "id": "google/gemini-2.0-flash-lite-001",
            "label": "Gemini 2.0 Flash Lite  ·  vision  (cheap)",
            "vision": True,
        },
        {
            "id": "anthropic/claude-haiku-4-5",
            "label": "Claude Haiku 4.5  ·  vision  (premium)",
            "vision": True,
        },
        {"id": "openrouter/free", "label": "OpenRouter Free Pool  ·  vision (slow)", "vision": True},
        {"id": "google/gemma-4-26b-a4b-it:free", "label": "Gemma 4 26B  ·  free, vision", "vision": True},
    ]

    # Voices tagged with gender so the UI can filter by avatar
    AVAILABLE_VOICES: list = [
        # ── Male voices ──
        {"id": "en-US-AndrewNeural",  "label": "Andrew  ·  US English  ·  warm, conversational", "gender": "M"},
        {"id": "en-US-BrianNeural",   "label": "Brian  ·  US English  ·  clear, mature",         "gender": "M"},
        {"id": "en-US-GuyNeural",     "label": "Guy  ·  US English  ·  newscast",                "gender": "M"},
        {"id": "en-US-EricNeural",    "label": "Eric  ·  US English  ·  rational",               "gender": "M"},
        {"id": "en-GB-RyanNeural",    "label": "Ryan  ·  British English  ·  calm",              "gender": "M"},
        # ── Female voices ──
        {"id": "en-US-EmmaNeural",    "label": "Emma  ·  US English  ·  friendly, articulate",   "gender": "F"},
        {"id": "en-US-AvaNeural",     "label": "Ava  ·  US English  ·  natural, expressive",     "gender": "F"},
        {"id": "en-US-AriaNeural",    "label": "Aria  ·  US English  ·  cheerful, professional", "gender": "F"},
        {"id": "en-US-JennyNeural",   "label": "Jenny  ·  US English  ·  assistant-style",       "gender": "F"},
        {"id": "en-GB-SoniaNeural",   "label": "Sonia  ·  British English  ·  warm",             "gender": "F"},
        {"id": "en-AU-NatashaNeural", "label": "Natasha  ·  Australian English",                 "gender": "F"},
    ]

    # Just two avatars — one male, one female. Both photoreal-ish humans (no anime).
    DEFAULT_AVATAR_URL: str = os.getenv(
        "DEFAULT_AVATAR_URL",
        "https://cdn.jsdelivr.net/gh/met4citizen/TalkingHead@main/avatars/brunette.glb",
    )

    AVAILABLE_AVATARS: list = [
        {
            "id": "female",
            "label": "Sara  ·  female teacher",
            "url": "https://cdn.jsdelivr.net/gh/met4citizen/TalkingHead@main/avatars/brunette.glb",
            "body": "F",
            "gender": "F",
            "default_voice": "en-US-EmmaNeural",
        },
        {
            "id": "male",
            "label": "David  ·  male teacher",
            "url": "https://cdn.jsdelivr.net/gh/met4citizen/TalkingHead@main/avatars/avatarsdk.glb",
            "body": "M",
            "gender": "M",
            "default_voice": "en-US-AndrewNeural",
        },
        {
            "id": "custom",
            "label": "Custom Ready Player Me URL…",
            "url": "custom",
            "body": "F",
            "gender": "F",
            "default_voice": "en-US-EmmaNeural",
        },
    ]


settings = Settings()
settings.UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
