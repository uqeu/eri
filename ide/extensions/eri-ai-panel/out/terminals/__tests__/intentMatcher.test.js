"use strict";
// Pure-function tests for the terminal intent matcher.
// Runs without a test runner: `node out/terminals/__tests__/intentMatcher.test.js`.
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = require("node:assert");
const intentMatcher_1 = require("../intentMatcher");
function snap(over) {
    return {
        group: "default",
        cwd: "/tmp",
        blocks: [],
        ...over,
    };
}
function testFocusByName() {
    const terms = [
        snap({ id: "t1", name: "dev server", lastCommand: "npm run dev" }),
        snap({ id: "t2", name: "rust", lastCommand: "cargo check" }),
    ];
    const out = (0, intentMatcher_1.matchTerminalIntent)("show me the dev server", terms);
    node_assert_1.strict.ok(out, "expected match");
    node_assert_1.strict.equal(out.kind, "focus");
    node_assert_1.strict.equal(out.terminalId, "t1");
}
function testKillResolvesByLastCommand() {
    const terms = [
        snap({ id: "cargo", name: "shell", lastCommand: "cargo build" }),
        snap({ id: "vite", name: "frontend", lastCommand: "vite dev" }),
    ];
    const out = (0, intentMatcher_1.matchTerminalIntent)("kill the build", terms);
    node_assert_1.strict.ok(out, "expected kill match");
    node_assert_1.strict.equal(out.kind, "kill");
    node_assert_1.strict.equal(out.terminalId, "cargo");
}
function testKillCtrlCAlias() {
    const terms = [
        snap({ id: "runner", name: "test runner", lastCommand: "pytest" }),
    ];
    const out = (0, intentMatcher_1.matchTerminalIntent)("ctrl-c the runner", terms);
    node_assert_1.strict.ok(out, "expected match");
    node_assert_1.strict.equal(out.kind, "kill");
    node_assert_1.strict.equal(out.terminalId, "runner");
}
function testSendExtractsPayload() {
    const terms = [
        snap({ id: "dev", name: "dev terminal", lastCommand: "npm run dev" }),
        snap({ id: "rust", name: "rust shell", lastCommand: "cargo run" }),
    ];
    const out = (0, intentMatcher_1.matchTerminalIntent)("in the dev terminal type cargo check", terms);
    node_assert_1.strict.ok(out, "expected send match");
    node_assert_1.strict.equal(out.kind, "send");
    node_assert_1.strict.equal(out.terminalId, "dev");
    node_assert_1.strict.equal(out.payload, "cargo check");
}
function testSendReverseShape() {
    const terms = [
        snap({ id: "rust", name: "rust shell", lastCommand: "cargo run" }),
        snap({ id: "node", name: "node repl", lastCommand: "node" }),
    ];
    const out = (0, intentMatcher_1.matchTerminalIntent)("run cargo test in the rust shell", terms);
    node_assert_1.strict.ok(out, "expected send match");
    node_assert_1.strict.equal(out.kind, "send");
    node_assert_1.strict.equal(out.terminalId, "rust");
    node_assert_1.strict.equal(out.payload, "cargo test");
}
function testSpawnLayout() {
    const out = (0, intentMatcher_1.matchTerminalIntent)("spawn my rust stack", []);
    node_assert_1.strict.ok(out, "expected layout match");
    node_assert_1.strict.equal(out.kind, "spawn-layout");
    node_assert_1.strict.ok(out.payload?.includes("rust") ?? false, `payload should mention rust, got: ${out.payload ?? "<null>"}`);
}
function testSpawnLayoutNoun() {
    const out = (0, intentMatcher_1.matchTerminalIntent)("open my frontend layout", []);
    node_assert_1.strict.ok(out, "expected layout match");
    node_assert_1.strict.equal(out.kind, "spawn-layout");
    node_assert_1.strict.ok((out.payload ?? "").includes("frontend"), `payload should mention frontend, got: ${out.payload ?? "<null>"}`);
}
function testAmbiguousReturnsNull() {
    // Two terminals with nothing in common with the transcript → no claim.
    const terms = [
        snap({ id: "a", name: "alpha" }),
        snap({ id: "b", name: "beta" }),
    ];
    const out = (0, intentMatcher_1.matchTerminalIntent)("the weather is nice", terms);
    node_assert_1.strict.equal(out, null, "unrelated transcript must return null");
}
function testPronounUsesGazeFallback() {
    const terms = [
        snap({ id: "a", name: "alpha" }),
        snap({ id: "b", name: "beta" }),
    ];
    const out = (0, intentMatcher_1.matchTerminalIntent)("kill it", terms, {
        gazeAttendedTerminalId: "b",
    });
    node_assert_1.strict.ok(out, "expected gaze fusion match");
    node_assert_1.strict.equal(out.kind, "kill");
    node_assert_1.strict.equal(out.terminalId, "b");
    node_assert_1.strict.equal(out.resolvedViaGaze, true);
}
function testTieBreakerByRecency() {
    const terms = [
        snap({ id: "older", name: "shell", lastActiveAt: 1 }),
        snap({ id: "newer", name: "shell", lastActiveAt: 5 }),
    ];
    const out = (0, intentMatcher_1.matchTerminalIntent)("open the shell", terms);
    node_assert_1.strict.ok(out, "expected match");
    node_assert_1.strict.equal(out.terminalId, "newer", "most recent should win ties");
}
function run() {
    testFocusByName();
    testKillResolvesByLastCommand();
    testKillCtrlCAlias();
    testSendExtractsPayload();
    testSendReverseShape();
    testSpawnLayout();
    testSpawnLayoutNoun();
    testAmbiguousReturnsNull();
    testPronounUsesGazeFallback();
    testTieBreakerByRecency();
    process.stdout.write("intentMatcher.test.ts: 10 cases passed\n");
}
run();
//# sourceMappingURL=intentMatcher.test.js.map