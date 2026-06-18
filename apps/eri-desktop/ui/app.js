// Eri companion — clean front-end logic on the Tauri shell.
// Talks to the Rust host via the single `bridge` command + `eri-stream` /
// `eri-result` events. Two-state window sizing (Pluely's robust approach: never
// content-measure into a collapse) — resting bar vs expanded answer.

const T = window.__TAURI__;
const invoke = T?.core?.invoke;
const listen = T?.event?.listen;

const $ = (id) => document.getElementById(id);
const body = document.body;
let currentAnswerEl = null; // the answer element for the active turn (created per ask)
const statusEl = $("status");
const qEl = $("q");

const WIDTH = 600;
const H_BAR = 64;
const H_PANEL = 460;
const H_SETTINGS = 210;

let settingsOpen = false;
let currentTurn = 0;   // every ask() bumps this; stale events from old turns are ignored
let gotStream = false; // did THIS turn stream any real text?
let answerRaw = "";    // raw markdown text accumulated for the current answer
let resultMode = false; // a control run has emitted [eri-result]; following lines are the final reply

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
// Show eri's live action as the typing word — a single, replacing status chip
// (e.g. "Opening Safari"), overriding the cute-word cycling during a control run.
function setStatusChip(text) {
  const t = document.getElementById("typing");
  if (!t) return;
  clearInterval(_typeTimer); _typeTimer = null; // stop cute-word cycling; show the real action
  const w = document.getElementById("typingWord");
  if (w) w.textContent = text;
  t.hidden = false;
  fit();
}
// Turn a raw control action ("open Safari", "type \"hi\"") into a friendly,
// present-tense chip label.
function prettyStatus(s) {
  s = String(s).replace(/\s+/g, " ").trim();
  if (/^look/i.test(s)) return "Looking at the screen";
  const map = { open: "Opening", type: "Typing", click: "Clicking", scroll: "Scrolling",
    quit: "Quitting", press: "Pressing", drag: "Dragging", switch: "Switching", wait: "Working" };
  const m = s.match(/^(\w+)\b(.*)$/);
  if (m && map[m[1].toLowerCase()]) return (map[m[1].toLowerCase()] + m[2]).trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
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

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
// Minimal, SAFE markdown → HTML (escape first, then bold/italic/code/links inline;
// headings, bullet + numbered lists, and paragraphs block-level). So eri's replies
// render pretty instead of showing raw ** and 1. markers.
function inlineMd(s) {
  return esc(s)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1");
}
function renderMarkdown(src) {
  const lines = src.split("\n");
  let html = "", list = null;
  const closeList = () => { if (list) { html += `</${list}>`; list = null; } };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    const t = line.trim();
    if (!t) { closeList(); continue; }
    let m;
    if ((m = t.match(/^#{1,4}\s+(.*)/))) { closeList(); html += `<h4>${inlineMd(m[1])}</h4>`; continue; }
    if ((m = t.match(/^(?:[-*•]|\d+[.)])\s+(.*)/))) {
      const kind = /^\d/.test(t) ? "ol" : "ul";
      if (list && list !== kind) closeList();
      if (!list) { html += `<${kind}>`; list = kind; }
      html += `<li>${inlineMd(m[1])}</li>`;
      continue;
    }
    closeList();
    html += `<p>${inlineMd(t)}</p>`;
  }
  closeList();
  return html;
}

function onStreamLine(line) {
  const t = (line || "").trim();
  if (t.includes("<tool_call") || t.startsWith("<tool_response")) { inTool = true; return; }
  if (t === "</tool_call>" || t.startsWith("</tool_response>")) { inTool = false; return; }
  if (inTool) return;

  // Control: a live status chip (single, replacing) for the action eri is doing.
  if (t.startsWith("[eri-status]")) {
    const s = t.replace(/^\[eri-status\]\s*/, "").trim();
    if (s && !resultMode) setStatusChip(prettyStatus(s));
    return;
  }
  // Control: the final-answer marker — everything after it is eri's reply, not
  // the step-by-step it took to get there.
  if (t.startsWith("[eri-result]")) {
    resultMode = true; gotStream = true;
    hideTyping(); statusEl.textContent = "";
    answerRaw = t.replace(/^\[eri-result\]\s*/, "").trim();
    if (currentAnswerEl) currentAnswerEl.innerHTML = renderMarkdown(answerRaw);
    return;
  }
  // Plumbing the user never sees.
  if (t.startsWith("[eri:speak]")) return;          // TTS-only line
  if (t.startsWith("[eri]")) return;                // generic control trace (gated lines)
  if (/^\[tool\]|^done\s*—|turn done/.test(t)) return;
  if (/tokens:\s*\d/.test(t)) return;
  if (/^\{.*\}$/.test(t)) return;                   // bare JSON tool args

  // Model text: ask/research/vision stream it directly; control only after the
  // result marker. Strip stray markers, then accumulate + render.
  const out = cleanLine(t);
  if (!out) return;
  if (!gotStream) { gotStream = true; statusEl.textContent = ""; hideTyping(); }
  answerRaw += (answerRaw ? "\n" : "") + out;
  if (currentAnswerEl) currentAnswerEl.innerHTML = renderMarkdown(answerRaw);
  const thread = document.getElementById("thread");
  thread.scrollTop = thread.scrollHeight;
  fit(); // grow the window to fit the streaming answer (rAF-debounced)
}

function ask() {
  const text = qEl.value.trim();
  if (!text) return;
  currentTurn += 1;
  gotStream = false;
  answerRaw = "";
  resultMode = false;
  // Append a new turn (your bubble + a fresh answer) to the scrollable log.
  const thread = $("thread"), typing = $("typing");
  const u = document.createElement("div"); u.className = "msg-user"; u.textContent = text;
  const a = document.createElement("div"); a.className = "answer";
  thread.insertBefore(u, typing);
  thread.insertBefore(a, typing);
  currentAnswerEl = a;
  resetStreamFilter();
  body.dataset.state = "answering";
  statusEl.textContent = "";
  showTyping();
  fit();
  setTimeout(fit, 70); // re-fit once the new turn lays out (kills the void)
  bridge("askEri", { intent: text, turn: currentTurn });
  qEl.value = "";
}

function newChat() {
  answerRaw = "";
  resultMode = false;
  currentAnswerEl = null;
  const thread = $("thread");
  thread.querySelectorAll(".msg-user, .answer").forEach((el) => el.remove());
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
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  // 100% → opacity 0 = the card BACKGROUND fully vanishes; only text, the accent
  // button, and the native blur remain. No floor.
  const opacity = (100 - p) / 100;
  document.documentElement.style.setProperty("--glass-opacity", opacity.toFixed(3));
  $("transparencyVal").textContent = p + "%";
  if (Number($("transparency").value) !== p) $("transparency").value = p;
}

function applyBlur(px) {
  const v = Math.max(0, Math.min(40, Number(px) || 0));
  document.documentElement.style.setProperty("--blur", v + "px");
  const el = $("blurVal"); if (el) el.textContent = v + "px";
  const range = $("blur"); if (range && Number(range.value) !== v) range.value = v;
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
  bridge("setVibrancy", { light: body.dataset.theme === "light" }); // swap native glass material
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
      // NOTE: don't clear/hide here — onStreamLine decides when real answer text
      // (vs a [eri-status] chip) arrives, so the status chip persists during a
      // control run instead of being hidden on the first status line.
      onStreamLine(p.line);
    });
    listen("eri-result", (e) => {
      const p = e.payload || {};
      if (p.turn !== currentTurn) return; // a late result from an old turn can't overwrite the new one
      hideTyping();
      statusEl.textContent = p.status === "error" ? "couldn't reach my brain — try again" : "";
      if (!gotStream && currentAnswerEl) currentAnswerEl.textContent = "Hmm, nothing came back. Mind trying that again?";
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
