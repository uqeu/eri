/**
 * List Composio toolkit slugs (one-off) so we add connectors with EXACT slugs —
 * a wrong slug silently breaks the connect flow.
 *
 *   COMPOSIO_API_KEY=... npx tsx scripts/composio-list-toolkits.ts [filter...]
 */

export {}; // module scope — isolates top-level names from sibling scripts under tsc

async function main(): Promise<void> {
  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey) throw new Error("set COMPOSIO_API_KEY");
  const filters = process.argv.slice(2).map((s) => s.toLowerCase());
  const res0 = await fetch("https://backend.composio.dev/api/v3/toolkits", {
    headers: { "x-api-key": apiKey },
  });
  if (!res0.ok) throw new Error(`toolkits GET -> ${res0.status} ${(await res0.text()).slice(0, 300)}`);
  const json = (await res0.json()) as { items?: Array<{ slug?: string; name?: string }> };
  const items = json.items ?? [];
  const rows = items
    .map((t) => ({ slug: (t.slug ?? "").toLowerCase(), name: t.name ?? "" }))
    .filter((t) => t.slug)
    .filter((t) => !filters.length || filters.some((f) => t.slug.includes(f) || t.name.toLowerCase().includes(f)))
    .sort((a, b) => a.slug.localeCompare(b.slug));
  for (const r of rows) {
    // eslint-disable-next-line no-console
    console.log(`${r.slug}\t${r.name}`);
  }
  // eslint-disable-next-line no-console
  console.log(`\n(${rows.length} shown of ${items.length} total)`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("list-toolkits failed:", err);
  process.exit(1);
});
