// Pure mapping from VSCode configuration + workspace/global state to the
// shape the settings-hub webview hydrates from. Kept side-effect free so it
// can be unit-tested without spinning up a real ExtensionContext.

export type AppearanceTheme = "light" | "dark" | "auto";
export type UpdateChannel = "Stable" | "Insiders";

export interface ConfigSource {
  get<T>(key: string): T | undefined;
}

export interface StateSource {
  get<T>(key: string): T | undefined;
}

export interface ProviderSummary {
  readonly id: string;
  readonly displayName: string;
  readonly hasKey: boolean;
}

export interface McpSummary {
  readonly name: string;
  readonly state: "online" | "offline" | "error";
}

export interface IndexSummary {
  readonly files: number;
  readonly chunks: number;
}

export interface AccountSummary {
  readonly signedIn: boolean;
  readonly tier: string;
  readonly billingUrl: string;
}

export interface AboutInfo {
  readonly version: string;
  readonly buildDate: string;
  readonly channel: UpdateChannel;
}

export interface SettingsHubState {
  readonly account: AccountSummary;
  readonly providers: ReadonlyArray<ProviderSummary>;
  readonly voice: {
    readonly enabled: boolean;
    readonly preset: string;
    readonly micPermission: "granted" | "denied" | "prompt" | "unknown";
  };
  readonly gaze: {
    readonly enabled: boolean;
    readonly sensitivity: number;
    readonly lastCalibration: string | null;
  };
  readonly model: {
    readonly default: string;
    readonly autoRouting: boolean;
  };
  readonly index: {
    readonly enabled: boolean;
    readonly summary: IndexSummary;
  };
  readonly mcp: ReadonlyArray<McpSummary>;
  readonly rules: {
    readonly count: number;
  };
  readonly privacy: {
    readonly telemetry: boolean;
  };
  readonly appearance: {
    readonly theme: AppearanceTheme;
    readonly fontSize: number;
  };
  readonly about: AboutInfo;
}

export interface BuildStateInput {
  readonly config: ConfigSource;
  readonly workspaceState: StateSource;
  readonly account: AccountSummary;
  readonly providers: ReadonlyArray<ProviderSummary>;
  readonly micPermission: "granted" | "denied" | "prompt" | "unknown";
  readonly indexSummary: IndexSummary;
  readonly mcp: ReadonlyArray<McpSummary>;
  readonly rulesCount: number;
  readonly about: AboutInfo;
}

const DEFAULTS = {
  voiceEnabled: true,
  voicePreset: "lumen",
  gazeEnabled: true,
  gazeSensitivity: 50,
  modelDefault: "auto",
  modelAutoRouting: true,
  indexEnabled: true,
  telemetry: false,
  theme: "auto" as AppearanceTheme,
  fontSize: 13,
} as const;

function readBool(source: ConfigSource, key: string, fallback: boolean): boolean {
  const value = source.get<unknown>(key);
  return typeof value === "boolean" ? value : fallback;
}

function readNumber(
  source: ConfigSource,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const value = source.get<unknown>(key);
  if (typeof value !== "number" || Number.isNaN(value)) {
    return fallback;
  }
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function readString(source: { get<T>(key: string): T | undefined }, key: string, fallback: string): string {
  const value = source.get<unknown>(key);
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function readTheme(source: ConfigSource): AppearanceTheme {
  const value = source.get<unknown>("appearance.theme");
  if (value === "light" || value === "dark" || value === "auto") {
    return value;
  }
  return DEFAULTS.theme;
}

export function buildSettingsHubState(input: BuildStateInput): SettingsHubState {
  const { config, workspaceState } = input;
  return {
    account: input.account,
    providers: input.providers,
    voice: {
      enabled: readBool(config, "voice.enabled", DEFAULTS.voiceEnabled),
      preset: readString(workspaceState, "eri.voice.preset", DEFAULTS.voicePreset),
      micPermission: input.micPermission,
    },
    gaze: {
      enabled: readBool(config, "gaze.enabled", DEFAULTS.gazeEnabled),
      sensitivity: readGazeSensitivity(workspaceState),
      lastCalibration: readString(workspaceState, "eri.gaze.lastCalibration", "") || null,
    },
    model: {
      default: readString(config, "model.default", DEFAULTS.modelDefault),
      autoRouting: readBool(config, "model.autoRouting", DEFAULTS.modelAutoRouting),
    },
    index: {
      enabled: readBool(config, "index.enabled", DEFAULTS.indexEnabled),
      summary: input.indexSummary,
    },
    mcp: input.mcp,
    rules: { count: input.rulesCount },
    privacy: {
      telemetry: readBool(config, "privacy.telemetry", DEFAULTS.telemetry),
    },
    appearance: {
      theme: readTheme(config),
      fontSize: readNumber(config, "appearance.fontSize", DEFAULTS.fontSize, 10, 20),
    },
    about: input.about,
  };
}

// Whitelisted configuration keys the webview is allowed to write back. Any
// other key is rejected by `applyConfigUpdate`.
const ALLOWED_CONFIG_KEYS: ReadonlySet<string> = new Set([
  "voice.enabled",
  "gaze.enabled",
  "model.default",
  "model.autoRouting",
  "index.enabled",
  "privacy.telemetry",
  "appearance.theme",
  "appearance.fontSize",
]);

const ALLOWED_WORKSPACE_KEYS: ReadonlySet<string> = new Set([
  "eri.voice.preset",
  "eri.gaze.sensitivity",
  "eri.gaze.lastCalibration",
]);

export function isAllowedConfigKey(key: string): boolean {
  return ALLOWED_CONFIG_KEYS.has(key);
}

export function isAllowedWorkspaceKey(key: string): boolean {
  return ALLOWED_WORKSPACE_KEYS.has(key);
}

// Coerces an unknown value from the webview into the type appropriate for the
// given configuration key. Returns `undefined` to signal "reject".
export function coerceConfigValue(key: string, raw: unknown): unknown {
  switch (key) {
    case "voice.enabled":
    case "gaze.enabled":
    case "model.autoRouting":
    case "index.enabled":
    case "privacy.telemetry":
      return typeof raw === "boolean" ? raw : undefined;
    case "model.default":
      return typeof raw === "string" && raw.length > 0 ? raw : undefined;
    case "appearance.theme":
      return raw === "light" || raw === "dark" || raw === "auto" ? raw : undefined;
    case "appearance.fontSize":
      if (typeof raw !== "number" || Number.isNaN(raw)) return undefined;
      if (raw < 10) return 10;
      if (raw > 20) return 20;
      return raw;
    default:
      return undefined;
  }
}

export function coerceWorkspaceValue(key: string, raw: unknown): unknown {
  switch (key) {
    case "eri.voice.preset":
      return typeof raw === "string" && raw.length > 0 ? raw : undefined;
    case "eri.gaze.sensitivity":
      if (typeof raw !== "number" || Number.isNaN(raw)) return undefined;
      if (raw < 1) return 1;
      if (raw > 100) return 100;
      return raw;
    case "eri.gaze.lastCalibration":
      return typeof raw === "string" ? raw : undefined;
    default:
      return undefined;
  }
}
