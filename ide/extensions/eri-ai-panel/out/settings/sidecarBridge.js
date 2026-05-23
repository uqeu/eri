"use strict";
// Bridges sidecar (Rust) -> extension secret lookups. The sidecar issues a
// JSON-RPC request `settings/getSecret` with `{providerId, fieldKey}` and the
// extension responds with `{value: string | null}`. We restrict to the
// providers/fields declared in `providers.ts` and never log the value.
Object.defineProperty(exports, "__esModule", { value: true });
exports.SECRET_REQUEST_METHOD = void 0;
exports.handleSecretRequest = handleSecretRequest;
const providers_1 = require("./providers");
exports.SECRET_REQUEST_METHOD = "settings/getSecret";
function parseParams(raw) {
    if (typeof raw !== "object" || raw === null) {
        return null;
    }
    const candidate = raw;
    if (typeof candidate.providerId !== "string" ||
        typeof candidate.fieldKey !== "string") {
        return null;
    }
    return { providerId: candidate.providerId, fieldKey: candidate.fieldKey };
}
async function handleSecretRequest(request, secrets) {
    if (request.method !== exports.SECRET_REQUEST_METHOD) {
        return null;
    }
    const params = parseParams(request.params);
    if (!params) {
        throw new Error("invalid params for settings/getSecret");
    }
    if (!(0, providers_1.isKnownProviderField)(params.providerId, params.fieldKey)) {
        return { value: null };
    }
    const value = await secrets.get(params.providerId, params.fieldKey);
    return { value: typeof value === "string" ? value : null };
}
//# sourceMappingURL=sidecarBridge.js.map