# Third-Party Licenses

LiveTutor AI is released under the MIT License (see `LICENSE`). It depends on the following third-party software, used unmodified and at arm's length, each governed by its own license.

---

## Python (server-side)

| Package              | Version pin | License                | Project                                                                 |
|----------------------|-------------|------------------------|-------------------------------------------------------------------------|
| `fastapi`            | ≥ 0.115.0   | MIT                    | https://github.com/fastapi/fastapi                                      |
| `uvicorn[standard]`  | ≥ 0.32.0    | BSD-3-Clause           | https://github.com/encode/uvicorn                                       |
| `python-dotenv`      | ≥ 1.0.1     | BSD-3-Clause           | https://github.com/theskumar/python-dotenv                              |
| `httpx`              | ≥ 0.27.2    | BSD-3-Clause           | https://github.com/encode/httpx                                         |
| `python-multipart`   | ≥ 0.0.12    | Apache-2.0             | https://github.com/Kludex/python-multipart                              |
| `jinja2`             | ≥ 3.1.4     | BSD-3-Clause           | https://github.com/pallets/jinja                                        |
| `aiofiles`           | ≥ 24.1.0    | Apache-2.0             | https://github.com/Tinche/aiofiles                                      |
| `pypdf`              | ≥ 5.1.0     | BSD-3-Clause           | https://github.com/py-pdf/pypdf                                         |
| `edge-tts`           | ≥ 7.0.0     | **LGPL-3.0**           | https://github.com/rany2/edge-tts                                       |
| `faster-whisper`     | ≥ 1.0.3     | MIT                    | https://github.com/SYSTRAN/faster-whisper                               |

### Note on `edge-tts` (LGPL-3.0)

`edge-tts` is licensed under the GNU Lesser General Public License v3.0. We use it as a library (importing its public API) and do not modify it. Under LGPL-3.0 this is permitted from a project of any license, including this MIT-licensed project. We do not redistribute `edge-tts` itself; users install it from PyPI via `pip install -r requirements.txt`.

If you fork this project and *modify* the `edge-tts` source, those modifications must remain LGPL-3.0.

---

## JavaScript / WebGL (client-side, loaded from CDN)

| Library              | Version | License | Project                                                  |
|----------------------|---------|---------|----------------------------------------------------------|
| Three.js             | 0.160.1 | MIT     | https://threejs.org/                                     |
| TalkingHead.js       | main    | MIT     | https://github.com/met4citizen/TalkingHead               |

These are loaded at runtime from `cdn.jsdelivr.net` via an importmap; no copies are bundled in this repository.

The default avatar `.glb` files (`brunette.glb`, `avatarsdk.glb`) are *referenced by URL* from the TalkingHead.js repository. They are not redistributed in this project. The TalkingHead repository is licensed MIT.

---

## External services (not licensed code, but worth disclosing)

- **OpenRouter.ai** — chat / language model API. Each user supplies their own API key under their own OpenRouter agreement.
- **Microsoft Edge TTS endpoint** — `edge-tts` accesses Microsoft's public Edge browser TTS endpoint. Microsoft has not formally authorised third-party use of this endpoint. For non-personal or commercial use, please review Microsoft's terms of service or replace the TTS layer with a service you have explicit rights to use (e.g. Piper, Coqui XTTS, or a paid TTS provider).
- **Ready Player Me** — when a user pastes a custom `.glb` URL into the Custom Avatar dialog, that URL is fetched directly by the user's browser from `models.readyplayer.me` under Ready Player Me's terms. No avatar files are stored or redistributed by this project.

---

## Full license texts

- MIT — https://opensource.org/licenses/MIT
- BSD-3-Clause — https://opensource.org/licenses/BSD-3-Clause
- Apache-2.0 — https://www.apache.org/licenses/LICENSE-2.0
- LGPL-3.0 — https://www.gnu.org/licenses/lgpl-3.0.html

If you spot anything missing or incorrect here, please open an issue.
