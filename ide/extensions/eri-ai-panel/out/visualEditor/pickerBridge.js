"use strict";
// PostMessage protocol between the extension host, the webview, and the
// iframe shim. Keeping the message shapes in one place (with type guards) so
// we can unit-test the round-trip without booting a webview.
Object.defineProperty(exports, "__esModule", { value: true });
exports.SHIM_TAG = void 0;
exports.wrapShim = wrapShim;
exports.unwrapShim = unwrapShim;
exports.parseWebviewMessage = parseWebviewMessage;
exports.describeElement = describeElement;
// Tag used on every shim message so we can distinguish them from random
// postMessages that pages might emit.
exports.SHIM_TAG = "eri.visualEditor.shim";
function wrapShim(payload) {
    return { tag: exports.SHIM_TAG, payload };
}
function unwrapShim(raw) {
    if (!raw || typeof raw !== "object") {
        return null;
    }
    const envelope = raw;
    if (envelope.tag !== exports.SHIM_TAG) {
        return null;
    }
    return parseShimOutbound(envelope.payload);
}
// Parse + validate inbound webview->host messages. Returns null when the
// shape doesn't match anything we know - the webview can spam us and we
// stay defensive.
function parseWebviewMessage(raw) {
    if (!raw || typeof raw !== "object") {
        return null;
    }
    const message = raw;
    switch (message.kind) {
        case "ready":
            return { kind: "ready" };
        case "pickCancelled":
            return { kind: "pickCancelled" };
        case "requestSetUrl":
            return { kind: "requestSetUrl" };
        case "requestClearTweaks":
            return { kind: "requestClearTweaks" };
        case "requestApplyToSource": {
            const note = raw.note;
            return {
                kind: "requestApplyToSource",
                ...(typeof note === "string" ? { note } : {}),
            };
        }
        case "pickResult": {
            const element = parsePickedElement(raw.element);
            if (!element) {
                return null;
            }
            return { kind: "pickResult", element };
        }
        case "shimError": {
            const m = raw.message;
            return { kind: "shimError", message: typeof m === "string" ? m : "" };
        }
        case "tweakChanged": {
            const property = raw.property;
            const value = raw.value;
            if (typeof property !== "string" || typeof value !== "string") {
                return null;
            }
            return { kind: "tweakChanged", property, value };
        }
        case "log": {
            const m = raw.message;
            return { kind: "log", message: typeof m === "string" ? m : "" };
        }
        default:
            return null;
    }
}
function parseShimOutbound(raw) {
    if (!raw || typeof raw !== "object") {
        return null;
    }
    const message = raw;
    switch (message.kind) {
        case "shimReady":
            return { kind: "shimReady" };
        case "pickCancelled":
            return { kind: "pickCancelled" };
        case "pickResult": {
            const element = parsePickedElement(raw.element);
            if (!element) {
                return null;
            }
            return { kind: "pickResult", element };
        }
        case "shimError": {
            const m = raw.message;
            return { kind: "shimError", message: typeof m === "string" ? m : "" };
        }
        default:
            return null;
    }
}
function parsePickedElement(raw) {
    if (!raw || typeof raw !== "object") {
        return null;
    }
    const obj = raw;
    if (typeof obj.tag !== "string" || typeof obj.selector !== "string") {
        return null;
    }
    const classNames = Array.isArray(obj.classNames)
        ? obj.classNames.filter((c) => typeof c === "string")
        : [];
    const bboxRaw = obj.bbox;
    const bbox = bboxRaw && typeof bboxRaw === "object"
        ? {
            x: numberOr(bboxRaw.x, 0),
            y: numberOr(bboxRaw.y, 0),
            w: numberOr(bboxRaw.w, 0),
            h: numberOr(bboxRaw.h, 0),
        }
        : { x: 0, y: 0, w: 0, h: 0 };
    const computed = obj.computedStyles;
    const computedStyles = {};
    if (computed && typeof computed === "object") {
        for (const [key, value] of Object.entries(computed)) {
            if (typeof value === "string") {
                computedStyles[key] = value;
            }
        }
    }
    return {
        tag: obj.tag,
        id: typeof obj.id === "string" ? obj.id : null,
        classNames,
        selector: obj.selector,
        bbox,
        computedStyles,
        innerText: typeof obj.innerText === "string" ? obj.innerText : "",
    };
}
function numberOr(value, fallback) {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
// Compose the human-readable context block sent to chat when the user picks
// an element. Used by both the inline "send to chat" flow and the apply-to-
// source bundler. Pure - shared between extension and tests.
function describeElement(element) {
    const classNames = element.classNames.length > 0 ? `.${element.classNames.join(".")}` : "";
    const id = element.id ? `#${element.id}` : "";
    const heading = `@Element ${element.tag}${id}${classNames}`;
    const summaryStyles = Object.entries(element.computedStyles)
        .slice(0, 16)
        .map(([k, v]) => `  ${k}: ${v};`)
        .join("\n");
    const trimmedText = element.innerText.trim().slice(0, 240);
    const lines = [
        `selector: ${element.selector}`,
        `bbox: ${element.bbox.x},${element.bbox.y} ${element.bbox.w}x${element.bbox.h}`,
        "",
        "computed styles:",
        summaryStyles,
    ];
    if (trimmedText.length > 0) {
        lines.push("", "innerText:", trimmedText);
    }
    return { heading, body: lines.join("\n") };
}
//# sourceMappingURL=pickerBridge.js.map