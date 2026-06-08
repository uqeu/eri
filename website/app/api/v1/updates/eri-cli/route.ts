import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Channel = "stable" | "beta" | "nightly";

const CHANNELS = new Set<Channel>(["stable", "beta", "nightly"]);
const DEFAULT_VERSION = "0.1.0";

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const channel = parseChannel(url.searchParams.get("channel"));
  if (!channel) {
    return NextResponse.json({ error: "invalid_channel" }, { status: 400 });
  }

  const currentVersion =
    url.searchParams.get("version") ||
    request.headers.get("x-eri-current-version") ||
    "0.0.0";
  const target = url.searchParams.get("target") || "unknown";
  const latestVersion = envForChannel("ERI_CLI_LATEST_VERSION", channel) || DEFAULT_VERSION;

  return NextResponse.json(
    {
      name: "eri-cli",
      channel,
      currentVersion,
      version: latestVersion,
      updateAvailable: versionIsNewer(latestVersion, currentVersion),
      minimumVersion: process.env.ERI_CLI_MINIMUM_VERSION ?? null,
      target,
      installerUrl: process.env.ERI_CLI_INSTALLER_URL ?? "https://tryeri.ca/install",
      archiveUrl: envForChannel("ERI_CLI_ARCHIVE_URL", channel),
      signatureUrl: envForChannel("ERI_CLI_SIGNATURE_URL", channel),
      sha256: envForChannel("ERI_CLI_SHA256", channel),
      publishedAt: process.env.ERI_CLI_PUBLISHED_AT ?? new Date().toISOString(),
      notes: releaseNotes(channel),
      autoUpdate: process.env.ERI_CLI_AUTO_UPDATE === "true",
    },
    {
      status: 200,
      headers: {
        "cache-control": "no-store",
      },
    },
  );
}

function parseChannel(value: string | null): Channel | null {
  const candidate = (value || "stable").toLowerCase();
  return CHANNELS.has(candidate as Channel) ? (candidate as Channel) : null;
}

function envForChannel(prefix: string, channel: Channel): string | null {
  const channelKey = `${prefix}_${channel.toUpperCase()}`;
  return process.env[channelKey] || process.env[prefix] || null;
}

function releaseNotes(channel: Channel): string[] {
  const raw = envForChannel("ERI_CLI_RELEASE_NOTES", channel);
  if (!raw) {
    return [
      "Adds local agent lifecycle checks for auth, MCP, workflow manifests, and updates.",
      "Keeps installable Eri connected to the signed server release channel.",
    ];
  }
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function versionIsNewer(latest: string, current: string): boolean {
  const latestParts = numericParts(latest);
  const currentParts = numericParts(current);
  const len = Math.max(latestParts.length, currentParts.length);
  for (let i = 0; i < len; i += 1) {
    const l = latestParts[i] ?? 0;
    const c = currentParts[i] ?? 0;
    if (l !== c) return l > c;
  }
  return false;
}

function numericParts(input: string): number[] {
  return input.split(/[.-]/).map((part) => {
    const digits = part.match(/^\d+/)?.[0];
    return digits ? Number.parseInt(digits, 10) : 0;
  });
}
