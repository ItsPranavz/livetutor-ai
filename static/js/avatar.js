/* LiveTutor 3D avatar — wraps TalkingHead.js and exposes a simple API
 * via window.Avatar.
 *
 * Speech motion strategy:
 *   - Lip-sync visemes are driven by head.speakAudio(audio, words, wtimes,
 *     wdurations). When the backend supplies Whisper-aligned word timings
 *     (boundaries with kind=='word'), we use those directly — that's the
 *     accurate path. Otherwise we fall back to even distribution across
 *     sentences.
 *   - Body sway and hand IK come from head.speakWithHands. We force it on
 *     every utterance (TalkingHead's auto-call only fires at 50%).
 *   - Hand gestures from a curated pool fire at sentence/comma beats. We
 *     use slow transitions (1100ms) so motion looks human, and skip
 *     gestures on very short utterances (< 1.4s).
 *   - We strip the "METAPERSON AVATARS" branding from the AvatarSDK male
 *     model by replacing its outfit textures with flat-colour materials.
 */
import * as THREE from "three";
import { TalkingHead } from "talkinghead";

const container = document.getElementById("avatar-3d");
const loadingEl = document.getElementById("avatar-loading");
const statusText = document.getElementById("status-text");
const statusDot = document.querySelector(".status-pill .status-dot");

let head = null;
let ready = false;
let audioCtx = null;

const AVATAR_PROFILES = {
  brunette: {
    cameraView: "upper",
    body: "F",
    baseline: { eyeBlinkLeft: 0.04, eyeBlinkRight: 0.04 },
  },
  avatarsdk: {
    cameraView: "upper",
    body: "M",
    retarget: {
      Neck:  { z: -0.01, rx: -0.15 },
      Neck1: { z: -0.01, rx: -0.15 },
      Neck2: { z: -0.01, rx: -0.15 },
      LeftShoulder:  { rz: -0.3 },
      RightShoulder: { rz:  0.3 },
      scaleToEyesLevel: 1.0,
      origin: { y: -0.1 },
    },
    baseline: { headRotateX: -0.04, eyeBlinkLeft: 0.05, eyeBlinkRight: 0.05 },
    stripOutfitBrand: true,
    outfitTopColor: 0x2f6f7f,
    outfitBottomColor: 0x2a3a55,
    outfitShoeColor: 0x202028,
  },
  // Generic default for custom avatar URLs the user provides
  custom: {
    cameraView: "upper",
    body: "F",
    baseline: { eyeBlinkLeft: 0.04, eyeBlinkRight: 0.04 },
  },
};

// Curated tutor gestures. We weight them so the most natural ones (open-palm
// emphasis, slight side-shift) appear more often than the more demonstrative
// ones (handup, thumbup).
const GESTURE_WEIGHTS = [
  { name: "side",     weight: 5 },  // open palm to the side — the most natural
  { name: "index",    weight: 3 },  // pointing — feels teacher-like
  { name: "ok",       weight: 2 },
  { name: "handup",   weight: 1 },
  { name: "thumbup",  weight: 1 },
];

const TAIL_EMOJIS = ["🙂", "😊", "🤔"];

function profileFor(url) {
  const lower = (url || "").toLowerCase();
  if (lower.includes("avatarsdk")) return AVATAR_PROFILES.avatarsdk;
  if (lower.includes("brunette")) return AVATAR_PROFILES.brunette;
  return AVATAR_PROFILES.custom;
}

function setLoading(visible, text) {
  if (!loadingEl) return;
  loadingEl.style.display = visible ? "" : "none";
  const t = loadingEl.querySelector(".loader-text");
  if (t && text) t.textContent = text;
}

function getAudioContext() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
  return audioCtx;
}

async function init() {
  setLoading(true, "loading tutor…");
  try {
    head = new TalkingHead(container, {
      ttsEndpoint: null,
      ttsApikey: null,
      lipsyncModules: ["en"],
      cameraView: "upper",
      lightAmbientColor: 0xffffff,
      lightAmbientIntensity: 1.7,
      lightDirectColor: 0xb6c0ff,
      lightDirectIntensity: 1.5,
      modelPixelRatio: window.devicePixelRatio || 1,
      modelFPS: 30,
      avatarMute: false,
    });

    const url = window.LIVETUTOR_DEFAULT_AVATAR ||
      "https://cdn.jsdelivr.net/gh/met4citizen/TalkingHead@main/avatars/brunette.glb";
    await loadAvatar(url, profileFor(url).body);

    ready = true;
    setLoading(false);
    setState("idle");
  } catch (err) {
    console.error("[avatar] init failed:", err);
    setLoading(true, "avatar failed to load — check console");
  }
}

