// OAuth device-authorization flow against eri.dev.
//
// Flow:
//   1. POST /api/v1/auth/device/start      → { deviceCode, userCode, verifyUrl, pollIntervalSec, expiresInSec }
//   2. Open verifyUrl in browser (user enters userCode or approves directly).
//   3. Poll /api/v1/auth/device/poll       → { status: "pending"|"approved"|"denied"|"expired", token? }
//      (May be short-circuited by a UriHandler delivering an "auth/callback?code=" deep link.)
//   4. GET  /api/v1/me with Bearer token   → { userId, email, tier } → EriSession.

import { EriSession, EriTier, isEriTier } from "./types";

interface DeviceStartResponse {
  readonly deviceCode: string;
  readonly userCode: string;
  readonly verifyUrl: string;
  readonly pollIntervalSec: number;
  readonly expiresInSec: number;
}

interface DevicePollResponse {
  readonly status: "pending" | "approved" | "denied" | "expired";
  readonly token?: string;
}

interface MeResponse {
  readonly userId: string;
  readonly email: string;
  readonly tier: EriTier;
}

export interface DeviceCodeOpener {
  open(url: string): Promise<void>;
}

export interface DeviceCodeUi {
  /** Surface the verifyUrl + userCode to the user so they can approve. */
  show(start: DeviceStartResponse): void;
  hide(): void;
}

export interface DeviceCodeDeps {
  readonly baseUrl: string;
  readonly fetchImpl?: typeof fetch;
  readonly opener?: DeviceCodeOpener;
  readonly ui?: DeviceCodeUi;
  readonly clock?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
  /**
   * Optional channel for an external "deep link arrived" signal. The IDE
   * UriHandler resolves the returned promise with the device code as soon
   * as `eri://auth/callback?code=…` is received, skipping the next poll wait.
   */
  readonly waitForDeepLink?: () => Promise<string | null>;
  /** Hard wall-clock cap for the whole flow. Default: 10 minutes. */
  readonly timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const MIN_POLL_INTERVAL_MS = 1_000;

export class DeviceCodeError extends Error {
  constructor(
    message: string,
    public readonly kind: "denied" | "expired" | "timeout" | "network" | "bad_response",
  ) {
    super(message);
    this.name = "DeviceCodeError";
  }
}

export class DeviceCodeFlow {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly opener: DeviceCodeOpener;
  private readonly ui: DeviceCodeUi;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly waitForDeepLink: (() => Promise<string | null>) | undefined;
  private readonly timeoutMs: number;
  private cancelled = false;

