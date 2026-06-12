import { describe, it, expect } from "vitest";
import {
  MODES,
  dimensionsFor,
  nextMode,
  CONTROL_FACETS,
  advanceFacet,
  BUILD,
  TIMELINE,
  HOLD_MS,
  firstSlideOf,
  CAPTION,
} from "./morph";

describe("morph modes", () => {
  it("has exactly two top-level modes, control then build", () => {
    expect(MODES).toEqual(["control", "build"]);
  });

  it("nextMode toggles between the two modes (total over MODES)", () => {
    expect(nextMode("control")).toBe("build");
    expect(nextMode("build")).toBe("control");
    for (const m of MODES) expect(MODES).toContain(nextMode(m));
  });

  it("build morphs DRAMATICALLY larger than control in both dimensions", () => {
    const control = dimensionsFor("control");
    const build = dimensionsFor("build");
    // The whole point of the morph: Build is the massive IDE, Control is compact.
    expect(build.maxWidth).toBeGreaterThan(control.maxWidth * 1.6);
    expect(build.minHeight).toBeGreaterThan(control.minHeight * 1.6);
  });
});

describe("control facets (research / eyes / voice folded into Control)", () => {
  it("has rotating facets, each a real request->answer beat", () => {
    expect(CONTROL_FACETS.length).toBeGreaterThanOrEqual(3);
    for (const f of CONTROL_FACETS) {
      expect(f.request.length).toBeGreaterThan(0);
      expect(f.answer.length).toBeGreaterThan(0);
      expect(f.actions.length).toBeGreaterThan(0);
    }
  });

  it("covers the folded-in capabilities: act, ask (research+eyes), voice", () => {
    const kinds = new Set(CONTROL_FACETS.map((f) => f.kind));
    expect(kinds.has("act")).toBe(true);
    expect(kinds.has("ask")).toBe(true);
    expect(kinds.has("voice")).toBe(true);
  });

  it("advanceFacet wraps around the ring", () => {
    expect(advanceFacet(0)).toBe(1);
    expect(advanceFacet(CONTROL_FACETS.length - 1)).toBe(0);
  });

  it("never reveals an underlying model name (brand guardrail)", () => {
    const banned = /\b(claude|gpt|gemini|qwen|llama|anthropic|openai|mercury)\b/i;
    for (const f of CONTROL_FACETS) {
      expect(banned.test(f.request)).toBe(false);
      expect(banned.test(f.answer)).toBe(false);
      if (f.note) expect(banned.test(f.note)).toBe(false);
    }
  });
});

describe("build scene", () => {
  it("describes a real IDE: a file tree, an open file with code, a preview, a test result", () => {
    expect(BUILD.files.length).toBeGreaterThanOrEqual(3);
    expect(BUILD.activeFile.length).toBeGreaterThan(0);
    expect(BUILD.code.length).toBeGreaterThan(3); // multi-line, not a 3-line stub
    expect(BUILD.tests).toMatch(/pass/i);
    expect(BUILD.preview.length).toBeGreaterThan(0);
  });

  it("never reveals an underlying model name (brand guardrail)", () => {
    const banned = /\b(claude|gpt|gemini|qwen|llama|anthropic|openai|mercury)\b/i;
    expect(banned.test(BUILD.request)).toBe(false);
    expect(banned.test(BUILD.code.map((l) => l.text).join("\n"))).toBe(false);
  });
});

describe("autoplay timeline", () => {
  it("interleaves Control beats with the Build showpiece, both present", () => {
    const modes = new Set(TIMELINE.map((s) => s.mode));
    expect(modes.has("control")).toBe(true);
    expect(modes.has("build")).toBe(true);
    // every control slide points at a real facet
    for (const s of TIMELINE) {
      if (s.mode === "control") {
        expect(s.facet).toBeGreaterThanOrEqual(0);
        expect(s.facet).toBeLessThan(CONTROL_FACETS.length);
      }
    }
  });

  it("Build holds longer than Control (more to read)", () => {
    expect(HOLD_MS.build).toBeGreaterThan(HOLD_MS.control);
  });

  it("firstSlideOf finds the first slide of each mode", () => {
    expect(TIMELINE[firstSlideOf("control")].mode).toBe("control");
    expect(TIMELINE[firstSlideOf("build")].mode).toBe("build");
  });

  it("has a caption for each mode, model-name free", () => {
    const banned = /\b(claude|gpt|gemini|qwen|llama|anthropic|openai|mercury)\b/i;
    for (const m of MODES) {
      expect(CAPTION[m].length).toBeGreaterThan(0);
      expect(banned.test(CAPTION[m])).toBe(false);
    }
  });
});
