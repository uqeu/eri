// Bridges sidecar (Rust) -> extension secret lookups. The sidecar issues a
// JSON-RPC request `settings/getSecret` with `{providerId, fieldKey}` and the
// extension responds with `{value: string | null}`. We restrict to the
// providers/fields declared in `providers.ts` and never log the value.

import { SidecarIncomingRequest } from "../sidecar";
import { isKnownProviderField } from "./providers";
import { SecretsStore } from "./secrets";

export const SECRET_REQUEST_METHOD = "settings/getSecret";

export interface SecretRequestParams {
  readonly providerId: string;
  readonly fieldKey: string;
}

export interface SecretResponse {
  readonly value: string | null;
}

function parseParams(raw: unknown): SecretRequestParams | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const candidate = raw as { providerId?: unknown; fieldKey?: unknown };
  if (
    typeof candidate.providerId !== "string" ||
    typeof candidate.fieldKey !== "string"
  ) {
    return null;
  }
  return { providerId: candidate.providerId, fieldKey: candidate.fieldKey };
}

export async function handleSecretRequest(
  request: SidecarIncomingRequest,
  secrets: SecretsStore,
): Promise<SecretResponse | null> {
  if (request.method !== SECRET_REQUEST_METHOD) {
    return null;
  }
  const params = parseParams(request.params);
  if (!params) {
    throw new Error("invalid params for settings/getSecret");
  }
  if (!isKnownProviderField(params.providerId, params.fieldKey)) {
    return { value: null };
  }
  const value = await secrets.get(params.providerId, params.fieldKey);
  return { value: typeof value === "string" ? value : null };
}
