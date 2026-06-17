/**
 * Web search for phone eri — the tool that lets eri answer real-time / factual
 * questions (weather, news, prices, "google this", "look this person up").
 *
 * Claude can't browse on its own, so this is the missing capability. Like the
 * connector reads, it resolves IN-CLOUD this turn: eri searches, gets results
 * back, and answers in the same reply — laptop open or closed.
 *
 * Backend-agnostic behind a `WebSearchDeps` seam (so it's testable without
 * network): the route wires the real search (Composio's search tool, free via
 * existing usage; Brave's free-tier API as a fallback). The pure mappers +
 * formatter are unit-tested. Contract: `webSearch` NEVER throws — a failure or
 * an unconfigured backend collapses to `{ items: [], reason }`, so eri says it
 * couldn't find anything rather than crashing the turn.
 */

import type { ToolDef } from "./run_core";

/** One search result, narrowed to what eri needs to answer + cite. */
export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

/** Result of a search. `items` always present (possibly empty); `reason` is a
 *  user-safe explanation when nothing came back. Never thrown. */
export interface WebSearchResult {
  items: SearchHit[];
  reason?: string;
}

/** The search IO, injected so orchestration is testable with stubs. Throws on
 *  failure (webSearch catches and converts to a reason). */
export interface WebSearchDeps {
  runSearch(query: string, limit: number): Promise<SearchHit[]>;
}

/** Cap results fed back to the model — a phone reply stays short + cheap. */
export const MAX_RESULTS = 5;

// ---- pure value guards -----------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
}
function firstString(row: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const k of keys) {
    const s = str(row[k]);
    if (s !== undefined) return s;
  }
  return undefined;
}

/** Narrow a raw row (Brave or Composio shaped) into a SearchHit. Needs a title +
 *  url; snippet optional. Returns undefined for an unusable row. Pure. */
function mapRow(item: unknown): SearchHit | undefined {
  if (!isRecord(item)) return undefined;
  const title = firstString(item, ["title", "name", "heading"]);
  const url = firstString(item, ["url", "link", "href"]);
  if (title === undefined || url === undefined) return undefined;
  const snippet =
    firstString(item, ["snippet", "description", "summary", "content", "text"]) ?? "";
  return { title, url, snippet: truncate(snippet, 200) };
}

/** Pull the result rows out of a Brave response (`web.results[]`). Pure. */
export function mapBraveResults(raw: unknown): SearchHit[] {
  if (!isRecord(raw)) return [];
  const web = raw.web;
  const rows = isRecord(web) && Array.isArray(web.results) ? web.results : [];
  return rows.map(mapRow).filter((h): h is SearchHit => h !== undefined);
}

/** Pull rows out of a Composio search result, tolerant of the common shapes
 *  (`results` / `organic` / `items`, or a bare array). Pure. */
export function mapComposioResults(raw: unknown): SearchHit[] {
  const data = isRecord(raw) && isRecord(raw.data) ? raw.data : raw;
  let rows: unknown[] = [];
  if (Array.isArray(data)) rows = data;
  else if (isRecord(data)) {
    for (const key of ["results", "organic", "items", "organic_results"]) {
      if (Array.isArray(data[key])) {
        rows = data[key] as unknown[];
        break;
      }
    }
  }
  return rows.map(mapRow).filter((h): h is SearchHit => h !== undefined);
}

function truncate(s: string, max: number): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

/** Render results as the compact text fed back to the model. Empty → honest
 *  "couldn't find" so eri doesn't fabricate. Pure + unit-tested. */
export function formatResults(result: WebSearchResult): string {
  if (result.items.length === 0) {
    return result.reason ?? "I couldn't find anything on that.";
  }
  const lines = result.items.map((h) => {
    const snip = h.snippet ? ` — ${h.snippet}` : "";
    return `- ${h.title}${snip} (${h.url})`;
  });
  return [`Here's what I found:`, ...lines].join("\n");
}

/**
 * Search the web. Never throws — an empty query, a failure, or an unconfigured
 * backend all return `{ items: [], reason }`. Results are capped.
 */
export async function webSearch(
  query: string,
  deps: WebSearchDeps,
  opts: { limit?: number } = {},
): Promise<WebSearchResult> {
  const q = query.trim();
  if (!q) return { items: [], reason: "There was no search query." };
  const limit = opts.limit ?? MAX_RESULTS;
  try {
    const items = (await deps.runSearch(q, limit)).slice(0, limit);
    return items.length > 0
      ? { items }
      : { items: [], reason: "I couldn't find anything on that." };
  } catch {
    return { items: [], reason: "I couldn't search the web just now." };
  }
}

/**
 * eri's web-search tool. Resolves in-cloud this turn, so eri reads the results
 * and answers in the same reply. Description reads naturally — no mechanics.
 */
export const WEB_SEARCH_TOOL: ToolDef = {
  name: "web_search",
  description:
    "Search the web for current or factual info you don't already know — weather, news, prices, opening hours, or to look up a person, place, or product. You get the results back this turn, so read them and answer directly with what you find.",
  input_schema: {
    type: "object",
    properties: {
      query: { type: "string", description: "What to search for." },
    },
    required: ["query"],
  },
};
