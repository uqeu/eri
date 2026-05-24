"use strict";
// Maintains the state of slider/color-picker tweaks the user has made to the
// currently picked element. Each tweak is keyed by CSS property name. The
// final apply-to-source bundle is constructed from this map.
//
// Property metadata (default value, unit, slider range) lives in PROPERTY_META
// so the webview can render the right control without duplicating constants.
Object.defineProperty(exports, "__esModule", { value: true });
exports.TweakStore = exports.PROPERTY_META = void 0;
exports.sliderValueToCss = sliderValueToCss;
exports.normalizeColor = normalizeColor;
exports.PROPERTY_META = [
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
// Pure: turn a numeric slider value + property meta into the CSS string that
// the iframe shim should set on the picked element. Centralized here so the
// formatting (units, clamping) is testable.
function sliderValueToCss(meta, raw) {
    if (meta.control !== "slider") {
        throw new Error(`property ${meta.property} is not a slider control`);
    }
    const min = meta.min ?? 0;
    const max = meta.max ?? 9999;
    const clamped = Math.max(min, Math.min(max, raw));
    const unit = meta.unit ?? "";
    // Slider values are integers - avoid fractional formatting noise.
    return `${Math.round(clamped)}${unit}`;
}
// Pure: validate + normalize a hex color from the color-picker input. Returns
// null if the input is malformed so the caller can ignore it.
function normalizeColor(value) {
    const trimmed = value.trim().toLowerCase();
    if (/^#[0-9a-f]{6}$/.test(trimmed)) {
        return trimmed;
    }
    if (/^#[0-9a-f]{3}$/.test(trimmed)) {
        // Expand short-form #abc to #aabbcc.
        return `#${trimmed[1]}${trimmed[1]}${trimmed[2]}${trimmed[2]}${trimmed[3]}${trimmed[3]}`;
    }
    return null;
}
class TweakStore {
    tweaks = new Map();
    list() {
        return Array.from(this.tweaks.values());
    }
    set(tweak) {
        this.tweaks.set(tweak.property, tweak);
    }
    setMany(entries) {
        for (const entry of entries) {
            this.tweaks.set(entry.property, entry);
        }
    }
    get(property) {
        return this.tweaks.get(property);
    }
    remove(property) {
        this.tweaks.delete(property);
    }
    clear() {
        this.tweaks.clear();
    }
    // Render the current tweaks as a CSS rule body, e.g.:
    //   color: #ef4444;
    //   font-size: 20px;
    // Used by applyToSource when bundling the change for chat.
    toCssBody(indent = "  ") {
        return this.list()
            .map((t) => `${indent}${t.property}: ${t.value};`)
            .join("\n");
    }
    // JSON representation - inserted into chat as a structured block so the
    // diffusion model has the exact property/value pairs.
    toJson() {
        const out = {};
        for (const tweak of this.list()) {
            out[tweak.property] = tweak.value;
        }
        return out;
    }
}
exports.TweakStore = TweakStore;
//# sourceMappingURL=styleTweaker.js.map