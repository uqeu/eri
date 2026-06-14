import { strict as assert } from "node:assert";
import { parseInbound, verifySendblueSecret } from "../imessage/webhook";

const SECRET = "s3cret-webhook-token-abcdef0123456789";

// Verify: matches in the named header, matches in any header (name-agnostic),
// rejects a wrong value, rejects when no secret is configured.
{
  assert.equal(verifySendblueSecret({ "sb-signing-secret": SECRET }, SECRET), true);
  assert.equal(verifySendblueSecret({ "x-sb-signature": SECRET }, SECRET), true, "plausible sb-prefixed header");
  assert.equal(verifySendblueSecret({ "x-weird-header": SECRET }, SECRET), false, "non-sb header must NOT satisfy auth");
  assert.equal(verifySendblueSecret({ "sb-signing-secret": "nope" }, SECRET), false);
  assert.equal(verifySendblueSecret({}, SECRET), false, "no header → reject");
  assert.equal(verifySendblueSecret({ "sb-signing-secret": SECRET }, ""), false, "no configured secret → reject");
}

// Parse: pulls the fields we use; rejects payloads missing essentials.
{
  const ok = parseInbound({
    from_number: "+16475497552",
    content: "what was I working on?",
    message_handle: "99DCC379-DD76-4712",
    is_outbound: false,
    service: "iMessage",
  });
  assert.ok(ok);
  assert.equal(ok!.fromNumber, "+16475497552");
  assert.equal(ok!.content, "what was I working on?");
  assert.equal(ok!.messageHandle, "99DCC379-DD76-4712");
  assert.equal(ok!.isOutbound, false);

  assert.equal(parseInbound({ content: "no handle" }), null, "missing handle → null");
  assert.equal(parseInbound({ message_handle: "x" }), null, "missing from_number → null");
  assert.equal(parseInbound("not an object"), null);

  // Our own outbound echoes parse but carry is_outbound=true so the route skips them.
  const echo = parseInbound({ from_number: "+1", message_handle: "h", is_outbound: true });
  assert.equal(echo!.isOutbound, true);
}

// eslint-disable-next-line no-console
console.log("imessage-webhook.test.ts: all assertions passed");
