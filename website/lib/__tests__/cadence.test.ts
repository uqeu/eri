import { strict as assert } from "node:assert";
import { analyzeCadence } from "../agent/style";

// Not enough signal → null (eri stays single-bubble until it's learned you).
assert.equal(analyzeCadence(["hi", "yo"]), null);

// Short, quick texts → more bubbles allowed.
{
  const c = analyzeCadence(["yo", "wyd", "lol", "nah fr", "u up"]);
  assert.ok(c, "short texter yields a facet");
  assert.equal(c!.maxBubbles, 3);
  assert.ok(c!.descriptor.length > 0);
}

// Medium-length messages → up to two bubbles.
{
  const med = "hey what are you up to today"; // 7 words
  const c = analyzeCadence([med, med, med, med]);
  assert.ok(c);
  assert.equal(c!.maxBubbles, 2);
}

// Fuller messages → a single reply.
{
  const long = "this is a much longer message that has plenty of words in it to read"; // 15 words
  const c = analyzeCadence([long, long, long, long, long]);
  assert.ok(c);
  assert.equal(c!.maxBubbles, 1);
}

// eslint-disable-next-line no-console
console.log("cadence.test.ts: all assertions passed");
