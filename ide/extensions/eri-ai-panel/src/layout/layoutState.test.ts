// Pure-function tests for layout state normalization.
// Runs without a test runner: `node out/layout/layoutState.test.js`.

import { strict as assert } from "node:assert";
import {
  DEFAULT_LAYOUT_STATE,
  normalizeLayout,
  resolvePreviewSurface,
  toggleMode,
} from "./layoutState";

function testNormalizeCoercesUnknownValuesToDefaults(): void {
  const state = normalizeLayout({
    mode: "nope",
    chatPosition: 17,
    explorerHiddenInEriMode: "yes",
    previewSurface: undefined,
    themeSlug: "",
  });
  assert.equal(state.mode, DEFAULT_LAYOUT_STATE.mode);
  assert.equal(state.chatPosition, DEFAULT_LAYOUT_STATE.chatPosition);
  assert.equal(state.explorerHiddenInEriMode, DEFAULT_LAYOUT_STATE.explorerHiddenInEriMode);
  assert.equal(state.previewSurface, DEFAULT_LAYOUT_STATE.previewSurface);
  assert.equal(state.themeSlug, DEFAULT_LAYOUT_STATE.themeSlug);
}

function testNormalizeAcceptsValidValues(): void {
  const state = normalizeLayout({
    mode: "eri",
    chatPosition: "bottom",
    explorerHiddenInEriMode: false,
    previewSurface: "webview",
    themeSlug: "linear",
  });
  assert.equal(state.mode, "eri");
  assert.equal(state.chatPosition, "bottom");
  assert.equal(state.explorerHiddenInEriMode, false);
  assert.equal(state.previewSurface, "webview");
  assert.equal(state.themeSlug, "linear");
}

function testResolvePreviewSurfaceAuto(): void {
  // auto → swift in coder mode, webview in eri mode
  assert.equal(
    resolvePreviewSurface({ ...DEFAULT_LAYOUT_STATE, previewSurface: "auto", mode: "coder" }),
    "swift",
  );
  assert.equal(
    resolvePreviewSurface({ ...DEFAULT_LAYOUT_STATE, previewSurface: "auto", mode: "eri" }),
    "webview",
  );
}

function testResolvePreviewSurfaceExplicitOverride(): void {
  // Explicit overrides win even if the mode would have chosen the other surface.
  assert.equal(
    resolvePreviewSurface({ ...DEFAULT_LAYOUT_STATE, previewSurface: "swift", mode: "eri" }),
    "swift",
  );
  assert.equal(
    resolvePreviewSurface({ ...DEFAULT_LAYOUT_STATE, previewSurface: "webview", mode: "coder" }),
    "webview",
  );
}

function testToggleMode(): void {
  const a = toggleMode(DEFAULT_LAYOUT_STATE);
  assert.equal(a.mode, "eri");
  const b = toggleMode(a);
  assert.equal(b.mode, "coder");
}

function run(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (err) {
    console.error(`fail ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

run("normalize coerces unknown values to defaults", testNormalizeCoercesUnknownValuesToDefaults);
run("normalize accepts valid values", testNormalizeAcceptsValidValues);
run("resolvePreviewSurface auto picks per mode", testResolvePreviewSurfaceAuto);
run("resolvePreviewSurface honours explicit override", testResolvePreviewSurfaceExplicitOverride);
run("toggleMode flips between coder and eri", testToggleMode);
