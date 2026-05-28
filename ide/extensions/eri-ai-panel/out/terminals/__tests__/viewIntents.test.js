"use strict";
// Pure-function tests for the voice view-intent classifier.
// Runs without a test runner: `node out/terminals/__tests__/viewIntents.test.js`.
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = require("node:assert");
const intentMatcher_1 = require("../intentMatcher");
const viewIntents_1 = require("../viewIntents");
function snap(over) {
    return {
        group: "default",
        cwd: "/tmp",
        blocks: [],
        ...over,
    };
}
const ZOOM_CASES = [
    { transcript: "zoom in a little", direction: "in", magnitude: "small" },
    { transcript: "zoom in a lot", direction: "in", magnitude: "big" },
    { transcript: "zoom out a bit", direction: "out", magnitude: "small" },
    { transcript: "make it bigger", direction: "in", magnitude: "small" },
    { transcript: "make it smaller please", direction: "out", magnitude: "small" },
];
const SCROLL_CASES = [
    { transcript: "scroll down a little", direction: "down", magnitude: "small" },
    { transcript: "scroll up a lot", direction: "up", magnitude: "big" },
    { transcript: "scroll left", direction: "left", magnitude: "small" },
    { transcript: "scroll right slightly", direction: "right", magnitude: "small" },
    { transcript: "go to the bottom", direction: "down", magnitude: "big" },
    { transcript: "go to the top", direction: "up", magnitude: "big" },
];
const NAVIGATE_CASES = [
    { transcript: "show me extension.ts", target: "extension.ts" },
    { transcript: "show me the hero headline", target: "hero headline" },
    { transcript: "reveal handleNotification", target: "handleNotification" },
    { transcript: "go to package.json", target: "package.json" },
    { transcript: "open the pricing section", target: "pricing section" },
];
function testZoomClassification() {
    for (const c of ZOOM_CASES) {
        const intent = (0, viewIntents_1.matchViewIntent)(c.transcript);
        node_assert_1.strict.ok(intent, `expected zoom match for "${c.transcript}"`);
        node_assert_1.strict.equal(intent.kind, "zoom", `kind for "${c.transcript}"`);
        if (intent.kind === "zoom") {
            node_assert_1.strict.equal(intent.direction, c.direction, `direction for "${c.transcript}"`);
            node_assert_1.strict.equal(intent.magnitude, c.magnitude, `magnitude for "${c.transcript}"`);
        }
    }
}
function testScrollClassification() {
    for (const c of SCROLL_CASES) {
        const intent = (0, viewIntents_1.matchViewIntent)(c.transcript);
        node_assert_1.strict.ok(intent, `expected scroll match for "${c.transcript}"`);
        node_assert_1.strict.equal(intent.kind, "scroll", `kind for "${c.transcript}"`);
        if (intent.kind === "scroll") {
            node_assert_1.strict.equal(intent.direction, c.direction, `direction for "${c.transcript}"`);
            node_assert_1.strict.equal(intent.magnitude, c.magnitude, `magnitude for "${c.transcript}"`);
        }
    }
}
function testNavigateClassification() {
    for (const c of NAVIGATE_CASES) {
        const intent = (0, viewIntents_1.matchViewIntent)(c.transcript);
        node_assert_1.strict.ok(intent, `expected navigate match for "${c.transcript}"`);
        node_assert_1.strict.equal(intent.kind, "navigate", `kind for "${c.transcript}"`);
        if (intent.kind === "navigate") {
            node_assert_1.strict.equal(intent.target, c.target, `target for "${c.transcript}"`);
        }
    }
}
function testTerminalShowRegressionGuard() {
    // "show me the dev terminal" must still classify as a terminal focus
    // intent, not a navigate intent. matchViewIntent should refuse it and
    // matchTerminalIntent should still claim it with kind=focus when a
    // matching terminal exists.
    const transcript = "show me the dev terminal";
    node_assert_1.strict.equal((0, viewIntents_1.matchViewIntent)(transcript), null, "view matcher must refuse terminal target");
    const terms = [
        snap({ id: "t1", name: "dev terminal", lastCommand: "npm run dev" }),
    ];
    const out = (0, intentMatcher_1.matchTerminalIntent)(transcript, terms);
    node_assert_1.strict.ok(out, "expected terminal match");
    node_assert_1.strict.equal(out.kind, "focus");
    node_assert_1.strict.equal(out.terminalId, "t1");
}
function testNoMatchOnPlainChat() {
    // Things that should NOT trigger view intents — they're chat.
    const noise = [
        "what do you think of this",
        "rename this to handleClick",
        "fix the bug in this file",
        "what does this function return",
    ];
    for (const text of noise) {
        const result = (0, viewIntents_1.matchViewIntent)(text);
        node_assert_1.strict.equal(result, null, `expected null for noise: "${text}" got ${JSON.stringify(result)}`);
        node_assert_1.strict.equal((0, viewIntents_1.looksLikeViewIntent)(text), false, `looksLikeViewIntent should be false for "${text}"`);
    }
}
function run(name, fn) {
    try {
        fn();
        console.log(`ok ${name}`);
    }
    catch (err) {
        console.error(`fail ${name}`);
        console.error(err);
        process.exitCode = 1;
    }
}
run("zoom intents classify correctly", testZoomClassification);
run("scroll intents classify correctly", testScrollClassification);
run("navigate intents classify correctly", testNavigateClassification);
run("terminal 'show me the dev terminal' regression guard", testTerminalShowRegressionGuard);
run("plain chat does not trigger view intents", testNoMatchOnPlainChat);
//# sourceMappingURL=viewIntents.test.js.map