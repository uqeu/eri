import { strict as assert } from "node:assert";
import { createHmac } from "node:crypto";
import {
  parseSpectrumInbound,
  verifySpectrumSignature,
  REPLAY_WINDOW_SEC,
} from "../messaging/spectrum_webhook";

const SECRET = "whsec_test_0123456789abcdef0123456789abcdef";

/** Build a valid signature the way Spectrum does, for a given body+timestamp. */
function sign(rawBody: string, timestamp: string, secret = SECRET): string {
  return "v0=" + createHmac("sha256", secret).update(`v0:${timestamp}:${rawBody}`).digest("hex");
}

async function run() {
  const nowMs = 1_750_000_000_000; // fixed clock for deterministic tests
  const ts = String(Math.floor(nowMs / 1000));
  const body = JSON.stringify({ event: "messages", hello: "world" });

  // verifySpectrumSignature — a correctly-signed delivery passes.
  {
    const sig = sign(body, ts);
    assert.ok(verifySpectrumSignature({ rawBody: body, signature: sig, timestamp: ts, secret: SECRET, now: nowMs }));
  }

  // Tampered body fails.
  {
    const sig = sign(body, ts);
    assert.ok(
      !verifySpectrumSignature({ rawBody: body + " ", signature: sig, timestamp: ts, secret: SECRET, now: nowMs }),
      "tampered body rejected",
    );
  }

  // Wrong secret fails.
  {
    const sig = sign(body, ts, "whsec_other");
    assert.ok(!verifySpectrumSignature({ rawBody: body, signature: sig, timestamp: ts, secret: SECRET, now: nowMs }));
  }

  // Missing signature / timestamp / secret all fail.
  {
    const sig = sign(body, ts);
    assert.ok(!verifySpectrumSignature({ rawBody: body, signature: null, timestamp: ts, secret: SECRET, now: nowMs }));
    assert.ok(!verifySpectrumSignature({ rawBody: body, signature: sig, timestamp: null, secret: SECRET, now: nowMs }));
    assert.ok(!verifySpectrumSignature({ rawBody: body, signature: sig, timestamp: ts, secret: "", now: nowMs }));
  }

  // Stale timestamp (just outside the replay window) fails; just inside passes.
  {
    const sig = sign(body, ts);
    const staleMs = nowMs + (REPLAY_WINDOW_SEC + 1) * 1000;
    assert.ok(!verifySpectrumSignature({ rawBody: body, signature: sig, timestamp: ts, secret: SECRET, now: staleMs }), "stale rejected");
    const freshMs = nowMs + (REPLAY_WINDOW_SEC - 1) * 1000;
    assert.ok(verifySpectrumSignature({ rawBody: body, signature: sig, timestamp: ts, secret: SECRET, now: freshMs }), "within window accepted");
  }

  // Non-numeric timestamp fails.
  {
    const sig = sign(body, "not-a-number");
    assert.ok(!verifySpectrumSignature({ rawBody: body, signature: sig, timestamp: "not-a-number", secret: SECRET, now: nowMs }));
  }

  // parseSpectrumInbound — a text DM maps onto the existing InboundMessage shape.
  {
    const parsed = parseSpectrumInbound({
      event: "messages",
      space: { id: "space_1", platform: "iMessage", type: "dm", phone: "shared" },
      message: {
        id: "msg_1",
        platform: "iMessage",
        direction: "inbound",
        sender: { id: "+15551234567", platform: "iMessage" },
        content: { type: "text", text: "hey eri" },
      },
    });
    assert.ok(parsed);
    assert.equal(parsed!.spaceId, "space_1");
    assert.equal(parsed!.isGroup, false);
    assert.equal(parsed!.platform, "iMessage");
    assert.equal(parsed!.contentType, "text");
    assert.equal(parsed!.message.fromNumber, "+15551234567");
    assert.equal(parsed!.message.content, "hey eri");
    assert.equal(parsed!.message.messageHandle, "msg_1");
    assert.equal(parsed!.message.isOutbound, false);
    assert.equal(parsed!.message.service, "iMessage");
    assert.equal(parsed!.attachment, undefined);
  }

  // A group space sets isGroup.
  {
    const parsed = parseSpectrumInbound({
      event: "messages",
      space: { id: "space_g", platform: "iMessage", type: "group" },
      message: { id: "m2", sender: { id: "+15550000001" }, content: { type: "text", text: "Eri hi" } },
    });
    assert.ok(parsed);
    assert.equal(parsed!.isGroup, true);
  }

  // An attachment carries metadata (no URL) and an empty text body.
  {
    const parsed = parseSpectrumInbound({
      event: "messages",
      space: { id: "s", platform: "iMessage", type: "dm" },
      message: {
        id: "m3",
        sender: { id: "+15550000002" },
        content: { type: "attachment", id: "att_9", name: "pic.heic", mimeType: "image/heic", size: 1234 },
      },
    });
    assert.ok(parsed);
    assert.equal(parsed!.message.content, "");
    assert.equal(parsed!.contentType, "attachment");
    assert.deepEqual(parsed!.attachment, { id: "att_9", mimeType: "image/heic", name: "pic.heic" });
  }

  // A shared rich link reads as text content (eri can act on the URL).
  {
    const parsed = parseSpectrumInbound({
      event: "messages",
      space: { id: "s", platform: "iMessage", type: "dm" },
      message: { id: "m4", sender: { id: "+1555" }, content: { type: "richlink", url: "https://x.com/a" } },
    });
    assert.equal(parsed!.message.content, "https://x.com/a");
  }

  // A reaction parses with its type but an empty body (route decides what to do).
  {
    const parsed = parseSpectrumInbound({
      event: "messages",
      space: { id: "s", platform: "iMessage", type: "dm" },
      message: { id: "m5", sender: { id: "+1555" }, content: { type: "reaction", emoji: "❤️", target: { id: "m1" } } },
    });
    assert.equal(parsed!.contentType, "reaction");
    assert.equal(parsed!.message.content, "");
  }

  // Falls back to the space phone as sender for a 1:1 line without a sender id.
  {
    const parsed = parseSpectrumInbound({
      event: "messages",
      space: { id: "s", platform: "iMessage", type: "dm", phone: "+15559998888" },
      message: { id: "m6", content: { type: "text", text: "hi" } },
    });
    assert.equal(parsed!.message.fromNumber, "+15559998888");
  }

  // Rejects: wrong event, missing space/message, missing ids, missing sender.
  {
    assert.equal(parseSpectrumInbound({ event: "other", space: {}, message: {} }), null);
    assert.equal(parseSpectrumInbound({ event: "messages", message: { id: "x" } }), null, "no space");
    assert.equal(parseSpectrumInbound({ event: "messages", space: { id: "s" } }), null, "no message");
    assert.equal(
      parseSpectrumInbound({ event: "messages", space: { id: "s", type: "dm" }, message: { id: "m", content: { type: "text", text: "hi" } } }),
      null,
      "no sender → null",
    );
    assert.equal(parseSpectrumInbound("nope"), null);
  }

  // eslint-disable-next-line no-console
  console.log("spectrum-webhook.test.ts: all assertions passed");
}

run();
