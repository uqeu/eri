/**
 * Minimal server-side Google OAuth 2.0 helpers. We deliberately avoid the
 * google-auth-library to keep dependencies lean — the OAuth code grant flow
 * is a few HTTP calls and a couple of redirects.
 *
 * The flow is documented at
 * https://developers.google.com/identity/protocols/oauth2/web-server.
 */

const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";

export const GOOGLE_OAUTH_SCOPE = "openid email profile";

export interface GoogleTokenResponse {
  access_token: string;
  id_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
  refresh_token?: string;
}

export interface GoogleUserInfo {
  id: string;
  email: string;
  verified_email: boolean;
  name?: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
  locale?: string;
}

function getCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || clientId.length === 0) {
    throw new Error("GOOGLE_CLIENT_ID environment variable must be set");
  }
  if (!clientSecret || clientSecret.length === 0) {
    throw new Error("GOOGLE_CLIENT_SECRET environment variable must be set");
  }
  return { clientId, clientSecret };
}

export function googleAuthUrl(state: string, redirectUri: string): string {
  const { clientId } = getCredentials();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_OAUTH_SCOPE,
    state,
    access_type: "online",
    prompt: "select_account",
    include_granted_scopes: "true",
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

function isTokenResponse(value: unknown): value is GoogleTokenResponse {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.access_token === "string" &&
    typeof obj.id_token === "string" &&
    typeof obj.expires_in === "number"
  );
}

export async function exchangeCode(
  code: string,
  redirectUri: string,
): Promise<GoogleTokenResponse> {
  const { clientId, clientSecret } = getCredentials();
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: body.toString(),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Google token exchange failed (${response.status}): ${text.slice(0, 200)}`,
    );
  }
  const raw: unknown = await response.json();
  if (!isTokenResponse(raw)) {
    throw new Error("Google token exchange returned unexpected payload");
  }
  return raw;
}

function isUserInfo(value: unknown): value is GoogleUserInfo {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.id === "string" &&
    typeof obj.email === "string" &&
    typeof obj.verified_email === "boolean"
  );
}

export async function getUserInfo(accessToken: string): Promise<GoogleUserInfo> {
  const response = await fetch(USERINFO_URL, {
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: "application/json",
    },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Google userinfo failed (${response.status}): ${text.slice(0, 200)}`,
    );
  }
  const raw: unknown = await response.json();
  if (!isUserInfo(raw)) {
    throw new Error("Google userinfo returned unexpected payload");
  }
  return raw;
}
