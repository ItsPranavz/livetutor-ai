# LiveTutor AI

A real-time AI tutor with a talking 2D avatar. The tutor speaks, lip-syncs, blinks, smiles, and listens — all driven by a streaming language model on OpenRouter. Voice input/output and avatar rendering run **locally in your browser**, so the only paid surface is the LLM call.

> Built to run for **well under $1** for serious testing — the default model is free.

---

## Features

- **Talking avatar** — SVG character with blinking eyes, eyebrow expressions, and lip-syncing visemes that cycle while the tutor speaks
- **Streaming responses** — tokens stream from OpenRouter directly into the caption bubble; sentences are spoken as they arrive
- **Voice in / voice out** — browser Web Speech APIs handle STT + TTS using your local OS voices (free, no setup)
- **Caption bubble + transcript** — see what's currently being spoken at the top, click to expand the full conversation history
- **File attachments** — drop in images (sent to vision models), PDFs (text extracted), or plain text/code/markdown files
- **Model picker** — switch between free OpenRouter models (default), or a few cheap paid options
- **Barge-in** — speaking or sending a new message stops the avatar mid-sentence

---

## Quick start

### Requirements
- Python 3.11+ (tested on 3.14)
- A modern browser with Web Speech support (Chrome, Edge, or Safari recommended)
- An OpenRouter API key — get one at https://openrouter.ai/keys

### Setup

```bash
cd "LiveTutor AI"

python3 -m venv .venv
source .venv/bin/activate            # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

### Configure

Copy `.env.example` to `.env` and fill in your API key:

```bash
cp .env.example .env
```

```env
OPENROUTER_API_KEY=sk-or-v1-...
DEFAULT_MODEL=openrouter/free
APP_HOST=127.0.0.1
APP_PORT=8000
APP_NAME=LiveTutor AI
SITE_URL=http://localhost:8000
```

### Run

```bash
python run.py
```

Open **http://127.0.0.1:8000** in your browser. Allow microphone access when prompted (only used for voice-in).

---

## How it works

```
┌─────────────── Browser (free, local) ───────────────┐    ┌── OpenRouter ──┐
│                                                     │    │                │
│  SVG avatar  ◄──── lip-sync visemes                 │    │   chat model   │
│              ◄──── blink / brow expressions         │    │   (streaming)  │
│                                                     │    │                │
│  speechSynthesis  ──── TTS using OS voices          │    └────────────────┘
│  webkitSpeechRecognition  ──── STT                  │            ▲
│                                                     │            │
│  chat UI / captions / history                       │            │
│                                                     │            │
└─────────────────────────────────────────────────────┘            │
                          │                                        │
                          ▼ POST /api/chat (SSE stream)            │
                ┌─────────────────────┐                            │
                │  FastAPI backend    │ ───────────────────────────┘
                │  - /api/chat (SSE)  │
                │  - /api/upload      │
                │  - serves static UI │
                └─────────────────────┘
```

- **Backend**: FastAPI in `app/` — `main.py` (routes), `llm.py` (OpenRouter streaming client), `uploads.py` (PDF/text/image handling), `config.py`
- **Frontend**: vanilla JS modules — `avatar.js` (SVG controller), `speech.js` (TTS/STT + sentence splitter), `chat.js` (streaming + state), `main.js` (DOM wiring)
- **Why streaming sentences?** The browser's TTS engine works one utterance at a time. As tokens stream in, a splitter slices them into sentences and queues each one to be spoken. The user starts hearing the answer well before the model has finished generating it.

---

## Cost notes

| Model                                   | Cost (in / out per 1M tokens) | Notes                          |
|-----------------------------------------|-------------------------------|--------------------------------|
| `openrouter/free`                       | $0 / $0                       | default, vision-capable        |
| `google/gemma-4-26b-a4b-it:free`        | $0 / $0                       | larger free model, vision      |
| `meta-llama/llama-3.3-70b-instruct:free`| $0 / $0                       | text only, sometimes rate-limited |
| `google/gemma-3-4b-it`                  | ~$0.04 / $0.08                | absurdly cheap, vision         |
| `google/gemini-2.0-flash-lite-001`      | ~$0.075 / $0.30               | fast, vision                   |
| `anthropic/claude-haiku-4-5`            | premium                       | best quality, slowest          |

A typical 50-turn lesson on Gemma 3 4B costs less than a US cent.

---

## Project layout

```
LiveTutor AI/
├── .env / .env.example          # API key + config
├── requirements.txt             # Python deps
├── run.py                       # uvicorn entry point
├── app/
│   ├── config.py                # settings + model list
│   ├── llm.py                   # OpenRouter streaming client
│   ├── main.py                  # FastAPI routes
│   └── uploads.py               # file → text/image extraction
├── templates/
│   └── index.html               # main UI shell
├── static/
│   ├── css/style.css
│   └── js/
│       ├── avatar.js            # SVG avatar controller
│       ├── speech.js            # TTS/STT + sentence splitter
│       ├── chat.js              # chat client / streaming
│       └── main.js              # DOM wiring
└── uploads/                     # files attached during chats
```

---

## Roadmap

- [ ] Swap browser TTS for **Piper TTS** (truly local, higher quality, gives audio for amplitude-driven lip-sync)
- [ ] Phoneme-aligned lip-sync (real visemes per phoneme, not random cycling)
- [ ] Multiple avatar styles — anime, photoreal, 3D Three.js head
- [ ] Avatar customization (hair color, glasses, skin tone, gender)
- [ ] Whiteboard / shared canvas the tutor can draw on
- [ ] Persistent multi-session memory across browser reloads
- [ ] Local Whisper for STT (browser STT can be flaky on Safari)

---

## Troubleshooting

- **No voice plays**: Open the **voices** dropdown in the bottom bar and pick a different voice. Some browsers require a user gesture before audio plays — try sending a message first.
- **Mic button disabled**: Your browser doesn't expose `webkitSpeechRecognition`. Use Chrome or Edge.
- **`OpenRouter error 404`** for the default model: free models on OpenRouter rotate. Pick a different model from the dropdown.
- **`429 rate-limited`**: Free tier hits a ceiling — wait a minute or switch to a different free model.
