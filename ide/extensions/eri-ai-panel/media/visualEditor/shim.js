// eri Visual Editor iframe shim. Runs inside the user's dev server page and
// reports element-picker results back to the parent webview via postMessage.
//
// Protocol:
//   inbound  - { tag: "eri.visualEditor.shim", payload: <ShimInbound> }
//   outbound - { tag: "eri.visualEditor.shim", payload: <ShimOutbound> }
//
// The shim is intentionally dependency-free and small (target ~150 lines)
// so we can also inline it as a fallback when the iframe is cross-origin and
// can't fetch this file directly.

(function () {
  "use strict";

  var TAG = "eri.visualEditor.shim";

  var picking = false;
  var hoveredEl = null;
  var lastGazePoint = null;
  var overlay = createOverlay();
  document.documentElement.appendChild(overlay);

  function send(payload) {
    try {
      window.parent.postMessage({ tag: TAG, payload: payload }, "*");
    } catch (_e) {
      // parent unavailable - ignore
    }
  }

  function createOverlay() {
    var el = document.createElement("div");
    el.id = "eri-visual-editor-overlay";
    el.style.position = "fixed";
    el.style.pointerEvents = "none";
    el.style.border = "1px solid rgba(34, 141, 242, 0.85)";
    el.style.background = "rgba(34, 141, 242, 0.08)";
    el.style.zIndex = "2147483646";
    el.style.transition = "all 80ms ease-out";
    el.style.display = "none";
    el.style.boxSizing = "border-box";
    return el;
  }

  function showOverlay(target) {
    if (!target || target === overlay) {
      hideOverlay();
      return;
    }
    var rect = target.getBoundingClientRect();
    overlay.style.left = rect.left + "px";
    overlay.style.top = rect.top + "px";
    overlay.style.width = rect.width + "px";
    overlay.style.height = rect.height + "px";
    overlay.style.display = "block";
  }

  function hideOverlay() {
    overlay.style.display = "none";
  }

  function onMouseMove(event) {
    if (!picking) {
      return;
    }
    var el = event.target;
    if (!el || el === overlay) {
      return;
    }
    hoveredEl = el;
    showOverlay(el);
  }

  function onClick(event) {
    if (!picking) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    var el = event.target;
    if (!el || el === overlay) {
      return;
    }
    finishPick(el);
  }

  function onKeyDown(event) {
    if (picking && event.key === "Escape") {
      picking = false;
      hideOverlay();
      send({ kind: "pickCancelled" });
    }
  }

  function finishPick(el) {
    picking = false;
    hideOverlay();
    try {
      var summary = describeElement(el);
      send({ kind: "pickResult", element: summary });
    } catch (err) {
      send({ kind: "shimError", message: String(err && err.message ? err.message : err) });
    }
  }

  function describeElement(el) {
    var rect = el.getBoundingClientRect();
    var classNames = (el.className && typeof el.className === "string")
      ? el.className.split(/\s+/).filter(function (c) { return c.length > 0; })
      : [];
    var id = el.id || null;
    var selector = computeSelector(el);
    var computedStyles = snapshotStyles(el);
    var innerText = (el.innerText || el.textContent || "").trim().slice(0, 1024);
    return {
      tag: el.tagName ? el.tagName.toLowerCase() : "unknown",
      id: id,
      classNames: classNames,
      selector: selector,
      bbox: { x: rect.left, y: rect.top, w: rect.width, h: rect.height },
      computedStyles: computedStyles,
      innerText: innerText,
    };
  }

  var TRACKED_PROPS = [
    "width", "height", "padding", "margin", "font-size", "font-weight",
    "color", "background-color", "background", "border-radius", "border-color",
    "display", "flex-direction", "justify-content", "align-items", "gap",
    "box-shadow", "opacity", "text-decoration",
  ];

  function snapshotStyles(el) {
    var computed = window.getComputedStyle(el);
    var out = {};
    for (var i = 0; i < TRACKED_PROPS.length; i += 1) {
      var key = TRACKED_PROPS[i];
      out[key] = computed.getPropertyValue(key);
    }
    return out;
  }

  function computeSelector(el) {
    if (!el || el.nodeType !== 1) {
      return "";
    }
    if (el.id) {
      return "#" + cssEscape(el.id);
    }
    var path = [];
    var node = el;
    while (node && node.nodeType === 1 && path.length < 6) {
      var tag = node.tagName ? node.tagName.toLowerCase() : "";
      var part = tag;
      if (node.className && typeof node.className === "string") {
        var classes = node.className.split(/\s+/).filter(function (c) { return c.length > 0; }).slice(0, 2);
        if (classes.length > 0) {
          part += "." + classes.map(cssEscape).join(".");
        }
      }
      if (node.parentElement) {
        var siblings = Array.prototype.filter.call(node.parentElement.children, function (s) {
          return s.tagName === node.tagName;
        });
        if (siblings.length > 1) {
          var idx = siblings.indexOf(node) + 1;
          part += ":nth-of-type(" + idx + ")";
        }
      }
      path.unshift(part);
      node = node.parentElement;
    }
    return path.join(" > ");
  }

  function cssEscape(value) {
    if (typeof window.CSS !== "undefined" && typeof window.CSS.escape === "function") {
      return window.CSS.escape(value);
    }
    return value.replace(/([^a-zA-Z0-9_-])/g, "\\$1");
  }

  function handleHighlightAtPoint(payload) {
    if (typeof payload.x !== "number" || typeof payload.y !== "number") {
      return;
    }
    lastGazePoint = { x: payload.x, y: payload.y };
    var rect = document.documentElement.getBoundingClientRect();
    var px = payload.x * rect.width;
    var py = payload.y * rect.height;
    var el = document.elementFromPoint(px, py);
    if (!el || el === overlay) {
      return;
    }
    hoveredEl = el;
    showOverlay(el);
  }

  function handleApplyStyles(change) {
    if (!change || typeof change !== "object" || typeof change.selector !== "string") {
      return;
    }
    var styles = change.styles || {};
    try {
      var els = document.querySelectorAll(change.selector);
      els.forEach(function (target) {
        for (var key in styles) {
          if (Object.prototype.hasOwnProperty.call(styles, key)) {
            target.style.setProperty(key, styles[key]);
          }
        }
      });
    } catch (err) {
      send({ kind: "shimError", message: "applyStyles failed: " + (err && err.message ? err.message : err) });
    }
  }

  window.addEventListener("message", function (event) {
    var data = event && event.data;
    if (!data || typeof data !== "object" || data.tag !== TAG) {
      return;
    }
    var payload = data.payload;
    if (!payload || typeof payload !== "object") {
      return;
    }
    switch (payload.kind) {
      case "pickStart":
        // If we have a recently-seen gaze hover element, auto-pick it instead
        // of waiting for a click. This is how the 800ms dwell -> pick path
        // resolves.
        if (lastGazePoint && hoveredEl) {
          finishPick(hoveredEl);
          return;
        }
        picking = true;
        break;
      case "pickStop":
        picking = false;
        hideOverlay();
        break;
      case "applyStyles":
        handleApplyStyles(payload.change);
        break;
      case "highlightAtPoint":
        handleHighlightAtPoint(payload);
        break;
      case "clearHighlight":
        hideOverlay();
        lastGazePoint = null;
        hoveredEl = null;
        break;
    }
  });

  document.addEventListener("mousemove", onMouseMove, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKeyDown, true);

  send({ kind: "shimReady" });
})();
