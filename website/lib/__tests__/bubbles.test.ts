import { strict as assert } from "node:assert";
import { splitIntoBubbles, MAX_BUBBLES } from "../messaging/bubbles";

// maxBubbles <= 1 → a single logical message (today's behavior), blank line kept.
{
  const out = splitIntoBubbles("hey\n\nhow are you", 1);
  assert.equal(out.length, 1, "cap 1 → one message");
}

// Blank-line separated reply → multiple bubbles when the cap allows.
{
  const out = splitIntoBubbles("hey\n\nhow are you\n\nwhat's up", 3);
  assert.deepEqual(out, ["hey", "how are you", "what's up"]);
}

// A single line never over-splits, even with a high cap.
{
  assert.deepEqual(splitIntoBubbles("just one thing", 3), ["just one thing"]);
}

// Overflow folds into the LAST bubble (never drops the tail).
{
  const out = splitIntoBubbles("a\n\nb\n\nc\n\nd\n\ne", 3);
  assert.equal(out.length, 3);
  assert.equal(out[0], "a");
  assert.equal(out[1], "b");
  assert.equal(out[2], "c\n\nd\n\ne");
}

// Markdown is stripped before bubbling.
{
  assert.deepEqual(splitIntoBubbles("**hi**\n\n`code`", 2), ["hi", "code"]);
}

// Empty / whitespace → no bubbles.
{
  assert.deepEqual(splitIntoBubbles("", 3), []);
  assert.deepEqual(splitIntoBubbles("   ", 3), []);
}

// The cap is bounded by MAX_BUBBLES no matter what's requested.
{
  const out = splitIntoBubbles("a\n\nb\n\nc\n\nd\n\ne\n\nf", 99);
  assert.equal(out.length, MAX_BUBBLES);
}

// eslint-disable-next-line no-console
console.log("bubbles.test.ts: all assertions passed");