function setState(state) {
  if (statusText) statusText.textContent = state;
  if (statusDot) statusDot.dataset.state = state;
  if (!ready || !head) return;
  try {
    if (state === "happy") head.setMood("happy");
    else head.setMood("neutral");
  } catch (_) {}
}

function pickWeighted(items) {
  const total = items.reduce((s, i) => s + i.weight, 0);
  let r = Math.random() * total;
  for (const i of items) { r -= i.weight; if (r <= 0) return i.name; }
  return items[0].name;
}

function buildLipSyncTrack(boundaries, fullText, audioBuffer) {
  /** Returns {words, wtimes, wdurations}. Prefers Whisper word boundaries
   *  (kind=='word') if available — that's the accurate path. */
  const words = [];
  const wtimes = [];
  const wdurations = [];

  const wordBoundaries = (boundaries || []).filter(b => b.kind === "word");
  if (wordBoundaries.length > 0) {
    for (const b of wordBoundaries) {
      const text = (b.text || "").replace(/^[^\w']+|[^\w']+$/g, ""); // trim punctuation
      if (!text) continue;
      words.push(text);
      wtimes.push(b.offset_ms);
      wdurations.push(Math.max(80, b.duration_ms));
    }
    if (words.length > 0) return { words, wtimes, wdurations };
  }

  // Fallback: distribute words evenly across each sentence.
  const sentenceBoundaries = (boundaries || []).filter(b => b.kind === "sentence");
  if (sentenceBoundaries.length > 0) {
    for (const b of sentenceBoundaries) {
      const tokens = (b.text || "").split(/\s+/).filter(Boolean);
      if (!tokens.length) continue;
      const per = Math.max(60, b.duration_ms / tokens.length);
      for (let i = 0; i < tokens.length; i++) {
        words.push(tokens[i]);
        wtimes.push(b.offset_ms + i * per);
        wdurations.push(per * 0.9);
      }
    }
  } else if (fullText && audioBuffer) {
    const tokens = fullText.split(/\s+/).filter(Boolean);
    const totalMs = audioBuffer.duration * 1000;
    const per = Math.max(70, totalMs / Math.max(tokens.length, 1));
    for (let i = 0; i < tokens.length; i++) {
      words.push(tokens[i]);
      wtimes.push(i * per);
      wdurations.push(per * 0.9);
    }
  }
  return { words, wtimes, wdurations };
}

function scheduleGesturesAtBeats(boundaries, totalMs) {
  /** Pick beat points (sentence ends, commas) and schedule gestures there.
   *  Always slower transitions (1100ms) so it never looks snappy. Returns the
   *  list of {atMs, name, durSec, mirror} we scheduled. */
  const beats = [];
  const sentenceBs = (boundaries || []).filter(b => b.kind === "sentence");
  // Beat = ~120ms before sentence end (so the gesture peaks roughly when the
  // word finishes, not after).
  for (const b of sentenceBs) {
    const peakAt = b.offset_ms + Math.max(0, b.duration_ms - 700);
    beats.push(Math.max(200, peakAt));
  }
  if (beats.length === 0) {
    // Fallback: one beat per ~3.5s of speech
    for (let t = 700; t < totalMs - 800; t += 3500) beats.push(t);
  }

  const scheduled = [];
  let lastBeat = -2000;
  for (const t of beats) {
    if (t - lastBeat < 2200) continue;       // never two gestures within 2.2s
    if (t > totalMs - 800) break;            // skip if too close to the end
    lastBeat = t;
    const name = pickWeighted(GESTURE_WEIGHTS);
    const durSec = Math.min(2.6, Math.max(1.4, (totalMs - t) / 1000 - 0.3));
    const mirror = Math.random() < 0.45;
    scheduled.push({ atMs: t, name, durSec, mirror });
  }
  return scheduled;
}

