/* LiveTutor chat client
 *
 *  - POST /api/chat with SSE-style stream
 *  - tokens → sentence splitter → window.Speech.queueText (which calls Edge TTS,
 *    which feeds audio to the avatar for lip-sync)
 *  - persists transcript and pending attachments
 */
(function () {
  const STORAGE_KEY = "livetutor.transcript";

  const state = {
    history: [],
    pendingAttachments: [],
    streaming: false,
    abortController: null,
  };

  function loadHistory() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) state.history = JSON.parse(raw) || [];
    } catch (_) { state.history = []; }
  }
  function saveHistory() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.history.slice(-60))); } catch (_) {}
  }
  function clearHistory() {
    state.history = [];
    saveHistory();
    renderTranscript();
  }

  function renderTranscript() {
    const list = document.getElementById("transcript-list");
    if (!list) return;
    list.innerHTML = "";
    if (state.history.length === 0) {
      const empty = document.createElement("div");
      empty.className = "msg system";
      empty.textContent = "No messages yet. Say hi to your tutor.";
      list.appendChild(empty);
      return;
    }
    state.history.forEach(m => {
      const div = document.createElement("div");
      div.className = `msg ${m.role}`;
      const text = typeof m.content === "string" ? m.content : (m.displayText || "");
      div.textContent = text;
      if (m.attachments && m.attachments.length) {
        m.attachments.forEach(a => {
          if (a.kind === "image" && a.data_url) {
            const img = document.createElement("img");
            img.src = a.data_url;
            div.appendChild(img);
          } else if (a.name) {
            const tag = document.createElement("span");
            tag.className = "att";
            tag.textContent = `📎 ${a.name}`;
            div.appendChild(tag);
          }
        });
      }
      list.appendChild(div);
    });
    list.scrollTop = list.scrollHeight;
  }

  function renderAttachmentsRow() {
    const row = document.getElementById("attachments-row");
    if (!row) return;
    row.innerHTML = "";
    state.pendingAttachments.forEach((att, i) => {
      const chip = document.createElement("span");
      chip.className = "att-chip";
      if (att.kind === "image" && att.data_url) {
        const img = document.createElement("img");
        img.src = att.data_url;
        chip.appendChild(img);
      } else {
        const ic = document.createElement("span");
        ic.textContent = "📎";
        chip.appendChild(ic);
      }
      const label = document.createElement("span");
      label.textContent = att.name || "file";
      chip.appendChild(label);
      const x = document.createElement("button");
      x.type = "button";
      x.textContent = "×";
      x.title = "Remove";
      x.onclick = () => { state.pendingAttachments.splice(i, 1); renderAttachmentsRow(); };
      chip.appendChild(x);
      row.appendChild(chip);
    });
  }

  async function uploadFiles(files) {
    for (const file of files) {
      const fd = new FormData();
      fd.append("file", file);
      try {
        const r = await fetch("/api/upload", { method: "POST", body: fd });
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          alert(`Upload failed: ${err.detail || r.statusText}`);
          continue;
        }
        const info = await r.json();
        state.pendingAttachments.push(info);
      } catch (e) {
        alert(`Upload failed: ${e.message}`);
      }
    }
    renderAttachmentsRow();
  }

  function setStatus(text) {
    const el = document.getElementById("meta-status");
    if (el) el.textContent = text;
  }
  function setCaption(text, mode) {
    const cap = document.getElementById("caption-text");
    const wrap = document.getElementById("caption");
    if (cap) cap.textContent = text;
    if (wrap && mode) wrap.dataset.state = mode;
  }

  async function sendMessage(text) {
    if (state.streaming) return;
    text = (text || "").trim();
    const attachments = state.pendingAttachments.slice();
    if (!text && attachments.length === 0) return;

    if (window.Speech) {
      window.Speech.stopAll();
      // Bridge the LLM+TTS round-trip with a pre-cached "Hmm, let me think."
      // — gives the user something natural to hear in <200ms instead of an
      // awkward 2-second silence.
      window.Speech.playFiller();
    }

    const userMsg = {
      role: "user",
      content: text || "(file)",
      displayText: text,
      attachments,
    };
    state.history.push(userMsg);
    state.pendingAttachments = [];
    renderAttachmentsRow();
    renderTranscript();
    saveHistory();

    const sendHistory = state.history.slice(0, -1).map(m => ({
      role: m.role,
      content: typeof m.content === "string" ? m.content : (m.displayText || ""),
    }));

    const model = document.getElementById("model-select").value;

    setStatus("thinking…");
    if (window.Avatar) window.Avatar.setState("thinking");
    setCaption("…", "idle");

    const assistantMsg = { role: "assistant", content: "" };
    state.history.push(assistantMsg);

    const splitter = window.Speech.makeSentenceSplitter(s => window.Speech.queueText(s));

    state.streaming = true;
    state.abortController = new AbortController();

    try {
      const resp = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, history: sendHistory, attachments, model }),
        signal: state.abortController.signal,
      });

      if (!resp.ok || !resp.body) {
        const err = await resp.text().catch(() => "");
        throw new Error(`Server error: ${resp.status} ${err}`);
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let firstToken = true;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf("\n\n")) >= 0) {
          const ev = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          for (const line of ev.split("\n")) {
            if (!line.startsWith("data:")) continue;
            const data = line.slice(5).trim();
            if (!data) continue;
            let obj;
            try { obj = JSON.parse(data); } catch { continue; }
            if (obj.type === "token" && obj.text) {
              if (firstToken) {
                firstToken = false;
                setStatus("speaking…");
                setCaption("", "speaking");
              }
              assistantMsg.content += obj.text;
              splitter.feed(obj.text);
              const cap = document.getElementById("caption-text");
              if (cap) {
                cap.textContent = assistantMsg.content;
              }
            } else if (obj.type === "error") {
              throw new Error(obj.error || "Unknown error");
            }
          }
        }
      }
      splitter.flush();
      setStatus("Ready");
      saveHistory();
      renderTranscript();
    } catch (err) {
      if (err.name === "AbortError") {
        setStatus("stopped");
      } else {
        const msg = `Error: ${err.message}`;
        assistantMsg.content = msg;
        setCaption(msg, "idle");
        setStatus("error");
        if (window.Avatar) window.Avatar.setState("idle");
      }
      renderTranscript();
      saveHistory();
    } finally {
      state.streaming = false;
      state.abortController = null;
    }
  }

  function abortStream() {
    if (state.abortController) state.abortController.abort();
  }

  loadHistory();
  if (state.history.length) {
    const last = [...state.history].reverse().find(m => m.role === "assistant");
    if (last) {
      const cap = document.getElementById("caption-text");
      if (cap) cap.textContent = last.content;
    }
  }
  renderTranscript();

  window.Chat = {
    sendMessage,
    uploadFiles,
    clearHistory,
    abortStream,
    renderTranscript,
    state,
  };
})();
