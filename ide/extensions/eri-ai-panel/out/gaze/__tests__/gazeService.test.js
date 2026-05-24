"use strict";
// Lightweight unit tests for the gaze service primitives.
// Runs without a test runner: `node out/gaze/__tests__/gazeService.test.js`.
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = require("node:assert");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Module = require("module");
class FakeEventEmitter {
    listeners = [];
    event = (listener) => {
        this.listeners.push(listener);
        return {
            dispose: () => {
                this.listeners = this.listeners.filter((l) => l !== listener);
            },
        };
    };
    fire(value) {
        for (const listener of this.listeners) {
            listener(value);
        }
    }
    dispose() {
        this.listeners = [];
    }
}
const VSCODE_FAKE_PATH = "__eri_test_vscode_stub__";
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent) {
    if (request === "vscode") {
        return VSCODE_FAKE_PATH;
    }
    return originalResolve.call(this, request, parent);
};
Module._cache[VSCODE_FAKE_PATH] = {
    exports: { EventEmitter: FakeEventEmitter },
};
// eslint-disable-next-line @typescript-eslint/no-var-requires
const gazeService = require("../gazeService");
const { parseGazePoint, regionFromPoint, GazeService } = gazeService;
function testParseValidPayload() {
    const point = parseGazePoint({ x: 0.4, y: 0.2, confidence: 0.9, ts_ms: 1000 });
    node_assert_1.strict.ok(point, "valid payload should parse");
    node_assert_1.strict.equal(point.x, 0.4);
    node_assert_1.strict.equal(point.y, 0.2);
    node_assert_1.strict.equal(point.confidence, 0.9);
    node_assert_1.strict.equal(point.tsMs, 1000);
}
function testParseRejectsMissingCoords() {
    node_assert_1.strict.equal(parseGazePoint({ x: 0.5 }), null, "missing y should reject");
    node_assert_1.strict.equal(parseGazePoint(null), null, "null should reject");
    node_assert_1.strict.equal(parseGazePoint({ x: "a", y: "b" }), null, "non-numeric should reject");
}
function testParseClampsOutOfRange() {
    const point = parseGazePoint({ x: 1.5, y: -0.3, confidence: 2 });
    node_assert_1.strict.ok(point);
    node_assert_1.strict.equal(point.x, 1);
    node_assert_1.strict.equal(point.y, 0);
    node_assert_1.strict.equal(point.confidence, 1);
}
function testRegionDetection() {
    node_assert_1.strict.equal(regionFromPoint({ x: 0.5, y: 0.4 }), "editor");
    node_assert_1.strict.equal(regionFromPoint({ x: 0.05, y: 0.5 }), "sidebar");
    node_assert_1.strict.equal(regionFromPoint({ x: 0.5, y: 0.98 }), "statusbar");
    node_assert_1.strict.equal(regionFromPoint({ x: 0.5, y: 0.02 }), "title");
    node_assert_1.strict.equal(regionFromPoint({ x: 0.5, y: 0.8 }), "panel");
    node_assert_1.strict.equal(regionFromPoint({ x: 0.9, y: 0.5 }), "auxbar");
}
function testGazeServiceEmitsPoint() {
    const service = new GazeService({ getSidecar: () => null });
    let received = 0;
    service.onGaze((point) => {
        received += 1;
        node_assert_1.strict.ok(point.x >= 0 && point.x <= 1);
    });
    service.forward({ method: "eri/gaze/point", params: { x: 0.3, y: 0.4, confidence: 0.8 } });
    service.forward({ method: "eri/gaze/point", params: { x: 0.31, y: 0.41, confidence: 0.8 } });
    service.forward({ method: "eri/voice/partial", params: { text: "irrelevant" } });
    node_assert_1.strict.equal(received, 2, "should only forward gaze points");
    service.dispose();
}
function testDwellFiresAttention() {
    const service = new GazeService({ getSidecar: () => null, dwellMs: 100 });
    const seen = [];
    service.onAttention((event) => seen.push(`${event.kind}:${event.region}`));
    const baseTs = 1_000_000;
    service.forward({
        method: "eri/gaze/point",
        params: { x: 0.5, y: 0.4, confidence: 0.9, ts_ms: baseTs },
    });
    service.forward({
        method: "eri/gaze/point",
        params: { x: 0.5, y: 0.4, confidence: 0.9, ts_ms: baseTs + 150 },
    });
    node_assert_1.strict.ok(seen.some((s) => s === "enter:editor"), `expected enter:editor in ${JSON.stringify(seen)}`);
    service.dispose();
}
function testGetLastPointTracksLatest() {
    const service = new GazeService({ getSidecar: () => null });
    node_assert_1.strict.equal(service.getLastPoint(), null);
    service.forward({
        method: "eri/gaze/point",
        params: { x: 0.2, y: 0.3, confidence: 0.5 },
    });
    const last = service.getLastPoint();
    node_assert_1.strict.ok(last);
    node_assert_1.strict.equal(last.x, 0.2);
    service.dispose();
}
function testLostClearsAttention() {
    const service = new GazeService({ getSidecar: () => null, dwellMs: 50 });
    const seen = [];
    service.onAttention((event) => seen.push(`${event.kind}:${event.region}`));
    const baseTs = 2_000_000;
    service.forward({
        method: "eri/gaze/point",
        params: { x: 0.5, y: 0.4, confidence: 0.9, ts_ms: baseTs },
    });
    service.forward({
        method: "eri/gaze/point",
        params: { x: 0.5, y: 0.4, confidence: 0.9, ts_ms: baseTs + 80 },
    });
    service.forward({ method: "eri/gaze/lost", params: {} });
    node_assert_1.strict.ok(seen.includes("enter:editor"));
    node_assert_1.strict.ok(seen.includes("leave:editor"));
    service.dispose();
}
function run() {
    testParseValidPayload();
    testParseRejectsMissingCoords();
    testParseClampsOutOfRange();
    testRegionDetection();
    testGazeServiceEmitsPoint();
    testDwellFiresAttention();
    testGetLastPointTracksLatest();
    testLostClearsAttention();
    console.log("gaze service tests passed");
}
run();
//# sourceMappingURL=gazeService.test.js.map