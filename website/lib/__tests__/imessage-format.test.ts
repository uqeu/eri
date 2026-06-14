import { strict as assert } from "node:assert";
import { chunkMessage, formatReply, stripMarkdown } from "../imessage/format";

// Markdown is stripped to plain text (iMessage shows the syntax otherwise).
{
  assert.equal(stripMarkdown("**bold** and *italic* and `code`"), "bold and italic and code");
  assert.equal(stripMarkdown("# Heading\n\ntext"), "Heading\n\ntext");
  assert.equal(stripMarkdown("see [eri](https://tryeri.ca)"), "see eri (https://tryeri.ca)");
  assert.equal(stripMarkdown("```ts\nconst x = 1;\n```"), "const x = 1;");
  // snake_case identifiers must survive (underscores aren't always italics)
  assert.equal(stripMarkdown("call run_core now"), "call run_core now");
}

// Short replies are a single chunk; empty input yields no chunks.
{
  assert.deepEqual(chunkMessage("hi there"), ["hi there"]);
  assert.deepEqual(chunkMessage("   "), []);
}

// Long replies chunk on friendly boundaries and never exceed the cap.
{
  const para = "Sentence one is here. Sentence two follows. ".repeat(80); // ~3500 chars
  const chunks = chunkMessage(para, 1500);
  assert.ok(chunks.length >= 2, "should split into multiple chunks");
  for (const c of chunks) assert.ok(c.length <= 1500, `chunk too long: ${c.length}`);
  // Reassembled (modulo whitespace) it's the same content.
  assert.equal(chunks.join(" ").replace(/\s+/g, " ").trim(), para.replace(/\s+/g, " ").trim());
}

// A single oversized token is hard-split rather than looping forever.
{
  const huge = "x".repeat(4000);
  const chunks = chunkMessage(huge, 1500);
  assert.ok(chunks.length >= 3);
  for (const c of chunks) assert.ok(c.length <= 1500);
}

// formatReply = strip then chunk.
{
  const out = formatReply("**hello** world");
  assert.deepEqual(out, ["hello world"]);
}

// eslint-disable-next-line no-console
console.log("imessage-format.test.ts: all assertions passed");
