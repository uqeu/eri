import { TandemEvent } from "./shipClient";

/**
 * Compact serialisable view of in-flight tandem progress, used by the
 * panel webview. Designed so the entire object can be `postMessage`d
 * into the webview which renders it idempotently.
 */
export interface TandemProgressState {
  readonly active: boolean;
  readonly builders: Array<{
    readonly model: string;
    readonly status: "pending" | "running" | "done" | "failed";
    readonly tokensIn?: number;
    readonly tokensOut?: number;
    readonly costMicros?: number;
    readonly reason?: string;
  }>;
  readonly checker: {
    readonly model: string;
    readonly status: "pending" | "running" | "done" | "failed";
    readonly tokensIn?: number;
    readonly tokensOut?: number;
    readonly costMicros?: number;
    readonly tokensStreamed?: number;
  };
  readonly totals?: { tokensIn: number; tokensOut: number; costMicros: number };
  readonly failureReason?: string;
}

const INITIAL: TandemProgressState = {
  active: false,
  builders: [],
  checker: {
    model: "gemini-2.0-flash-thinking-exp",
    status: "pending",
  },
};

/**
 * Pure state reducer. Each new `TandemEvent` produces a new
 * `TandemProgressState`; the caller posts the new state to the webview.
 */
export class TandemProgressReducer {
  private state: TandemProgressState = INITIAL;

  begin(builderModels: string[], checkerModel: string): TandemProgressState {
    this.state = {
      active: true,
      builders: builderModels.map((m) => ({ model: m, status: "pending" })),
      checker: { model: checkerModel, status: "pending" },
    };
    return this.state;
  }

  apply(event: TandemEvent): TandemProgressState {
    switch (event.kind) {
      case "builder_started":
        this.state = withBuilder(this.state, event.model, (b) => ({
          ...b,
          status: "running",
        }));
        return this.state;
      case "builder_done":
        this.state = withBuilder(this.state, event.model, (b) => ({
          ...b,
          status: "done",
          tokensIn: event.tokens.tokens_in,
          tokensOut: event.tokens.tokens_out,
          costMicros: event.cost_usd_micros,
        }));
        return this.state;
      case "builder_failed":
        this.state = withBuilder(this.state, event.model, (b) => ({
          ...b,
          status: "failed",
          reason: event.reason,
        }));
        return this.state;
      case "checker_started":
        this.state = {
          ...this.state,
          checker: {
            ...this.state.checker,
            model: event.model,
            status: "running",
            tokensStreamed: 0,
          },
        };
        return this.state;
      case "checker_token":
        this.state = {
          ...this.state,
          checker: {
            ...this.state.checker,
            tokensStreamed: (this.state.checker.tokensStreamed ?? 0) + 1,
          },
        };
        return this.state;
      case "checker_done":
        this.state = {
          ...this.state,
          checker: {
            ...this.state.checker,
            status: "done",
            tokensIn: event.tokens.tokens_in,
            tokensOut: event.tokens.tokens_out,
            costMicros: event.cost_usd_micros,
          },
        };
        return this.state;
      case "ship_done":
        this.state = {
          ...this.state,
          active: false,
          totals: {
            tokensIn: event.totals.tokens_in,
            tokensOut: event.totals.tokens_out,
            costMicros: event.totals.cost_usd_micros,
          },
        };
        return this.state;
      case "ship_failed":
        this.state = {
          ...this.state,
          active: false,
          failureReason: event.reason,
        };
        return this.state;
      default:
        return this.state;
    }
  }

  reset(): TandemProgressState {
    this.state = INITIAL;
    return this.state;
  }

  current(): TandemProgressState {
    return this.state;
  }
}

function withBuilder(
  state: TandemProgressState,
  model: string,
  update: (b: TandemProgressState["builders"][0]) => TandemProgressState["builders"][0],
): TandemProgressState {
  return {
    ...state,
    builders: state.builders.map((b) => (b.model === model ? update(b) : b)),
  };
}
