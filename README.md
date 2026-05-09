# LiveTutor AI

A real-time, browser-based AI tutor with a 3D talking avatar. The tutor speaks, lip-syncs to its actual voice, gestures while talking, and listens to you with your microphone — all powered by a streaming language model on OpenRouter and a local Whisper backbone for speech understanding.

> Designed to run for **well under $1** for a full evaluation. The default model is fast and cheap; voice + speech recognition run locally so the only paid surface is the LLM call itself.

---

## Highlights

- **3D talking avatar** — Three.js + Ready Player Me-style models via [TalkingHead.js](https://github.com/met4citizen/TalkingHead). Real visemes for lip-sync, hand gestures during speech, expression cues at end of sentences. Pick from a built-in male or female teacher, or paste your own custom Ready Player Me URL.
- **Word-accurate lip-sync** — every TTS sentence is run through `faster-whisper` server-side to extract real per-word start/end timings; the avatar's visemes fire on the actual phonemes, not on evenly-distributed estimates.
- **Sub-200ms perceived latency** — when you hit send, a pre-cached filler ("Hmm, let me think.") starts playing in roughly 200ms while the LLM and the actual reply are still being generated. The conversation feels real-time even though the underlying round-trip is 2-3 seconds.
- **Fast LLM** — defaults to `meta-llama/llama-3.3-70b-instruct` routed to **Groq** through OpenRouter (~200ms time-to-first-token). Cerebras / Sambanova fallback. Vision-capable models auto-routed when you attach an image.
- **Local STT** — your microphone audio is captured with `MediaRecorder`, posted to a `faster-whisper` endpoint, and transcribed locally. Listens continuously with a 4-second silence auto-stop and a live VU meter. Far more accurate than browser `webkitSpeechRecognition`.
- **Microsoft neural voices** — backend uses `edge-tts` for Andrew, Emma, Ava, Brian, Aria, Jenny, Sonia, Ryan, Natasha, etc. The voice picker is auto-filtered by the avatar's gender.
- **Streaming responses** — tokens stream from OpenRouter into the caption bubble; sentences are spoken as they arrive.
- **File attachments** — drop in images (sent to a vision-capable model), PDFs (text extracted), or text/code/markdown files.
- **Polished UI** — unified composer shell, glass surfaces, refined typography, micro-interactions.

---

## Architecture

```
┌──────────────── Browser (free, local) ─────────────────┐    ┌─── OpenRouter ────┐
│                                                        │    │                   │
│  Three.js + TalkingHead.js                             │    │   chat model      │
│   ├─ visemes from Whisper word timings                 │    │   (streaming)     │
│   ├─ hand gestures (TalkingHead pose templates)        │    │                   │
│   └─ expression / mood cues                            │    └────────┬──────────┘
│                                                        │             │
│  MediaRecorder → POST /api/stt   (faster-whisper)      │             │
│  Web Audio AnalyserNode → live VU meter, silence stop  │             │
│                                                        │             │
│  Chat / captions / transcript / attachments            │             │
│                                                        │             │
└─────────────┬──────────────────────────────────────────┘             │
              │                                                         │
              ▼ POST /api/chat (SSE stream)                             │
   ┌──────────────────────────────────┐                                 │
   │  FastAPI backend                 │                                 │
   │   ├─ /api/chat        (SSE)      │ ────────────────────────────────┘
   │   ├─ /api/tts         (audio +   │
   │   │   word-level Whisper align)  │
   │   ├─ /api/stt         (Whisper)  │ ── faster-whisper (local CPU)
   │   ├─ /api/filler      (cached)   │ ── edge-tts pre-rendered audio
   │   ├─ /api/upload      (image/PDF)│
   │   └─ serves static UI            │
   └──────────────────────────────────┘
```

- **Backend** (`app/`): `main.py` (routes), `llm.py` (OpenRouter streaming + provider routing + sanitiser), `tts.py` (Edge TTS with retry + Whisper alignment + filler cache), `stt.py` (faster-whisper), `uploads.py` (PDF/text/image processing), `config.py` (model/voice/avatar registries).
- **Frontend** (`static/js/`): `avatar.js` (TalkingHead controller, gesture scheduler, branding stripper), `speech.js` (TTS queue, MediaRecorder STT, sentence splitter, filler), `chat.js` (streaming chat client), `main.js` (DOM wiring, custom URL modal, VU meter).

---

## Quick start

### Requirements
- Python 3.11+ (tested on 3.14)
- A modern browser. Chrome, Edge, or Safari recommended (we use `MediaRecorder` and Web Audio APIs)
- An OpenRouter API key — get one at https://openrouter.ai/keys
- ffmpeg (for `faster-whisper` to decode browser audio). Install with `brew install ffmpeg` on macOS

### Setup

```bash
git clone https://github.com/ItsPranavz/livetutor-ai.git
cd livetutor-ai

python3 -m venv .venv
source .venv/bin/activate            # on Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

### Configure

```bash
cp .env.example .env
# edit .env and paste your OpenRouter key
```

`.env`:
```env
OPENROUTER_API_KEY=sk-or-v1-...
DEFAULT_MODEL=meta-llama/llama-3.3-70b-instruct
DEFAULT_VOICE=en-US-AndrewNeural
APP_HOST=127.0.0.1
APP_PORT=8000
APP_NAME=LiveTutor AI
SITE_URL=http://localhost:8000
```

### Run

```bash
python run.py
```

Open **http://127.0.0.1:8000** in your browser. The first time you click the mic, the Whisper model (~150 MB for `base.en`) will download and load into memory — subsequent transcriptions take 200-600 ms.

Allow the microphone permission when your browser asks. Click the page once before sending the first message — browsers require a user gesture before audio playback.

---

## Cost notes

| Model                                         | Provider     | Cost (in / out per 1M tokens)  |
|-----------------------------------------------|--------------|--------------------------------|
| `meta-llama/llama-3.3-70b-instruct`           | Groq         | ~$0.59 / $0.79                 |
| `meta-llama/llama-3.1-8b-instruct`            | Cerebras     | ~$0.10 / $0.10                 |
| `qwen/qwen-3-32b`                             | Cerebras     | ~$0.40 / $0.80                 |
| `openai/gpt-4o-mini` (vision)                 | OpenAI       | ~$0.15 / $0.60                 |
| `google/gemini-2.0-flash-lite-001` (vision)   | Google       | ~$0.075 / $0.30                |
| `anthropic/claude-haiku-4-5` (vision)         | Anthropic    | premium                        |

A typical 50-turn lesson on the default Llama 3.3 70B model costs less than $0.01.

---

## Configuration knobs

Override via environment variables in `.env`:

| Variable           | Default                                  | Notes                                       |
|--------------------|------------------------------------------|---------------------------------------------|
| `OPENROUTER_API_KEY` | (required)                             | Your key from openrouter.ai/keys            |
| `DEFAULT_MODEL`    | `meta-llama/llama-3.3-70b-instruct`      | Any model in `app/config.py`'s `AVAILABLE_MODELS` |
| `DEFAULT_VOICE`    | `en-US-AndrewNeural`                     | Any Microsoft Edge neural voice short-name  |
| `WHISPER_MODEL`    | `base.en`                                | `tiny.en`, `base.en`, `small.en`, `medium.en` |
| `WHISPER_DEVICE`   | `cpu`                                    | `cpu` or `cuda`                             |
| `WHISPER_COMPUTE`  | `int8`                                   | `int8`, `int16`, `float16`, `float32`       |
| `APP_PORT`         | `8000`                                   |                                             |

---

## Project layout

```
livetutor-ai/
├── .env / .env.example      API key + tunables (.env never committed)
├── LICENSE                  MIT
├── README.md
├── THIRD_PARTY_LICENSES.md  attribution for runtime dependencies
├── requirements.txt
├── run.py                   uvicorn entry point
├── app/
│   ├── config.py            Settings: models, voices, avatars
│   ├── llm.py               OpenRouter streaming + speech sanitiser + system prompt
│   ├── main.py              FastAPI routes
│   ├── tts.py               Edge TTS + Whisper word-level alignment + filler cache
│   ├── stt.py               Lazy-loaded faster-whisper for STT
│   └── uploads.py           Multipart → image / PDF / text extraction
├── templates/
│   └── index.html           UI shell (Jinja-free; we use simple substitution)
├── static/
│   ├── css/style.css
│   └── js/
│       ├── avatar.js        TalkingHead.js wrapper, gesture scheduler
│       ├── speech.js        TTS queue + MediaRecorder STT + filler
│       ├── chat.js          Streaming chat client, transcript, attachments
│       └── main.js          DOM wiring, custom URL modal, VU meter
└── uploads/                 Files attached during chats (gitignored)
```

---

## Caveats

- **Avatar quality**: the two bundled tutors (Sara and David) come from the open-source TalkingHead.js repo and are stylised 3D, not photoreal. For a more realistic avatar, create one at [readyplayer.me/avatar](https://readyplayer.me/avatar) (free) and paste the `.glb` URL into the **Custom Ready Player Me URL…** option in the Tutor dropdown.
- **Edge TTS gray area**: the `edge-tts` Python package calls Microsoft's public Edge browser TTS endpoint without an official API key. Microsoft has not blocked this and it's widely used, but for commercial use you should review Microsoft's ToS or switch to a TTS you have explicit rights to (Piper, Coqui, or a paid service).
- **First TTS call is slower**: synthesising the first sentence triggers Whisper alignment on ~2 KB of audio (≈300 ms extra). Subsequent sentences are similar. The pre-cached filler is what makes it feel instant.
- **Lip-sync** uses Whisper word timings combined with TalkingHead's Oculus viseme set. It looks reasonable for English; for cinema-quality you'd want a dedicated lip-sync model (SadTalker, Wav2Lip, Audio2Face).

---

## License

This project is released under the [MIT License](LICENSE) — see `LICENSE` for the full text.

Third-party libraries used at runtime are listed in [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md) along with their respective licenses. Most are MIT/BSD/Apache-2.0; `edge-tts` is LGPL-3.0 (compatible with permissive licenses since the project consumes it as a library, not as a derivative).

---

## Acknowledgements

- [TalkingHead.js](https://github.com/met4citizen/TalkingHead) by Mika Suominen — the 3D avatar engine and stock models
- [Three.js](https://threejs.org/) — WebGL rendering
- [edge-tts](https://github.com/rany2/edge-tts) by rany2 — access to Microsoft's neural voices
- [faster-whisper](https://github.com/SYSTRAN/faster-whisper) — speech-to-text + forced alignment
- [FastAPI](https://fastapi.tiangolo.com/) — web framework
- [OpenRouter](https://openrouter.ai/) — model routing

---

## Contributing

Pull requests welcome. Please don't commit your `.env` or any API keys.
