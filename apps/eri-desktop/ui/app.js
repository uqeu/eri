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

// eri's whimsical loading words (à la Claude's "flibbertigibbeting") — never "Thinking".
const ERI_WORDS = [
  "noodling", "pondering", "tinkering", "brewing", "mulling", "percolating",
  "scheming", "cooking", "rummaging", "conjuring", "puttering", "vibing",
  "wrangling", "spelunking", "untangling", "perusing", "finagling",
];
let _typeTimer = null;
function randWord() { return ERI_WORDS[Math.floor(Math.random() * ERI_WORDS.length)]; }
function showTyping() {
  const t = document.getElementById("typing");
  if (!t) return;
  document.getElementById("typingWord").textContent = randWord();
  t.hidden = false;
  clearInterval(_typeTimer);
  _typeTimer = setInterval(() => { document.getElementById("typingWord").textContent = randWord(); }, 2200);
  fit();
}
function hideTyping() {
  const t = document.getElementById("typing");
  if (t) t.hidden = true;
  clearInterval(_typeTimer);
  _typeTimer = null;
}

function bridge(command, payload = {}) {
  if (!invoke) return;
  invoke("bridge", { message: { command, ...payload } }).catch((e) => console.error("[eri]", command, e));
}

let _fitRaf = false;
function fit() {
  if (body.dataset.min === "1") return; // pill is fixed-size (park); never content-fit it
  if (_fitRaf) return;
  _fitRaf = true;
  requestAnimationFrame(() => {
    _fitRaf = false;
    if (body.dataset.min === "1") return;
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
    out = rest
      .replace(/^done\s*—\s*/i, "")
      .replace(/\s*\(no model tokens used\)/gi, "")
      .replace(/\s*\([^)]*\)\s*\.?\s*$/, "")
      .trim();
    if (out) out = out.charAt(0).toUpperCase() + out.slice(1).replace(/\.*$/, ".");
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
  statusEl.textContent = "";
  showTyping();
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
  hideTyping();
  resetStreamFilter();
  fit();
  qEl.focus();
}

function quit() { bridge("quit"); }

// Hide-to-pill (Wispr-style): close → shrink to a pill that stays running.
function minimize() {
  body.dataset.min = "1";
  body.dataset.settings = "closed";
  settingsOpen = false;
  bridge("park", { width: 150, height: 44 });
}
function restore() {
  if (body.dataset.min !== "1") return;
  body.dataset.min = "0";
  bridge("unpark");
  fit();
  setTimeout(() => { fit(); qEl.focus(); }, 40);
}

/* ---------------- transparency + toggles ---------------- */
function applyTransparency(pct) {
  const p = Math.max(0, Math.min(92, Number(pct) || 0));
  const opacity = Math.max(0.08, (100 - p) / 100);
  document.documentElement.style.setProperty("--glass-opacity", opacity.toFixed(3));
  $("transparencyVal").textContent = p + "%";
  if (Number($("transparency").value) !== p) $("transparency").value = p;
}

function setToggle(el, on) { el.setAttribute("aria-checked", on ? "true" : "false"); }

function loadPrefs() {
  let pct = 50, inv = false, top = false;
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

/* ---------------- appearance: theme / accent / font ---------------- */
const ACCENTS = [
  { id: "lime",   c: "#d9ff57", ink: "#14180a" },
  { id: "blue",   c: "#5b9dff", ink: "#04132e" },
  { id: "violet", c: "#b794ff", ink: "#160a2e" },
  { id: "pink",   c: "#ff8ad1", ink: "#2e0a1f" },
  { id: "amber",  c: "#ffb454", ink: "#2e1a04" },
  { id: "teal",   c: "#5fe3c0", ink: "#04261f" },
  { id: "snow",   c: "#eaeaea", ink: "#141414" },
];
const FONTS = [
  { id: "system", label: "System", stack: '-apple-system, BlinkMacSystemFont, "Inter", system-ui, sans-serif' },
  { id: "inter",  label: "Inter",  stack: 'Inter, system-ui, sans-serif' },
  { id: "funnel", label: "Funnel", stack: '"Funnel Display", system-ui, sans-serif' },
  { id: "serif",  label: "Serif",  stack: 'Fraunces, Georgia, serif' },
  { id: "mono",   label: "Mono",   stack: '"SF Mono", "JetBrains Mono", Menlo, monospace' },
];

function applyAccent(id) {
  const a = ACCENTS.find((x) => x.id === id) || ACCENTS[0];
  document.documentElement.style.setProperty("--accent", a.c);
  document.documentElement.style.setProperty("--accent-ink", a.ink);
  document.querySelectorAll("#accentSwatches .swatch").forEach((s) => s.classList.toggle("is-on", s.dataset.id === a.id));
}
function applyFont(id) {
  const f = FONTS.find((x) => x.id === id) || FONTS[0];
  document.documentElement.style.setProperty("--ui-font", f.stack);
  document.querySelectorAll("#fontChips .font-chip").forEach((c) => c.classList.toggle("is-on", c.dataset.id === f.id));
}
function applyTheme(t) {
  body.dataset.theme = t === "light" ? "light" : "dark";
  document.querySelectorAll("#themeSeg .seg-btn").forEach((b) => b.classList.toggle("is-on", b.dataset.theme === body.dataset.theme));
}

function initAppearance() {
  const sw = $("accentSwatches"), fc = $("fontChips"), seg = $("themeSeg");
  if (sw) sw.innerHTML = ACCENTS.map((a) => `<button class="swatch" type="button" data-id="${a.id}" title="${a.id}" style="background:${a.c}"></button>`).join("");
  if (fc) fc.innerHTML = FONTS.map((f) => `<button class="font-chip" type="button" data-id="${f.id}" style="font-family:${f.stack}">${f.label}</button>`).join("");

  let theme = "dark", accent = "lime", font = "system";
  try {
    theme = localStorage.getItem("eri.theme") || theme;
    accent = localStorage.getItem("eri.accent") || accent;
    font = localStorage.getItem("eri.font") || font;
  } catch (e) {}
  applyTheme(theme); applyAccent(accent); applyFont(font);

  if (sw) sw.addEventListener("click", (e) => { const b = e.target.closest(".swatch"); if (!b) return; applyAccent(b.dataset.id); try { localStorage.setItem("eri.accent", b.dataset.id); } catch (err) {} });
  if (fc) fc.addEventListener("click", (e) => { const b = e.target.closest(".font-chip"); if (!b) return; applyFont(b.dataset.id); try { localStorage.setItem("eri.font", b.dataset.id); } catch (err) {} fit(); });
  if (seg) seg.addEventListener("click", (e) => { const b = e.target.closest(".seg-btn"); if (!b) return; applyTheme(b.dataset.theme); try { localStorage.setItem("eri.theme", b.dataset.theme); } catch (err) {} });
}

/* ---------------- wire up ---------------- */
function init() {
  if (listen) {
    listen("eri-stream", (e) => {
      const p = e.payload || {};
      if (p.turn !== currentTurn) return; // ignore stale events from a previous turn
      if (!gotStream) { answerEl.textContent = ""; gotStream = true; statusEl.textContent = ""; hideTyping(); }
      onStreamLine(p.line);
    });
    listen("eri-result", (e) => {
      const p = e.payload || {};
      if (p.turn !== currentTurn) return; // a late result from an old turn can't overwrite the new one
      hideTyping();
      statusEl.textContent = p.status === "error" ? "couldn't reach my brain — try again" : "";
      if (!gotStream) answerEl.textContent = "Hmm, nothing came back. Mind trying that again?";
      body.dataset.state = "answered";
      fit();
    });
  }

  $("send").addEventListener("click", ask);
  qEl.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(); } });
  $("newchat").addEventListener("click", newChat);
  $("close").addEventListener("click", minimize);

  // Keyboard: ⌘Q/⌘W force-quit; Escape hides (or restores / clears first).
  window.addEventListener("keydown", (e) => {
    if (e.metaKey && (e.key === "q" || e.key === "w")) { e.preventDefault(); quit(); return; }
    if (e.key === "Escape") {
      e.preventDefault();
      if (body.dataset.min === "1") restore();
      else if (body.dataset.state !== "resting") newChat();
      else minimize();
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

  // Move the frameless window: explicit native drag on mousedown anywhere on the
  // bar except the input/buttons (data-tauri-drag-region proved unreliable).
  const bar = document.querySelector(".bar");
  if (bar) {
    bar.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      if (body.dataset.min === "1") return; // pill: click restores, don't drag
      if (e.target.closest("button, input, .ico, .send")) return;
      bridge("startDrag"); // Rust-side native drag (no JS ACL needed)
    });
    bar.addEventListener("click", () => { if (body.dataset.min === "1") restore(); });
  }

  initAppearance();
  loadPrefs();
  fit();
  qEl.focus();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();
