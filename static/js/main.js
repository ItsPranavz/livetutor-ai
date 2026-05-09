/* LiveTutor: DOM event wiring */
(function () {
  const $ = (id) => document.getElementById(id);

  const messageInput  = $("message-input");
  const composerForm  = $("composer-form");
  const fileInput     = $("file-input");
  const attachBtn     = $("attach-btn");
  const micBtn        = $("mic-btn");
  const sendBtn       = $("send-btn");
  const resetBtn      = $("reset-btn");

  const captionWrap   = $("caption");
  const captionText   = $("caption-text");
  const historyToggle = $("history-toggle");
  const transcript    = $("transcript");
  const transcriptClose = $("transcript-close");

  const ttsToggle     = $("tts-toggle");
  const voiceSelect   = $("voice-select");
  const avatarSelect  = $("avatar-select");
  const modelSelect   = $("model-select");

  const vuMeter       = $("vu-meter");
  const vuBars        = $("vu-bars");
  const silenceCountdown = $("silence-countdown");
  const metaStatus    = $("meta-status");
  const modelDisplay  = $("model-display");

  const customModal   = $("custom-avatar-modal");
  const customUrl     = $("custom-url-input");
  const customCancel  = $("custom-cancel");
  const customApply   = $("custom-apply");

  const CUSTOM_URL_KEY = "livetutor.customAvatar.url";
  const CUSTOM_BODY_KEY = "livetutor.customAvatar.body";

  // ─── composer ─────────────────────────────────────────────────────────
  function autosize() {
    messageInput.style.height = "auto";
    messageInput.style.height = Math.min(messageInput.scrollHeight, 160) + "px";
  }
  messageInput.addEventListener("input", autosize);

  composerForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const txt = messageInput.value;
    messageInput.value = "";
    autosize();
    await window.Chat.sendMessage(txt);
  });

  messageInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      composerForm.requestSubmit();
    }
  });

  // ─── attachments ─────────────────────────────────────────────────────
  attachBtn.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async () => {
    if (!fileInput.files || !fileInput.files.length) return;
    await window.Chat.uploadFiles(fileInput.files);
    fileInput.value = "";
  });

  // ─── transcript drawer ───────────────────────────────────────────────
  function openTranscript() {
    window.Chat.renderTranscript();
    transcript.classList.remove("hidden");
    transcript.setAttribute("aria-hidden", "false");
  }
  function closeTranscript() {
    transcript.classList.add("hidden");
    transcript.setAttribute("aria-hidden", "true");
  }
  historyToggle.addEventListener("click", (e) => { e.stopPropagation(); openTranscript(); });
  captionWrap.addEventListener("click", (e) => {
    if (e.target.closest(".caption-history")) return;
    openTranscript();
  });
  transcriptClose.addEventListener("click", closeTranscript);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (!transcript.classList.contains("hidden")) closeTranscript();
      if (!customModal.classList.contains("hidden")) closeCustomModal();
    }
  });

  // ─── New Session ─────────────────────────────────────────────────────
  resetBtn.addEventListener("click", () => {
    if (window.Speech) window.Speech.stopAll();
    if (window.Chat.state && window.Chat.state.abortController) {
      try { window.Chat.state.abortController.abort(); } catch (_) {}
    }
    window.Chat.clearHistory();
    window.Chat.state.pendingAttachments = [];
    document.getElementById("attachments-row").innerHTML = "";
    if (captionText) captionText.textContent = "Fresh session. What would you like to learn?";
    captionWrap.dataset.state = "idle";
    metaStatus.textContent = "Ready";
    if (window.Avatar) window.Avatar.setState("idle");
    resetBtn.classList.add("flash");
    setTimeout(() => resetBtn.classList.remove("flash"), 600);
  });

  // ─── voice picker — filtered by avatar gender ────────────────────────
  function applyVoiceFilter(gender, preferredVoiceId) {
    if (!voiceSelect) return;
    let firstVisible = null;
    let preferredHit = null;
    for (const opt of voiceSelect.options) {
      const g = opt.dataset.gender || "";
      const visible = !gender || g === gender;
      opt.hidden = !visible;
      opt.disabled = !visible;
      if (visible) {
        if (!firstVisible) firstVisible = opt;
        if (preferredVoiceId && opt.value === preferredVoiceId) preferredHit = opt;
      }
    }
    const cur = voiceSelect.options[voiceSelect.selectedIndex];
    if (!cur || cur.hidden) {
      const target = preferredHit || firstVisible;
      if (target) voiceSelect.value = target.value;
      if (window.Speech) window.Speech.setVoice(voiceSelect.value);
    }
  }

  // ─── avatar picker (incl. "Custom Ready Player Me URL…") ─────────────
  function applyAvatarSelection() {
    if (!avatarSelect) return;
    const opt = avatarSelect.options[avatarSelect.selectedIndex];
    if (!opt) return;
    const value = avatarSelect.value;

    // Special "custom" sentinel
    if (value === "custom") {
      openCustomModal();
      // Revert the dropdown so it doesn't stay on "Custom" if user cancels
      avatarSelect.value = avatarSelect.querySelector("option:not([value='custom'])").value;
      return;
    }

    const body = opt.dataset.body || "F";
    const gender = opt.dataset.gender || "F";
    const preferred = opt.dataset.defaultVoice || "";
    applyVoiceFilter(gender, preferred);
    if (window.Avatar && window.Avatar.loadAvatar) window.Avatar.loadAvatar(value, body);
  }

  if (avatarSelect) {
    avatarSelect.addEventListener("change", applyAvatarSelection);
    const opt = avatarSelect.options[avatarSelect.selectedIndex];
    if (opt) applyVoiceFilter(opt.dataset.gender || "F", opt.dataset.defaultVoice || "");
  }

  if (voiceSelect) {
    const saved = localStorage.getItem("livetutor.voice.id");
    if (saved) {
      const opt = [...voiceSelect.options].find(o => o.value === saved && !o.hidden);
      if (opt) voiceSelect.value = saved;
    }
    if (window.Speech) window.Speech.setVoice(voiceSelect.value);
    voiceSelect.addEventListener("change", () => {
      if (window.Speech) window.Speech.setVoice(voiceSelect.value);
    });
  }

  // ─── custom avatar modal ────────────────────────────────────────────
  function openCustomModal() {
    customModal.classList.remove("hidden");
    customModal.setAttribute("aria-hidden", "false");
    customUrl.value = localStorage.getItem(CUSTOM_URL_KEY) || "";
    const savedBody = localStorage.getItem(CUSTOM_BODY_KEY) || "F";
    document.querySelectorAll("input[name='custom-body']").forEach(r => {
      r.checked = r.value === savedBody;
    });
    setTimeout(() => customUrl.focus(), 50);
  }
  function closeCustomModal() {
    customModal.classList.add("hidden");
    customModal.setAttribute("aria-hidden", "true");
  }
  customCancel.addEventListener("click", closeCustomModal);
  customModal.addEventListener("click", (e) => {
    if (e.target === customModal) closeCustomModal();
  });

  customApply.addEventListener("click", () => {
    let url = (customUrl.value || "").trim();
    if (!url || !/\.glb($|\?)/i.test(url)) {
      customUrl.style.borderColor = "var(--danger)";
      setTimeout(() => { customUrl.style.borderColor = ""; }, 1200);
      return;
    }
    // Auto-append the morphTargets query string if user forgot it
    if (!url.includes("morphTargets")) {
      url += (url.includes("?") ? "&" : "?") + "morphTargets=ARKit,Oculus%20Visemes&textureAtlas=1024";
    }
    const body = (document.querySelector("input[name='custom-body']:checked") || {}).value || "F";
    localStorage.setItem(CUSTOM_URL_KEY, url);
    localStorage.setItem(CUSTOM_BODY_KEY, body);
    closeCustomModal();
    applyVoiceFilter(body, body === "M" ? "en-US-AndrewNeural" : "en-US-EmmaNeural");
    if (window.Avatar && window.Avatar.loadAvatar) window.Avatar.loadAvatar(url, body);
  });

  // Restore previous custom avatar on reload, if it was the last used
  (() => {
    const saved = localStorage.getItem(CUSTOM_URL_KEY);
    if (saved && localStorage.getItem("livetutor.lastWasCustom") === "1") {
      const body = localStorage.getItem(CUSTOM_BODY_KEY) || "F";
      setTimeout(() => {
        if (window.Avatar && window.Avatar.loadAvatar) window.Avatar.loadAvatar(saved, body);
      }, 1500);
    }
  })();

  // ─── model display ────────────────────────────────────────────────────
  function updateModelDisplay() {
    if (!modelDisplay || !modelSelect) return;
    const opt = modelSelect.options[modelSelect.selectedIndex];
    modelDisplay.textContent = opt ? opt.textContent.split("·")[0].trim() : "";
  }
  modelSelect && modelSelect.addEventListener("change", updateModelDisplay);
  updateModelDisplay();

  // ─── mic / STT with VU meter ─────────────────────────────────────────
  // Pre-render 8 thin bars in the input overlay
  if (vuBars) {
    vuBars.innerHTML = "";
    for (let i = 0; i < 8; i++) {
      const b = document.createElement("span");
      vuBars.appendChild(b);
    }
  }
  const vuBarEls = vuBars ? Array.from(vuBars.children) : [];

  function setVuLevel(rms) {
    if (!vuBarEls.length) return;
    const targets = [];
    for (let i = 0; i < vuBarEls.length; i++) {
      // Bias each bar's threshold so they light up progressively
      const threshold = (i + 1) / 12;
      const lit = (rms || 0) > threshold;
      const baseHeight = 3 + (i % 4) * 2;
      const litHeight = baseHeight + Math.min(20, (rms || 0) * 200);
      vuBarEls[i].style.height = (lit ? litHeight : baseHeight) + "px";
      vuBarEls[i].style.opacity = lit ? "1" : "0.35";
    }
  }

  if (!window.Speech.sttSupported()) {
    micBtn.disabled = true;
    micBtn.title = "Microphone not available in this browser.";
  } else {
    window.Speech.setSTTCallbacks({
      onPartial: (txt) => {
        captionText.textContent = txt || "(listening…)";
        captionWrap.dataset.state = "listening";
      },
      onFinal: (txt) => {
        if (!txt) return;
        messageInput.value = (messageInput.value ? (messageInput.value + " ") : "") + txt;
        composerForm.requestSubmit();
      },
      onState: (s) => {
        if (s === "listening") {
          micBtn.classList.add("recording");
          metaStatus.textContent = "listening…";
          vuMeter.hidden = false;
          messageInput.placeholder = "";
        } else if (s === "processing") {
          micBtn.classList.remove("recording");
          metaStatus.textContent = "transcribing…";
          vuMeter.hidden = true;
          messageInput.placeholder = "Message your tutor…";
        } else {
          micBtn.classList.remove("recording");
          vuMeter.hidden = true;
          messageInput.placeholder = "Message your tutor…";
          if (metaStatus.textContent === "listening…" || metaStatus.textContent === "transcribing…") {
            metaStatus.textContent = "Ready";
          }
        }
      },
      onLevel: (rms) => setVuLevel(rms),
      onCountdown: (remainingMs, rms) => {
        if (remainingMs == null) {
          silenceCountdown.textContent = "";
          return;
        }
        if (remainingMs <= 0) silenceCountdown.textContent = "stopping…";
        else if (remainingMs < 2500) silenceCountdown.textContent = `auto-send in ${(remainingMs / 1000).toFixed(1)}s`;
        else silenceCountdown.textContent = "";
      },
    });

    micBtn.addEventListener("click", () => {
      if (window.Speech.isListening()) window.Speech.stopListening();
      else window.Speech.startListening();
    });
  }

  // ─── TTS mute toggle ──────────────────────────────────────────────────
  function refreshMuteLabel() {
    const muted = window.Speech && window.Speech.isMuted();
    ttsToggle.textContent = muted ? "unmute voice" : "mute voice";
    ttsToggle.setAttribute("aria-pressed", muted ? "true" : "false");
  }
  refreshMuteLabel();
  ttsToggle.addEventListener("click", () => {
    if (!window.Speech) return;
    window.Speech.setMuted(!window.Speech.isMuted());
    refreshMuteLabel();
  });

  // ─── Speech callbacks ─────────────────────────────────────────────────
  window.Speech.setCallbacks({
    onCaption: (text) => {
      captionText.textContent = text;
      captionWrap.dataset.state = "speaking";
    },
    onEnd: () => {
      if (window.Avatar) {
        window.Avatar.setState("happy");
        setTimeout(() => {
          if (!window.Speech.isSpeaking() && !window.Speech.isListening()) {
            window.Avatar.setState("idle");
          }
        }, 1200);
      }
    },
  });

  // ─── health probe ────────────────────────────────────────────────────
  fetch("/api/health").then(r => r.json()).then(j => {
    if (!j.has_key) metaStatus.textContent = "⚠ no API key set";
  }).catch(() => {});
})();
