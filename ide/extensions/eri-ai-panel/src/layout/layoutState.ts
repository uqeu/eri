// Pure layout-state helpers — no vscode imports. Lets layoutManager.ts
// stay thin (just wires VS Code APIs to these helpers) and lets the
// regression tests run via plain `node out/...test.js`.

export type LayoutMode = "coder" | "eri";
export type ChatPosition = "left" | "right" | "bottom";
export type PreviewSurface = "swift" | "webview" | "auto";

export interface LayoutState {
  readonly mode: LayoutMode;
  readonly chatPosition: ChatPosition;
  readonly explorerHiddenInEriMode: boolean;
  readonly previewSurface: PreviewSurface;
  readonly themeSlug: string;
}

export const DEFAULT_LAYOUT_STATE: LayoutState = {
  mode: "coder",
  chatPosition: "right",
  explorerHiddenInEriMode: true,
  previewSurface: "auto",
  themeSlug: "anthropic",
};

const MODES: ReadonlyArray<LayoutMode> = ["coder", "eri"];
const POSITIONS: ReadonlyArray<ChatPosition> = ["left", "right", "bottom"];
const SURFACES: ReadonlyArray<PreviewSurface> = ["swift", "webview", "auto"];

function pick<T extends string>(
  value: unknown,
  allowed: ReadonlyArray<T>,
  fallback: T,
): T {
  if (typeof value !== "string") return fallback;
  return (allowed as ReadonlyArray<string>).includes(value) ? (value as T) : fallback;
}

export interface LayoutInputs {
  readonly mode?: unknown;
  readonly chatPosition?: unknown;
  readonly explorerHiddenInEriMode?: unknown;
  readonly previewSurface?: unknown;
  readonly themeSlug?: unknown;
}

export function normalizeLayout(input: LayoutInputs): LayoutState {
  return {
    mode: pick<LayoutMode>(input.mode, MODES, DEFAULT_LAYOUT_STATE.mode),
    chatPosition: pick<ChatPosition>(
      input.chatPosition,
      POSITIONS,
      DEFAULT_LAYOUT_STATE.chatPosition,
    ),
    explorerHiddenInEriMode:
      typeof input.explorerHiddenInEriMode === "boolean"
        ? input.explorerHiddenInEriMode
        : DEFAULT_LAYOUT_STATE.explorerHiddenInEriMode,
    previewSurface: pick<PreviewSurface>(
      input.previewSurface,
      SURFACES,
      DEFAULT_LAYOUT_STATE.previewSurface,
    ),
    themeSlug:
      typeof input.themeSlug === "string" && input.themeSlug.trim().length > 0
        ? input.themeSlug.trim()
        : DEFAULT_LAYOUT_STATE.themeSlug,
  };
}

/**
 * Resolve which preview surface is actually active given the user's
 * setting + the current mode. `"auto"` flips to Swift in coder mode and
 * to the embedded webview in eri mode — matching the demo's behaviour
 * without forcing the user to micromanage the override.
 */
export function resolvePreviewSurface(
  state: LayoutState,
): "swift" | "webview" {
  if (state.previewSurface === "swift") return "swift";
  if (state.previewSurface === "webview") return "webview";
  return state.mode === "eri" ? "webview" : "swift";
}

/** Other layout module's view of the next-state after a mode flip. */
export function toggleMode(state: LayoutState): LayoutState {
  return { ...state, mode: state.mode === "coder" ? "eri" : "coder" };
}
