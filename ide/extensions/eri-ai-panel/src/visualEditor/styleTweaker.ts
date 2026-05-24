// Maintains the state of slider/color-picker tweaks the user has made to the
// currently picked element. Each tweak is keyed by CSS property name. The
// final apply-to-source bundle is constructed from this map.
//
// Property metadata (default value, unit, slider range) lives in PROPERTY_META
// so the webview can render the right control without duplicating constants.

export type TweakValueSource = "slider" | "color" | "voice" | "manual";

export interface Tweak {
  readonly property: string;
  readonly value: string;
  readonly source: TweakValueSource;
}

export interface PropertyMeta {
  readonly property: string;
  readonly label: string;
  readonly control: "slider" | "color";
  readonly unit?: string;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly defaultNumber?: number;
  readonly defaultColor?: string;
}

export const PROPERTY_META: ReadonlyArray<PropertyMeta> = [
  { property: "width",         label: "Width",         control: "slider", unit: "px", min: 0,   max: 1200, step: 1,  defaultNumber: 320 },
  { property: "height",        label: "Height",        control: "slider", unit: "px", min: 0,   max: 1200, step: 1,  defaultNumber: 200 },
  { property: "padding",       label: "Padding",       control: "slider", unit: "px", min: 0,   max: 96,   step: 1,  defaultNumber: 8 },
  { property: "margin",        label: "Margin",        control: "slider", unit: "px", min: 0,   max: 96,   step: 1,  defaultNumber: 0 },
  { property: "font-size",     label: "Font size",     control: "slider", unit: "px", min: 8,   max: 96,   step: 1,  defaultNumber: 16 },
  { property: "border-radius", label: "Radius",        control: "slider", unit: "px", min: 0,   max: 64,   step: 1,  defaultNumber: 0 },
  { property: "color",         label: "Text color",    control: "color",                                            defaultColor: "#e6edf3" },
  { property: "background",    label: "Background",    control: "color",                                            defaultColor: "#1f1f24" },
  { property: "border-color",  label: "Border color",  control: "color",                                            defaultColor: "#33373e" },
];

// Pure: turn a numeric slider value + property meta into the CSS string that
// the iframe shim should set on the picked element. Centralized here so the
// formatting (units, clamping) is testable.
export function sliderValueToCss(meta: PropertyMeta, raw: number): string {
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
export function normalizeColor(value: string): string | null {
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

export class TweakStore {
  private tweaks = new Map<string, Tweak>();

  list(): ReadonlyArray<Tweak> {
    return Array.from(this.tweaks.values());
  }

  set(tweak: Tweak): void {
    this.tweaks.set(tweak.property, tweak);
  }

  setMany(entries: ReadonlyArray<Tweak>): void {
    for (const entry of entries) {
      this.tweaks.set(entry.property, entry);
    }
  }

  get(property: string): Tweak | undefined {
    return this.tweaks.get(property);
  }

  remove(property: string): void {
    this.tweaks.delete(property);
  }

  clear(): void {
    this.tweaks.clear();
  }

  // Render the current tweaks as a CSS rule body, e.g.:
  //   color: #ef4444;
  //   font-size: 20px;
  // Used by applyToSource when bundling the change for chat.
  toCssBody(indent: string = "  "): string {
    return this.list()
      .map((t) => `${indent}${t.property}: ${t.value};`)
      .join("\n");
  }

  // JSON representation - inserted into chat as a structured block so the
  // diffusion model has the exact property/value pairs.
  toJson(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const tweak of this.list()) {
      out[tweak.property] = tweak.value;
    }
    return out;
  }
}
