// PostMessage protocol between the extension host, the webview, and the
// iframe shim. Keeping the message shapes in one place (with type guards) so
// we can unit-test the round-trip without booting a webview.

export interface PickedElement {
  readonly tag: string;
  readonly id: string | null;
  readonly classNames: ReadonlyArray<string>;
  readonly selector: string;
  readonly bbox: { x: number; y: number; w: number; h: number };
  readonly computedStyles: Readonly<Record<string, string>>;
  readonly innerText: string;
}

export interface StyleChange {
  readonly selector: string;
  readonly styles: Readonly<Record<string, string>>;
}

// Webview -> extension. The webview brokers iframe shim messages and forwards
// them up here.
export type WebviewToHostMessage =
  | { readonly kind: "ready" }
  | { readonly kind: "pickResult"; readonly element: PickedElement }
  | { readonly kind: "pickCancelled" }
  | { readonly kind: "shimError"; readonly message: string }
  | { readonly kind: "requestApplyToSource"; readonly note?: string }
  | { readonly kind: "requestSetUrl" }
  | { readonly kind: "requestClearTweaks" }
  | { readonly kind: "tweakChanged"; readonly property: string; readonly value: string }
  | { readonly kind: "log"; readonly message: string };

// Extension -> webview. The webview either acts on these directly (UI state)
// or relays them as postMessage to the iframe shim.
export type HostToWebviewMessage =
  | { readonly kind: "init"; readonly url: string; readonly recentUrls: ReadonlyArray<string> }
  | { readonly kind: "setUrl"; readonly url: string; readonly recentUrls: ReadonlyArray<string> }
  | { readonly kind: "pickStart" }
  | { readonly kind: "pickStop" }
  | { readonly kind: "applyStyles"; readonly change: StyleChange }
  | { readonly kind: "highlightAtPoint"; readonly x: number; readonly y: number }
  | { readonly kind: "clearHighlight" }
  | { readonly kind: "setVoiceState"; readonly state: VoiceState }
  | { readonly kind: "showStatus"; readonly text: string; readonly tone?: StatusTone }
  | { readonly kind: "syncTweaks"; readonly tweaks: ReadonlyArray<{ property: string; value: string }> };

export type VoiceState = "idle" | "listening" | "thinking" | "applied";
export type StatusTone = "info" | "warn" | "error";

// Webview <-> iframe shim (the shim runs inside the user's dev server page).
// The webview just relays these through the iframe's contentWindow.
export type ShimInbound =
  | { readonly kind: "pickStart" }
  | { readonly kind: "pickStop" }
  | { readonly kind: "applyStyles"; readonly change: StyleChange }
  | { readonly kind: "highlightAtPoint"; readonly x: number; readonly y: number }
  | { readonly kind: "clearHighlight" };

export type ShimOutbound =
  | { readonly kind: "shimReady" }
  | { readonly kind: "pickResult"; readonly element: PickedElement }
  | { readonly kind: "pickCancelled" }
  | { readonly kind: "shimError"; readonly message: string };

// Tag used on every shim message so we can distinguish them from random
// postMessages that pages might emit.
export const SHIM_TAG = "eri.visualEditor.shim";

export interface ShimEnvelope<T> {
  readonly tag: typeof SHIM_TAG;
  readonly payload: T;
}

export function wrapShim<T>(payload: T): ShimEnvelope<T> {
  return { tag: SHIM_TAG, payload };
}

export function unwrapShim(raw: unknown): ShimOutbound | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const envelope = raw as { tag?: unknown; payload?: unknown };
  if (envelope.tag !== SHIM_TAG) {
    return null;
  }
  return parseShimOutbound(envelope.payload);
}

// Parse + validate inbound webview->host messages. Returns null when the
// shape doesn't match anything we know - the webview can spam us and we
// stay defensive.
export function parseWebviewMessage(raw: unknown): WebviewToHostMessage | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const message = raw as { kind?: unknown };
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
      const note = (raw as { note?: unknown }).note;
      return {
        kind: "requestApplyToSource",
        ...(typeof note === "string" ? { note } : {}),
      };
    }
    case "pickResult": {
      const element = parsePickedElement((raw as { element?: unknown }).element);
      if (!element) {
        return null;
      }
      return { kind: "pickResult", element };
    }
    case "shimError": {
      const m = (raw as { message?: unknown }).message;
      return { kind: "shimError", message: typeof m === "string" ? m : "" };
    }
    case "tweakChanged": {
      const property = (raw as { property?: unknown }).property;
      const value = (raw as { value?: unknown }).value;
      if (typeof property !== "string" || typeof value !== "string") {
        return null;
      }
      return { kind: "tweakChanged", property, value };
    }
    case "log": {
      const m = (raw as { message?: unknown }).message;
      return { kind: "log", message: typeof m === "string" ? m : "" };
    }
    default:
      return null;
  }
}

function parseShimOutbound(raw: unknown): ShimOutbound | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const message = raw as { kind?: unknown };
  switch (message.kind) {
    case "shimReady":
      return { kind: "shimReady" };
    case "pickCancelled":
      return { kind: "pickCancelled" };
    case "pickResult": {
      const element = parsePickedElement((raw as { element?: unknown }).element);
      if (!element) {
        return null;
      }
      return { kind: "pickResult", element };
    }
    case "shimError": {
      const m = (raw as { message?: unknown }).message;
      return { kind: "shimError", message: typeof m === "string" ? m : "" };
    }
    default:
      return null;
  }
}

function parsePickedElement(raw: unknown): PickedElement | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.tag !== "string" || typeof obj.selector !== "string") {
    return null;
  }
  const classNames = Array.isArray(obj.classNames)
    ? obj.classNames.filter((c): c is string => typeof c === "string")
    : [];
  const bboxRaw = obj.bbox as Record<string, unknown> | null | undefined;
  const bbox = bboxRaw && typeof bboxRaw === "object"
    ? {
        x: numberOr(bboxRaw.x, 0),
        y: numberOr(bboxRaw.y, 0),
        w: numberOr(bboxRaw.w, 0),
        h: numberOr(bboxRaw.h, 0),
      }
    : { x: 0, y: 0, w: 0, h: 0 };
  const computed = obj.computedStyles;
  const computedStyles: Record<string, string> = {};
  if (computed && typeof computed === "object") {
    for (const [key, value] of Object.entries(computed as Record<string, unknown>)) {
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

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

// Compose the human-readable context block sent to chat when the user picks
// an element. Used by both the inline "send to chat" flow and the apply-to-
// source bundler. Pure - shared between extension and tests.
export function describeElement(element: PickedElement): {
  heading: string;
  body: string;
} {
  const classNames =
    element.classNames.length > 0 ? `.${element.classNames.join(".")}` : "";
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
