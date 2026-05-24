"use strict";
// AgentRegistry — single source of truth for available agents in this
// extension activation. Maintains the active-agent selection (persisted
// to globalState) and emits change events when availability shifts.
//
// The registry is intentionally synchronous on the read path (list/get)
// so the UI can render without awaiting filesystem / network. Mutations
// (refreshAvailability / setActive) are async.
Object.defineProperty(exports, "__esModule", { value: true });
exports.AgentRegistry = void 0;
const vscode = require("vscode");
const builtins_1 = require("./builtins");
const detection_1 = require("./detection");
const ACTIVE_KEY = "eri.agents.activeId.v1";
const BYOK_PROVIDER_FIELD = {
    anthropic: ["anthropic", "anthropic-api-key"],
    openai: ["openai", "openai-api-key"],
    google: ["google", "google-api-key"],
    eri: null,
    local: null,
    custom: null,
};
class AgentRegistry {
    opts;
    emitter = new vscode.EventEmitter();
    descriptors = new Map();
    activeId;
    constructor(opts) {
        this.opts = opts;
        const persisted = opts.globalState.get(ACTIVE_KEY);
        this.activeId = typeof persisted === "string" && persisted.length > 0
            ? persisted
            : builtins_1.AGENT_ID.auto;
        this.rebuildSync();
    }
    list() {
        return Array.from(this.descriptors.values());
    }
    get(id) {
        return this.descriptors.get(id);
    }
    active() {
        const found = this.descriptors.get(this.activeId);
        if (found && found.available) {
            return found;
        }
        // Fallback to Auto / Mercury when previously selected agent is unavailable.
        const fallback = this.descriptors.get(builtins_1.AGENT_ID.auto) ?? this.descriptors.get(builtins_1.AGENT_ID.mercury);
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
    async setActive(id) {
        if (!this.descriptors.has(id)) {
            throw new Error(`unknown agent: ${id}`);
        }
        this.activeId = id;
        await this.opts.globalState.update(ACTIVE_KEY, id);
        const active = this.active();
        this.emitter.fire(active);
    }
    /** Re-runs CLI detection, BYOK key checks, sign-in state. */
    async refreshAvailability() {
        const binaryNames = (0, builtins_1.builtinDescriptors)()
            .filter((d) => d.kind === "cli" && typeof d.binary === "string")
            .map((d) => d.binary);
        const detection = await (0, detection_1.detectCliBinaries)(binaryNames, this.opts.which);
        const byokAvailability = new Map();
        for (const vendor of Object.keys(BYOK_PROVIDER_FIELD)) {
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
    get onChange() {
        return this.emitter.event;
    }
    dispose() {
        this.emitter.dispose();
    }
    rebuildSync(state) {
        const detection = state?.detection ?? new Map();
        const byok = state?.byok ?? new Map();
        const signedIn = state?.signedIn ?? this.opts.session.isSignedIn();
        const next = new Map();
        for (const builtin of (0, builtins_1.builtinDescriptors)()) {
            const available = isBuiltinAvailable(builtin, { detection, byok, signedIn });
            const binaryPath = builtin.kind === "cli" && builtin.binary
                ? detection.get(builtin.binary)
                : undefined;
            const descriptor = binaryPath
                ? { ...builtin, available, binary: binaryPath }
                : { ...builtin, available };
            next.set(descriptor.id, descriptor);
        }
        const userFile = (0, detection_1.loadUserAgentFiles)(this.opts.getWorkspaceRoot());
        for (const entry of userFile.agents) {
            if (next.has(entry.id)) {
                continue;
            }
            const kind = entry.kind;
            const customBinary = entry.binary ? detection.get(entry.binary) ?? entry.binary : undefined;
            const available = kind === "cli" ? typeof customBinary === "string" && customBinary.length > 0 : true;
            const descriptor = {
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
exports.AgentRegistry = AgentRegistry;
function isBuiltinAvailable(descriptor, state) {
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
//# sourceMappingURL=registry.js.map