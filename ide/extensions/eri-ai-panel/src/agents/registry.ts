// AgentRegistry — single source of truth for available agents in this
// extension activation. Maintains the active-agent selection (persisted
// to globalState) and emits change events when availability shifts.
//
// The registry is intentionally synchronous on the read path (list/get)
// so the UI can render without awaiting filesystem / network. Mutations
// (refreshAvailability / setActive) are async.

import * as vscode from "vscode";
import { AGENT_ID, builtinDescriptors } from "./builtins";
import { detectCliBinaries, loadUserAgentFiles, WhichRunner } from "./detection";
import { AgentDescriptor, AgentKind, AgentVendor } from "./types";

export interface SessionLike {
  /** Returns true when an eri session token is present (proxy auth ok). */
  isSignedIn(): boolean;
}

export interface SecretsLike {
  has(providerId: string, fieldKey: string): Promise<boolean>;
}

const ACTIVE_KEY = "eri.agents.activeId.v1";
const BYOK_PROVIDER_FIELD: Readonly<Record<AgentVendor, [string, string] | null>> = {
  anthropic: ["anthropic", "anthropic-api-key"],
  openai: ["openai", "openai-api-key"],
  google: ["google", "google-api-key"],
  eri: null,
  local: null,
  custom: null,
};

export interface AgentRegistryOptions {
  readonly session: SessionLike;
  readonly secrets: SecretsLike;
  readonly globalState: vscode.Memento;
  readonly getWorkspaceRoot: () => string | undefined;
  /** Override for testing — defaults to spawning `/usr/bin/which`. */
  readonly which?: WhichRunner;
}

export class AgentRegistry implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<AgentDescriptor>();
  private descriptors = new Map<string, AgentDescriptor>();
  private activeId: string;

  constructor(private readonly opts: AgentRegistryOptions) {
    const persisted = opts.globalState.get<string>(ACTIVE_KEY);
    this.activeId = typeof persisted === "string" && persisted.length > 0
      ? persisted
      : AGENT_ID.auto;
    this.rebuildSync();
  }

  list(): ReadonlyArray<AgentDescriptor> {
    return Array.from(this.descriptors.values());
  }

  get(id: string): AgentDescriptor | undefined {
    return this.descriptors.get(id);
  }

  active(): AgentDescriptor {
    const found = this.descriptors.get(this.activeId);
    if (found && found.available) {
      return found;
    }
    // Fallback to Auto / Mercury when previously selected agent is unavailable.
    const fallback =
      this.descriptors.get(AGENT_ID.auto) ?? this.descriptors.get(AGENT_ID.mercury);
    if (fallback) {
      return fallback;
    }
    // Defensive — should never hit; return any first descriptor.
    const first = this.descriptors.values().next();
    if (first.done) {
      throw new Error("agent registry empty");
    }
    return first.value;
  }

  async setActive(id: string): Promise<void> {
    if (!this.descriptors.has(id)) {
      throw new Error(`unknown agent: ${id}`);
    }
    this.activeId = id;
    await this.opts.globalState.update(ACTIVE_KEY, id);
    const active = this.active();
    this.emitter.fire(active);
  }

  /** Re-runs CLI detection, BYOK key checks, sign-in state. */
  async refreshAvailability(): Promise<void> {
    const binaryNames = builtinDescriptors()
      .filter((d) => d.kind === "cli" && typeof d.binary === "string")
      .map((d) => d.binary as string);
    const detection = await detectCliBinaries(binaryNames, this.opts.which);

    const byokAvailability = new Map<AgentVendor, boolean>();
    for (const vendor of Object.keys(BYOK_PROVIDER_FIELD) as AgentVendor[]) {
      const ref = BYOK_PROVIDER_FIELD[vendor];
      if (!ref) {
        continue;
      }
      const [provider, field] = ref;
      const has = await this.opts.secrets.has(provider, field);
      byokAvailability.set(vendor, has);
    }

    const signedIn = this.opts.session.isSignedIn();
    this.rebuildSync({ detection: detection.binaries, byok: byokAvailability, signedIn });
    this.emitter.fire(this.active());
  }

  get onChange(): vscode.Event<AgentDescriptor> {
    return this.emitter.event;
  }

  dispose(): void {
    this.emitter.dispose();
  }

  private rebuildSync(state?: {
    detection: ReadonlyMap<string, string>;
    byok: ReadonlyMap<AgentVendor, boolean>;
    signedIn: boolean;
  }): void {
    const detection = state?.detection ?? new Map<string, string>();
    const byok = state?.byok ?? new Map<AgentVendor, boolean>();
    const signedIn = state?.signedIn ?? this.opts.session.isSignedIn();
    const next = new Map<string, AgentDescriptor>();

    for (const builtin of builtinDescriptors()) {
      const available = isBuiltinAvailable(builtin, { detection, byok, signedIn });
      const binaryPath =
        builtin.kind === "cli" && builtin.binary
          ? detection.get(builtin.binary)
          : undefined;
      const descriptor: AgentDescriptor = binaryPath
        ? { ...builtin, available, binary: binaryPath }
        : { ...builtin, available };
      next.set(descriptor.id, descriptor);
    }

    const userFile = loadUserAgentFiles(this.opts.getWorkspaceRoot());
    for (const entry of userFile.agents) {
      if (next.has(entry.id)) {
        continue;
      }
      const kind: AgentKind = entry.kind;
      const customBinary = entry.binary ? detection.get(entry.binary) ?? entry.binary : undefined;
      const available = kind === "cli" ? typeof customBinary === "string" && customBinary.length > 0 : true;
      const descriptor: AgentDescriptor = {
        id: entry.id,
        label: entry.label,
        kind,
        vendor: entry.vendor ?? "custom",
        description: entry.description ?? entry.label,
        available,
        free: true,
        source: "user",
        ...(entry.model ? { model: entry.model } : {}),
        ...(customBinary ? { binary: customBinary } : {}),
        ...(entry.binaryArgs ? { binaryArgs: entry.binaryArgs } : {}),
      };
      next.set(descriptor.id, descriptor);
    }
    this.descriptors = next;
  }
}

function isBuiltinAvailable(
  descriptor: AgentDescriptor,
  state: {
    detection: ReadonlyMap<string, string>;
    byok: ReadonlyMap<AgentVendor, boolean>;
    signedIn: boolean;
  },
): boolean {
  switch (descriptor.kind) {
    case "mercury":
    case "auto":
      return true;
    case "proxy":
      return state.signedIn;
    case "byok":
      return state.byok.get(descriptor.vendor) === true;
    case "cli":
      return typeof descriptor.binary === "string" && state.detection.has(descriptor.binary);
    default:
      return false;
  }
}
