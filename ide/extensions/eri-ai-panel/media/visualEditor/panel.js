// Webview-side controller for the Visual Editor. Runs inside the VS Code
// webview iframe (NOT the user's dev server iframe). Responsible for:
//   - Rendering the toolbar + sidebar UI
//   - Relaying shim-bound messages to the user's dev server iframe
//   - Forwarding shim messages back up to the extension host
//   - Driving the slider/color tweaks UI

(function () {
  "use strict";
  // eslint-disable-next-line no-undef
  const vscode = acquireVsCodeApi();

  const SHIM_TAG = "eri.visualEditor.shim";

  const PROPERTY_META = [
    { property: "width", label: "Width", control: "slider", unit: "px", min: 0, max: 1200, step: 1, defaultNumber: 320 },
    { property: "height", label: "Height", control: "slider", unit: "px", min: 0, max: 1200, step: 1, defaultNumber: 200 },
    { property: "padding", label: "Padding", control: "slider", unit: "px", min: 0, max: 96, step: 1, defaultNumber: 8 },
    { property: "margin", label: "Margin", control: "slider", unit: "px", min: 0, max: 96, step: 1, defaultNumber: 0 },
    { property: "font-size", label: "Font size", control: "slider", unit: "px", min: 8, max: 96, step: 1, defaultNumber: 16 },
    { property: "border-radius", label: "Radius", control: "slider", unit: "px", min: 0, max: 64, step: 1, defaultNumber: 0 },
    { property: "color", label: "Text color", control: "color", defaultColor: "#e6edf3" },
    { property: "background", label: "Background", control: "color", defaultColor: "#1f1f24" },
    { property: "border-color", label: "Border color", control: "color", defaultColor: "#33373e" },
  ];

  const frame = document.getElementById("ve-frame");
  const inspector = document.getElementById("ve-inspector");
  const tweaks = document.getElementById("ve-tweaks");
  const status = document.getElementById("ve-status");
  const voiceBadge = document.getElementById("ve-voice");
  const urlBtn = document.getElementById("ve-url");
  const pickBtn = document.getElementById("ve-pick");
  const applyBtn = document.getElementById("ve-apply");
  const clearBtn = document.getElementById("ve-clear");

  let currentUrl = frame.getAttribute("src");
  let picked = null;
  let pickActive = false;

  renderTweaks(null);

  urlBtn.addEventListener("click", function () {
    vscode.postMessage({ kind: "requestSetUrl" });
  });

  pickBtn.addEventListener("click", function () {
    pickActive = !pickActive;
    pickBtn.classList.toggle("primary", pickActive);
    if (pickActive) {
      sendToShim({ kind: "pickStart" });
      setStatus("pick mode on - click an element", "info");
    } else {
      sendToShim({ kind: "pickStop" });
      setStatus("pick mode off", "info");
    }
  });

  applyBtn.addEventListener("click", function () {
    vscode.postMessage({ kind: "requestApplyToSource" });
  });

  clearBtn.addEventListener("click", function () {
    vscode.postMessage({ kind: "requestClearTweaks" });
  });

  frame.addEventListener("load", function () {
    try {
      void frame.contentDocument;
      injectShim();
    } catch (_e) {
      setStatus("preview origin blocked DOM access - serve from localhost", "warn");
    }
  });

  window.addEventListener("message", function (event) {
    var data = event && event.data;
    if (data && typeof data === "object" && data.tag === SHIM_TAG) {
      handleShimMessage(data.payload);
      return;
    }
    if (data && typeof data === "object" && typeof data.kind === "string") {
      handleHostMessage(data);
    }
  });

  vscode.postMessage({ kind: "ready" });

  function handleShimMessage(payload) {
    if (!payload || typeof payload !== "object") {
      return;
    }
    switch (payload.kind) {
      case "shimReady":
        if (pickActive) {
          sendToShim({ kind: "pickStart" });
        }
        break;
      case "pickResult":
        picked = payload.element;
        pickActive = false;
        pickBtn.classList.remove("primary");
        renderInspector(picked);
        renderTweaks(picked);
        vscode.postMessage({ kind: "pickResult", element: picked });
        setStatus("picked " + (picked && picked.selector), "info");
        break;
      case "pickCancelled":
        pickActive = false;
        pickBtn.classList.remove("primary");
        vscode.postMessage({ kind: "pickCancelled" });
        break;
      case "shimError":
        vscode.postMessage({ kind: "shimError", message: String(payload.message || "") });
        setStatus("shim error: " + payload.message, "warn");
        break;
    }
  }

  function handleHostMessage(message) {
    switch (message.kind) {
      case "init":
      case "setUrl":
        currentUrl = message.url;
        urlBtn.textContent = currentUrl;
        if (frame.getAttribute("src") !== currentUrl) {
          frame.setAttribute("src", currentUrl);
        }
        break;
      case "pickStart":
        pickActive = true;
        pickBtn.classList.add("primary");
        sendToShim({ kind: "pickStart" });
        break;
      case "pickStop":
        pickActive = false;
        pickBtn.classList.remove("primary");
        sendToShim({ kind: "pickStop" });
        break;
      case "applyStyles":
        sendToShim({ kind: "applyStyles", change: message.change });
        break;
      case "highlightAtPoint":
        sendToShim({ kind: "highlightAtPoint", x: message.x, y: message.y });
        break;
      case "clearHighlight":
        sendToShim({ kind: "clearHighlight" });
        break;
      case "syncTweaks":
        renderTweaks(picked);
        break;
      case "setVoiceState":
        voiceBadge.dataset.state = message.state;
        voiceBadge.textContent = "voice " + message.state;
        break;
      case "showStatus":
        setStatus(message.text, message.tone || "info");
        break;
    }
  }

  function sendToShim(payload) {
    try {
      if (frame && frame.contentWindow) {
        frame.contentWindow.postMessage({ tag: SHIM_TAG, payload: payload }, "*");
      }
    } catch (_e) {
      // cross-origin - silently drop
    }
  }

  function injectShim() {
    try {
      var doc = frame.contentDocument;
      if (!doc) {
        return;
      }
      if (doc.getElementById("eri-visual-editor-shim")) {
        return;
      }
      var script = doc.createElement("script");
      script.id = "eri-visual-editor-shim";
      script.src = currentBaseHref() + "shim.js?eri=" + Date.now();
      script.onerror = function () {
        var inline = doc.createElement("script");
        inline.id = "eri-visual-editor-shim-inline";
        inline.textContent = inlineShimSource();
        doc.documentElement.appendChild(inline);
      };
      doc.documentElement.appendChild(script);
    } catch (_e) {
      setStatus("cannot inject shim (cross-origin)", "warn");
    }
  }

  function currentBaseHref() {
    var scripts = document.getElementsByTagName("script");
    for (var i = 0; i < scripts.length; i += 1) {
      var src = scripts[i].getAttribute("src") || "";
      if (src.indexOf("panel.js") !== -1) {
        return src.replace(/panel\.js.*$/, "");
      }
    }
    return "";
  }

  function inlineShimSource() {
    return (
      "(" +
      function () {
        var TAG = "eri.visualEditor.shim";
        function send(payload) {
          window.parent.postMessage({ tag: TAG, payload: payload }, "*");
        }
        window.addEventListener("message", function (e) {
          var d = e && e.data;
          if (!d || d.tag !== TAG) {
            return;
          }
          var p = d.payload;
          if (p && p.kind === "applyStyles" && p.change) {
            try {
              var els = document.querySelectorAll(p.change.selector);
              els.forEach(function (el) {
                var s = p.change.styles || {};
                for (var k in s) {
                  if (Object.prototype.hasOwnProperty.call(s, k)) {
                    el.style.setProperty(k, s[k]);
                  }
                }
              });
            } catch (_e2) {}
          }
        });
        send({ kind: "shimReady" });
      }.toString() +
      ")();"
    );
  }

  function renderInspector(el) {
    if (!el) {
      inspector.textContent = "No element picked yet.";
      return;
    }
    var lines = [
      "tag: " + el.tag,
      "selector: " + el.selector,
      "id: " + (el.id || "(none)"),
      "classes: " + (el.classNames && el.classNames.length ? el.classNames.join(" ") : "(none)"),
      "size: " + Math.round(el.bbox.w) + " x " + Math.round(el.bbox.h),
    ];
    inspector.textContent = lines.join("\n");
  }

  function renderTweaks(el) {
    tweaks.textContent = "";
    if (!el) {
      var note = document.createElement("div");
      note.style.color = "var(--muted)";
      note.style.fontSize = "11px";
      note.textContent = "Pick an element to enable style tweaks.";
      tweaks.appendChild(note);
      return;
    }
    for (var i = 0; i < PROPERTY_META.length; i += 1) {
      var meta = PROPERTY_META[i];
      var row = document.createElement("div");
      row.className = "tweak-row";

      var label = document.createElement("label");
      label.textContent = meta.label;
      row.appendChild(label);

      if (meta.control === "slider") {
        bindSliderRow(row, meta, el);
      } else {
        bindColorRow(row, meta, el);
      }
      tweaks.appendChild(row);
    }
  }

  function bindSliderRow(row, meta, el) {
    var slider = document.createElement("input");
    slider.type = "range";
    slider.min = String(meta.min);
    slider.max = String(meta.max);
    slider.step = String(meta.step || 1);
    var initial = parseInitialPx(el.computedStyles && el.computedStyles[meta.property]) || meta.defaultNumber || 0;
    slider.value = String(initial);
    var value = document.createElement("span");
    value.className = "value";
    value.textContent = initial + meta.unit;
    slider.addEventListener("input", function () {
      var v = Number(slider.value);
      var css = v + (meta.unit || "");
      value.textContent = css;
      vscode.postMessage({ kind: "tweakChanged", property: meta.property, value: css });
    });
    row.appendChild(slider);
    row.appendChild(value);
  }

  function bindColorRow(row, meta, el) {
    var picker = document.createElement("input");
    picker.type = "color";
    var initialColor = normalizeColor(el.computedStyles && el.computedStyles[meta.property]) || meta.defaultColor || "#000000";
    picker.value = initialColor;
    var value = document.createElement("span");
    value.className = "value";
    value.textContent = initialColor;
    picker.addEventListener("input", function () {
      value.textContent = picker.value;
      vscode.postMessage({ kind: "tweakChanged", property: meta.property, value: picker.value });
    });
    row.appendChild(picker);
    row.appendChild(value);
  }

  function parseInitialPx(value) {
    if (!value || typeof value !== "string") {
      return null;
    }
    var m = /^(-?\d+(?:\.\d+)?)px$/.exec(value.trim());
    if (!m) {
      return null;
    }
    var n = Number(m[1]);
    return Number.isFinite(n) ? Math.round(n) : null;
  }

  function normalizeColor(value) {
    if (!value || typeof value !== "string") {
      return null;
    }
    var trimmed = value.trim().toLowerCase();
    if (/^#[0-9a-f]{6}$/.test(trimmed)) {
      return trimmed;
    }
    var rgbMatch = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(trimmed);
    if (rgbMatch) {
      var r = Number(rgbMatch[1]).toString(16).padStart(2, "0");
      var g = Number(rgbMatch[2]).toString(16).padStart(2, "0");
      var b = Number(rgbMatch[3]).toString(16).padStart(2, "0");
      return "#" + r + g + b;
    }
    return null;
  }

  function setStatus(text, tone) {
    status.textContent = text;
    status.dataset.tone = tone || "info";
  }
})();
