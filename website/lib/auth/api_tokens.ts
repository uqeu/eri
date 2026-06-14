import { createHash, randomBytes } from "node:crypto";
import {
  getApiTokenByHash,
  insertApiToken,
  newApiTokenId,
  touchApiToken,
  type ApiTokenRow,
} from "@/lib/inference/db";
import { getUserById, type UserRow } from "@/lib/db";

/**
 * eri API tokens are bearer tokens scoped to a single user, used by the
 * IDE to authenticate proxy / usage calls. They look like:
 *
 *     eri_sk_<base64url(32 bytes)>
 *
 * The raw bearer is shown to the IDE exactly once, immediately after the
 * device-code grant is approved. We never persist it; only the sha256
 * digest lands in `api_tokens.token_hash`.
 */

const TOKEN_PREFIX = "eri_sk_";

export interface IssuedApiToken {
  raw: string;
  row: ApiTokenRow;
}

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function isApiTokenShape(value: string): boolean {
  return value.startsWith(TOKEN_PREFIX) && value.length > TOKEN_PREFIX.length;
}

export async function issueApiToken(input: {
  userId: string;
  label?: string;
}): Promise<IssuedApiToken> {
  const raw = `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  const row = await insertApiToken({
    id: newApiTokenId(),
    user_id: input.userId,
    token_hash: hashToken(raw),
    label: input.label ?? "Eri",
  });
  return { raw, row };
}

export interface AuthContext {
  user: UserRow;
  apiToken: ApiTokenRow;
}

/**
 * Validate a raw Authorization Bearer header and resolve the matching user
 * + token row. Returns null on any failure (missing header, wrong shape,
 * unknown hash, revoked, deleted user). Touches `last_used_at` as a side
 * effect when validation succeeds.
 */
export async function authenticateApiBearer(
  authHeader: string | null,
): Promise<AuthContext | null> {
  if (!authHeader) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  if (!match) return null;
  const raw = match[1];
  if (!isApiTokenShape(raw)) return null;

  const tokenHash = hashToken(raw);
  const apiToken = await getApiTokenByHash(tokenHash);
  if (!apiToken) return null;
  if (apiToken.revoked_at !== null) return null;

  const user = await getUserById(apiToken.user_id);
  if (!user) return null;

  touchApiToken(apiToken.id).catch((error) => {
    // Log only the message — the raw error may carry DB internals (security: M-4).
    console.error(
      "api_token.touch_failed",
      error instanceof Error ? error.message : String(error),
    );
  });

  return { user, apiToken };
}
