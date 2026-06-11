const boot = window.ERI_BOOTSTRAP || {};

// Commands handled entirely in the web layer (no host round-trip needed).
const LOCAL_ONLY = new Set([
  "setMode", "goHome", "openArtifact", "useSuggestion", "closeSources", "toggleTheme",
  "calibrateGaze", "authAction", "closeAuth", "openAuthUrl", "onboardSignIn", "onboardSkip",
]);

const state = {
  view: "launcher",
  theme: "dark",
  mode: "Plan",
  canvas: "preview",
  intent: (boot.intent || "").trim(),
  workspace: boot.workspace || "local",
  runState: "idle",
  account: null,
  voice: false,
  gaze: false,
  morph: "home",
  restMode: "home",
  thread: [],
  artifacts: [],
  files: [],
  activeFile: null,
  fileContent: "Open a file from the tree to view it.",
  sources: null,
};

const $ = (id) => document.getElementById(id);

/* ---------------- helpers ---------------- */
function esc(v) {
  return String(v)
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}
function now() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function isCli(text) {
  const t = text.trimStart();
  return t.startsWith("/") || t.startsWith("eri ") || t.startsWith("$ ");
}
function cliBody(text) {
  return text.trim().replace(/^\$\s+/, "").replace(/^\//, "").trim();
}
function autosize(el) {
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 200) + "px";
}

/* ---------------- bridge ---------------- */
function native(command, payload = {}) {
  const message = { command, ...payload, mode: state.mode, intent: state.intent };
  if (window.webkit?.messageHandlers?.eri) {
    window.webkit.messageHandlers.eri.postMessage(message);
  } else {
    window.eriBridgeResult({ command, status: "local", detail: `${command} (browser mode)` });
  }
}

// Debug logging to /tmp/eri_app.log (via the Swift bridge) so the app can be
// debugged without a visible webview console.
function jlog(msg) { try { native("log", { msg: String(msg) }); } catch (e) { /* noop */ } }
window.addEventListener("error", (e) => jlog("JSERR " + (e.message || e) + " @" + (e.lineno || "?")));
window.addEventListener("unhandledrejection", (e) => jlog("JSREJECT " + (e.reason && e.reason.message ? e.reason.message : e.reason)));

/* ---------------- dynamic morph ---------------- */
// The window physically reshapes to match the work: build expands toward a full
// editor + preview; voice/control go compact; eyes shrinks to a glance pill.
// The native host does the resize (see resizeWindow in eri_agent_manager.swift);
// CSS keyed on [data-mode] reshapes the in-window layout to match. This is
// presentation only — resizing never implies an action ran.
// One declarative table for what the pad can do — the capability seam. Each
// capability owns its morph size and whether it's transient (overlays the
// resting layout and restores it when it ends). MORPH and TRANSIENT are DERIVED
// from this, so a capability's mode name, layout, and lifecycle are decided in
// one place. Adding or wiring a capability (e.g. research) is one entry here,
// not edits scattered across the file.
const CAPABILITIES = {
  home:     { width: 1200, height: 820, transient: false },
  build:    { width: 1480, height: 980, transient: false },
  voice:    { width: 720,  height: 520, transient: true },
  control:  { width: 880,  height: 560, transient: true },
  eyes:     { width: 460,  height: 280, transient: true },
  memory:   { width: 720,  height: 560, transient: true },
  research: { width: 860,  height: 620, transient: true },
};
const MORPH = Object.fromEntries(
  Object.entries(CAPABILITIES).map(([id, c]) => [id, { width: c.width, height: c.height }]),
);
const TRANSIENT = new Set(
  Object.entries(CAPABILITIES).filter(([, c]) => c.transient).map(([id]) => id),
);

function setMorph(mode) {
  if (!MORPH[mode]) mode = "home";
  if (!TRANSIENT.has(mode)) state.restMode = mode;
  if (state.morph === mode) return;
  state.morph = mode;
  document.body.dataset.mode = mode;
  native("resizeWindow", MORPH[mode]);
}
function restMorph() { setMorph(state.restMode || "home"); }

/* ---------------- thread ---------------- */
function addMessage(role, text) {
  state.thread.push({ type: "msg", role, text });
}
function addEvent(kind, text, toks, err = false) {
  state.thread.push({ type: "event", kind, text, toks, err });
}
function addOutput(command, text) {
  state.thread.push({ type: "output", command, text });
}

