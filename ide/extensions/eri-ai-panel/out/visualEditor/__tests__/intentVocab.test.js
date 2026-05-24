"use strict";
// Unit tests for the visual-editor voice intent vocabulary. Runs via:
//   node out/visualEditor/__tests__/intentVocab.test.js
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = require("node:assert");
const intentVocab_1 = require("../intentVocab");
function testColorIntent() {
    const result = (0, intentVocab_1.matchIntent)("make this red");
    node_assert_1.strict.equal(result.kind, "direct");
    if (result.kind === "direct") {
        node_assert_1.strict.deepEqual(result.styles, { color: "#ef4444" });
    }
}
function testBackgroundIntent() {
    const result = (0, intentVocab_1.matchIntent)("set the background blue");
    node_assert_1.strict.equal(result.kind, "direct");
    if (result.kind === "direct") {
        node_assert_1.strict.deepEqual(result.styles, { background: "#3b82f6" });
    }
}
function testRelativeBiggerIntent() {
    const result = (0, intentVocab_1.matchIntent)("make it bigger");
    node_assert_1.strict.equal(result.kind, "relative");
    if (result.kind === "relative") {
        node_assert_1.strict.equal(result.property, "font-size");
        node_assert_1.strict.equal(result.delta, 4);
        node_assert_1.strict.equal(result.unit, "px");
    }
}
function testLayoutCenterIntent() {
    const result = (0, intentVocab_1.matchIntent)("center this");
    node_assert_1.strict.equal(result.kind, "layout");
    if (result.kind === "layout") {
        node_assert_1.strict.equal(result.styles["justify-content"], "center");
        node_assert_1.strict.equal(result.styles["align-items"], "center");
        node_assert_1.strict.equal(result.styles["display"], "flex");
    }
}
function testShadowIntent() {
    const result = (0, intentVocab_1.matchIntent)("add a shadow please");
    node_assert_1.strict.equal(result.kind, "direct");
    if (result.kind === "direct") {
        node_assert_1.strict.ok(result.styles["box-shadow"]);
        node_assert_1.strict.notEqual(result.styles["box-shadow"], "none");
    }
}
function testNoMatch() {
    const result = (0, intentVocab_1.matchIntent)("refactor the auth flow to use jwt");
    node_assert_1.strict.equal(result.kind, "none");
}
function testApplyRelativeAdds() {
    const intent = {
        kind: "relative",
        property: "font-size",
        delta: 4,
        unit: "px",
        phrase: "bigger",
    };
    node_assert_1.strict.equal((0, intentVocab_1.applyRelative)(intent, "16px"), "20px");
}
function testApplyRelativeClampsToZero() {
    const intent = {
        kind: "relative",
        property: "padding",
        delta: -8,
        unit: "px",
        phrase: "less padding",
    };
    node_assert_1.strict.equal((0, intentVocab_1.applyRelative)(intent, "4px"), "0px");
}
function testApplyRelativeRejectsNonPx() {
    const intent = {
        kind: "relative",
        property: "width",
        delta: 40,
        unit: "px",
        phrase: "wider",
    };
    node_assert_1.strict.equal((0, intentVocab_1.applyRelative)(intent, "auto"), null);
}
function testColorWithoutTriggerDoesNotMatch() {
    // Just mentioning "red" shouldn't fire - needs a "make/color/turn" trigger.
    const result = (0, intentVocab_1.matchIntent)("the red border looks fine");
    node_assert_1.strict.equal(result.kind, "none");
}
function run() {
    testColorIntent();
    testBackgroundIntent();
    testRelativeBiggerIntent();
    testLayoutCenterIntent();
    testShadowIntent();
    testNoMatch();
    testApplyRelativeAdds();
    testApplyRelativeClampsToZero();
    testApplyRelativeRejectsNonPx();
    testColorWithoutTriggerDoesNotMatch();
    process.stdout.write("intentVocab.test.ts: 10 cases passed\n");
}
run();
//# sourceMappingURL=intentVocab.test.js.map