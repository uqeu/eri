"use strict";
// Pure-function tests for the shared theme tokens.
// Runs without a test runner: `node out/theme/eriTheme.test.js`.
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = require("node:assert");
const eriTheme_1 = require("./eriTheme");
function testUnknownSlugFallsBackToDefault() {
    const theme = (0, eriTheme_1.resolveTheme)("not-a-real-theme");
    node_assert_1.strict.equal(theme, eriTheme_1.DEFAULT_THEME);
}
function testKnownSlugsResolve() {
    node_assert_1.strict.equal((0, eriTheme_1.resolveTheme)("linear").accent, "#5e6ad2");
    node_assert_1.strict.equal((0, eriTheme_1.resolveTheme)("cursor").accent, "#7ee787");
    node_assert_1.strict.equal((0, eriTheme_1.resolveTheme)("shadcn-default").bg, "#09090b");
}
function testDefaultSelectorIsRoot() {
    node_assert_1.strict.ok((0, eriTheme_1.eriThemeCss)().includes(":root {"));
    const scoped = (0, eriTheme_1.eriThemeCss)({ selector: ".eri-scope" });
    node_assert_1.strict.ok(scoped.includes(".eri-scope {"));
    node_assert_1.strict.ok(!scoped.includes(":root {"));
}
function testCanonicalVariablesPresent() {
    const css = (0, eriTheme_1.eriThemeCss)();
    const required = [
        "--eri-bg",
        "--eri-bg-card",
        "--eri-bg-elevated",
        "--eri-border",
        "--eri-text",
        "--eri-text-muted",
        "--eri-accent",
        "--eri-accent-ink",
        "--eri-danger",
        "--eri-font-mono",
    ];
    for (const key of required) {
        node_assert_1.strict.ok(css.includes(key), `expected css to include ${key}`);
    }
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
run("unknown slug falls back to default", testUnknownSlugFallsBackToDefault);
run("known slugs resolve", testKnownSlugsResolve);
run("default selector is :root", testDefaultSelectorIsRoot);
run("canonical variables are present", testCanonicalVariablesPresent);
//# sourceMappingURL=eriTheme.test.js.map