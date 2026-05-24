// Unit tests for the visual-editor voice intent vocabulary. Runs via:
//   node out/visualEditor/__tests__/intentVocab.test.js

import { strict as assert } from "node:assert";
import { applyRelative, matchIntent } from "../intentVocab";

function testColorIntent(): void {
  const result = matchIntent("make this red");
  assert.equal(result.kind, "direct");
  if (result.kind === "direct") {
    assert.deepEqual(result.styles, { color: "#ef4444" });
  }
}

function testBackgroundIntent(): void {
  const result = matchIntent("set the background blue");
  assert.equal(result.kind, "direct");
  if (result.kind === "direct") {
    assert.deepEqual(result.styles, { background: "#3b82f6" });
  }
}

function testRelativeBiggerIntent(): void {
  const result = matchIntent("make it bigger");
  assert.equal(result.kind, "relative");
  if (result.kind === "relative") {
    assert.equal(result.property, "font-size");
    assert.equal(result.delta, 4);
    assert.equal(result.unit, "px");
  }
}

function testLayoutCenterIntent(): void {
  const result = matchIntent("center this");
  assert.equal(result.kind, "layout");
  if (result.kind === "layout") {
    assert.equal(result.styles["justify-content"], "center");
    assert.equal(result.styles["align-items"], "center");
    assert.equal(result.styles["display"], "flex");
  }
}

function testShadowIntent(): void {
  const result = matchIntent("add a shadow please");
  assert.equal(result.kind, "direct");
  if (result.kind === "direct") {
    assert.ok(result.styles["box-shadow"]);
    assert.notEqual(result.styles["box-shadow"], "none");
  }
}

function testNoMatch(): void {
  const result = matchIntent("refactor the auth flow to use jwt");
  assert.equal(result.kind, "none");
}

function testApplyRelativeAdds(): void {
  const intent = {
    kind: "relative" as const,
    property: "font-size",
    delta: 4,
    unit: "px",
    phrase: "bigger",
  };
  assert.equal(applyRelative(intent, "16px"), "20px");
}

function testApplyRelativeClampsToZero(): void {
  const intent = {
    kind: "relative" as const,
    property: "padding",
    delta: -8,
    unit: "px",
    phrase: "less padding",
  };
  assert.equal(applyRelative(intent, "4px"), "0px");
}

function testApplyRelativeRejectsNonPx(): void {
  const intent = {
    kind: "relative" as const,
    property: "width",
    delta: 40,
    unit: "px",
    phrase: "wider",
  };
  assert.equal(applyRelative(intent, "auto"), null);
}

function testColorWithoutTriggerDoesNotMatch(): void {
  // Just mentioning "red" shouldn't fire - needs a "make/color/turn" trigger.
  const result = matchIntent("the red border looks fine");
  assert.equal(result.kind, "none");
}

function run(): void {
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
