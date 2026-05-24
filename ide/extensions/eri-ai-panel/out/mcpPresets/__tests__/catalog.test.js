"use strict";
// Smoke-test the catalog shape so a typo at edit time doesn't ship a broken
// preset that crashes the installer.
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = require("node:assert");
const catalog_1 = require("../catalog");
function testEveryPresetHasRequiredFields() {
    for (const preset of catalog_1.MCP_PRESETS) {
        node_assert_1.strict.ok(preset.id.length > 0, `preset missing id: ${JSON.stringify(preset)}`);
        node_assert_1.strict.ok(preset.displayName.length > 0, `preset ${preset.id} missing displayName`);
        node_assert_1.strict.ok(preset.description.length > 0, `preset ${preset.id} missing description`);
        node_assert_1.strict.ok(preset.command.length > 0, `preset ${preset.id} missing command`);
        node_assert_1.strict.ok(Array.isArray(preset.args), `preset ${preset.id} args not array`);
        node_assert_1.strict.ok(catalog_1.CATEGORY_ORDER.includes(preset.category), `preset ${preset.id} has unknown category ${preset.category}`);
        node_assert_1.strict.ok(preset.transport === "stdio" || preset.transport === "http", `preset ${preset.id} has unknown transport ${preset.transport}`);
    }
}
function testNoDuplicateIds() {
    const seen = new Set();
    for (const preset of catalog_1.MCP_PRESETS) {
        node_assert_1.strict.ok(!seen.has(preset.id), `duplicate preset id: ${preset.id}`);
        seen.add(preset.id);
    }
}
function testRecommendedDefaultsExistAndAreKeyless() {
    for (const id of catalog_1.RECOMMENDED_SAFE_DEFAULTS) {
        const preset = (0, catalog_1.getPreset)(id);
        node_assert_1.strict.ok(preset, `recommended preset ${id} not found in catalog`);
        node_assert_1.strict.equal(preset.deprecated, undefined, `recommended ${id} is deprecated`);
        const secretEnv = preset.requiredEnv.filter((envVar) => envVar.secret);
        node_assert_1.strict.equal(secretEnv.length, 0, `recommended ${id} requires secrets — must be keyless`);
    }
}
function testVisiblePresetsHidesBetaByDefault() {
    const stable = (0, catalog_1.visiblePresets)({ includeBeta: false });
    for (const preset of stable) {
        node_assert_1.strict.notEqual(preset.beta, true, `${preset.id} is beta but visible`);
        node_assert_1.strict.notEqual(preset.deprecated, true, `${preset.id} is deprecated but visible`);
    }
    const withBeta = (0, catalog_1.visiblePresets)({ includeBeta: true });
    node_assert_1.strict.ok(withBeta.length >= stable.length, "includeBeta=true should not hide anything stable");
}
function main() {
    testEveryPresetHasRequiredFields();
    testNoDuplicateIds();
    testRecommendedDefaultsExistAndAreKeyless();
    testVisiblePresetsHidesBetaByDefault();
    console.log("catalog.test ok");
}
main();
//# sourceMappingURL=catalog.test.js.map