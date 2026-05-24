// Lightweight tests for the pure pieces of the editor + preview gaze
// pipeline. Run with `node out/gaze/__tests__/editorGaze.test.js`.

import { strict as assert } from "node:assert";

// Hijack the vscode resolver so we can import modules that ultimately
// pull `import * as vscode from "vscode"`. We only exercise the pure
// helpers, so a tiny stub is enough.
const Module = require("module") as {
  _resolveFilename: (req: string, parent: unknown) => string;
  _cache: Record<string, unknown>;
};
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request: string, parent: unknown) {
  if (request === "vscode") {
    return "vscode";
  }
  return originalResolve.call(this, request, parent);
};
Module._cache["vscode"] = {
  exports: {
    OverviewRulerLane: { Left: 0 },
    window: {
      createTextEditorDecorationType: () => ({ dispose: () => undefined }),
      onDidChangeActiveTextEditor: () => ({ dispose: () => undefined }),
      visibleTextEditors: [],
    },
    workspace: {
      getConfiguration: () => ({
        get: <T>(_key: string, fallback: T) => fallback,
      }),
    },
    EventEmitter: class<T> {
      private listeners: Array<(value: T) => void> = [];
      event = (listener: (value: T) => void): { dispose(): void } => {
        this.listeners.push(listener);
        return { dispose: () => undefined };
      };
      fire(value: T): void {
        for (const listener of this.listeners) {
          listener(value);
        }
      }
      dispose(): void {
        this.listeners = [];
      }
    },
  },
};

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { inferEditorLine } = require("../editorGaze") as typeof import("../editorGaze");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { Throttle } = require("../previewRelay") as typeof import("../previewRelay");

function testInferEditorLineMidRange(): void {
  // y = 0.375 sits at the midpoint of [0.05, 0.7], so we expect the line
  // halfway through a 100-line visible range starting at 200.
  const line = inferEditorLine(0.375, 200, 300);
  assert.equal(line, 250);
}

function testInferEditorLineClamps(): void {
  assert.equal(inferEditorLine(0.0, 100, 200), 100);
  assert.equal(inferEditorLine(1.0, 100, 200), 200);
  assert.equal(inferEditorLine(0.5, 50, 50), 50);
}

function testThrottlePreventsFastFiring(): void {
  const throttle = new Throttle(30);
  assert.equal(throttle.tick(0), true);
  assert.equal(throttle.tick(10), false);
  assert.equal(throttle.tick(29), false);
  assert.equal(throttle.tick(31), true);
}

function run(): void {
  testInferEditorLineMidRange();
  testInferEditorLineClamps();
  testThrottlePreventsFastFiring();
  console.log("editor gaze tests passed");
}

run();
