"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TandemProgressReducer = void 0;
const INITIAL = {
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
class TandemProgressReducer {
    state = INITIAL;
    begin(builderModels, checkerModel) {
        this.state = {
            active: true,
            builders: builderModels.map((m) => ({ model: m, status: "pending" })),
            checker: { model: checkerModel, status: "pending" },
        };
        return this.state;
    }
    apply(event) {
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
    reset() {
        this.state = INITIAL;
        return this.state;
    }
    current() {
        return this.state;
    }
}
exports.TandemProgressReducer = TandemProgressReducer;
function withBuilder(state, model, update) {
    return {
        ...state,
        builders: state.builders.map((b) => (b.model === model ? update(b) : b)),
    };
}
//# sourceMappingURL=tandemProgress.js.map