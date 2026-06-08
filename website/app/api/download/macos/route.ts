// `GET /api/download/macos` — the macOS download entry point.
//
// eri is pre-launch: there is no public .dmg artifact yet. Rather than serve a
// dead link, this route sends users to early access. When the signed build is
// ready, swap the redirect target for the artifact URL (or stream the .dmg) and
// nothing else on the download page has to change.
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request): NextResponse {
  const url = new URL("/sign-up?from=download-macos", request.url);
  return NextResponse.redirect(url, 302);
}
