"use strict";
// SessionStore — single source of truth for the active eri sign-in.
//
// Storage split (security-critical):
//   - `token`         → vscode.SecretStorage (OS Keychain). Never persisted elsewhere.
//   - other metadata  → Memento (globalState) for fast cold-start without unlocking Keychain.
//
// All updates create new EriSession objects (immutable pattern).
Object.defineProperty(exports, "__esModule", { value: true });
exports.SessionStore = void 0;
const vscode = require("vscode");
const types_1 = require("./types");
const SECRET_KEY = "eri.session.token.v1";
const META_KEY = "eri.session.meta.v1";
class SessionStore {
    secrets;
    state;
    emitter = new vscode.EventEmitter();
    cached = null;
    constructor(secrets, state) {
        this.secrets = secrets;
        this.state = state;
    }
    /** Must be called once on activation so isSignedIn() returns accurate sync state. */
    async hydrate() {
        this.cached = await this.read();
    }
    async get() {
        if (this.cached) {
            return this.cached;
        }
        this.cached = await this.read();
        return this.cached;
    }
    async set(session) {
        await this.secrets.store(SECRET_KEY, session.token);
        const meta = {
            userId: session.userId,
            email: session.email,
            tier: session.tier,
            signedInAt: session.signedInAt,
        };
        await this.state.update(META_KEY, meta);
        this.cached = session;
        this.emitter.fire(session);
    }
    async clear() {
        await this.secrets.delete(SECRET_KEY);
        await this.state.update(META_KEY, undefined);
        this.cached = null;
        this.emitter.fire(null);
    }
    /** Synchronous — reflects the last hydrate()/get()/set()/clear() call. */
    isSignedIn() {
        return this.cached !== null;
    }
    /** Synchronous read of cached session. */
    current() {
        return this.cached;
    }
    get onChange() {
        return this.emitter.event;
    }
    dispose() {
        this.emitter.dispose();
    }
    async read() {
        const meta = this.state.get(META_KEY);
        if (!isSessionMetadata(meta)) {
            return null;
        }
        const token = await this.secrets.get(SECRET_KEY);
        if (!token) {
            return null;
        }
        return {
            token,
            userId: meta.userId,
            email: meta.email,
            tier: meta.tier,
            signedInAt: meta.signedInAt,
        };
    }
}
exports.SessionStore = SessionStore;
function isSessionMetadata(value) {
    if (typeof value !== "object" || value === null) {
        return false;
    }
    const obj = value;
    return (typeof obj.userId === "string" &&
        typeof obj.email === "string" &&
        (0, types_1.isEriTier)(obj.tier) &&
        typeof obj.signedInAt === "string");
}
//# sourceMappingURL=sessionStore.js.map