/* ---------------- render ---------------- */
function render() {
  document.body.dataset.view = state.view; // CSS drives launcher/workspace visibility
  document.body.dataset.theme = state.theme;
  document.body.dataset.mode = state.morph; // CSS drives per-mode morph layout
  $("workspaceLabel").textContent = state.workspace;

  // voice mic state (both composers) + account
  document.querySelectorAll(".mic").forEach((b) => b.classList.toggle("is-on", state.voice));
  $("accountBtn").textContent = state.account || "Sign in";
  $("accountBtn").classList.toggle("is-on", !!state.account);

  // mode segments (both composers)
  document.querySelectorAll('[data-command="setMode"]').forEach((b) => {
    b.classList.toggle("is-on", b.dataset.mode === state.mode);
  });
  // canvas tabs + panes
  document.querySelectorAll('[data-command="setCanvas"]').forEach((b) => {
    b.classList.toggle("is-on", b.dataset.canvas === state.canvas);
  });
  document.querySelectorAll(".canvas-pane").forEach((p) => {
    p.hidden = p.dataset.pane !== state.canvas;
  });

  // chat header
  $("chatTitle").textContent = state.intent.trim() || "New conversation";
  const pill = $("runPill");
  pill.dataset.state = state.runState;
  pill.textContent = state.runState;

  // thread
  $("thread").innerHTML = state.thread.map((row) => {
    if (row.type === "msg") {
      const who = row.role === "eri" ? "Eri" : "You";
      return `<div class="msg ${row.role}">
        <div class="msg-role"><span class="who">${who}</span></div>
        <div class="msg-body">${esc(row.text)}</div>
      </div>`;
    }
    if (row.type === "output") {
      return `<div class="output-block"><div class="output-head">${esc(row.command)}</div><pre class="output">${esc(row.text)}</pre></div>`;
    }
    return `<div class="event ${row.err ? "err" : ""}">
      <span class="kind">${esc(row.kind)}</span>
      <span class="txt">${esc(row.text)}</span>
      <span class="toks">${row.toks ? esc(row.toks) : ""}</span>
    </div>`;
  }).join("");
  $("thread").scrollTop = $("thread").scrollHeight;

  // artifacts (hide the section entirely when empty)
  $("artifactsWrap").hidden = !state.artifacts.length;
  $("artifactsCount").textContent = state.artifacts.length ? `(${state.artifacts.length})` : "";
  $("artifacts").innerHTML = state.artifacts.map((a) => `
    <button class="artifact" type="button" data-command="openArtifact" data-name="${esc(a.name)}">
      <span class="a-tile">${esc((a.kind || a.name || "?").slice(0, 1).toUpperCase())}</span>
      <span class="a-main">
        <span class="a-name">${esc(a.name)}</span>
        <span class="a-detail">${esc(a.detail)}</span>
      </span>
      <span class="a-dot ${esc(a.state)}" title="${esc(a.state)}"></span>
    </button>`).join("");

  // code tree + file (real workspace files via the host bridge)
  if (!state.files.length) {
    $("fileTree").innerHTML = `<div class="file-node dir" style="cursor:default">Loading…</div>`;
  } else {
    $("fileTree").innerHTML = state.files.map((f) => {
      const label = esc(f.name || f.path);
      if (f.dir) return `<button class="file-node dir" type="button" data-command="openDir" data-path="${esc(f.path)}"><span class="fi">▸</span>${label}</button>`;
      const on = f.path === state.activeFile ? "is-on" : "";
      return `<button class="file-node ${on}" type="button" data-command="selectFile" data-path="${esc(f.path)}"><span class="fi">·</span>${label}</button>`;
    }).join("");
  }
  $("fileViewName").textContent = state.activeFile || "No file selected";
  $("fileBody").innerHTML = `<code>${esc(state.fileContent)}</code>`;
}

/* ---------------- actions ---------------- */
// Decide what the user actually wants, so eri talks when you talk,
// edits fast (Mercury) for small changes, and builds (frontier) for big asks.
function classifyIntent(text) {
  if (isCli(text)) return "cli";
  const t = text.trim().toLowerCase();
  const wc = t.split(/\s+/).length;
  // Build: imperative create-an-app verbs, or app/page/feature nouns.
  if (/^(build|make|create|generate|scaffold|design|prototype|implement|add)\b/.test(t)
      || /\b(app|landing\s?page|website|web app|dashboard|component|page|screen|feature|onboarding|pricing|signup|portfolio)\b/.test(t)) {
    return "build";
  }
  // Edit: change verbs → fast Mercury inline edit.
  if (/^(change|edit|update|fix|tweak|adjust|move|rename|delete|remove|replace|refactor|swap|set|make (it|the|this)|turn (it|the|this))\b/.test(t)) {
    return "edit";
  }
  // Short non-imperative or question → just talk.
  if (wc <= 6 || /\?$/.test(t) || /^(hi|hey|hello|yo|sup|thanks|thank you|ok|cool|what|why|how|who|when|where|can you|could you|explain|tell me|do you)\b/.test(t)) {
    return "talk";
  }
  return "build";
}

