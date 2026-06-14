import { strict as assert } from "node:assert";
import { isTerminalStatus, relayMessage } from "../commands/queue";

// Terminal vs in-flight statuses.
{
  assert.equal(isTerminalStatus("done"), true);
  assert.equal(isTerminalStatus("error"), true);
  assert.equal(isTerminalStatus("pending"), false);
  assert.equal(isTerminalStatus("claimed"), false);
  assert.equal(isTerminalStatus("awaiting_confirm"), false);
}

// Relay formatting for each status the phone sees.
{
  assert.equal(relayMessage({ status: "done", result: "Opened Spotify" }), "✓ Opened Spotify");
  assert.equal(relayMessage({ status: "done" }), "✓ Done.");
  assert.equal(
    relayMessage({ status: "error", result: "app not found" }),
    "✗ Couldn't finish that — app not found",
  );
  assert.equal(relayMessage({ status: "error" }), "✗ I couldn't finish that one.");
  assert.equal(
    relayMessage({ status: "awaiting_confirm", confirmPrompt: "eri wants to send an email — reply YES" }),
    "eri wants to send an email — reply YES",
  );
  assert.equal(
    relayMessage({ status: "awaiting_confirm" }),
    "eri needs your OK to continue — reply YES.",
  );
  assert.ok(relayMessage({ status: "pending" }).includes("Working on it"));
}

// eslint-disable-next-line no-console
console.log("commands-queue.test.ts: all assertions passed");
