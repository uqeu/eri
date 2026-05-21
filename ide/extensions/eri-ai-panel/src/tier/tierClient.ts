import * as vscode from "vscode";
import { Sidecar } from "../sidecar";

export type TierName = "Free" | "Starter" | "Pro" | "Pro+" | "Teams";

export type Feature =
  | "voice"
  | "diffusionPreview"
  | "iterationHistory"
  | "gaze"
  | "inlineEdit"
  | "composer"
  | "agentMode"
  | "mentions"
  | "codebaseIndex"
  | "mcp"
  | "multiModel"
  | "cloudAgents"
  | "exclusiveVoices"
  | "codebaseTrainedBrain"
  | "privateContext"
  | "polishQueue"
  | "sso"
  | "auditLogs"
  | "scim";

interface RateLimits {
  perMonth: number;
  perWeek: number;
  perDay: number;
  perHour: number;
}

interface MeResponse {
  userId: string;
  tier: TierName;
  features: Feature[];
  rateLimits: RateLimits;
}

interface CachedTierState {
  tier: TierName;
  features: Feature[];
  rateLimits?: RateLimits;
}

const TIER_NAMES: ReadonlyArray<TierName> = ["Free", "Starter", "Pro", "Pro+", "Teams"];
const FEATURE_NAMES: ReadonlyArray<Feature> = [
  "voice",
  "diffusionPreview",
  "iterationHistory",
  "gaze",
  "inlineEdit",
  "composer",
  "agentMode",
  "mentions",
  "codebaseIndex",
  "mcp",
  "multiModel",
  "cloudAgents",
  "exclusiveVoices",
  "codebaseTrainedBrain",
  "privateContext",
  "polishQueue",
  "sso",
  "auditLogs",
  "scim",
];

const SECRET_KEY = "eri.accessToken";
const STATE_KEY = "eri.tierState";
const POLL_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_API_BASE = "https://eri.dev";

function isTierName(value: unknown): value is TierName {
  return typeof value === "string" && (TIER_NAMES as ReadonlyArray<string>).includes(value);
}

function isFeature(value: unknown): value is Feature {
  return typeof value === "string" && (FEATURE_NAMES as ReadonlyArray<string>).includes(value);
}

function parseMeResponse(payload: unknown): MeResponse | null {
  if (typeof payload !== "object" || payload === null) return null;
  const obj = payload as Record<string, unknown>;
  if (typeof obj.userId !== "string") return null;
  if (!isTierName(obj.tier)) return null;
  if (!Array.isArray(obj.features)) return null;
  const features = obj.features.filter(isFeature);
  const rateLimits = obj.rateLimits as RateLimits | undefined;
  return {
    userId: obj.userId,
    tier: obj.tier,
    features,
    ...(rateLimits ? { rateLimits } : {}),
  } as MeResponse;
}

export interface TierClientHandle {
  getTier(): TierName;
  getFeatures(): ReadonlySet<Feature>;
  refresh(): Promise<void>;
  dispose(): void;
}

export function activateTierClient(
  context: vscode.ExtensionContext,
  getSidecar: () => Sidecar | null,
): TierClientHandle {
  let state: CachedTierState = loadCached(context) ?? { tier: "Free", features: [] };
  let timer: NodeJS.Timeout | null = null;

  const apply = (): void => {
    void vscode.commands.executeCommand("setContext", "eri.tier", state.tier);
    const allowed = new Set(state.features);
    for (const feature of FEATURE_NAMES) {
      void vscode.commands.executeCommand(
        "setContext",
        `eri.feature.${feature}`,
        allowed.has(feature),
      );
    }
    // Mirror the same source of truth into the Rust sidecar so request-level
    // gating matches the UI without a second source of truth.
    getSidecar()?.notify("eri/auth/setTier", {
      tier: state.tier,
      features: state.features,
    });
  };

  const fetchAndApply = async (): Promise<void> => {
    const token = await context.secrets.get(SECRET_KEY);
    if (!token) {
      // No token yet — Free tier silently. Apply so context keys exist.
      state = { tier: "Free", features: [] };
      apply();
      return;
    }
    const baseUrl =
      vscode.workspace.getConfiguration("eri").get<string>("apiBaseUrl")?.trim() ||
      DEFAULT_API_BASE;
    try {
      const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/v1/me`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        console.warn(`[eri] /api/v1/me returned ${response.status}; using Free fallback`);
        state = { tier: "Free", features: [] };
        apply();
        return;
      }
      const json: unknown = await response.json();
      const parsed = parseMeResponse(json);
      if (!parsed) {
        console.warn("[eri] /api/v1/me returned unexpected payload; using Free fallback");
        state = { tier: "Free", features: [] };
        apply();
        return;
      }
      state = {
        tier: parsed.tier,
        features: parsed.features,
        ...(parsed.rateLimits ? { rateLimits: parsed.rateLimits } : {}),
      };
      await context.workspaceState.update(STATE_KEY, state);
      apply();
    } catch (err) {
      // Offline / DNS / fetch failure — keep the previous tier (which may be
      // a cached paid tier from last session) but never escalate above what
      // we already have.
      console.warn("[eri] tier fetch failed, keeping cached tier", err);
      apply();
    }
  };

  // Apply cached state immediately so UI doesn't flicker between
  // "Free" and the real tier on cold start.
  apply();
  void fetchAndApply();
  timer = setInterval(() => {
    void fetchAndApply();
  }, POLL_INTERVAL_MS);

  return {
    getTier: () => state.tier,
    getFeatures: () => new Set(state.features),
    refresh: fetchAndApply,
    dispose: () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}

function loadCached(context: vscode.ExtensionContext): CachedTierState | null {
  const raw = context.workspaceState.get<unknown>(STATE_KEY);
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  if (!isTierName(obj.tier)) return null;
  if (!Array.isArray(obj.features)) return null;
  const features = obj.features.filter(isFeature);
  return { tier: obj.tier, features };
}
