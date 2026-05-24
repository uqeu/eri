"use strict";
// Lightweight tests for the pure pieces of the editor + preview gaze
// pipeline. Run with `node out/gaze/__tests__/editorGaze.test.js`.
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = require("node:assert");
// Hijack the vscode resolver so we can import modules that ultimately
// pull `import * as vscode from "vscode"`. We only exercise the pure
// helpers, so a tiny stub is enough.
const Module = require("module");
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent) {
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
                get: (_key, fallback) => fallback,
            }),
        },
        EventEmitter: class {
            listeners = [];
            event = (listener) => {
                this.listeners.push(listener);
                return { dispose: () => undefined };
            };
            fire(value) {
                for (const listener of this.listeners) {
                    listener(value);
                }
            }
            dispose() {
                this.listeners = [];
            }
        },
    },
};
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { inferEditorLine } = require("../editorGaze");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { Throttle } = require("../previewRelay");
function testInferEditorLineMidRange() {
    // y = 0.375 sits at the midpoint of [0.05, 0.7], so we expect the line
    // halfway through a 100-line visible range starting at 200.
    const line = inferEditorLine(0.375, 200, 300);
    node_assert_1.strict.equal(line, 250);
}
function testInferEditorLineClamps() {
    node_assert_1.strict.equal(inferEditorLine(0.0, 100, 200), 100);
    node_assert_1.strict.equal(inferEditorLine(1.0, 100, 200), 200);
    node_assert_1.strict.equal(inferEditorLine(0.5, 50, 50), 50);
}
function testThrottlePreventsFastFiring() {
    const throttle = new Throttle(30);
    node_assert_1.strict.equal(throttle.tick(0), true);
    node_assert_1.strict.equal(throttle.tick(10), false);
    node_assert_1.strict.equal(throttle.tick(29), false);
    node_assert_1.strict.equal(throttle.tick(31), true);
}
function run() {
    testInferEditorLineMidRange();
    testInferEditorLineClamps();
    testThrottlePreventsFastFiring();
    console.log("editor gaze tests passed");
}
run();
//# sourceMappingURL=editorGaze.test.js.map