// Eri companion — clean front-end logic on the Tauri shell.
// Talks to the Rust host via the single `bridge` command + `eri-stream` /
// `eri-result` events. Two-state window sizing (Pluely's robust approach: never
// content-measure into a collapse) — resting bar vs expanded answer.

const T = window.__TAURI__;
const invoke = T?.core?.invoke;
const listen = T?.event?.listen;

const $ = (id) => document.getElementById(id);
const body = document.body;
const answerEl = $("answer");
const statusEl = $("status");
const qEl = $("q");

const WIDTH = 600;
const H_BAR = 64;
const H_PANEL = 460;
const H_SETTINGS = 210;

let settingsOpen = false;
let currentTurn = 0;   // every ask() bumps this; stale events from old turns are ignored
let gotStream = false; // did THIS turn stream any real text?

function bridge(command, payload = {}) {
  if (!invoke) return;
  invoke("bridge", { message: { command, ...payload } }).catch((e) => console.error("[eri]", command, e));
}

let _fitRaf = false;
function fit() {
  if (_fitRaf) return;
  _fitRaf = true;
  requestAnimationFrame(() => {
    _fitRaf = false;
    // Window = the card's actual height. No fixed panel, no glass void below.
    const card = document.querySelector(".card");
    const h = card ? Math.ceil(card.getBoundingClientRect().height) : H_BAR;
    bridge("resizeWindow", { width: WIDTH, height: Math.max(56, h) });
  });
}

/* ---------------- ask + stream ---------------- */
let inTool = false;

function resetStreamFilter() { inTool = false; }

// Strip the agentic loop's internal markers so the reply reads like a clean
// answer (Cluely-style), never the mechanics. Markers can appear mid-line
// (the CLI doesn't always newline between model text and "[eri] ... -> ...").
function cleanLine(s) {
  return s
    .replace(/\[eri\][^]*?->[^.\n]*\.?/g, "")  // "[eri] open Spotify -> DRY RUN: ..."
    .replace(/\[eri\][^.\n]*/g, "")            // any remaining "[eri] ..." marker
    .replace(/\bDRY RUN:[^.\n]*\.?/gi, "")     // simulation noise
    .replace(/\(dry-run[^)]*\)/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function onStreamLine(line) {
  const t = (line || "").trim();
  if (t.includes("<tool_call") || t.startsWith("<tool_response")) { inTool = true; return; }
  if (t === "</tool_call>" || t.startsWith("</tool_response>")) { inTool = false; return; }
  if (inTool) return;
  if (/^\[tool\]|^done\s*—|turn done/.test(t)) return;
  if (/tokens:\s*\d/.test(t)) return;
  if (/^\{.*\}$/.test(t)) return; // bare JSON tool args

  let out;
  if (t.startsWith("[eri]")) {
    // Control loop lines. Keep the user-facing RESULT; drop status/trace/dry-run.
    const rest = t.replace(/^\[eri\]\s*/, "");
    const isResult = /^(done|opening|opened|launch(ed)?|clos(e|ed|ing)|sent|typed|clicked|switch(ed)?|playing|paused|muted)/i.test(rest);
    if (!isResult || /dry[ -]?run/i.test(rest)) return;
    out = rest.replace(/^done\s*—\s*/i, "").replace(/\s*\([^)]*\)\s*$/, "").trim();
    if (out) out = out.charAt(0).toUpperCase() + out.slice(1);
  } else {
    out = cleanLine(t); // model text — strip any mid-line markers/dry-run
  }
  if (!out) return;
  answerEl.textContent += (answerEl.textContent ? " " : "") + out;
  const thread = document.getElementById("thread");
  thread.scrollTop = thread.scrollHeight;
  fit(); // grow the window to fit the streaming answer (rAF-debounced)
}

function ask() {
  const text = qEl.value.trim();
  if (!text) return;
  currentTurn += 1;
  gotStream = false;
  answerEl.textContent = "";
  const userEl = $("msgUser");
  userEl.textContent = text;
  userEl.hidden = false;
  resetStreamFilter();
  body.dataset.state = "answering";
  statusEl.textContent = "thinking…";
  fit();
  bridge("askEri", { intent: text, turn: currentTurn });
  qEl.value = "";
}