async function speakAudio({ audioB64, mime, boundaries, fullText, isFiller }) {
  if (!ready || !head || !audioB64) return;

  const bytes = Uint8Array.from(atob(audioB64), c => c.charCodeAt(0));
  const ctx = getAudioContext();
  let audioBuffer;
  try {
    audioBuffer = await ctx.decodeAudioData(bytes.buffer.slice(0));
  } catch (e) {
    console.warn("[avatar] decode failed:", e);
    return;
  }

  const totalMs = audioBuffer.duration * 1000;
  const { words, wtimes, wdurations } = buildLipSyncTrack(boundaries, fullText, audioBuffer);

  setState("speaking");
  try {
    head.speakAudio({ audio: audioBuffer, words, wtimes, wdurations });

    // Body sway + hand IK on every utterance, with one re-pulse halfway.
    setTimeout(() => { try { head.speakWithHands(0, 1.0); } catch (_) {} }, 100);
    if (totalMs > 3500) {
      setTimeout(() => { try { head.speakWithHands(0, 1.0); } catch (_) {} }, totalMs * 0.55);
    }

    // Skip explicit gestures on fillers (they're too short to feel right).
    if (!isFiller && totalMs > 1400) {
      const gestures = scheduleGesturesAtBeats(boundaries, totalMs);
      for (const g of gestures) {
        setTimeout(() => {
          if (!head) return;
          try {
            // Slow 1100ms transition — feels human, not snappy.
            head.playGesture(g.name, g.durSec, g.mirror, 1100);
          } catch (_) {}
        }, g.atMs);
      }
    }

    await new Promise(r => setTimeout(r, Math.max(300, totalMs + 120)));

    // Tail expression after a real (non-filler) utterance — small smile.
    if (!isFiller) {
      setTimeout(() => {
        try { head.playGesture(TAIL_EMOJIS[Math.floor(Math.random() * TAIL_EMOJIS.length)], 1.4, false, 600); } catch (_) {}
      }, 0);
    }
  } catch (e) {
    console.warn("[avatar] speakAudio error:", e);
  }
}

function stopSpeaking() {
  if (!head) return;
  try {
    if (typeof head.stopSpeaking === "function") head.stopSpeaking();
    if (typeof head.stopGesture === "function") head.stopGesture(400);
  } catch (_) {}
}

function replaceMeshMaterial(mesh, color) {
  if (!mesh || !mesh.material) return;
  const old = mesh.material;
  const next = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.78,
    metalness: 0.02,
    skinning: !!old.skinning,
  });
  next.name = old.name;
  if (old.map) { try { old.map.dispose(); } catch (_) {} }
  try { old.dispose(); } catch (_) {}
  mesh.material = next;
}

function stripOutfitBranding(profile) {
  if (!head || !head.armature || !profile.stripOutfitBrand) return;
  head.armature.traverse((o) => {
    if (!o.isMesh) return;
    const n = (o.name || "").toLowerCase();
    if (n === "outfit_top")    return replaceMeshMaterial(o, profile.outfitTopColor);
    if (n === "outfit_bottom") return replaceMeshMaterial(o, profile.outfitBottomColor);
    if (n === "outfit_shoes")  return replaceMeshMaterial(o, profile.outfitShoeColor);
  });
}

async function loadAvatar(url, body) {
  if (!head) return;
  setLoading(true, "loading tutor…");
  const profile = profileFor(url);
  const opts = {
    url,
    body: body || profile.body || "F",
    avatarMood: "neutral",
    lipsyncLang: "en",
  };
  if (profile.retarget) opts.retarget = profile.retarget;
  if (profile.baseline) opts.baseline = profile.baseline;

  try {
    await head.showAvatar(opts, (ev) => {
      if (ev && ev.lengthComputable) {
        const pct = Math.round((ev.loaded / ev.total) * 100);
        setLoading(true, `loading tutor… ${pct}%`);
      }
    });
    stripOutfitBranding(profile);
    if (typeof head.setView === "function" && profile.cameraView) {
      try {
        head.cameraClock = null;
        head.setView(profile.cameraView);
      } catch (_) {}
    }
    setLoading(false);
  } catch (e) {
    console.error("[avatar] swap failed:", e);
    setLoading(true, "could not load that avatar");
    setTimeout(() => setLoading(false), 1800);
  }
}

window.Avatar = {
  setState,
  speakAudio,
  stopSpeaking,
  loadAvatar,
  isReady: () => ready,
  _head: () => head,
  playGesture: (name, dur = 3, mirror = false, ms = 1100) => {
    if (head && typeof head.playGesture === "function") {
      try { head.playGesture(name, dur, mirror, ms); } catch (e) { console.warn(e); }
    }
  },
  // Compatibility shims
  startSpeakingLoop: () => {},
  stopSpeakingLoop: () => {},
  showViseme: () => {},
  blinkOnce: () => {},
};

init();
