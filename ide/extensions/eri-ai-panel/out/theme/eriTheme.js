"use strict";
// Shared theme tokens for every eri webview (panel, composer, settings
// hub, embedded preview chrome). Single source of truth so that when the
// user picks a different marketplace theme (Phase 23) the colours move in
// one place instead of every inline <style> block.
//
// The marketplace catalog itself lives in the sidecar
// (crates/eri_coreutils/src/services/themes.rs) and is fetched via
// `eri/themes/list` / `eri/themes/setActive`. Here we only ship the
// surface-level CSS variables that webviews need to draw chat + preview
// chrome — anything richer (per-component overrides, gradient maps) is
// the responsibility of the consumer.
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_THEME = void 0;
exports.resolveTheme = resolveTheme;
exports.eriThemeCss = eriThemeCss;
const DEFAULT_DARK = {
    slug: "anthropic",
    mode: "dark",
    bg: "#0c0c0c",
    bgCard: "#141414",
    bgElevated: "#1a1a1a",
    border: "#262626",
    text: "#ededed",
    textMuted: "#8b8b96",
    accent: "#e0ff4f",
    accentInk: "#0c0c0c",
    danger: "#ff6b6b",
};
// Small inline catalog covering the marketplace slugs most users will
// land on out of the box. The sidecar's full 80-theme catalog can
// override any of these via `applyTheme()` once the user picks one.
const PRESETS = {
    anthropic: DEFAULT_DARK,
    linear: {
        ...DEFAULT_DARK,
        slug: "linear",
        accent: "#5e6ad2",
        accentInk: "#ffffff",
    },
    cursor: {
        ...DEFAULT_DARK,
        slug: "cursor",
        accent: "#7ee787",
        accentInk: "#0c0c0c",
    },
    "shadcn-default": {
        ...DEFAULT_DARK,
        slug: "shadcn-default",
        bg: "#09090b",
        bgCard: "#18181b",
        bgElevated: "#27272a",
        border: "#27272a",
        accent: "#fafafa",
        accentInk: "#09090b",
    },
};
function resolveTheme(slug) {
    if (!slug)
        return DEFAULT_DARK;
    const preset = PRESETS[slug];
    return preset ?? DEFAULT_DARK;
}
/**
 * Emit the canonical CSS variable block + a couple of utility classes
 * (`.mono-cap` for the demo's small-caps header style, `.eri-chip` for
 * the lime accent chip). Webviews paste this directly into their inline
 * <style> tag.
 */
function eriThemeCss(opts = {}) {
    const theme = opts.theme ?? DEFAULT_DARK;
    const selector = opts.selector ?? ":root";
    return `${selector} {
  color-scheme: ${theme.mode};
  --eri-bg: ${theme.bg};
  --eri-bg-card: ${theme.bgCard};
  --eri-bg-elevated: ${theme.bgElevated};
  --eri-border: ${theme.border};
  --eri-text: ${theme.text};
  --eri-text-muted: ${theme.textMuted};
  --eri-accent: ${theme.accent};
  --eri-accent-ink: ${theme.accentInk};
  --eri-danger: ${theme.danger};
  --eri-font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
}
.mono-cap {
  font-family: var(--eri-font-mono);
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--eri-text-muted);
}
.eri-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 8px;
  border-radius: 9999px;
  background: var(--eri-accent);
  color: var(--eri-accent-ink);
  font-size: 11px;
  font-weight: 500;
}
.eri-gaze-ring {
  position: absolute;
  pointer-events: none;
  border: 2px solid var(--eri-accent);
  border-radius: 999px;
  box-shadow: 0 0 12px var(--eri-accent);
  transition: transform 90ms ease-out, opacity 200ms ease-out;
}`;
}
exports.DEFAULT_THEME = DEFAULT_DARK;
//# sourceMappingURL=eriTheme.js.map