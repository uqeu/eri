// UsageClient — fetches the current period's token usage from /api/v1/usage
// and exposes it as a vscode.Event so the status bar and webview can react.
//
// Handles auth errors gracefully:
//   - 401 / 403 → treat as "session invalid", emit null, caller can sign-out.
//   - over_quota body → still emits the usage payload; UI shows red.

import * as vscode from "vscode";
import { EriSession, EriTier, UsageSummary, isEriTier } from "./types";

interface UsageResponse {
  readonly tier: EriTier;
  readonly tokensUsed: number;
  readonly tokensIncluded: number;
  readonly tokensGhost: number;
  readonly remainingIncluded: number;
  readonly remainingGhost: number;
  readonly softCapWarning: boolean;
  readonly periodEnd: string;
}

export interface UsageClientDeps {
  readonly getSession: () => EriSession | null;
  readonly baseUrl: string;
  readonly fetchImpl?: typeof fetch;
  readonly onUnauthorized?: () => void;
}

const DEFAULT_INTERVAL_SEC = 30;

export class UsageClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly emitter = new vscode.EventEmitter<UsageSummary | null>();
  private last: UsageSummary | null = null;

  constructor(private readonly deps: UsageClientDeps) {
    this.baseUrl = deps.baseUrl.replace(/\/+$/, "");
    this.fetchImpl = deps.fetchImpl ?? fetch;
  }

  get onUsage(): vscode.Event<UsageSummary | null> {
    return this.emitter.event;
  }

  current(): UsageSummary | null {
    return this.last;
  }

  /** Returns null if not signed in or fetch failed. */
  async fetchUsage(): Promise<UsageSummary | null> {
    const session = this.deps.getSession();
    if (!session) {
      this.last = null;
      this.emitter.fire(null);
      return null;
    }
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/api/v1/usage`, {
        method: "GET",
        headers: { authorization: `Bearer ${session.token}` },
      });
    } catch {
      return this.last;
    }
    if (res.status === 401 || res.status === 403) {
      this.deps.onUnauthorized?.();
      this.last = null;
      this.emitter.fire(null);
      return null;
    }
    if (!res.ok) {
      return this.last;
    }
    const parsed = parseUsage(await safeJson(res));
    if (!parsed) {
      return this.last;
    }
    this.last = parsed;
    this.emitter.fire(parsed);
    return parsed;
  }

  startPolling(intervalSec: number = DEFAULT_INTERVAL_SEC): vscode.Disposable {
    const ms = Math.max(5, intervalSec) * 1000;
    // Fire immediately, then on interval.
    void this.fetchUsage();
    const timer = setInterval(() => {
      void this.fetchUsage();
    }, ms);
    return new vscode.Disposable(() => clearInterval(timer));
  }

  dispose(): void {
    this.emitter.dispose();
  }
}

function parseUsage(payload: unknown): UsageResponse | null {
  if (typeof payload !== "object" || payload === null) return null;
  const obj = payload as Record<string, unknown>;
  if (!isEriTier(obj.tier)) return null;
  const num = (key: string): number | null => {
    const v = obj[key];
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  };
  const tokensUsed = num("tokensUsed");
  const tokensIncluded = num("tokensIncluded");
  const tokensGhost = num("tokensGhost");
  const remainingIncluded = num("remainingIncluded");
  const remainingGhost = num("remainingGhost");
  if (
    tokensUsed === null ||
    tokensIncluded === null ||
    tokensGhost === null ||
    remainingIncluded === null ||
    remainingGhost === null
  ) {
    return null;
  }
  const softCapWarning = obj.softCapWarning === true;
  const periodEnd = typeof obj.periodEnd === "string" ? obj.periodEnd : "";
  return {
    tier: obj.tier,
    tokensUsed,
    tokensIncluded,
    tokensGhost,
    remainingIncluded,
    remainingGhost,
    softCapWarning,
    periodEnd,
  };
}

async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/** Pure helper: percentage of included tokens still available, clamped 0..100. */
export function remainingIncludedPct(usage: UsageSummary): number {
  if (usage.tokensIncluded <= 0) return 0;
  const pct = (usage.remainingIncluded / usage.tokensIncluded) * 100;
  if (!Number.isFinite(pct)) return 0;
  if (pct < 0) return 0;
  if (pct > 100) return 100;
  return pct;
}
