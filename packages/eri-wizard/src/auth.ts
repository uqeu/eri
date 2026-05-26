// Thin wrapper around eri.dev's device-code auth flow. Mirrors the
// shape the eri CLI uses so credentials persist to the same file
// `~/.config/eri/credentials.json`.

import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

const POLL_INTERVAL_MS = 2_000;
const POLL_MAX_MS = 10 * 60 * 1000; // 10 minutes

export interface DeviceStart {
  deviceCode: string;
  userCode: string;
  verificationUrl: string;
}

export interface DevicePoll {
  status: "pending" | "approved" | "denied" | "expired";
  bearer?: string;
  userId?: string;
  email?: string;
  tier?: string;
}

export async function startDeviceFlow(baseUrl: string): Promise<DeviceStart> {
  const response = await fetch(`${baseUrl}/api/v1/auth/device/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  if (!response.ok) {
    throw new Error(`device/start failed: HTTP ${response.status}`);
  }
  const body = (await response.json()) as DeviceStart;
  return {
    deviceCode: body.deviceCode,
    userCode: body.userCode,
    verificationUrl: body.verificationUrl,
  };
}

export async function pollDeviceFlow(
  baseUrl: string,
  deviceCode: string,
): Promise<DevicePoll> {
  const deadline = Date.now() + POLL_MAX_MS;
  while (Date.now() < deadline) {
    const response = await fetch(`${baseUrl}/api/v1/auth/device/poll`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceCode }),
    });
    if (!response.ok) {
      throw new Error(`device/poll failed: HTTP ${response.status}`);
    }
    const body = (await response.json()) as DevicePoll;
    if (body.status === "approved") return body;
    if (body.status === "denied") throw new Error("sign-in denied");
    if (body.status === "expired") throw new Error("sign-in code expired");
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  return { status: "expired" };
}

export interface SavedCredentials {
  baseUrl: string;
  bearer: string;
  userId?: string;
  email?: string;
  tier?: string;
}

export async function saveCredentials(creds: SavedCredentials): Promise<void> {
  const home = process.env.HOME ?? os.homedir();
  const dir = path.join(home, ".config", "eri");
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, "credentials.json");
  const payload = {
    bearer: creds.bearer,
    userId: creds.userId,
    email: creds.email,
    tier: creds.tier,
    baseUrl: creds.baseUrl,
  };
  await fs.writeFile(file, JSON.stringify(payload, null, 2) + "\n", {
    encoding: "utf8",
    mode: 0o600,
  });
}
