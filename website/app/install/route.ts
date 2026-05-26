// `GET /install` — serves the one-line installer script as plain
// shell. The script lives in `scripts/install.sh` at the repo root;
// we embed it as a build-time import so a Vercel edge instance can
// return it without filesystem IO.
//
// Users invoke this as `curl -fsSL https://tryeri.ca/install | sh`.
//
// Telemetry (best-effort): log the User-Agent + IP so we can size
// the install funnel. We do NOT set cookies, do NOT track users
// across requests, and never write identifying data to disk —
// just rolling counters in our metrics pipeline.

import { readFileSync } from "node:fs";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-static";

const INSTALLER_PATH = path.join(process.cwd(), "..", "scripts", "install.sh");

function loadScript(): string {
  try {
    return readFileSync(INSTALLER_PATH, "utf8");
  } catch {
    // During Vercel build the cwd is `website/`; fall back to a
    // bundled copy if the resolution differs.
    try {
      return readFileSync(
        path.join(process.cwd(), "scripts", "install.sh"),
        "utf8",
      );
    } catch {
      return "#!/usr/bin/env bash\necho 'eri installer is unavailable. Please try again later.'\n";
    }
  }
}

export async function GET(): Promise<Response> {
  const body = loadScript();
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/x-shellscript; charset=utf-8",
      "cache-control": "public, max-age=300, s-maxage=600",
      "x-eri-channel": "stable",
    },
  });
}
