import { strict as assert } from "node:assert";
import { buildImageContent, VISION_MODEL } from "../agent/vision";

const URL = "https://media.sendblue.example/abc.jpg";

// buildImageContent: image block (URL source) first, then the user's text.
{
  const blocks = buildImageContent(URL, "what does this say?");
  assert.equal(blocks.length, 2);
  assert.deepEqual(blocks[0], { type: "image", source: { type: "url", url: URL } });
  assert.deepEqual(blocks[1], { type: "text", text: "what does this say?" });
}

// A blank/whitespace prompt falls back to a default ask so the model always has
// an instruction (a photo with no caption still gets described).
{
  const blocks = buildImageContent(URL, "   ");
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].type, "image");
  assert.deepEqual(blocks[1], { type: "text", text: "What's in this image?" });
}

// The prompt is trimmed (text-message whitespace shouldn't leak into the block).
{
  const blocks = buildImageContent(URL, "  read the receipt total  ");
  assert.deepEqual(blocks[1], { type: "text", text: "read the receipt total" });
}

// The image URL is carried verbatim into the source block.
{
  const other = "https://example.com/x.png";
  const blocks = buildImageContent(other, "hi");
  const img = blocks[0] as { source: { url: string } };
  assert.equal(img.source.url, other);
}

// Vision defaults to Sonnet (Haiku is weaker at vision).
{
  assert.equal(VISION_MODEL, "claude-sonnet-4-6");
}

// eslint-disable-next-line no-console
console.log("vision.test.ts: all assertions passed");
