"use strict";
// Round-trip tests for the picker bridge protocol parsing.
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = require("node:assert");
const pickerBridge_1 = require("../pickerBridge");
function sampleElement() {
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
function testParseReadyMessage() {
    const result = (0, pickerBridge_1.parseWebviewMessage)({ kind: "ready" });
    node_assert_1.strict.deepEqual(result, { kind: "ready" });
}
function testParsePickResult() {
    const result = (0, pickerBridge_1.parseWebviewMessage)({
        kind: "pickResult",
        element: sampleElement(),
    });
    node_assert_1.strict.equal(result?.kind, "pickResult");
    if (result?.kind === "pickResult") {
        node_assert_1.strict.equal(result.element.tag, "button");
        node_assert_1.strict.equal(result.element.classNames.length, 2);
    }
}
function testParseRejectsMalformedPickResult() {
    // Missing tag / selector - should return null.
    const result = (0, pickerBridge_1.parseWebviewMessage)({ kind: "pickResult", element: { id: "x" } });
    node_assert_1.strict.equal(result, null);
}
function testParseRejectsUnknownKind() {
    node_assert_1.strict.equal((0, pickerBridge_1.parseWebviewMessage)({ kind: "unknown" }), null);
    node_assert_1.strict.equal((0, pickerBridge_1.parseWebviewMessage)(null), null);
    node_assert_1.strict.equal((0, pickerBridge_1.parseWebviewMessage)("not an object"), null);
}
function testParseTweakChanged() {
    const result = (0, pickerBridge_1.parseWebviewMessage)({
        kind: "tweakChanged",
        property: "color",
        value: "#ef4444",
    });
    node_assert_1.strict.equal(result?.kind, "tweakChanged");
    if (result?.kind === "tweakChanged") {
        node_assert_1.strict.equal(result.property, "color");
        node_assert_1.strict.equal(result.value, "#ef4444");
    }
}
function testShimEnvelopeRoundTrip() {
    const envelope = (0, pickerBridge_1.wrapShim)({ kind: "shimReady" });
    node_assert_1.strict.equal(envelope.tag, pickerBridge_1.SHIM_TAG);
    const parsed = (0, pickerBridge_1.unwrapShim)(envelope);
    node_assert_1.strict.equal(parsed?.kind, "shimReady");
}
function testUnwrapShimRejectsForeignEnvelope() {
    const result = (0, pickerBridge_1.unwrapShim)({ tag: "other", payload: { kind: "shimReady" } });
    node_assert_1.strict.equal(result, null);
}
function testUnwrapShimParsesPickResult() {
    const envelope = (0, pickerBridge_1.wrapShim)({ kind: "pickResult", element: sampleElement() });
    const parsed = (0, pickerBridge_1.unwrapShim)(envelope);
    node_assert_1.strict.equal(parsed?.kind, "pickResult");
    if (parsed?.kind === "pickResult") {
        node_assert_1.strict.equal(parsed.element.selector, "button.btn.btn-primary");
    }
}
function testDescribeElementProducesHeadingAndBody() {
    const { heading, body } = (0, pickerBridge_1.describeElement)(sampleElement());
    node_assert_1.strict.ok(heading.includes("@Element"));
    node_assert_1.strict.ok(heading.includes("button"));
    node_assert_1.strict.ok(heading.includes("#submit"));
    node_assert_1.strict.ok(heading.includes(".btn.btn-primary"));
    node_assert_1.strict.ok(body.includes("selector: button.btn.btn-primary"));
    node_assert_1.strict.ok(body.includes("font-size: 14px"));
    node_assert_1.strict.ok(body.includes("innerText:"));
    node_assert_1.strict.ok(body.includes("Submit"));
}
function run() {
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
//# sourceMappingURL=pickerBridge.test.js.map