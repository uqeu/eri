"use strict";
// Pure layout-state helpers — no vscode imports. Lets layoutManager.ts
// stay thin (just wires VS Code APIs to these helpers) and lets the
// regression tests run via plain `node out/...test.js`.
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_LAYOUT_STATE = void 0;
exports.normalizeLayout = normalizeLayout;
exports.resolvePreviewSurface = resolvePreviewSurface;
exports.toggleMode = toggleMode;
exports.DEFAULT_LAYOUT_STATE = {
    mode: "coder",
    chatPosition: "right",
    explorerHiddenInEriMode: true,
    previewSurface: "auto",
    themeSlug: "anthropic",
};
const MODES = ["coder", "eri"];
const POSITIONS = ["left", "right", "bottom"];
const SURFACES = ["swift", "webview", "auto"];
function pick(value, allowed, fallback) {
    if (typeof value !== "string")
        return fallback;
    return allowed.includes(value) ? value : fallback;
}
function normalizeLayout(input) {
    return {
        mode: pick(input.mode, MODES, exports.DEFAULT_LAYOUT_STATE.mode),
        chatPosition: pick(input.chatPosition, POSITIONS, exports.DEFAULT_LAYOUT_STATE.chatPosition),
        explorerHiddenInEriMode: typeof input.explorerHiddenInEriMode === "boolean"
            ? input.explorerHiddenInEriMode
            : exports.DEFAULT_LAYOUT_STATE.explorerHiddenInEriMode,
        previewSurface: pick(input.previewSurface, SURFACES, exports.DEFAULT_LAYOUT_STATE.previewSurface),
        themeSlug: typeof input.themeSlug === "string" && input.themeSlug.trim().length > 0
            ? input.themeSlug.trim()
            : exports.DEFAULT_LAYOUT_STATE.themeSlug,
    };
}
/**
 * Resolve which preview surface is actually active given the user's
 * setting + the current mode. `"auto"` flips to Swift in coder mode and
 * to the embedded webview in eri mode — matching the demo's behaviour
 * without forcing the user to micromanage the override.
 */
function resolvePreviewSurface(state) {
    if (state.previewSurface === "swift")
        return "swift";
    if (state.previewSurface === "webview")
        return "webview";
    return state.mode === "eri" ? "webview" : "swift";
}
/** Other layout module's view of the next-state after a mode flip. */
function toggleMode(state) {
    return { ...state, mode: state.mode === "coder" ? "eri" : "coder" };
}
//# sourceMappingURL=layoutState.js.map