  constructor(deps: DeviceCodeDeps) {
    this.baseUrl = deps.baseUrl.replace(/\/+$/, "");
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.opener = deps.opener ?? { open: async () => undefined };
    this.ui = deps.ui ?? { show: () => undefined, hide: () => undefined };
    this.now = deps.clock ?? (() => Date.now());
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.waitForDeepLink = deps.waitForDeepLink;
    this.timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  cancel(): void {
    this.cancelled = true;
  }

  async run(): Promise<EriSession> {
    const start = await this.startDevice();
    this.ui.show(start);
    try {
      await this.opener.open(start.verifyUrl);
      const token = await this.pollUntilApproved(start);
      const me = await this.fetchMe(token);
      const session: EriSession = {
        token,
        userId: me.userId,
        email: me.email,
        tier: me.tier,
        signedInAt: new Date(this.now()).toISOString(),
      };
      return session;
    } finally {
      this.ui.hide();
    }
  }

  private async startDevice(): Promise<DeviceStartResponse> {
    const res = await this.safeFetch(`${this.baseUrl}/api/v1/auth/device/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientId: "eri-ide", scope: "ide" }),
    });
    if (!res.ok) {
      throw new DeviceCodeError(`device/start ${res.status}`, "network");
    }
    const parsed = parseDeviceStart(await safeJson(res));
    if (!parsed) {
      throw new DeviceCodeError("device/start returned malformed payload", "bad_response");
    }
    return parsed;
  }

  private async pollUntilApproved(start: DeviceStartResponse): Promise<string> {
    const intervalMs = Math.max(MIN_POLL_INTERVAL_MS, start.pollIntervalSec * 1000);
    const deadline = this.now() + Math.min(this.timeoutMs, start.expiresInSec * 1000);

    while (!this.cancelled && this.now() < deadline) {
      const deepLinkPromise = this.waitForDeepLink?.();
      const winner = deepLinkPromise
        ? await raceFastestFirst(deepLinkPromise, this.sleep(intervalMs))
        : await this.sleep(intervalMs);
      // If a deep link arrived, swap to using its code as the device code.
      const overrideCode = typeof winner === "string" ? winner : null;
      const deviceCode = overrideCode ?? start.deviceCode;

      const res = await this.safeFetch(`${this.baseUrl}/api/v1/auth/device/poll`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deviceCode }),
      });
      if (!res.ok) {
        // Treat transient HTTP errors as continue-polling, not fatal.
        continue;
      }
      const poll = parseDevicePoll(await safeJson(res));
      if (!poll) {
        continue;
      }
      switch (poll.status) {
        case "approved":
          if (!poll.token) {
            throw new DeviceCodeError("approved without token", "bad_response");
          }
          return poll.token;
        case "denied":
          throw new DeviceCodeError("Sign-in denied", "denied");
        case "expired":
          throw new DeviceCodeError("Device code expired", "expired");
        case "pending":
        default:
          continue;
      }
    }

    throw new DeviceCodeError(
      this.cancelled ? "Sign-in cancelled" : "Sign-in timed out",
      "timeout",
    );
  }

  private async fetchMe(token: string): Promise<MeResponse> {
    const res = await this.safeFetch(`${this.baseUrl}/api/v1/me`, {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      throw new DeviceCodeError(`/api/v1/me ${res.status}`, "network");
    }
    const me = parseMe(await safeJson(res));
    if (!me) {
      throw new DeviceCodeError("/api/v1/me malformed payload", "bad_response");
    }
    return me;
  }

  private async safeFetch(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetchImpl(url, init);
    } catch (err: unknown) {
      throw new DeviceCodeError(getMessage(err), "network");
    }
  }
}

// --- parsers (no `any`, narrow `unknown` safely) -----------------------------

function parseDeviceStart(payload: unknown): DeviceStartResponse | null {
  if (typeof payload !== "object" || payload === null) return null;
  const obj = payload as Record<string, unknown>;
  if (typeof obj.deviceCode !== "string") return null;
  if (typeof obj.userCode !== "string") return null;
  if (typeof obj.verifyUrl !== "string") return null;
  const pollIntervalSec = typeof obj.pollIntervalSec === "number" ? obj.pollIntervalSec : 5;
  const expiresInSec = typeof obj.expiresInSec === "number" ? obj.expiresInSec : 600;
  return {
    deviceCode: obj.deviceCode,
    userCode: obj.userCode,
    verifyUrl: obj.verifyUrl,
    pollIntervalSec,
    expiresInSec,
  };
}

function parseDevicePoll(payload: unknown): DevicePollResponse | null {
  if (typeof payload !== "object" || payload === null) return null;
  const obj = payload as Record<string, unknown>;
  const status = obj.status;
  if (
    status !== "pending" &&
    status !== "approved" &&
    status !== "denied" &&
    status !== "expired"
  ) {
    return null;
  }
  const token = typeof obj.token === "string" ? obj.token : undefined;
  return token !== undefined ? { status, token } : { status };
}

function parseMe(payload: unknown): MeResponse | null {
  if (typeof payload !== "object" || payload === null) return null;
  const obj = payload as Record<string, unknown>;
  if (typeof obj.userId !== "string") return null;
  if (typeof obj.email !== "string") return null;
  if (!isEriTier(obj.tier)) return null;
  return { userId: obj.userId, email: obj.email, tier: obj.tier };
}

async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function getMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "unknown network error";
}

/**
 * Returns whichever input resolves first. If the second (timer) resolves with
 * `undefined`, we surface `undefined` (i.e. "interval elapsed"). If the
 * first (deep-link) resolves with a string code, we surface that.
 */
async function raceFastestFirst(
  deepLink: Promise<string | null>,
  timer: Promise<void>,
): Promise<string | undefined> {
  const dl = deepLink.then((code) => (code ? code : Symbol("none")));
  const tm = timer.then(() => Symbol("tick"));
  const winner = await Promise.race([dl, tm]);
  return typeof winner === "string" ? winner : undefined;
}
