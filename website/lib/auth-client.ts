"use client";

import { useCallback, useEffect, useState } from "react";

export interface PublicUser {
  id: string;
  email: string;
  display_name: string | null;
  tier: string;
  created_at: number;
  oauth_provider: string | null;
  has_password: boolean;
  is_admin?: boolean;
}

interface AuthState {
  access_token: string | null;
  expires_at: number | null;
  user: PublicUser | null;
}

interface SessionListener {
  (state: AuthState): void;
}

const REFRESH_COOKIE = "eri_refresh";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

let state: AuthState = {
  access_token: null,
  expires_at: null,
  user: null,
};
const listeners = new Set<SessionListener>();

function notify(): void {
  for (const listener of listeners) {
    listener(state);
  }
}

function setState(next: Partial<AuthState>): void {
  state = { ...state, ...next };
  notify();
}

function readRefreshCookie(): string | null {
  if (typeof document === "undefined") return null;
  const entries = document.cookie.split("; ").filter(Boolean);
  for (const entry of entries) {
    const eq = entry.indexOf("=");
    if (eq === -1) continue;
    const name = entry.slice(0, eq);
    if (name === REFRESH_COOKIE) {
      return decodeURIComponent(entry.slice(eq + 1));
    }
  }
  return null;
}

function writeRefreshCookie(token: string): void {
  if (typeof document === "undefined") return;
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${REFRESH_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Lax${secure}`;
}

function clearRefreshCookie(): void {
  if (typeof document === "undefined") return;
  document.cookie = `${REFRESH_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
}

export interface AuthSuccessResponse {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  user: PublicUser;
}

function isAuthSuccess(value: unknown): value is AuthSuccessResponse {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.access_token === "string" &&
    typeof obj.refresh_token === "string" &&
    typeof obj.expires_at === "number" &&
    typeof obj.user === "object" &&
    obj.user !== null
  );
}

function isUserResponse(value: unknown): value is { user: PublicUser } {
  if (typeof value !== "object" || value === null) return false;
  const user = (value as { user?: unknown }).user;
  if (typeof user !== "object" || user === null) return false;
  const obj = user as Record<string, unknown>;
  return typeof obj.id === "string" && typeof obj.email === "string";
}

export function getAccessToken(): string | null {
  return state.access_token;
}

export function getCurrentUser(): PublicUser | null {
  return state.user;
}

export function setSession(response: AuthSuccessResponse): void {
  writeRefreshCookie(response.refresh_token);
  setState({
    access_token: response.access_token,
    expires_at: response.expires_at,
    user: response.user,
  });
}

// Single-flight refresh: concurrent callers (header + device page + any
// reload()) all await the same Promise instead of firing N parallel POSTs
// against /api/auth/refresh. Without this dedupe, single-use refresh tokens
// race — the first POST consumes + rotates the token, every other POST sees
// "already consumed" → 401 → would clearRefreshCookie() and wipe the
// session we just successfully refreshed.
let refreshInFlight: Promise<PublicUser | null> | null = null;

async function refreshSession(): Promise<PublicUser | null> {
  if (refreshInFlight) return refreshInFlight;
  const refresh = readRefreshCookie();
  if (!refresh) return null;
  refreshInFlight = (async (): Promise<PublicUser | null> => {
    try {
      const response = await fetch("/api/auth/refresh", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refresh_token: refresh }),
      });
      if (response.status === 401 || response.status === 403) {
        // Server explicitly says the refresh token is bad — wipe.
        clearRefreshCookie();
        return null;
      }
      if (!response.ok) {
        // Transient (5xx, network blip) — keep the cookie so a retry can
        // succeed. The caller just gets `null` for this attempt.
        return null;
      }
      const body: unknown = await response.json();
      if (!isAuthSuccess(body)) {
        clearRefreshCookie();
        return null;
      }
      setSession(body);
      return body.user;
    } catch {
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

async function fetchMe(token: string): Promise<PublicUser | null> {
  try {
    const response = await fetch("/api/auth/me", {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    if (!isUserResponse(body)) return null;
    return body.user;
  } catch {
    return null;
  }
}

export async function ensureSession(): Promise<PublicUser | null> {
  if (state.user && state.access_token) {
    const now = Math.floor(Date.now() / 1000);
    if (state.expires_at && state.expires_at > now + 30) {
      return state.user;
    }
  }
  if (state.access_token) {
    const user = await fetchMe(state.access_token);
    if (user) {
      setState({ user });
      return user;
    }
  }
  return refreshSession();
}

/**
 * Force a server round-trip to refetch the current user, bypassing the
 * in-memory cache that `ensureSession` short-circuits on. Use this after a
 * server-side mutation that can change user state (plan changes, profile
 * updates, etc.) so every subscriber to `useUser` re-renders with fresh data.
 */
export async function refreshUser(): Promise<PublicUser | null> {
  if (state.access_token) {
    const user = await fetchMe(state.access_token);
    if (user) {
      setState({ user });
      return user;
    }
  }
  return refreshSession();
}

export interface AuthedFetchOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

export async function authedFetch(
  url: string,
  options: AuthedFetchOptions = {},
): Promise<Response> {
  let token = state.access_token;
  if (!token) {
    const refreshed = await refreshSession();
    if (!refreshed) {
      throw new Error("Not authenticated.");
    }
    token = state.access_token;
  }
  const headers: Record<string, string> = {
    ...(options.headers ?? {}),
    authorization: `Bearer ${token}`,
  };
  if (options.body !== undefined && !headers["content-type"]) {
    headers["content-type"] = "application/json";
  }
  const init: RequestInit = {
    method: options.method ?? "GET",
    headers,
  };
  if (options.body !== undefined) {
    init.body =
      typeof options.body === "string"
        ? options.body
        : JSON.stringify(options.body);
  }
  let response = await fetch(url, init);
  if (response.status === 401) {
    const refreshed = await refreshSession();
    if (refreshed) {
      headers.authorization = `Bearer ${state.access_token}`;
      response = await fetch(url, { ...init, headers });
    }
  }
  return response;
}

export async function signOut(): Promise<void> {
  const refresh = readRefreshCookie();
  if (refresh) {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refresh_token: refresh }),
      });
    } catch {
      // Ignore network errors; we still clear local state.
    }
  }
  clearRefreshCookie();
  setState({ access_token: null, expires_at: null, user: null });
  if (typeof window !== "undefined") {
    window.location.href = "/";
  }
}

export interface UseUserResult {
  user: PublicUser | null;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

export function useUser(): UseUserResult {
  const [user, setUser] = useState<PublicUser | null>(state.user);
  const [loading, setLoading] = useState<boolean>(state.user === null);
  const [error, setError] = useState<string | null>(null);

  // `reload` always hits the server — useUser callers invoke it when they
  // know something server-side has changed (plan switch, profile save) and
  // need every subscriber to see the new state. The first-paint bootstrap
  // path still uses ensureSession so we don't hammer the network on mount.
  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await refreshUser();
      setUser(next);
      if (!next) {
        setError("Not authenticated.");
      }
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to load session.";
      setError(message);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const listener: SessionListener = (next) => {
      setUser(next.user);
    };
    listeners.add(listener);
    void (async () => {
      setLoading(true);
      try {
        const next = await ensureSession();
        setUser(next);
        if (!next) {
          setError("Not authenticated.");
        }
      } catch {
        setUser(null);
      } finally {
        setLoading(false);
      }
    })();
    return () => {
      listeners.delete(listener);
    };
  }, []);

  return { user, loading, error, reload };
}
