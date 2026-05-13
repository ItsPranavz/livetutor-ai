# LiveTutor AI

A real-time, browser-based AI tutor with a 3D talking avatar. The tutor speaks, lip-syncs to its actual voice, gestures while talking, and listens to you with your microphone, all powered by a streaming language model on OpenRouter and a local Whisper backbone for speech understanding.

> Designed to run for **well under $1** for a full evaluation. The default model is fast and cheap; voice and speech recognition run locally, so the only paid surface is the LLM call itself.

---

## Features

- **3D talking avatar.** Built with Three.js and Ready Player Me-style models via [TalkingHead.js](https://github.com/met4citizen/TalkingHead). The avatar's mouth moves in sync with what it says, it uses hand gestures, and it shows facial expressions at the end of sentences. Pick a built-in male or female teacher, or paste your own custom Ready Player Me URL.
- **Accurate lip-sync.** Every spoken sentence is processed with `faster-whisper` on the server to get the timing of each word, so the mouth movements match the real sounds.
- **Fast response time.** When you hit send, a short filler ("Hmm, let me think.") starts playing in about 200ms while the LLM is still generating the real reply. The conversation feels instant even though the full round-trip takes 2 to 3 seconds.
- **Fast LLM.** Defaults to `meta-llama/llama-3.3-70b-instruct` routed to **Groq** through OpenRouter, with around 200ms time-to-first-token. Falls back to Cerebras or Sambanova. Switches to a vision model automatically when you attach an image.
- **Local speech recognition.** Your voice is captured with `MediaRecorder`, sent to a local `faster-whisper` endpoint, and transcribed there. It listens continuously, stops after 4 seconds of silence, and shows a live VU meter. Much more accurate than the browser's built-in speech API.
- **Microsoft neural voices.** The backend uses `edge-tts` for voices like Andrew, Emma, Ava, Brian, Aria, Jenny, Sonia, Ryan, and Natasha. The voice picker is filtered by the avatar's gender.
- **Streaming responses.** Tokens stream from OpenRouter into the caption bubble, and sentences are spoken as they arrive.
- **File attachments.** Drop in images (sent to a vision model), PDFs (text is extracted), or text, code, and markdown files.
- **Polished UI.** Unified composer, glass surfaces, refined typography, and smooth micro-interactions.

---

## Quick start

### Requirements
- Python 3.11+ (tested on 3.14)
- A modern browser. Chrome, Edge, or Safari recommended (we use `MediaRecorder` and Web Audio APIs)
- An OpenRouter API key. Get one at https://openrouter.ai/keys
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

Open **http://127.0.0.1:8000** in your browser. The first time you click the mic, the Whisper model (about 150 MB for `base.en`) will download and load into memory. After that, transcriptions take 200 to 600 ms.

Allow the microphone permission when your browser asks. Click the page once before sending the first message; browsers require a user gesture before audio playback.

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

| Variable             | Default                             | Meaning                                          |
|----------------------|-------------------------------------|--------------------------------------------------|
| `OPENROUTER_API_KEY` | (required)                          | Your API key from openrouter.ai/keys             |
| `DEFAULT_MODEL`      | `meta-llama/llama-3.3-70b-instruct` | The default chat model                           |
| `DEFAULT_VOICE`      | `en-US-AndrewNeural`                | The default Microsoft Edge neural voice          |
| `WHISPER_MODEL`      | `base.en`                           | Whisper model size: tiny, base, small, medium    |
| `WHISPER_DEVICE`     | `cpu`                               | Device to run Whisper on: cpu or cuda            |
| `WHISPER_COMPUTE`    | `int8`                              | Whisper precision: int8, int16, float16, float32 |
| `APP_PORT`           | `8000`                              | Port the app runs on                             |

---

## Project layout

```
livetutor-ai/
├── .env / .env.example      API key + tunables (.env never committed)
├── LICENSE                  MIT
├── README.md
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

## License

This project is released under the [MIT License](LICENSE). See `LICENSE` for the full text.

---

## Contributing

Pull requests welcome. Please don't commit your `.env` or any API keys.
