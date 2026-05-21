# eri website

Landing page + waitlist for [eri](https://eri.dev) — the voice-first AI IDE.

Built with Next.js 14 (App Router), TypeScript, and Tailwind CSS.

## Local development

```bash
pnpm install
pnpm dev
```

Open http://localhost:3000.

## Scripts

- `pnpm dev` — start the dev server with hot reload
- `pnpm build` — production build
- `pnpm start` — run the production build locally
- `pnpm typecheck` — strict TypeScript check

## Waitlist storage

Submissions are appended to `.waitlist.json` at the project root. The file is
gitignored. Swap `app/api/waitlist/route.ts` for a real database (Postgres,
Supabase, etc.) before launch.

## Deploy to Vercel

```bash
# from this directory
vercel
# or push to a Git remote connected to a Vercel project
```

Notes:

- `.waitlist.json` is **not persistent on Vercel** (the filesystem is
  ephemeral). Replace the route handler with a managed database before going
  live.
- No environment variables are required for the landing page itself.

## Backend setup

The website also serves the auth, billing, and usage APIs that the `eri_auth`
and `eri_billing` Rust crates talk to.

1. Copy `.env.example` to `.env.local` and fill in the values:
   - `JWT_SECRET` — generate with `openssl rand -hex 64`
   - `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` — from the Stripe dashboard
   - `ERI_PRICE_STARTER` / `ERI_PRICE_PRO` — `price_…` IDs for the $20/mo and
     $30/mo plans
   - `RESEND_API_KEY` — optional; when missing, password-reset is a no-op
2. Install dependencies: `pnpm install`
3. Start the dev server: `pnpm dev`
4. Tunnel Stripe webhooks to your local server:
   ```bash
   stripe listen --forward-to localhost:3000/api/billing/webhook
   ```
   Stripe prints a `whsec_…` value — paste it into `STRIPE_WEBHOOK_SECRET`.

The SQLite database lives at `.eri.sqlite` and is gitignored. Migrations run
on the first request. Routes:

- `POST /api/auth/{signup,login,refresh,logout,password-reset}`,
  `GET /api/auth/me`
- `POST /api/billing/{checkout,portal,webhook}`,
  `GET /api/billing/subscription`
- `POST /api/usage/ping`, `GET /api/usage/summary`

All authenticated routes accept `Authorization: Bearer <access_token>`. Each
route is rate-limited to 10 requests/minute per IP.

## Structure

```
app/
  layout.tsx              # Fonts (Fraunces + Space Grotesk), metadata
  page.tsx                # Composes Hero / Features / Compare / Footer
  globals.css             # Tailwind + theme tokens
  api/waitlist/           # POST /api/waitlist
  api/auth/               # signup / login / logout / refresh / me / password-reset
  api/billing/            # checkout / portal / subscription / webhook
  api/usage/              # ping (write) + summary (read)
  sign-in/                # /sign-in
  sign-up/                # /sign-up
  forgot-password/        # /forgot-password
  (dashboard)/            # Authed route group with shared shell
    layout.tsx            # Wraps children in DashboardShell
    dashboard/            # /dashboard
    billing/              # /billing
    usage/                # /usage
    account/              # /account
components/
  Hero.tsx / Features.tsx / Compare.tsx / Footer.tsx / WaitlistForm.tsx
  DashboardShell.tsx      # Sidebar + auth guard + user avatar
lib/
  auth.ts                 # Server: bcrypt, JWT, refresh tokens
  auth-client.ts          # Client: useUser, authedFetch, signOut, setSession
  db.ts / stripe.ts / rate_limit.ts
public/
  logo.svg                # eri mark
```

## Dashboard pages

The dashboard is the self-serve surface a logged-in user lands on after
signup. All authed pages live in the `(dashboard)` route group and share a
single shell with a sidebar (desktop) / hamburger menu (mobile).

| Route              | Purpose                                                            |
| ------------------ | ------------------------------------------------------------------ |
| `/sign-in`         | Email + password login → POST `/api/auth/login`                    |
| `/sign-up`         | Account creation → POST `/api/auth/signup`                         |
| `/forgot-password` | Request reset → POST `/api/auth/password-reset` (always 204)       |
| `/dashboard`       | Welcome banner, subscription + usage cards, quick links            |
| `/billing`         | Plan cards for Free / Starter / Pro; Stripe Checkout + Portal      |
| `/usage`           | 30-day SVG bar chart of daily spend, totals, tier progress         |
| `/account`         | Display name, change password, delete account (confirm modal)      |

### Auth state

- `access_token` is held in module-level memory inside `lib/auth-client.ts`.
- `refresh_token` is stored in a `Secure`, `SameSite=Lax`, 30-day cookie
  named `eri_refresh`. It is written by the client after a successful
  signup/login and read back to refresh the access token on page reload.
- `useUser()` is the React hook that pages call to subscribe to the current
  user. On mount it calls `ensureSession()` which (1) returns the in-memory
  user if the access token is still valid, or (2) POSTs the refresh cookie
  to `/api/auth/refresh` to mint a new token pair.
- `authedFetch(url, opts)` is the helper for protected API calls. It
  attaches the access token, transparently refreshes on `401`, and retries
  once.
- `signOut()` POSTs `/api/auth/logout`, clears the refresh cookie, and
  redirects to `/`.
- Pages inside `(dashboard)/` rely on `DashboardShell` to redirect to
  `/sign-in` whenever `useUser()` resolves to `null`.

`PATCH /api/auth/me` and `DELETE /api/auth/me` are referenced by the
account page but are not yet implemented server-side. The page logs the
intent client-side and shows a "saved" toast so the UI can be wired up
once the endpoints land.
