import * as vscode from "vscode";
import { Sidecar, SidecarNotification } from "../sidecar";

/**
 * Wire shapes mirror `crates/eri_coreutils/src/services/ship.rs`
 * (`ShipResult`) and `website/lib/inference/tandem.ts::TandemEvent`.
 */

export interface WorkspaceFile {
  readonly path: string;
  readonly content: string;
}

export interface TandemSlot {
  readonly role: "builder" | "checker";
  readonly provider: "anthropic" | "openai" | "google";
  readonly model: string;
}

export interface BuilderCheckerPlan {
  readonly builders: TandemSlot[];
  readonly checker: TandemSlot;
}

export interface ShipRequest {
  readonly instructions: string;
  readonly workspaceFiles: WorkspaceFile[];
  readonly plan?: BuilderCheckerPlan;
}

export interface ShipResult {
  readonly ok: boolean;
  readonly survivors: string[];
  readonly totalTokensIn: number;
  readonly totalTokensOut: number;
  readonly totalCostMicros: number;
  readonly mergedPatchset: string;
}

export type TandemEvent =
  | { readonly kind: "builder_started"; readonly model: string; readonly provider: string }
  | {
      readonly kind: "builder_done";
      readonly model: string;
      readonly provider: string;
      readonly tokens: { tokens_in: number; tokens_out: number };
      readonly cost_usd_micros: number;
      readonly text: string;
    }
  | {
      readonly kind: "builder_failed";
      readonly model: string;
      readonly provider: string;
      readonly reason: string;
    }
  | { readonly kind: "checker_started"; readonly model: string; readonly provider: string }
  | { readonly kind: "checker_token"; readonly text: string }
  | {
      readonly kind: "checker_done";
      readonly model: string;
      readonly provider: string;
      readonly tokens: { tokens_in: number; tokens_out: number };
      readonly cost_usd_micros: number;
      readonly text: string;
    }
  | {
      readonly kind: "ship_done";
      readonly totals: {
        tokens_in: number;
        tokens_out: number;
        cost_usd_micros: number;
      };
      readonly survivors: string[];
    }
  | { readonly kind: "ship_failed"; readonly reason: string };

/**
 * Thin client around the `eri/ship/run` JSON-RPC call. Tracks one
 * in-flight ship at a time; concurrent calls reject with a clear error
 * so the UI can warn instead of double-billing.
 */
export class ShipClient implements vscode.Disposable {
  private inflight = false;
  private readonly eventEmitter = new vscode.EventEmitter<TandemEvent>();
  readonly onEvent = this.eventEmitter.event;

  constructor(private readonly getSidecar: () => Sidecar | null) {}

  /**
   * Route every `eri/ship/event` notification into this client's emitter.
   * Wired from the extension's central notification handler.
   */
  forward(notification: SidecarNotification): void {
    if (notification.method !== "eri/ship/event") {
      return;
    }
    if (notification.params && typeof notification.params === "object") {
      this.eventEmitter.fire(notification.params as TandemEvent);
    }
  }

  async run(request: ShipRequest): Promise<ShipResult> {
    if (this.inflight) {
      throw new Error("ship_in_progress");
    }
    const sidecar = this.getSidecar();
    if (!sidecar) {
      throw new Error("sidecar_not_running");
    }
    this.inflight = true;
    try {
      const raw = await sidecar.request<RawShipResult>("eri/ship/run", {
        instructions: request.instructions,
        workspaceFiles: request.workspaceFiles,
        plan: request.plan ?? null,
      });
      return {
        ok: raw.ok ?? false,
        survivors: raw.survivors ?? [],
        totalTokensIn: raw.totalTokensIn ?? 0,
        totalTokensOut: raw.totalTokensOut ?? 0,
        totalCostMicros: raw.totalCostMicros ?? 0,
        mergedPatchset: raw.mergedPatchset ?? "",
      };
    } finally {
      this.inflight = false;
    }
  }

  dispose(): void {
    this.eventEmitter.dispose();
  }
}

interface RawShipResult {
  ok?: boolean;
  survivors?: string[];
  totalTokensIn?: number;
  totalTokensOut?: number;
  totalCostMicros?: number;
  mergedPatchset?: string;
}
