import { strict as assert } from "node:assert";
import { withSendRetry, SEND_ATTEMPTS, isTokenExpired } from "../messaging/send_retry";

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

  // isTokenExpired: recognizes the dead-Photon-token signal (the self-heal trigger)
  // across the error's code, message, and nested cause — but NOT a transient error.
  assert.equal(isTokenExpired({ code: "tokenExpired" }), true);
  assert.equal(isTokenExpired({ message: "SendTextMessage UNAUTHENTICATED: Authentication failed" }), true);
  assert.equal(isTokenExpired({ cause: new Error("UNAUTHENTICATED: token expired") }), true);
  assert.equal(isTokenExpired({ code: "TOKENEXPIRED" }), true, "case-insensitive");
  assert.equal(isTokenExpired(new Error("network timeout")), false, "a transient error is NOT a token expiry");
  assert.equal(isTokenExpired(null), false);

  // eslint-disable-next-line no-console
  console.log("spectrum-send-retry.test.ts: all assertions passed");
}

run();
