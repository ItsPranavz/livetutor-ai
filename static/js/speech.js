/* LiveTutor speech module
 *
 * TTS: backend Edge TTS + Whisper word-level alignment. Audio bytes are
 *      decoded by avatar.js and fed into TalkingHead.js for accurate
 *      viseme timing (uses real word offsets from Whisper, not estimates).
 *
 * STT: MediaRecorder (browser) → POST /api/stt → faster-whisper. We listen
 *      with a Web Audio amplitude monitor so we can auto-stop after 4
 *      seconds of silence and surface a live VU meter to the UI.
 *
 * Filler: when Chat fires Speech.playFiller(), we fetch a pre-cached
 *         "Hmm…" / "Right…" audio clip from the backend (~10ms) and play
 *         it immediately. Bridges the gap between user-send and the real
 *         streamed reply.
 */
(function () {
  // ─── TTS ───────────────────────────────────────────────────────────────
  const VOICE_KEY = "livetutor.voice.id";
  const MUTE_KEY = "livetutor.mute";

  const queue = [];
  const inflight = [];
  let speaking = false;
  let muted = localStorage.getItem(MUTE_KEY) === "1";
  let chosenVoice = localStorage.getItem(VOICE_KEY) || null;
  let stopRequested = false;

  const callbacks = { onStart: null, onEnd: null, onCaption: null };

  function setVoice(v) {
    if (!v) return;
    chosenVoice = v;
    localStorage.setItem(VOICE_KEY, v);
  }
  function getVoice() {
    if (chosenVoice) return chosenVoice;
    const sel = document.getElementById("voice-select");
    return (sel && sel.value) || "en-US-AndrewNeural";
  }

  async function synthSentence(text) {
    const r = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice: getVoice(), align: true }),
    });
    if (!r.ok) {
      let detail = "";
      try { detail = (await r.json()).detail || ""; } catch {}
      throw new Error(`TTS HTTP ${r.status}: ${detail}`);
    }
    const j = await r.json();
    return { ...j, text };
  }

  async function pump() {
    if (speaking) return;
    if (muted) { queue.length = 0; inflight.length = 0; return; }
    if (queue.length === 0 && inflight.length === 0) return;

    while (inflight.length < 2 && queue.length > 0) {
      const item = queue.shift();
      // item = {text, isFiller?, prefetchedAudioB64?, prefetchedMime?, prefetchedBoundaries?}
      if (item.prefetchedAudioB64) {
        // Filler — already have audio bytes; no synth needed
        inflight.push({
          text: item.text,
          isFiller: !!item.isFiller,
          promise: Promise.resolve({
            audio_b64: item.prefetchedAudioB64,
            mime: item.prefetchedMime,
            boundaries: item.prefetchedBoundaries || [],
          }),
        });
      } else {
        inflight.push({
          text: item.text,
          isFiller: !!item.isFiller,
          promise: synthSentence(item.text).catch(e => {
            console.warn("[tts] synth error:", e);
            return null;
          }),
        });
      }
    }

    const next = inflight.shift();
    if (!next) return;
    const synth = await next.promise;
    if (stopRequested) { stopRequested = false; speaking = false; return pump(); }
    if (!synth || !synth.audio_b64) return pump();

    speaking = true;
    if (!next.isFiller) {
      if (callbacks.onStart) callbacks.onStart(next.text);
      if (callbacks.onCaption) callbacks.onCaption(next.text);
    }
    try {
      if (window.Avatar && window.Avatar.isReady && window.Avatar.isReady()) {
        await window.Avatar.speakAudio({
          audioB64: synth.audio_b64,
          mime: synth.mime,
          boundaries: synth.boundaries,
          fullText: next.text,
          isFiller: next.isFiller,
        });
      } else {
        await playRaw(synth.audio_b64, synth.mime);
      }
    } catch (e) {
      console.warn("[tts] playback error:", e);
    }
    speaking = false;

    if (queue.length === 0 && inflight.length === 0) {
      if (window.Avatar) window.Avatar.setState("idle");
      if (callbacks.onEnd) callbacks.onEnd();
    } else {
      pump();
    }
  }

  function playRaw(b64, mime) {
    return new Promise((resolve) => {
      const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: mime || "audio/mpeg" });
      const url = URL.createObjectURL(blob);
      const a = new Audio(url);
      a.onended = () => { URL.revokeObjectURL(url); resolve(); };
      a.onerror = () => { URL.revokeObjectURL(url); resolve(); };
      a.play().catch(() => resolve());
    });
  }

  function queueText(text) {
    if (!text || !text.trim() || muted) return;
    // New content cancels any pending stop request from a previous stopAll().
    stopRequested = false;
    queue.push({ text: text.trim(), isFiller: false });
    pump();
  }

  // ── Filler: instantly play "Hmm, let me think." while real reply generates
  let lastFillerAt = 0;
  async function playFiller() {
    if (muted) return;
    // Don't spam fillers if the user sends rapidly
    if (Date.now() - lastFillerAt < 4000) return;
    lastFillerAt = Date.now();
    try {
      const r = await fetch("/api/filler", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voice: getVoice() }),
      });
      if (!r.ok) return;
      const j = await r.json();
      // The chat.js flow calls stopAll() right before playFiller(); clear the
      // stop signal so this newly-queued filler isn't immediately discarded.
      stopRequested = false;
      queue.unshift({
        text: j.text || "",
        isFiller: true,
        prefetchedAudioB64: j.audio_b64,
        prefetchedMime: j.mime,
        prefetchedBoundaries: j.boundaries || [],
      });
      pump();
    } catch (e) { /* silent — fillers are best-effort */ }
  }

  function stopAll() {
    queue.length = 0;
    inflight.length = 0;
    stopRequested = true;
    speaking = false;
    if (window.Avatar) {
      window.Avatar.stopSpeaking();
      window.Avatar.setState("idle");
    }
  }

  function isSpeaking() { return speaking || queue.length > 0 || inflight.length > 0; }
  function setMuted(v) {
    muted = !!v;
    localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
    if (muted) stopAll();
  }
  function isMuted() { return muted; }

  function makeSentenceSplitter(onSentence) {
    let buffer = "";
    function feed(chunk) {
      if (!chunk) return;
      buffer += chunk;
      const re = /[^.!?]*[.!?]+["')\]]*\s+|[^.!?\n]+\n+/g;
      let match, lastIdx = 0;
      while ((match = re.exec(buffer)) !== null) {
        const sentence = match[0].trim();
        if (sentence.length >= 2) onSentence(sentence);
        lastIdx = re.lastIndex;
      }
      buffer = buffer.slice(lastIdx);
      if (buffer.length > 200) {
        const commaIdx = buffer.lastIndexOf(",");
        if (commaIdx > 40) {
          const part = buffer.slice(0, commaIdx + 1).trim();
          buffer = buffer.slice(commaIdx + 1);
          if (part) onSentence(part);
        }
      }
    }
    function flush() {
      const remaining = buffer.trim();
      buffer = "";
      if (remaining) onSentence(remaining);
    }
    return { feed, flush };
  }

  // ─── STT ───────────────────────────────────────────────────────────────
  const SILENCE_MS = 4000;
  const SILENCE_THRESHOLD = 0.012;

  let mediaStream = null;
  let mediaRecorder = null;
  let audioChunks = [];
  let listening = false;
  let userStopped = false;
  let lastVoiceAt = 0;
  let firstVoiceAt = 0;
  let silenceTimer = null;
  let countdownTicker = null;
  let analyserCtx = null;
  let analyserNode = null;
  let analyserData = null;

  const sttCallbacks = { onPartial: null, onFinal: null, onState: null, onCountdown: null, onLevel: null };

  function sttSupported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
  }

  function pickRecorderMime() {
    const candidates = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/ogg;codecs=opus",
      "audio/mp4",
      "",
    ];
    for (const m of candidates) {
      if (!m || (window.MediaRecorder.isTypeSupported && window.MediaRecorder.isTypeSupported(m))) return m;
    }
    return "";
  }

  async function startListening() {
    if (!sttSupported()) return false;
    if (listening) return true;
    stopAll();

    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 16000,
        },
      });
    } catch (e) {
      if (sttCallbacks.onState) sttCallbacks.onState("error:permission");
      return false;
    }

    const mime = pickRecorderMime();
    audioChunks = [];
    mediaRecorder = new MediaRecorder(mediaStream, mime ? { mimeType: mime } : undefined);
    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) audioChunks.push(e.data);
    };
    mediaRecorder.onstart = () => {
      listening = true;
      userStopped = false;
      lastVoiceAt = Date.now();
      firstVoiceAt = 0;
      if (window.Avatar) window.Avatar.setState("listening");
      if (sttCallbacks.onState) sttCallbacks.onState("listening");
      startVoiceMonitor();
    };
    mediaRecorder.onstop = async () => {
      listening = false;
      stopVoiceMonitor();
      if (sttCallbacks.onState) sttCallbacks.onState("processing");

      const usedMime = mediaRecorder.mimeType || mime || "audio/webm";
      const blob = new Blob(audioChunks, { type: usedMime });
      audioChunks = [];

      try { mediaStream.getTracks().forEach(t => t.stop()); } catch (_) {}
      mediaStream = null;
      mediaRecorder = null;

      if (firstVoiceAt === 0 || userStopped) {
        if (sttCallbacks.onState) sttCallbacks.onState("idle");
        if (window.Avatar && !isSpeaking()) window.Avatar.setState("idle");
        return;
      }

      try {
        const fd = new FormData();
        fd.append("file", blob, "speech." + (usedMime.includes("ogg") ? "ogg" : usedMime.includes("mp4") ? "m4a" : "webm"));
        const r = await fetch("/api/stt", { method: "POST", body: fd });
        if (sttCallbacks.onState) sttCallbacks.onState("idle");
        if (window.Avatar && !isSpeaking()) window.Avatar.setState("idle");
        if (!r.ok) {
          const err = await r.text().catch(() => "");
          console.warn("[stt] HTTP", r.status, err);
          return;
        }
        const j = await r.json();
        const text = (j.text || "").trim();
        if (text && sttCallbacks.onFinal) sttCallbacks.onFinal(text);
      } catch (e) {
        console.warn("[stt] fetch failed:", e);
        if (sttCallbacks.onState) sttCallbacks.onState("idle");
      }
    };

    try { mediaRecorder.start(250); }
    catch (e) {
      if (sttCallbacks.onState) sttCallbacks.onState("error:" + e.message);
      return false;
    }
    return true;
  }

  function stopListening() {
    userStopped = true;
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      try { mediaRecorder.stop(); } catch (_) {}
    }
  }
  function isListening() { return listening; }

  function startVoiceMonitor() {
    stopVoiceMonitor();
    try {
      analyserCtx = new (window.AudioContext || window.webkitAudioContext)();
      const src = analyserCtx.createMediaStreamSource(mediaStream);
      analyserNode = analyserCtx.createAnalyser();
      analyserNode.fftSize = 1024;
      src.connect(analyserNode);
      analyserData = new Float32Array(analyserNode.fftSize);
    } catch (e) {
      console.warn("[stt] analyser init failed:", e);
    }
    countdownTicker = setInterval(() => {
      if (!listening || !analyserNode) return;
      analyserNode.getFloatTimeDomainData(analyserData);
      let sum = 0;
      for (let i = 0; i < analyserData.length; i++) sum += analyserData[i] * analyserData[i];
      const rms = Math.sqrt(sum / analyserData.length);

      const now = Date.now();
      if (rms > SILENCE_THRESHOLD) {
        lastVoiceAt = now;
        if (firstVoiceAt === 0) firstVoiceAt = now;
      }

      if (sttCallbacks.onLevel) sttCallbacks.onLevel(rms);

      const sinceVoice = now - lastVoiceAt;
      const remaining = firstVoiceAt === 0 ? SILENCE_MS : Math.max(0, SILENCE_MS - sinceVoice);
      if (sttCallbacks.onCountdown) sttCallbacks.onCountdown(remaining, rms);

      if (firstVoiceAt > 0 && sinceVoice >= SILENCE_MS) {
        if (sttCallbacks.onState) sttCallbacks.onState("auto-stop");
        try { mediaRecorder && mediaRecorder.stop(); } catch (_) {}
      }
    }, 80);
  }

  function stopVoiceMonitor() {
    if (countdownTicker) { clearInterval(countdownTicker); countdownTicker = null; }
    if (analyserCtx) { try { analyserCtx.close(); } catch (_) {} analyserCtx = null; }
    analyserNode = null;
    analyserData = null;
    if (sttCallbacks.onCountdown) sttCallbacks.onCountdown(null, 0);
    if (sttCallbacks.onLevel) sttCallbacks.onLevel(null);
  }

  window.Speech = {
    queueText,
    playFiller,
    stopAll,
    isSpeaking,
    setMuted,
    isMuted,
    makeSentenceSplitter,
    setCallbacks(cbs) { Object.assign(callbacks, cbs); },

    setVoice,
    getVoice,

    startListening,
    stopListening,
    isListening,
    sttSupported,
    setSTTCallbacks(cbs) { Object.assign(sttCallbacks, cbs); },

    SILENCE_MS,
  };
})();
