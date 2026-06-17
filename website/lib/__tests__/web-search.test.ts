import { strict as assert } from "node:assert";
import {
  formatResults,
  mapBraveResults,
  mapComposioResults,
  webSearch,
  WEB_SEARCH_TOOL,
} from "../agent/web_search";

// Brave shape: { web: { results: [{title, url, description}] } }
{
  const hits = mapBraveResults({
    web: { results: [{ title: "Weather", url: "https://w", description: "12°C cloudy" }, { nope: 1 }] },
  });
  assert.equal(hits.length, 1, "drops rows missing title/url");
  assert.equal(hits[0].title, "Weather");
  assert.equal(hits[0].snippet, "12°C cloudy");
  assert.deepEqual(mapBraveResults({}), []);
}

// Composio shape: tolerant of data.results / organic / bare array; link or url.
{
  const a = mapComposioResults({ data: { results: [{ title: "T", link: "https://l", snippet: "s" }] } });
  assert.equal(a.length, 1);
  assert.equal(a[0].url, "https://l");
  const b = mapComposioResults({ organic: [{ name: "N", url: "https://u" }] });
  assert.equal(b.length, 1);
  assert.equal(b[0].title, "N");
  assert.deepEqual(mapComposioResults("garbage"), []);
}

// formatResults: hits → list; empty → honest reason, never fabricated.
{
  const f = formatResults({ items: [{ title: "T", url: "https://u", snippet: "s" }] });
  assert.ok(f.includes("Here's what I found"));
  assert.ok(f.includes("https://u"));
  assert.equal(formatResults({ items: [], reason: "couldn't search" }), "couldn't search");
  assert.ok(formatResults({ items: [] }).toLowerCase().includes("couldn't find"));
}

// Tool is well-formed + reads naturally (no mechanics).
{
  assert.equal(WEB_SEARCH_TOOL.name, "web_search");
  assert.ok(!/composio|brave|api/i.test(WEB_SEARCH_TOOL.description));
}

// webSearch never throws: a thrown backend → reason, blank query → reason.
async function run() {
  const ok = await webSearch("hi", { runSearch: async () => [{ title: "T", url: "https://u", snippet: "" }] });
  assert.equal(ok.items.length, 1);
  const boom = await webSearch("hi", { runSearch: async () => { throw new Error("down"); } });
  assert.equal(boom.items.length, 0);
  assert.ok(boom.reason);
  const blank = await webSearch("   ", { runSearch: async () => { throw new Error("should not run"); } });
  assert.equal(blank.items.length, 0);

  // eslint-disable-next-line no-console
  console.log("web-search.test.ts: all assertions passed");
}

run();
