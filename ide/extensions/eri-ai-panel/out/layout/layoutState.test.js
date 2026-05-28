"use strict";
// Pure-function tests for layout state normalization.
// Runs without a test runner: `node out/layout/layoutState.test.js`.
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = require("node:assert");
const layoutState_1 = require("./layoutState");
function testNormalizeCoercesUnknownValuesToDefaults() {
    const state = (0, layoutState_1.normalizeLayout)({
        mode: "nope",
        chatPosition: 17,
        explorerHiddenInEriMode: "yes",
        previewSurface: undefined,
        themeSlug: "",
    });
    node_assert_1.strict.equal(state.mode, layoutState_1.DEFAULT_LAYOUT_STATE.mode);
    node_assert_1.strict.equal(state.chatPosition, layoutState_1.DEFAULT_LAYOUT_STATE.chatPosition);
    node_assert_1.strict.equal(state.explorerHiddenInEriMode, layoutState_1.DEFAULT_LAYOUT_STATE.explorerHiddenInEriMode);
    node_assert_1.strict.equal(state.previewSurface, layoutState_1.DEFAULT_LAYOUT_STATE.previewSurface);
    node_assert_1.strict.equal(state.themeSlug, layoutState_1.DEFAULT_LAYOUT_STATE.themeSlug);
}
function testNormalizeAcceptsValidValues() {
    const state = (0, layoutState_1.normalizeLayout)({
        mode: "eri",
        chatPosition: "bottom",
        explorerHiddenInEriMode: false,
        previewSurface: "webview",
        themeSlug: "linear",
    });
    node_assert_1.strict.equal(state.mode, "eri");
    node_assert_1.strict.equal(state.chatPosition, "bottom");
    node_assert_1.strict.equal(state.explorerHiddenInEriMode, false);
    node_assert_1.strict.equal(state.previewSurface, "webview");
    node_assert_1.strict.equal(state.themeSlug, "linear");
}
function testResolvePreviewSurfaceAuto() {
    // auto → swift in coder mode, webview in eri mode
    node_assert_1.strict.equal((0, layoutState_1.resolvePreviewSurface)({ ...layoutState_1.DEFAULT_LAYOUT_STATE, previewSurface: "auto", mode: "coder" }), "swift");
    node_assert_1.strict.equal((0, layoutState_1.resolvePreviewSurface)({ ...layoutState_1.DEFAULT_LAYOUT_STATE, previewSurface: "auto", mode: "eri" }), "webview");
}
function testResolvePreviewSurfaceExplicitOverride() {
    // Explicit overrides win even if the mode would have chosen the other surface.
    node_assert_1.strict.equal((0, layoutState_1.resolvePreviewSurface)({ ...layoutState_1.DEFAULT_LAYOUT_STATE, previewSurface: "swift", mode: "eri" }), "swift");
    node_assert_1.strict.equal((0, layoutState_1.resolvePreviewSurface)({ ...layoutState_1.DEFAULT_LAYOUT_STATE, previewSurface: "webview", mode: "coder" }), "webview");
}
function testToggleMode() {
    const a = (0, layoutState_1.toggleMode)(layoutState_1.DEFAULT_LAYOUT_STATE);
    node_assert_1.strict.equal(a.mode, "eri");
    const b = (0, layoutState_1.toggleMode)(a);
    node_assert_1.strict.equal(b.mode, "coder");
}
function run(name, fn) {
    try {
        fn();
        console.log(`ok ${name}`);
    }
    catch (err) {
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
//# sourceMappingURL=layoutState.test.js.map