// eri's name, however speech mis-hears it.
function fixName(text) {
  return text.replace(/\b(eric|erie|erika|airy|errie|eerie|ehri|aria|harry|hairy|larry|eddie|ari|erry|杭)\b/gi, "eri");
}

// Strip polite/filler lead-ins so the build title reads clean.
function buildTitle(text) {
  const t = text.trim().replace(
    /^(please\s+)?(can you|could you|would you|will you)?\s*(please\s+)?(tell me|make me|make|build me|build|create|generate|design|whip up|give me|i want|i need|lets|let's|do)\s+(a|an|the|me)?\s*/i,
    "",
  ).trim();
  return t || text.trim();
}

// eri's personality — warm, a little playful, present. Answers like someone you
// know, not a command parser. Only the everyday stuff is local; real questions
// go to the model. Variety so it never feels canned.
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function localReply(text) {
  const t = fixName(text).trim().toLowerCase().replace(/[^\w?]/g, " ").replace(/\s+/g, " ").trim();
  const wc = t.split(" ").length;

  // how are you — actually answer, then turn it back. No build pivot.
  if (/how (are|r) (you|u|ya)|how(s| is) it going|how have you been|hows your day|you good|you ok/.test(t)) {
    return pick([
      "Honestly? Great — the blank canvas is my favorite part. How are you doing?",
      "Good! Sharp and ready. How's your day going?",
      "Doing well — running on caffeine and electrons. You?",
      "Can't complain. Glad you're here. What's going on with you?",
    ]);
  }
  // greeting / name-call
  if (wc <= 4 && /^(hi|hey|hello|yo|sup|hiya|howdy|eri|hey eri|hi eri)\b/.test(t)) {
    return pick([
      "Hey! Good to see you. What's on your mind?",
      "Yo. I'm here — want to make something, or just thinking out loud?",
      "Hey hey. eri's around. What are we getting into?",
      "Hi! I'm all ears.",
    ]);
  }
  // who/what are you
  if (/(your|the) name|who are you|what are you|what do they call you|introduce yourself/.test(t)) {
    return pick([
      "I'm eri — part build agent, part someone you can actually talk to. I turn what you say into real apps, and I'm happy to just chat too.",
      "eri. I build and edit apps live from your voice, but I'm also just here if you want to think something through.",
    ]);
  }
  // capabilities
  if (/what can you do|what do you do|^help$|how does this work|what can i say|how do i use/.test(t)) {
    return "Two things: I talk with you, and I build. Say “build a pricing page” and watch it appear — then “make it warmer” and I'll tweak it. Or just tell me what you're chewing on.";
  }
  // affirmations / thanks
  if (/\b(thanks|thank you|ty|cheers|appreciate)\b/.test(t)) {
    return pick(["Anytime — I mean it.", "Of course. That's what I'm here for.", "You got it."]);
  }
  if (wc <= 3 && /\b(nice|cool|awesome|great|perfect|love it|sweet|dope|sick)\b/.test(t)) {
    return pick(["Right? Let's keep going.", "Glad you like it.", "We're cooking."]);
  }
  if (/\b(bye|goodbye|see ya|later|good ?night|gn)\b/.test(t)) {
    return pick(["See you — just say my name when you're back.", "Later. I'll be here.", "Night. Go rest."]);
  }
  // affirmative/short → keep it human, don't force a build
  if (wc <= 2 && /^(yes|yeah|yep|ok|okay|sure|maybe|no|nope|hmm|idk)\b/.test(t)) {
    return pick(["I'm with you.", "Take your time — no rush.", "Whenever you're ready."]);
  }
  return null; // hand off to the model for real, open-ended conversation
}

function startSignIn() {
  $("authTitle").textContent = "Sign in to eri";
  $("authSub").textContent = "Opening your browser. Approve there, or use the code below.";
  $("authCodeWrap").hidden = true;
  $("authLink").hidden = true;
  $("authStatusText").textContent = "Starting…";
  $("authStatusLine").classList.remove("done", "err");
  $("authSheet").showModal();
  native("authLogin");
}

function submitInput(text) {
  const trimmed = text.trim();
  if (!trimmed) return;
  if (state.view === "launcher") state.view = "workspace";
  addMessage("user", trimmed);
  const kind = classifyIntent(trimmed);
  jlog("submit kind=" + kind + " text=" + trimmed.slice(0, 50));

  if (kind === "cli") {
    addEvent("cli", `eri ${cliBody(trimmed)}`, "");
    native("runCli", { cmd: cliBody(trimmed) });
    state.runState = "working";
  } else if (kind === "talk") {
    // eri answers basic conversation locally (knows its own name); else asks the model.
    const reply = localReply(trimmed);
    if (reply) {
      addMessage("eri", reply);
      state.runState = "idle";
    } else {
      state._askIdx = state.thread.push({ type: "msg", role: "eri", text: "…" }) - 1;
      native("askEri", { intent: trimmed });
      state.runState = "thinking";
    }
  } else if (kind === "edit" || kind === "build") {
    // Building/editing needs the model → needs sign-in. Handle that gracefully (no error spam).
    if (!state.account) {
      addMessage("eri", pick([
        "I'd love to build that — I just need you to sign in first so I can fire up the model. It's quick.",
        "On it, the second you're signed in. Sign in and I'll start right away.",
      ]));
      state.runState = "idle";
      render();
      startSignIn();
      return;
    }
    // Build is the expansive mode: grow toward a full editor + preview.
    setMorph("build");
    state.canvas = "preview";
    if (kind === "edit") {
      state.intent = state.intent || "Current build";
      addMessage("eri", pick(["On it.", "Got it — changing that now.", "Say less."]));
      native("runEri", { intent: trimmed, mode: "Fast" });
      if (!state.artifacts.length) state.artifacts = [{ kind: "Diff", name: "Code diff", detail: "Proposed edit", state: "active" }];
    } else {
      const title = buildTitle(trimmed);
      state.intent = title.slice(0, 70);
      addMessage("eri", pick([`Love it — building ${title} now.`, `On it. ${title.charAt(0).toUpperCase() + title.slice(1)} coming up.`, "Say less. Building it."]));
      native("spawnAgent", { intent: trimmed, mode: "Plan" });
      state.artifacts = [
        { kind: "Plan", name: "Implementation plan", detail: "Architecture and approach", state: "draft" },
        { kind: "Tasks", name: "Task list", detail: "Build steps", state: "open" },
      ];
    }
    state.runState = "working";
  }
  render();
}

const CHAT_CMDS = new Set(["openGit", "listAgents", "listMemory", "runDoctor", "runReview", "ship"]);

function runCommand(command, data = {}) {
  if (CHAT_CMDS.has(command)) { state.view = "workspace"; state.runState = "working"; }
  switch (command) {
    case "goHome":
      state.view = "launcher";
      state.runState = "idle";
      setMorph("home");
      break;
    case "setMode":
      state.mode = data.mode || state.mode;
      break;
    case "setCanvas":
      state.canvas = data.canvas || state.canvas;
      if (state.canvas === "code" && !state.files.length) native("listFiles");
      break;
    case "openEditor":
      state.view = "workspace";
      state.canvas = "code";
      native("listFiles");
      render();
      return;
    case "selectFile":
      state.activeFile = data.path;
      state.fileContent = "Loading…";
      native("readFile", { path: data.path });
      render();
      return;
    case "openDir":
      native("listFiles", { path: data.path });
      return;
    case "useSuggestion":
      $("launcherInput").value = data.text || "";
      autosize($("launcherInput"));
      reflectCli($("launcherForm"), $("launcherInput"));
      $("launcherInput").focus();
      return; // no native, no full render needed beyond focus
    case "toggleVoice":
      state.voice = !state.voice;
      native(state.voice ? "startVoice" : "stopVoice");
      if (state.voice) setMorph("voice");
      else restMorph();
      break;
    case "calibrateGaze":
      state.gaze = !state.gaze;
      if (state.gaze) { native("startGaze"); setMorph("eyes"); }
      else restMorph();
      break;
    case "authAction":
      if (state.account) { native("authStatus"); break; }
      startSignIn();
      break;
    case "closeAuth":
      $("authSheet").close();
      break;
    case "onboardSignIn":
      try { localStorage.setItem("eri.onboarded", "1"); } catch (e) {}
      $("onboardSheet").close();
      startSignIn();
      break;
    case "onboardSkip":
      try { localStorage.setItem("eri.onboarded", "1"); } catch (e) {}
      $("onboardSheet").close();
      setTimeout(() => $("launcherInput") && $("launcherInput").focus(), 30);
      break;
    case "openAuthUrl":
      if (state.authUrl) native("openUrl", { url: state.authUrl });
      break;
    case "toggleTheme":
      state.theme = state.theme === "dark" ? "light" : "dark";
      break;
    case "openSources":
      native("openSources");
      $("sourcesSheet").showModal();
      break;
    case "closeSources":
      $("sourcesSheet").close();
      break;
    case "openPreview":
      state.canvas = "preview";
      $("previewUrl").textContent = "localhost:5173";
      break;
    case "runReview":
      state.runState = "working";
      addEvent("review", "Verifying the build…", "");
      break;
    case "controlGoal": {
      // Hands-free computer control toward the composer's current text.
      const input = state.view === "workspace" ? $("chatInput") : $("launcherInput");
      const goal = (input && input.value.trim()) || "";
      if (!goal) return;
      state.view = "workspace";
      state.runState = "working";
      setMorph("control");
      addEvent("control", `eri is taking control: ${goal}`, "");
      native("startControl", { goal });
      if (input) { input.value = ""; autosize(input); }
      render();
      return; // already dispatched; don't fall through to native("controlGoal")
    }
    case "research": {
      // Web research toward the composer's current text — Claude's web search
      // via `eri research`. Streams into an eri bubble like askEri.
      const input = state.view === "workspace" ? $("chatInput") : $("launcherInput");
      const query = (input && input.value.trim()) || "";
      if (!query) return;
      state.view = "workspace";
      setMorph("research");
      addMessage("you", query);
      state._researchIdx = state.thread.push({ type: "msg", role: "eri", text: "Searching the web…" }) - 1;
      state.runState = "thinking";
      native("research", { query });
      if (input) { input.value = ""; autosize(input); }
      render();
      return; // already dispatched
    }
    case "panicStop":
      addEvent("control", "Stopping all actuation (⌘⌥⎋).", "");
      restMorph();
      break; // falls through to native("panicStop")
    default:
      break;
  }
  if (!LOCAL_ONLY.has(command)) native(command, data);
  render();
}

/* ---------------- host callbacks ---------------- */
window.eriBridgeResult = (result = {}) => {
  const command = result.command || "bridge";
  const detail = result.detail || result.status || "done";
  const failed = result.status === "failed";

  // Only surface meaningful one-off results; build/edit progress streams separately.
  if (["openEditor", "openPreview", "openTerminal", "openGit", "runCli"].includes(command)) {
    if (detail && detail !== "local" && detail !== "running") addEvent(command, detail, "", failed);
  }
  if (command === "runReview") {
    state.runState = failed ? "blocked" : "reviewed";
    addEvent("review", detail, "", failed);
  }
  if (command === "ship") state.runState = failed ? "blocked" : "shipped";
  if (command === "askEri") {
    // Finish the conversational bubble; if nothing streamed, stay in character.
    if (state._askIdx != null && state.thread[state._askIdx]) {
      const m = state.thread[state._askIdx];
      if (m.text === "…" || !m.text.trim()) {
        // Don't blame sign-in when the user IS signed in — that's the bug that
        // made eri look broken. Be honest about what actually happened.
        m.text = state.account
          ? "Hmm — my brain didn't send anything back just then. Mind trying that again?"
          : "I can go deeper once you sign in — that's where my full brain lives. For now, tell me what to build.";
      }
    }
    state._askIdx = null;
    state.runState = "idle";
  }
  if (command === "research") {
    if (state._researchIdx != null && state.thread[state._researchIdx]) {
      const m = state.thread[state._researchIdx];
      if (m.text === "Searching the web…" || !m.text.trim()) {
        m.text = state.account
          ? "I couldn't pull anything back just then — try again, or set ANTHROPIC_API_KEY for web research."
          : "Web research needs a key for now — set ANTHROPIC_API_KEY, then ask me again.";
      }
    }
    state._researchIdx = null;
    state.runState = "idle";
    restMorph();
  }
  if (command === "runEri" || command === "spawnAgent") {
    if (failed) {
      addMessage("eri", "Hmm, that didn't go through. If you're not signed in yet, that's usually it — say the word and I'll open sign-in.");
      state.runState = "idle";
    } else if (result.status === "done") {
      state.runState = "ready";
    }
  }
  if (command === "authLogin" && result.status === "done") native("authStatus");
  if (command === "createCheckpoint") {
    state.artifacts.push({ name: "Checkpoint", detail, state: result.status || "saved" });
  }
  render();
};

// Phase 3: streamed agent events from `eri ship --output artifact-json`.
window.eriStreamEvent = (command, rawLine) => {
  let evt = {};
  try { evt = JSON.parse(rawLine); } catch { evt = { text: String(rawLine) }; }
  const kind = evt.kind || command || "event";
  const text = evt.text || evt.message || "";

  // Conversational `ask` → stream into a single eri chat bubble, not event rows.
  if (command === "askEri") {
    // The CLI prints meta lines ([tool] …, [eri] …, "done — tokens: …") around
    // the real answer. Keep those out of the chat bubble.
    const noise = /^\[tool\]|^\[eri\]|^done\s*—|tokens:\s*\d/i.test(text.trim());
    if (text && !noise && state._askIdx != null && state.thread[state._askIdx]) {
      const m = state.thread[state._askIdx];
      m.text = (m.text === "…" ? "" : m.text) + text + " ";
    }
    state.runState = "thinking";
    render();
    return;
  }

  // Research → stream the cited answer into the research bubble.
  if (command === "research") {
    const noise = /^eri is searching/i.test(text.trim());
    if (text && !noise && state._researchIdx != null && state.thread[state._researchIdx]) {
      const m = state.thread[state._researchIdx];
      m.text = (m.text === "Searching the web…" ? "" : m.text) + text + "\n";
    }
    state.runState = "thinking";
    render();
    return;
  }

  const toks = evt.tokensOut ? `${evt.tokensOut} tok` : "";
  if (text) addEvent(kind, text, toks, kind === "error");
  if (state.runState === "idle") state.runState = "working";
  render();
};

// Phase 3: indexed-sources summary from graphify-out/graph.json.
window.eriSources = (summary = {}) => {
  state.sources = summary;
  const total = summary.nodes || 0;
  const sc = $("sourcesCount"); if (sc) sc.textContent = total ? ` ${total}` : "";
  const top = (summary.topFiles || []).map((f) =>
    `<div class="source-row"><div><div class="s-name">${esc(f.file)}</div></div><div class="s-stat">${esc(f.symbols)} sym</div></div>`
  ).join("");
  $("sourcesBody").innerHTML = `
    <div class="source-row"><div><div class="s-name">Codebase index</div><div class="s-detail">${esc(summary.communities || 0)} communities · ${esc(summary.links || 0)} edges</div></div><div class="s-stat">${esc(total)} symbols</div></div>
    ${top}`;
};

// Real workspace files (from the host file browser).
window.eriFiles = (list = []) => {
  state.files = Array.isArray(list) ? list : [];
  render();
};

// Real file contents.
window.eriFile = (path, content) => {
  state.activeFile = path;
  state.fileContent = content || "";
  render();
};

// Auth status from `eri auth status`.
window.eriAuth = (text = "") => {
  const m = /Signed in as\s+(.+?)(\s+\(|$)/.exec(text);
  state.account = m ? m[1].trim() : null;
  render();
};

// Live device-code stream from `eri auth login` → the sign-in dialog.
window.eriAuthStream = (line = "") => {
  const url = (line.match(/https?:\/\/\S+/) || [])[0];
  const code = (line.match(/code:\s*([A-Za-z0-9-]{4,})/i) || [])[1];
  if (url) {
    state.authUrl = url;
    const a = $("authLink"); a.hidden = false;
  }
  if (code) {
    $("authCode").textContent = code;
    $("authCodeWrap").hidden = false;
    $("authStatusText").textContent = "Waiting for approval…";
  }
  if (/waiting for approval/i.test(line)) $("authStatusText").textContent = "Waiting for approval…";
  const signed = line.match(/Signed in as\s+(.+)$/i);
  if (signed) {
    state.account = signed[1].trim();
    $("authTitle").textContent = "Signed in";
    $("authSub").textContent = "";
    $("authCodeWrap").hidden = true;
    $("authLink").hidden = true;
    $("authStatusText").textContent = state.account;
    $("authStatusLine").classList.add("done");
    render();
    setTimeout(() => $("authSheet").close(), 1400);
  }
  if (/denied|expired|error|timed out|failed/i.test(line)) {
    $("authStatusText").textContent = line.trim();
    $("authStatusLine").classList.add("err");
  }
};

// Voice (native Speech) + gaze sidecar signals.
window.eriSignal = (command, raw) => {
  let m = {};
  try { m = JSON.parse(raw); } catch { m = { type: "status", message: String(raw) }; }
  if (command === "startVoice") {
    if (m.type === "error") { state.voice = false; restMorph(); addEvent("voice", m.message || "voice error", "", true); render(); return; }
    if (m.type === "status") {
      if (m.message === "listening") state.voice = true;
      if (m.message === "stopped") { state.voice = false; restMorph(); }
      render(); return;
    }
    if (m.type === "partial") {
      const input = state.view === "workspace" ? $("chatInput") : $("launcherInput");
      input.value = fixName(m.text || "");
      autosize(input);
      reflectCli(input.closest("form"), input);
      if (m.final && (m.text || "").trim()) {
        state.voice = false;
        input.closest("form").requestSubmit();
      }
      render();
    }
    return;
  }
  if (command === "startGaze") {
    if (m.type === "error") { state.gaze = false; addEvent("gaze", m.message || "gaze error", "", true); }
    else { state.gaze = true; }
    render();
  }
};

// Output of read-only CLI commands (agent list, doctor, memory recall).
window.eriText = (command, text) => {
  addOutput(command, (text || "").trim() || "(no output)");
  if (state.runState === "working") state.runState = "idle";
  render();
};

/* ---------------- slash / mention combobox ---------------- */
const SLASH_ITEMS = [
  { label: "Doctor", hint: "diagnose setup", cmd: "runDoctor" },
  { label: "Agents", hint: "list personas", cmd: "listAgents" },
  { label: "Sources", hint: "indexed codebase", cmd: "openSources" },
  { label: "Editor", hint: "open files", cmd: "openEditor" },
  { label: "Preview", hint: "live preview", cmd: "openPreview" },
  { label: "Terminal", hint: "open terminal", cmd: "openTerminal" },
  { label: "Source control", hint: "git status", cmd: "openGit" },
  { label: "Sign in", hint: "device login", cmd: "authAction" },
  { label: "Gaze", hint: "eye tracking", cmd: "calibrateGaze" },
  { label: "Research", hint: "search the web", cmd: "research" },
  { label: "Theme", hint: "switch dark / light", cmd: "toggleTheme" },
];
const MENTION_ITEMS = [
  { label: "Codebase", hint: "indexed graph", insert: "@codebase" },
  { label: "Docs", hint: "documentation", insert: "@docs" },
  { label: "Memory", hint: "saved context", insert: "@memory" },
  { label: "MCP", hint: "connected tools", insert: "@mcp" },
];
const TOKEN_RE = /(^|\s)([/@])([\w-]*)$/;
const cbx = { el: null, input: null, kind: null, items: [], index: 0 };

function cbxOpen(input) {
  const m = TOKEN_RE.exec(input.value);
  if (!m) return cbxClose();
  const source = m[2] === "/" ? SLASH_ITEMS : MENTION_ITEMS;
  const q = m[3].toLowerCase();
  const items = source.filter((i) => i.label.toLowerCase().includes(q));
  if (!items.length) return cbxClose();
  cbx.input = input; cbx.kind = m[2]; cbx.items = items; cbx.index = 0;
  cbxRender();
  const r = input.closest("form").getBoundingClientRect();
  cbx.el.style.left = r.left + "px";
  cbx.el.style.width = r.width + "px";
  cbx.el.style.bottom = (window.innerHeight - r.top + 8) + "px";
  cbx.el.hidden = false;
}
function cbxRender() {
  cbx.el.innerHTML = cbx.items.map((i, n) =>
    `<div class="cbx-row ${n === cbx.index ? "is-on" : ""}" data-cbx="${n}" role="option">
       <span class="cbx-label">${esc(i.label)}</span><span class="cbx-hint">${esc(i.hint)}</span>
     </div>`).join("");
}
function cbxClose() { if (cbx.el) cbx.el.hidden = true; cbx.items = []; }
function cbxSelect(n) {
  const item = cbx.items[n]; if (!item) return;
  const input = cbx.input;
  input.value = input.value.replace(TOKEN_RE, (_, pre) => pre);
  cbxClose();
  if (cbx.kind === "/") {
    autosize(input); reflectCli(input.closest("form"), input);
    runCommand(item.cmd);
  } else {
    const sep = input.value && !/\s$/.test(input.value) ? " " : "";
    input.value = (input.value + sep + item.insert + " ").replace(/^\s+/, "");
    autosize(input); input.focus();
  }
}
function cbxKey(e) {
  if (cbx.el.hidden || !cbx.items.length) return false;
  if (e.key === "ArrowDown") { cbx.index = (cbx.index + 1) % cbx.items.length; cbxRender(); e.preventDefault(); return true; }
  if (e.key === "ArrowUp") { cbx.index = (cbx.index - 1 + cbx.items.length) % cbx.items.length; cbxRender(); e.preventDefault(); return true; }
  if (e.key === "Enter" || e.key === "Tab") { cbxSelect(cbx.index); e.preventDefault(); return true; }
  if (e.key === "Escape") { cbxClose(); e.preventDefault(); return true; }
  return false;
}

/* ---------------- wiring ---------------- */
function reflectCli(form, input) {
  form.classList.toggle("is-cli", isCli(input.value));
}

function bindComposer(form, input, onSubmit) {
  input.addEventListener("input", () => { autosize(input); reflectCli(form, input); cbxOpen(input); });
  input.addEventListener("keydown", (e) => {
    if (cbxKey(e)) return;
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); }
  });
  input.addEventListener("blur", () => setTimeout(cbxClose, 120));
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const v = input.value;
    if (!v.trim()) return;
    input.value = "";
    autosize(input);
    reflectCli(form, input);
    onSubmit(v);
  });
}

