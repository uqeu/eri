"use strict";
// Phrase to style mapping for the Visual Editor voice intents. Kept as a
// small hardcoded vocabulary; the agent (chat) handles long-tail intents.
//
// Two flavors of matches:
//   * direct  - a concrete CSS property change to apply inline immediately
//   * layout  - a layout hint (display/flex/justify) for the picked element
//
// The matcher is intentionally simple (regex-free, lowercased substring
// matches) so tests can pin the exact phrases that route to each branch.
Object.defineProperty(exports, "__esModule", { value: true });
exports.matchIntent = matchIntent;
exports.applyRelative = applyRelative;
// Single-color mapping; kept tiny on purpose - anything fancier (color names
// like "fuchsia", "tangerine") is relayed to chat instead of guessed at.
const COLOR_MAP = {
    red: "#ef4444",
    green: "#22c55e",
    blue: "#3b82f6",
    yellow: "#eab308",
    orange: "#f97316",
    purple: "#a855f7",
    pink: "#ec4899",
    black: "#000000",
    white: "#ffffff",
    gray: "#6b7280",
    grey: "#6b7280",
};
const DIRECT_RULES = [
    { match: ["add a shadow", "add shadow", "give it a shadow"], styles: { "box-shadow": "0 8px 24px rgba(0,0,0,0.18)" } },
    { match: ["remove shadow", "no shadow"], styles: { "box-shadow": "none" } },
    { match: ["rounder", "round it", "round the corners", "more rounded"], styles: { "border-radius": "12px" } },
    { match: ["very round", "fully round", "make it a circle", "make it round"], styles: { "border-radius": "9999px" } },
    { match: ["square corners", "sharp corners", "no border radius"], styles: { "border-radius": "0" } },
    { match: ["bold"], styles: { "font-weight": "700" } },
    { match: ["thin", "lighter weight"], styles: { "font-weight": "300" } },
    { match: ["italic"], styles: { "font-style": "italic" } },
    { match: ["underline"], styles: { "text-decoration": "underline" } },
    { match: ["transparent", "see-through"], styles: { opacity: "0.5" } },
    { match: ["opaque", "solid"], styles: { opacity: "1" } },
    { match: ["hide it", "hide this"], styles: { display: "none" } },
];
const LAYOUT_RULES = [
    { match: ["stack vertically", "stack vertical", "vertical stack", "column layout"], styles: { display: "flex", "flex-direction": "column", gap: "8px" } },
    { match: ["stack horizontally", "horizontal stack", "row layout", "side by side"], styles: { display: "flex", "flex-direction": "row", gap: "8px" } },
    { match: ["center this", "center it", "center horizontally"], styles: { display: "flex", "justify-content": "center", "align-items": "center" } },
    { match: ["align right", "right align"], styles: { display: "flex", "justify-content": "flex-end" } },
    { match: ["align left", "left align"], styles: { display: "flex", "justify-content": "flex-start" } },
    { match: ["space between"], styles: { display: "flex", "justify-content": "space-between" } },
];
const RELATIVE_RULES = [
    { match: ["bigger", "larger", "make it big"], property: "font-size", delta: 4, unit: "px" },
    { match: ["smaller", "make it small"], property: "font-size", delta: -4, unit: "px" },
    { match: ["wider"], property: "width", delta: 40, unit: "px" },
    { match: ["narrower"], property: "width", delta: -40, unit: "px" },
    { match: ["taller"], property: "height", delta: 20, unit: "px" },
    { match: ["shorter"], property: "height", delta: -20, unit: "px" },
    { match: ["more padding", "add padding"], property: "padding", delta: 8, unit: "px" },
    { match: ["less padding"], property: "padding", delta: -8, unit: "px" },
    { match: ["more margin"], property: "margin", delta: 8, unit: "px" },
    { match: ["less margin"], property: "margin", delta: -8, unit: "px" },
];
// Resolve a voice transcript into an actionable intent. Returns { kind: "none" }
// if nothing matches - the caller should relay to chat in that case.
function matchIntent(transcript) {
    const normalized = transcript.trim().toLowerCase();
    if (normalized.length === 0) {
        return { kind: "none" };
    }
    const backgroundResult = matchBackgroundIntent(normalized);
    if (backgroundResult) {
        return backgroundResult;
    }
    const colorResult = matchColorIntent(normalized);
    if (colorResult) {
        return colorResult;
    }
    for (const rule of DIRECT_RULES) {
        for (const phrase of rule.match) {
            if (normalized.includes(phrase)) {
                return { kind: "direct", styles: rule.styles, phrase };
            }
        }
    }
    for (const rule of LAYOUT_RULES) {
        for (const phrase of rule.match) {
            if (normalized.includes(phrase)) {
                return { kind: "layout", styles: rule.styles, phrase };
            }
        }
    }
    for (const rule of RELATIVE_RULES) {
        for (const phrase of rule.match) {
            if (normalized.includes(phrase)) {
                return {
                    kind: "relative",
                    property: rule.property,
                    delta: rule.delta,
                    unit: rule.unit,
                    phrase,
                };
            }
        }
    }
    return { kind: "none" };
}
function matchColorIntent(normalized) {
    // Only "make/color/turn ... <color>" - avoids accidentally interpreting
    // a stray "red" mid-sentence as a color command.
    const triggers = ["make this", "make it", "color it", "turn it", "color this", "turn this"];
    const triggered = triggers.some((t) => normalized.includes(t));
    if (!triggered) {
        return null;
    }
    for (const [name, hex] of Object.entries(COLOR_MAP)) {
        if (containsWord(normalized, name)) {
            return { kind: "direct", styles: { color: hex }, phrase: `make this ${name}` };
        }
    }
    return null;
}
function matchBackgroundIntent(normalized) {
    const triggers = ["background", "bg "];
    if (!triggers.some((t) => normalized.includes(t))) {
        return null;
    }
    for (const [name, hex] of Object.entries(COLOR_MAP)) {
        if (containsWord(normalized, name)) {
            return {
                kind: "direct",
                styles: { background: hex },
                phrase: `background ${name}`,
            };
        }
    }
    return null;
}
function containsWord(haystack, word) {
    const idx = haystack.indexOf(word);
    if (idx === -1) {
        return false;
    }
    const before = idx === 0 ? " " : haystack[idx - 1];
    const after = idx + word.length >= haystack.length ? " " : haystack[idx + word.length];
    return !/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after);
}
// Apply a RelativeIntent against the picked element's currently-known computed
// styles. Returns the resulting absolute CSS declaration (e.g. "20px") or null
// if the base value cannot be parsed.
function applyRelative(intent, baseValue) {
    const parsed = parseLengthPx(baseValue);
    if (parsed === null) {
        return null;
    }
    const next = Math.max(0, parsed + intent.delta);
    return `${next}${intent.unit}`;
}
function parseLengthPx(value) {
    if (!value) {
        return null;
    }
    const match = /^(-?\d+(?:\.\d+)?)px$/.exec(value.trim());
    if (!match) {
        return null;
    }
    const n = Number(match[1]);
    return Number.isFinite(n) ? n : null;
}
//# sourceMappingURL=intentVocab.js.map