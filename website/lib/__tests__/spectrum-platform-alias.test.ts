/**
 * Regression test for the outage: eri went silent because spectrum-ts 5.2.0
 * routes an inbound webhook by the platform id ON THE WIRE ("imessage") while
 * keying its provider registry by the DEFINITION name ("iMessage"). The lookup
 * missed, so `app.webhook()` ACKed every message with 200 and never called our
 * handler.
 *
 * These assertions pin the alias that closes that gap — including the three
 * properties that make it safe to ship: it is idempotent, it never clobbers a
 * real provider, and it degrades instead of throwing on an unexpected shape.
 */

import { strict as assert } from "node:assert";
import {
  aliasWirePlatformKeys,
  readPlatformRegistry,
  wirePlatformKey,
} from "../messaging/spectrum_platforms";

async function run() {
  // The real case: registry keyed "iMessage", envelope says "imessage".
  {
    const state = { definition: { name: "iMessage" } };
    const platforms = new Map<string, unknown>([["iMessage", state]]);

    // Before: the raw wire lookup the SDK performs misses → ACK-and-drop.
    assert.equal(platforms.get("imessage"), undefined, "precondition: wire key missing");

    const added = aliasWirePlatformKeys(platforms);

    // After: the wire lookup resolves to the SAME runtime state — not a copy.
    // The send path keys its own maps off definition.name, so identity matters.
    assert.equal(platforms.get("imessage"), state, "wire key routes to the same state");
    assert.equal(platforms.get("iMessage"), state, "definition key still routes");
    assert.equal(platforms.size, 2);
    assert.deepEqual(added, [{ from: "iMessage", to: "imessage" }]);
  }

  // Idempotent: called on every request (the token self-heal can swap the app),
  // so repeats must not grow or rewrite the registry.
  {
    const state = { definition: { name: "iMessage" } };
    const platforms = new Map<string, unknown>([["iMessage", state]]);
    aliasWirePlatformKeys(platforms);
    assert.deepEqual(aliasWirePlatformKeys(platforms), [], "second pass adds nothing");
    aliasWirePlatformKeys(platforms);
    assert.equal(platforms.size, 2, "no duplicate entries across repeats");
    assert.equal(platforms.get("imessage"), state);
  }

  // A key already in wire form is left completely alone (no self-aliasing).
  {
    const platforms = new Map<string, unknown>([["telegram", {}]]);
    assert.deepEqual(aliasWirePlatformKeys(platforms), []);
    assert.equal(platforms.size, 1, "already-normalized key untouched");
  }

  // An existing wire key is never overwritten — a provider genuinely registered
  // under the wire id must win over an alias of a differently-cased sibling.
  {
    const real = { real: true };
    const other = { real: false };
    const platforms = new Map<string, unknown>([
      ["imessage", real],
      ["iMessage", other],
    ]);
    aliasWirePlatformKeys(platforms);
    assert.equal(platforms.get("imessage"), real, "existing wire entry preserved");
  }

  // Multi-word / underscored names fold the way the SDK's own normalizer does.
  {
    const state = {};
    const platforms = new Map<string, unknown>([["WhatsApp_Business", state]]);
    aliasWirePlatformKeys(platforms);
    assert.equal(platforms.get("whatsapp-business"), state);
    assert.equal(wirePlatformKey("  Slack "), "slack");
    assert.equal(wirePlatformKey("whatsapp business"), "whatsapp-business");
  }

  // Degrades, never throws: an SDK whose internals moved must not 500 the
  // webhook — it falls back to the SDK's own routing, which is still a 200.
  {
    for (const bad of [undefined, null, {}, [], "imessage", 7]) {
      assert.equal(aliasWirePlatformKeys(bad), null, `non-registry input rejected: ${String(bad)}`);
    }
  }

  // readPlatformRegistry digs out the SDK's escape hatch without asserting on
  // shape — anything unexpected reads as undefined, which the caller logs.
  {
    const platforms = new Map<string, unknown>();
    assert.equal(readPlatformRegistry({ __internal: { platforms } }), platforms);
    assert.equal(readPlatformRegistry({ __internal: {} }), undefined);
    assert.equal(readPlatformRegistry({}), undefined);
    assert.equal(readPlatformRegistry(null), undefined);
    assert.equal(readPlatformRegistry(undefined), undefined);
    // End to end: the shape the SDK actually returns → a working wire key.
    const state = {};
    const app = { __internal: { platforms: new Map<string, unknown>([["iMessage", state]]) } };
    aliasWirePlatformKeys(readPlatformRegistry(app));
    assert.equal(app.__internal.platforms.get("imessage"), state);
  }

  // eslint-disable-next-line no-console
  console.log("spectrum-platform-alias.test.ts: all assertions passed");
}

run();
