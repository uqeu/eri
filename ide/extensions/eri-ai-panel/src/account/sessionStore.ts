// SessionStore — single source of truth for the active eri sign-in.
//
// Storage split (security-critical):
//   - `token`         → vscode.SecretStorage (OS Keychain). Never persisted elsewhere.
//   - other metadata  → Memento (globalState) for fast cold-start without unlocking Keychain.
//
// All updates create new EriSession objects (immutable pattern).

import * as vscode from "vscode";
import { EriSession, isEriTier } from "./types";

interface SecretLike {
  get(key: string): Thenable<string | undefined>;
  store(key: string, value: string): Thenable<void>;
  delete(key: string): Thenable<void>;
}

interface MementoLike {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Thenable<void>;
}

interface SessionMetadata {
  readonly userId: string;
  readonly email: string;
  readonly tier: EriSession["tier"];
  readonly signedInAt: string;
}

const SECRET_KEY = "eri.session.token.v1";
const META_KEY = "eri.session.meta.v1";

export class SessionStore {
  private readonly emitter = new vscode.EventEmitter<EriSession | null>();
  private cached: EriSession | null = null;

  constructor(private readonly secrets: SecretLike, private readonly state: MementoLike) {}

  /** Must be called once on activation so isSignedIn() returns accurate sync state. */
  async hydrate(): Promise<void> {
    this.cached = await this.read();
  }

  async get(): Promise<EriSession | null> {
    if (this.cached) {
      return this.cached;
    }
    this.cached = await this.read();
    return this.cached;
  }

  async set(session: EriSession): Promise<void> {
    await this.secrets.store(SECRET_KEY, session.token);
    const meta: SessionMetadata = {
      userId: session.userId,
      email: session.email,
      tier: session.tier,
      signedInAt: session.signedInAt,
    };
    await this.state.update(META_KEY, meta);
    this.cached = session;
    this.emitter.fire(session);
  }

  async clear(): Promise<void> {
    await this.secrets.delete(SECRET_KEY);
    await this.state.update(META_KEY, undefined);
    this.cached = null;
    this.emitter.fire(null);
  }

  /** Synchronous — reflects the last hydrate()/get()/set()/clear() call. */
  isSignedIn(): boolean {
    return this.cached !== null;
  }

  /** Synchronous read of cached session. */
  current(): EriSession | null {
    return this.cached;
  }

  get onChange(): vscode.Event<EriSession | null> {
    return this.emitter.event;
  }

  dispose(): void {
    this.emitter.dispose();
  }

  private async read(): Promise<EriSession | null> {
    const meta = this.state.get<unknown>(META_KEY);
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

function isSessionMetadata(value: unknown): value is SessionMetadata {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.userId === "string" &&
    typeof obj.email === "string" &&
    isEriTier(obj.tier) &&
    typeof obj.signedInAt === "string"
  );
}
