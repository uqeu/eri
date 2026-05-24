// Smoke-test the catalog shape so a typo at edit time doesn't ship a broken
// preset that crashes the installer.

import { strict as assert } from "node:assert";
import {
  CATEGORY_ORDER,
  getPreset,
  MCP_PRESETS,
  RECOMMENDED_SAFE_DEFAULTS,
  visiblePresets,
} from "../catalog";

function testEveryPresetHasRequiredFields(): void {
  for (const preset of MCP_PRESETS) {
    assert.ok(preset.id.length > 0, `preset missing id: ${JSON.stringify(preset)}`);
    assert.ok(preset.displayName.length > 0, `preset ${preset.id} missing displayName`);
    assert.ok(preset.description.length > 0, `preset ${preset.id} missing description`);
    assert.ok(preset.command.length > 0, `preset ${preset.id} missing command`);
    assert.ok(Array.isArray(preset.args), `preset ${preset.id} args not array`);
    assert.ok(
      CATEGORY_ORDER.includes(preset.category),
      `preset ${preset.id} has unknown category ${preset.category}`,
    );
    assert.ok(
      preset.transport === "stdio" || preset.transport === "http",
      `preset ${preset.id} has unknown transport ${preset.transport}`,
    );
  }
}

function testNoDuplicateIds(): void {
  const seen = new Set<string>();
  for (const preset of MCP_PRESETS) {
    assert.ok(!seen.has(preset.id), `duplicate preset id: ${preset.id}`);
    seen.add(preset.id);
  }
}

function testRecommendedDefaultsExistAndAreKeyless(): void {
  for (const id of RECOMMENDED_SAFE_DEFAULTS) {
    const preset = getPreset(id);
    assert.ok(preset, `recommended preset ${id} not found in catalog`);
    assert.equal(preset.deprecated, undefined, `recommended ${id} is deprecated`);
    const secretEnv = preset.requiredEnv.filter((envVar) => envVar.secret);
    assert.equal(
      secretEnv.length,
      0,
      `recommended ${id} requires secrets — must be keyless`,
    );
  }
}

function testVisiblePresetsHidesBetaByDefault(): void {
  const stable = visiblePresets({ includeBeta: false });
  for (const preset of stable) {
    assert.notEqual(preset.beta, true, `${preset.id} is beta but visible`);
    assert.notEqual(preset.deprecated, true, `${preset.id} is deprecated but visible`);
  }
  const withBeta = visiblePresets({ includeBeta: true });
  assert.ok(
    withBeta.length >= stable.length,
    "includeBeta=true should not hide anything stable",
  );
}

function main(): void {
  testEveryPresetHasRequiredFields();
  testNoDuplicateIds();
  testRecommendedDefaultsExistAndAreKeyless();
  testVisiblePresetsHidesBetaByDefault();
  console.log("catalog.test ok");
}

main();