function newChat() {
  answerEl.textContent = "";
  const userEl = $("msgUser");
  userEl.textContent = "";
  userEl.hidden = true;
  body.dataset.state = "resting";
  statusEl.textContent = "";
  resetStreamFilter();
  fit();
  qEl.focus();
}

function quit() { bridge("quit"); }

/* ---------------- transparency + toggles ---------------- */
function applyTransparency(pct) {
  const p = Math.max(0, Math.min(85, Number(pct) || 0));
  const opacity = Math.max(0.12, (100 - p) / 100);
  document.documentElement.style.setProperty("--glass-opacity", opacity.toFixed(3));
  $("transparencyVal").textContent = p + "%";
  if (Number($("transparency").value) !== p) $("transparency").value = p;
}

function setToggle(el, on) { el.setAttribute("aria-checked", on ? "true" : "false"); }

function loadPrefs() {
  let pct = 38, inv = false, top = false;
  try {
    const s = localStorage.getItem("eri.transparency"); if (s != null) pct = parseInt(s, 10);
    inv = localStorage.getItem("eri.invisible") === "1";
    top = localStorage.getItem("eri.ontop") === "1";
  } catch (e) {}
  applyTransparency(pct);
  setToggle($("invisible"), inv);
  setToggle($("ontop"), top);
  if (inv) bridge("setContentProtection", { enabled: true });
  if (top) bridge("setAlwaysOnTop", { enabled: true });
}

/* ---------------- wire up ---------------- */
function init() {
  if (listen) {
    listen("eri-stream", (e) => {
      const p = e.payload || {};
      if (p.turn !== currentTurn) return; // ignore stale events from a previous turn
      if (!gotStream) { answerEl.textContent = ""; gotStream = true; statusEl.textContent = ""; }
      onStreamLine(p.line);
    });
    listen("eri-result", (e) => {
      const p = e.payload || {};
      if (p.turn !== currentTurn) return; // a late result from an old turn can't overwrite the new one
      statusEl.textContent = p.status === "error" ? "couldn't reach my brain — try again" : "";
      if (!gotStream) answerEl.textContent = "Hmm, nothing came back. Mind trying that again?";
      body.dataset.state = "answered";
      fit();
    });
  }

  $("send").addEventListener("click", ask);
  qEl.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(); } });
  $("newchat").addEventListener("click", newChat);
  $("close").addEventListener("click", quit);

  // Keyboard: ⌘Q/⌘W quit; Escape clears the answer, or quits if already resting.
  window.addEventListener("keydown", (e) => {
    if (e.metaKey && (e.key === "q" || e.key === "w")) { e.preventDefault(); quit(); return; }
    if (e.key === "Escape") {
      e.preventDefault();
      if (body.dataset.state !== "resting") newChat();
      else quit();
    }
  });

  $("gear").addEventListener("click", () => {
    settingsOpen = !settingsOpen;
    body.dataset.settings = settingsOpen ? "open" : "closed";
    $("gear").classList.toggle("is-on", settingsOpen);
    fit();
  });

  $("transparency").addEventListener("input", (e) => {
    applyTransparency(e.target.value);
    try { localStorage.setItem("eri.transparency", String(e.target.value)); } catch (err) {}
  });

  $("invisible").addEventListener("click", () => {
    const on = $("invisible").getAttribute("aria-checked") !== "true";
    setToggle($("invisible"), on);
    bridge("setContentProtection", { enabled: on });
    try { localStorage.setItem("eri.invisible", on ? "1" : "0"); } catch (e) {}
  });
  $("ontop").addEventListener("click", () => {
    const on = $("ontop").getAttribute("aria-checked") !== "true";
    setToggle($("ontop"), on);
    bridge("setAlwaysOnTop", { enabled: on });
    try { localStorage.setItem("eri.ontop", on ? "1" : "0"); } catch (e) {}
  });

  $("mic").addEventListener("click", () => { $("mic").classList.toggle("is-on"); bridge("startVoice"); });
  $("shot").addEventListener("click", () => bridge("screenshot"));

  loadPrefs();
  fit();
  qEl.focus();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();
