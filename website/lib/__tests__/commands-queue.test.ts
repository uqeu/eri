import { strict as assert } from "node:assert";
import { isTerminalStatus, meteredRemoteUsage, relayMessage } from "../commands/queue";

// meteredRemoteUsage — what (if anything) a completed remote turn bills (M4).
{
  // Terminal + real tokens → metered.
  assert.deepEqual(meteredRemoteUsage({ status: "done", tokensIn: 200, tokensOut: 80 }), {
    tokensIn: 200,
    tokensOut: 80,
  });
  assert.deepEqual(meteredRemoteUsage({ status: "error", tokensIn: 50, tokensOut: 0 }), {
    tokensIn: 50,
    tokensOut: 0,
  });
  // Non-terminal never meters (a resumed awaiting_confirm bills on its own completion).
  assert.equal(meteredRemoteUsage({ status: "awaiting_confirm", tokensIn: 999, tokensOut: 999 }), null);
  // Zero tokens (local recall / fast-lane) → nothing to bill.
  assert.equal(meteredRemoteUsage({ status: "done", tokensIn: 0, tokensOut: 0 }), null);
  assert.equal(meteredRemoteUsage({ status: "done" }), null);
  // Garbage token values are coerced to 0, not trusted.
  assert.equal(meteredRemoteUsage({ status: "done", tokensIn: -5, tokensOut: "lots" }), null);
}

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
