// eri settings hub webview script.
// Receives full state snapshots from the extension and posts user changes
// back. All DOM updates use textContent / property assignments; no innerHTML.
(function () {
  "use strict";

  const vscode = acquireVsCodeApi();
  let currentState = null;
  let suppressEvents = false;

  function $(selector, root) {
    return (root || document).querySelector(selector);
  }

  function $all(selector, root) {
    return Array.from((root || document).querySelectorAll(selector));
  }

  function setText(selector, value) {
    const el = $(selector);
    if (el) el.textContent = value == null ? "" : String(value);
  }

  function bind(name, value) {
    $all(`[data-bind="${name}"]`).forEach((el) => {
      el.textContent = value == null ? "" : String(value);
    });
  }

  function renderProviders(list) {
    const root = $('[data-bind="byok.providers"]');
    if (!root) return;
    root.textContent = "";
    if (!list || list.length === 0) {
      const empty = document.createElement("li");
      empty.className = "empty";
      empty.textContent = "No providers configured.";
      root.appendChild(empty);
      return;
    }
    list.forEach((p) => {
      const li = document.createElement("li");
      const name = document.createElement("span");
      name.textContent = p.displayName || p.id;
      const pill = document.createElement("span");
      pill.className = "pill " + (p.hasKey ? "ok" : "warn");
      pill.textContent = p.hasKey ? "Key set" : "No key";
      li.appendChild(name);
      li.appendChild(pill);
      root.appendChild(li);
    });
  }

  function renderMcp(list) {
    const root = $('[data-bind="mcp.list"]');
    if (!root) return;
    root.textContent = "";
    if (!list || list.length === 0) {
      const empty = document.createElement("li");
      empty.className = "empty";
      empty.textContent = "No MCP servers registered.";
      root.appendChild(empty);
      return;
    }
    list.forEach((s) => {
      const li = document.createElement("li");
      const name = document.createElement("span");
      name.textContent = s.name;
      const pill = document.createElement("span");
      const cls = s.state === "online" ? "ok" : s.state === "error" ? "err" : "warn";
      pill.className = "pill " + cls;
      pill.textContent = s.state;
      li.appendChild(name);
      li.appendChild(pill);
      root.appendChild(li);
    });
  }

  function setControlValue(el, value) {
    if (el.type === "checkbox") {
      el.checked = !!value;
    } else if (el.tagName === "SELECT") {
      el.value = String(value);
    } else if (el.type === "range" || el.type === "number") {
      el.value = String(value);
    } else {
      el.value = String(value);
    }
  }

  function applyState(state) {
    if (!state) return;
    currentState = state;
    suppressEvents = true;
    try {
      // Account
      bind("account.summary", state.account.signedIn ? state.account.tier : "Signed out");
      bind("account.status", state.account.signedIn ? "Signed in" : "Signed out");
      bind("account.tier", state.account.tier);
      $all('[data-hide-when="account.signedIn"]').forEach((b) => {
        b.hidden = !!state.account.signedIn;
      });

      // BYOK
      const withKey = state.providers.filter((p) => p.hasKey).length;
      bind("byok.summary", `${withKey}/${state.providers.length} keys`);
      renderProviders(state.providers);

      // Voice
      bind("voice.summary", state.voice.enabled ? state.voice.preset : "Disabled");
      bind("voice.micPermission", state.voice.micPermission);
      const voiceEnabled = $("#voice-enabled");
      if (voiceEnabled) setControlValue(voiceEnabled, state.voice.enabled);
      const voicePreset = $("#voice-preset");
      if (voicePreset) setControlValue(voicePreset, state.voice.preset);

      // Gaze
      bind(
        "gaze.summary",
        state.gaze.enabled ? `Sensitivity ${state.gaze.sensitivity}` : "Disabled",
      );
      bind("gaze.lastCalibration", state.gaze.lastCalibration || "Never");
      bind("gaze.sensitivityValue", state.gaze.sensitivity);
      const gazeEnabled = $("#gaze-enabled");
      if (gazeEnabled) setControlValue(gazeEnabled, state.gaze.enabled);
      const gazeSens = $("#gaze-sensitivity");
      if (gazeSens) setControlValue(gazeSens, state.gaze.sensitivity);

      // Model
      bind(
        "model.summary",
        state.model.autoRouting ? "Auto routing" : state.model.default,
      );
      const modelDefault = $("#model-default");
      if (modelDefault) setControlValue(modelDefault, state.model.default);
      const modelAuto = $("#model-auto-routing");
      if (modelAuto) setControlValue(modelAuto, state.model.autoRouting);

      // Index
      bind(
        "index.summary",
        state.index.enabled
          ? `${state.index.summary.files} files`
          : "Disabled",
      );
      bind("index.files", state.index.summary.files);
      bind("index.chunks", state.index.summary.chunks);
      const indexEnabled = $("#index-enabled");
      if (indexEnabled) setControlValue(indexEnabled, state.index.enabled);

      // MCP
      bind("mcp.summary", `${state.mcp.length} server${state.mcp.length === 1 ? "" : "s"}`);
      renderMcp(state.mcp);

      // Rules
      bind("rules.summary", `${state.rules.count} active`);
      bind("rules.count", state.rules.count);

      // Privacy
      bind("privacy.summary", state.privacy.telemetry ? "Telemetry on" : "Telemetry off");
      const telemetry = $("#privacy-telemetry");
      if (telemetry) setControlValue(telemetry, state.privacy.telemetry);

      // Appearance
      bind("appearance.summary", `${state.appearance.theme} • ${state.appearance.fontSize}px`);
      bind("appearance.fontSizeValue", state.appearance.fontSize);
      const themeSel = $("#appearance-theme");
      if (themeSel) setControlValue(themeSel, state.appearance.theme);
      const fontSize = $("#appearance-font-size");
      if (fontSize) setControlValue(fontSize, state.appearance.fontSize);

      // About
      bind("about.summary", `v${state.about.version} (${state.about.channel})`);
      bind("about.version", state.about.version);
      bind("about.buildDate", state.about.buildDate);
      bind("about.channel", state.about.channel);
    } finally {
      suppressEvents = false;
    }
  }

  function postUpdate(scope, key, value) {
    vscode.postMessage({ type: "update", scope: scope, key: key, value: value });
  }

  function readControlValue(el) {
    if (el.type === "checkbox") return el.checked;
    if (el.type === "range" || el.type === "number") {
      const n = Number(el.value);
      return Number.isFinite(n) ? n : undefined;
    }
    return el.value;
  }

  function wireControls() {
    $all("[data-config]").forEach((el) => {
      const key = el.getAttribute("data-config");
      el.addEventListener("change", () => {
        if (suppressEvents) return;
        postUpdate("config", key, readControlValue(el));
      });
      if (el.type === "range") {
        el.addEventListener("input", () => {
          // Live label updates only; no postUpdate until "change"
          if (key === "appearance.fontSize") {
            bind("appearance.fontSizeValue", el.value);
          }
        });
      }
    });

    $all("[data-workspace]").forEach((el) => {
      const key = el.getAttribute("data-workspace");
      el.addEventListener("change", () => {
        if (suppressEvents) return;
        postUpdate("workspace", key, readControlValue(el));
      });
      if (el.type === "range") {
        el.addEventListener("input", () => {
          if (key === "eri.gaze.sensitivity") {
            bind("gaze.sensitivityValue", el.value);
          }
        });
      }
    });

    $all("[data-action]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const action = btn.getAttribute("data-action");
        vscode.postMessage({ type: "action", action: action });
      });
    });
  }

  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "state" && msg.state) {
      applyState(msg.state);
    }
  });

  wireControls();
  vscode.postMessage({ type: "ready" });
})();
