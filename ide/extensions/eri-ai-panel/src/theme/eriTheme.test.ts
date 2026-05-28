// Pure-function tests for the shared theme tokens.
// Runs without a test runner: `node out/theme/eriTheme.test.js`.

import { strict as assert } from "node:assert";
import { DEFAULT_THEME, eriThemeCss, resolveTheme } from "./eriTheme";

function testUnknownSlugFallsBackToDefault(): void {
  const theme = resolveTheme("not-a-real-theme");
  assert.equal(theme, DEFAULT_THEME);
}

function testKnownSlugsResolve(): void {
  assert.equal(resolveTheme("linear").accent, "#5e6ad2");
  assert.equal(resolveTheme("cursor").accent, "#7ee787");
  assert.equal(resolveTheme("shadcn-default").bg, "#09090b");
}

function testDefaultSelectorIsRoot(): void {
  assert.ok(eriThemeCss().includes(":root {"));
  const scoped = eriThemeCss({ selector: ".eri-scope" });
  assert.ok(scoped.includes(".eri-scope {"));
  assert.ok(!scoped.includes(":root {"));
}

function testCanonicalVariablesPresent(): void {
  const css = eriThemeCss();
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
    assert.ok(css.includes(key), `expected css to include ${key}`);
  }
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

run("unknown slug falls back to default", testUnknownSlugFallsBackToDefault);
run("known slugs resolve", testKnownSlugsResolve);
run("default selector is :root", testDefaultSelectorIsRoot);
run("canonical variables are present", testCanonicalVariablesPresent);
