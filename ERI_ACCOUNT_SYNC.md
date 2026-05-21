# eri Account Sync — Architecture Proposal

> Status: proposal · written 2026-05-21
> Decision needed on: token-flow choice (A vs B), sync scope, and whether to keep
> email/password alongside Google OAuth.

## What we have today

- **Website** (`website/lib/auth.ts`): email + password sign-up, bcryptjs-hashed
  passwords, JWT access token (1h) + refresh token (30d), stored in Postgres
  `users` + `refresh_tokens` tables. `userFromBearer` reads `Authorization:
  Bearer <jwt>` and returns the user row.
- **Stripe checkout** wired into Pro / Pro+ / Teams / Starter products.
- **Tier gating** end-to-end: extension fetches `/api/v1/me`, sets context keys
  like `eri.feature.composer`, sidecar gates JSON-RPC methods.
- **In-flight** (this turn): Google OAuth (`/api/auth/google/start` +
  `/callback`), forum, stub pages.

## The two design choices

### A. Deep-link IDE callback (recommended)

1. User clicks "Sign in" inside eri IDE → extension opens
   `https://eri.dev/auth/device?challenge=<code>` in the user's browser.
2. User signs in on the website (email/password OR Google).
3. Website's `/auth/device` page reads the challenge, looks up the just-issued
   JWT pair, then 302s the browser to `eri://auth/callback?token=<short_code>`.
4. macOS routes `eri://` URLs to our app bundle (we register the URL scheme in
   `Info.plist` during the VSCodium fork branding).
5. Extension's URL handler exchanges `short_code` for the full JWT pair via
   `POST /api/v1/auth/device/exchange`.
6. Extension stores the JWT pair in **macOS Keychain** (via
   `vscode.SecretStorage` which uses Keychain on macOS) — never on disk.

**Why this is good:** standard OAuth device-code pattern. Browser does the auth.
Token lands in the OS keychain. No password in the IDE.

### B. Built-in browser inside the IDE (not recommended)

Embed a webview that loads `eri.dev/sign-in`, intercept the callback URL.

**Why I'd avoid this:** Google OAuth explicitly bans embedded webviews
(`User-Agent` check; they reject sign-ins from them). Apple sign-in does the same.
We'd have to maintain our own login form forever, and we lose the muscle memory
of "sign in to eri.dev once, IDE picks it up."

## What syncs between IDE and website

| Sync field          | Direction        | When                            | Storage                |
|---------------------|------------------|---------------------------------|------------------------|
| User identity       | website → IDE    | sign-in, token refresh          | Keychain (`eri.token`) |
| Tier + features     | website → IDE    | every 5 min poll + on sign-in   | extension memory       |
| Usage counters      | website → IDE    | before each turn (`/turns/check`) | not cached            |
| Editor settings     | both directions  | on settings change              | `users.settings` JSONB |
| Iteration history   | IDE → website    | optional, opt-in                | `iterations` table     |
| MCP server list     | both directions  | on edit                         | `users.mcp_servers` JSONB |
| Voice preset        | both directions  | on edit                         | `users.settings.voice` |
| BYOK keys           | **never sync**   | —                               | local Keychain only    |

BYOK keys (Anthropic, OpenAI, Gemini personal keys) stay on the user's device.
They never touch our server. That's both a security pitch and our infra
simplification.

## Concrete next steps (if you approve)

1. **Google OAuth** — currently in flight (agent C). Adds `oauth_provider` +
   `oauth_subject` columns to `users`, lets `password_hash` be null.
2. **Device-code grant** — new endpoints:
   - `POST /api/v1/auth/device/start` → returns `{ device_code, user_code, verification_url, expires_in }`.
   - `GET  /api/v1/auth/device/poll?device_code=...` → 202 while pending, 200 + JWT pair when user completes browser flow, 410 if expired.
   - `/auth/device` page on website that prompts user to confirm the code.
3. **URL scheme registration** in the VSCodium fork: `Info.plist`'s
   `CFBundleURLTypes` registers `eri://`.
4. **Extension auth flow** in `eri-ai-panel`:
   - Command `eri.signIn` → opens device-code URL, polls, stores token in
     `vscode.SecretStorage`.
   - Existing `tierClient.ts` already calls `/api/v1/me` with the bearer — just
     point it at the keychain-stored token instead of expecting it to be set.
5. **Settings sync** — extend `/api/v1/me` to return `settings` JSONB; add
   `PATCH /api/v1/me/settings`. Extension reads on startup, writes on any
   change.

## Questions for you before I build it

- **Approve A?** (device-code via browser).
- **Settings to sync** — voice preset, model default, theme, font size — anything
  else worth syncing? Editor keybindings? MCP server list?
- **Forum auth** — should the forum require a paid tier, or any logged-in user?
  Currently building it as "any logged-in user."
- **Email/password retention** — keep it as a fallback alongside Google, or
  Google-only? (Recommend keep — Enterprise customers will want SSO eventually
  and email/password is still simplest for dev/test accounts.)

If you nod yes to A + the default sync scope, I can dispatch the device-code +
SecretStorage work right after the current 4 agents land.
