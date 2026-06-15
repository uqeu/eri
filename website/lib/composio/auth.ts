/**
 * Composio route auth — accept EITHER credential.
 *
 * The Composio endpoints are reached two ways: the computer/CLI sends its
 * long-lived `eri_sk_` API token, while the web connect-apps UI sends the
 * short-lived access-token JWT (the same one `authedFetch` attaches). Both
 * resolve the same user; this collapses them to `{ id, tier }` so a route
 * doesn't care which surface called it.
 */

import { userFromBearer } from "@/lib/auth";
import { authenticateApiBearer } from "@/lib/auth/api_tokens";

export interface ComposioCaller {
  id: string;
  tier: string;
}

/** Resolve the caller from an Authorization header, trying the API token first
 *  (CLI/computer) then the web access token. Null when neither validates. */
export async function composioCaller(authHeader: string | null): Promise<ComposioCaller | null> {
  const api = await authenticateApiBearer(authHeader);
  if (api) {
    return { id: api.user.id, tier: api.user.tier };
  }
  const web = await userFromBearer(authHeader);
  if (web) {
    return { id: web.id, tier: web.tier };
  }
  return null;
}
