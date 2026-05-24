// Lightweight unit tests for the gaze service primitives.
// Runs without a test runner: `node out/gaze/__tests__/gazeService.test.js`.

import { strict as assert } from "node:assert";

// Install a `vscode` stub BEFORE we require the module under test —
// gazeService does `import * as vscode from "vscode"` at the top.
// We intercept the resolver and stuff a fake module into require.cache.
type ResolverHost = {
  _resolveFilename: (req: string, parent: unknown) => string;
  _cache: Record<string, NodeJS.Module>;
};
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Module = require("module") as ResolverHost;

class FakeEventEmitter<T> {
  private listeners: Array<(value: T) => void> = [];
  event = (listener: (value: T) => void): { dispose(): void } => {
    this.listeners.push(listener);
    return {
      dispose: () => {
        this.listeners = this.listeners.filter((l) => l !== listener);
      },
    };
  };
  fire(value: T): void {
    for (const listener of this.listeners) {
      listener(value);
    }
  }
  dispose(): void {
    this.listeners = [];
  }
}

const VSCODE_FAKE_PATH = "__eri_test_vscode_stub__";
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request: string, parent: unknown) {
  if (request === "vscode") {
    return VSCODE_FAKE_PATH;
  }
  return originalResolve.call(this, request, parent);
};
Module._cache[VSCODE_FAKE_PATH] = {
  exports: { EventEmitter: FakeEventEmitter },
} as unknown as NodeJS.Module;

// eslint-disable-next-line @typescript-eslint/no-var-requires
const gazeService = require("../gazeService") as typeof import("../gazeService");
const { parseGazePoint, regionFromPoint, GazeService } = gazeService;

function testParseValidPayload(): void {
  const point = parseGazePoint({ x: 0.4, y: 0.2, confidence: 0.9, ts_ms: 1000 });
  assert.ok(point, "valid payload should parse");
  assert.equal(point.x, 0.4);
  assert.equal(point.y, 0.2);
  assert.equal(point.confidence, 0.9);
  assert.equal(point.tsMs, 1000);
}

function testParseRejectsMissingCoords(): void {
  assert.equal(parseGazePoint({ x: 0.5 }), null, "missing y should reject");
  assert.equal(parseGazePoint(null), null, "null should reject");
  assert.equal(parseGazePoint({ x: "a", y: "b" }), null, "non-numeric should reject");
}

function testParseClampsOutOfRange(): void {
  const point = parseGazePoint({ x: 1.5, y: -0.3, confidence: 2 });
  assert.ok(point);
  assert.equal(point.x, 1);
  assert.equal(point.y, 0);
  assert.equal(point.confidence, 1);
}

function testRegionDetection(): void {
  assert.equal(regionFromPoint({ x: 0.5, y: 0.4 }), "editor");
  assert.equal(regionFromPoint({ x: 0.05, y: 0.5 }), "sidebar");
  assert.equal(regionFromPoint({ x: 0.5, y: 0.98 }), "statusbar");
  assert.equal(regionFromPoint({ x: 0.5, y: 0.02 }), "title");
  assert.equal(regionFromPoint({ x: 0.5, y: 0.8 }), "panel");
  assert.equal(regionFromPoint({ x: 0.9, y: 0.5 }), "auxbar");
}

function testGazeServiceEmitsPoint(): void {
  const service = new GazeService({ getSidecar: () => null });
  let received = 0;
  service.onGaze((point) => {
    received += 1;
    assert.ok(point.x >= 0 && point.x <= 1);
  });
  service.forward({ method: "eri/gaze/point", params: { x: 0.3, y: 0.4, confidence: 0.8 } });
  service.forward({ method: "eri/gaze/point", params: { x: 0.31, y: 0.41, confidence: 0.8 } });
  service.forward({ method: "eri/voice/partial", params: { text: "irrelevant" } });
  assert.equal(received, 2, "should only forward gaze points");
  service.dispose();
}

function testDwellFiresAttention(): void {
  const service = new GazeService({ getSidecar: () => null, dwellMs: 100 });
  const seen: string[] = [];
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
  assert.ok(
    seen.some((s) => s === "enter:editor"),
    `expected enter:editor in ${JSON.stringify(seen)}`,
  );
  service.dispose();
}

function testGetLastPointTracksLatest(): void {
  const service = new GazeService({ getSidecar: () => null });
  assert.equal(service.getLastPoint(), null);
  service.forward({
    method: "eri/gaze/point",
    params: { x: 0.2, y: 0.3, confidence: 0.5 },
  });
  const last = service.getLastPoint();
  assert.ok(last);
  assert.equal(last.x, 0.2);
  service.dispose();
}

function testLostClearsAttention(): void {
  const service = new GazeService({ getSidecar: () => null, dwellMs: 50 });
  const seen: string[] = [];
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
  assert.ok(seen.includes("enter:editor"));
  assert.ok(seen.includes("leave:editor"));
  service.dispose();
}

function run(): void {
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