function bind() {
  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-command]");
    if (!t) return;
    if (t.type === "submit") return; // handled by form submit
    jlog("click " + t.dataset.command);
    runCommand(t.dataset.command, { ...t.dataset });
  });

  bindComposer($("launcherForm"), $("launcherInput"), (v) => submitInput(v));
  bindComposer($("chatForm"), $("chatInput"), (v) => submitInput(v));

  $("sourcesSheet").addEventListener("click", (e) => {
    if (e.target === $("sourcesSheet")) $("sourcesSheet").close();
  });

  cbx.el = $("cbx");
  cbx.el.addEventListener("mousedown", (e) => {
    const row = e.target.closest("[data-cbx]");
    if (row) { e.preventDefault(); cbxSelect(Number(row.dataset.cbx)); }
  });
}

/* ---------------- boot ---------------- */
bind();

// Dev/preview hook — only fires when opened with ?view=…/?theme=… (never in-app).
const devParams = new URLSearchParams(location.search);
if (devParams.get("theme")) state.theme = devParams.get("theme");
if (devParams.get("canvas")) state.canvas = devParams.get("canvas");
if (devParams.get("view") === "workspace") {
  state.view = "workspace";
  state.runState = "working";
  addMessage("user", "build a beautiful onboarding app with pricing and signup");
  addMessage("eri", "Planning the onboarding app. I'll draft a plan, propose edits as a diff, open the preview, then verify before shipping.");
  addEvent("plan", "Outlined a 3-step onboarding wizard, a pricing table, and a signup form", "");
  addEvent("edit", "app/onboarding/page.tsx created with step state", "");
  if (devParams.get("demo") === "cli") {
    addOutput("agent list", "Built-in personas:\n  eri        - default balanced agent\n  builder    - first working versions\n  coder      - focused implementation\n  architect  - plans and system design\n  debugger   - failure diagnosis\nActive: eri");
  }
  state.files = [
    { path: "app", name: "app", dir: true },
    { path: "components", name: "components", dir: true },
    { path: "package.json", name: "package.json", dir: false },
    { path: "README.md", name: "README.md", dir: false },
    { path: "styles.css", name: "styles.css", dir: false },
  ];
  state.activeFile = "package.json";
  state.fileContent = '{\n  "name": "onboarding-app",\n  "version": "0.1.0",\n  "scripts": {\n    "dev": "next dev",\n    "build": "next build"\n  }\n}';
  state.artifacts = [
    { kind: "Plan", name: "Implementation plan", detail: "Architecture and edit approach", state: "draft" },
    { kind: "Tasks", name: "Task list", detail: "Steps for this build", state: "open" },
    { kind: "Diff", name: "Code diff", detail: "Proposed edits, pending review", state: "active" },
    { kind: "Shot", name: "Screenshot", detail: "Preview frame with gaze target", state: "ready" },
  ];
}

if (state.intent) {
  // Launched with an intent (eri ui --open "…"): prefill, stay on launcher so the user confirms.
  $("launcherInput").value = state.intent;
  autosize($("launcherInput"));
  reflectCli($("launcherForm"), $("launcherInput"));
}
render();
if (devParams.get("demo") === "auth") {
  $("authSheet").showModal();
  window.eriAuthStream("→ Open this URL to sign in:");
  window.eriAuthStream("  https://eri.dev/device");
  window.eriAuthStream("→ Or paste this code: WXYZ-4821");
  window.eriAuthStream("Waiting for approval");
}
if (devParams.get("demo") === "slash") {
  $("launcherInput").value = "/"; $("launcherInput").focus(); cbxOpen($("launcherInput"));
}
native("authStatus"); // reflect signed-in state on launch
// Input ready immediately (Raycast feel).
if (state.view === "launcher") setTimeout(() => $("launcherInput").focus(), 30);
