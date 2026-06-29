import { strict as assert } from "node:assert";
import { withSendRetry, SEND_ATTEMPTS } from "../messaging/send_retry";

// Inject a no-op backoff so the test doesn't actually sleep.
const noBackoff = async () => {};

async function run() {
  // Succeeds on the first attempt → called once, no retry, no throw.
  {
    let calls = 0;
    await withSendRetry(async () => { calls += 1; }, 3, noBackoff);
    assert.equal(calls, 1);
  }

  // Fails twice then succeeds → self-heals within the window (no throw).
  {
    let calls = 0;
    await withSendRetry(async () => {
      calls += 1;
      if (calls < 3) throw new Error("transient");
    }, 3, noBackoff);
    assert.equal(calls, 3);
  }

  // Always fails → throws the LAST error after exactly `attempts` tries.
  {
    let calls = 0;
    await assert.rejects(
      withSendRetry(async () => { calls += 1; throw new Error(`fail ${calls}`); }, 3, noBackoff),
      /fail 3/,
    );
    assert.equal(calls, 3);
  }

  assert.equal(SEND_ATTEMPTS, 3);
  // eslint-disable-next-line no-console
  console.log("spectrum-send-retry.test.ts: all assertions passed");
}

run();
