// Round-trip tests for the picker bridge protocol parsing.

import { strict as assert } from "node:assert";
import {
  PickedElement,
  SHIM_TAG,
  describeElement,
  parseWebviewMessage,
  unwrapShim,
  wrapShim,
} from "../pickerBridge";

function sampleElement(): PickedElement {
  return {
    tag: "button",
    id: "submit",
    classNames: ["btn", "btn-primary"],
    selector: "button.btn.btn-primary",
    bbox: { x: 10, y: 20, w: 120, h: 32 },
    computedStyles: {
      color: "rgb(255, 255, 255)",
      "background-color": "rgb(59, 130, 246)",
      "font-size": "14px",
    },
    innerText: "Submit",
  };
}

function testParseReadyMessage(): void {
  const result = parseWebviewMessage({ kind: "ready" });
  assert.deepEqual(result, { kind: "ready" });
}

function testParsePickResult(): void {
  const result = parseWebviewMessage({
    kind: "pickResult",
    element: sampleElement(),
  });
  assert.equal(result?.kind, "pickResult");
  if (result?.kind === "pickResult") {
    assert.equal(result.element.tag, "button");
    assert.equal(result.element.classNames.length, 2);
  }
}

function testParseRejectsMalformedPickResult(): void {
  // Missing tag / selector - should return null.
  const result = parseWebviewMessage({ kind: "pickResult", element: { id: "x" } });
  assert.equal(result, null);
}

function testParseRejectsUnknownKind(): void {
  assert.equal(parseWebviewMessage({ kind: "unknown" }), null);
  assert.equal(parseWebviewMessage(null), null);
  assert.equal(parseWebviewMessage("not an object"), null);
}

function testParseTweakChanged(): void {
  const result = parseWebviewMessage({
    kind: "tweakChanged",
    property: "color",
    value: "#ef4444",
  });
  assert.equal(result?.kind, "tweakChanged");
  if (result?.kind === "tweakChanged") {
    assert.equal(result.property, "color");
    assert.equal(result.value, "#ef4444");
  }
}

function testShimEnvelopeRoundTrip(): void {
  const envelope = wrapShim({ kind: "shimReady" });
  assert.equal(envelope.tag, SHIM_TAG);
  const parsed = unwrapShim(envelope);
  assert.equal(parsed?.kind, "shimReady");
}

function testUnwrapShimRejectsForeignEnvelope(): void {
  const result = unwrapShim({ tag: "other", payload: { kind: "shimReady" } });
  assert.equal(result, null);
}

function testUnwrapShimParsesPickResult(): void {
  const envelope = wrapShim({ kind: "pickResult", element: sampleElement() });
  const parsed = unwrapShim(envelope);
  assert.equal(parsed?.kind, "pickResult");
  if (parsed?.kind === "pickResult") {
    assert.equal(parsed.element.selector, "button.btn.btn-primary");
  }
}

function testDescribeElementProducesHeadingAndBody(): void {
  const { heading, body } = describeElement(sampleElement());
  assert.ok(heading.includes("@Element"));
  assert.ok(heading.includes("button"));
  assert.ok(heading.includes("#submit"));
  assert.ok(heading.includes(".btn.btn-primary"));
  assert.ok(body.includes("selector: button.btn.btn-primary"));
  assert.ok(body.includes("font-size: 14px"));
  assert.ok(body.includes("innerText:"));
  assert.ok(body.includes("Submit"));
}

function run(): void {
  testParseReadyMessage();
  testParsePickResult();
  testParseRejectsMalformedPickResult();
  testParseRejectsUnknownKind();
  testParseTweakChanged();
  testShimEnvelopeRoundTrip();
  testUnwrapShimRejectsForeignEnvelope();
  testUnwrapShimParsesPickResult();
  testDescribeElementProducesHeadingAndBody();
  process.stdout.write("pickerBridge.test.ts: 9 cases passed\n");
}

run();
