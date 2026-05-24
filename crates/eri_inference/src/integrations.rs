//! Integration scaffolding prompts.
//!
//! Each builder produces a focused Claude Code CLI prompt that asks the agent
//! to wire a single third-party SDK into the user's current eri project. The
//! prompts are deliberately conservative: Claude diagnoses the project shape
//! first (single-file `index.html` vs. multi-file with a `package.json`),
//! installs the right SDK via the project's package manager, writes only the
//! files needed for the integration, and leaves everything else untouched.
//!
//! These prompts NEVER spawn npm/yarn themselves — the Claude Code CLI does
//! that on Claude's behalf when it runs. eri only formats the instruction.

use std::path::Path;

/// Provider id for the [`crate::eri_inference`] `AddAuth` voice command.
/// Lowercased so the parser is forgiving and the prompt builder is total.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AuthProvider {
    Auth0,
    Clerk,
    SupabaseAuth,
}

impl AuthProvider {
    pub fn slug(self) -> &'static str {
        match self {
            AuthProvider::Auth0 => "auth0",
            AuthProvider::Clerk => "clerk",
            AuthProvider::SupabaseAuth => "supabase",
        }
    }

    pub fn display(self) -> &'static str {
        match self {
            AuthProvider::Auth0 => "Auth0",
            AuthProvider::Clerk => "Clerk",
            AuthProvider::SupabaseAuth => "Supabase Auth",
        }
    }
}

/// Database provider for the `AddDatabase` voice command. Defaults to Neon
/// when the user just says "set up a database" / "add postgres" without
/// naming a host — Neon's free tier is fastest to provision.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DbProvider {
    Neon,
    Supabase,
}

impl DbProvider {
    pub fn slug(self) -> &'static str {
        match self {
            DbProvider::Neon => "neon",
            DbProvider::Supabase => "supabase",
        }
    }

    pub fn display(self) -> &'static str {
        match self {
            DbProvider::Neon => "Neon Postgres",
            DbProvider::Supabase => "Supabase Postgres",
        }
    }
}

/// Shared guard rails embedded in every integration prompt. The Claude Code
/// CLI runs with full file-system access, so these rules are load-bearing:
/// without them Claude has been observed to "tidy up" unrelated files or
/// reflow whitespace in the entire HTML draft.
const GUARD_RAILS: &str = "\
HARD GUARD RAILS (MUST follow all):\n\
- DO NOT delete or rewrite any existing code that is not directly required by this integration.\n\
- DO NOT touch unrelated files (assets, CSS, other components, README).\n\
- DO NOT reflow / reformat existing HTML or JS — only add or edit the lines this integration needs.\n\
- DO NOT hardcode secrets. Read every API key, client id, project URL, and price id from environment variables.\n\
- If a required env var is missing, scaffold it in a `.env.example` file (NEVER `.env`) and tell the user the EXACT name to set.\n\
- Before installing anything, print one line: `eri.integration: diagnosing <project-shape>` so the panel log captures the entry point.\n\
- After writing files, print a numbered NEXT STEPS list naming each env var the user must populate and the URL where they get it.\n\
- If `package.json` is missing AND the project is a single self-contained HTML file, prefer the CDN/script-tag flavor of the SDK over npm install — the user is not running a Node build.\n";

fn project_diagnosis_block(html_path: &Path) -> String {
    format!(
        "PROJECT CONTEXT:\n\
         - Active eri build dir is the parent of: {html}\n\
         - First, list that directory. If `package.json` exists, install via the detected package manager (npm > pnpm > yarn, in that order of fallback).\n\
         - If only `index.html` is present, treat this as a single-file static project and use the SDK's browser/CDN snippet instead of a Node install.\n\
         - Either way, the user must be able to open `index.html` (single-file) OR run `npm run dev` (multi-file) and see the new integration working.\n",
        html = html_path.display(),
    )
}

/// Build the Auth0 setup prompt. Targets either the @auth0/auth0-spa-js CDN
/// script tag (single-file HTML mode) or `npm i @auth0/auth0-react` /
/// `@auth0/nextjs-auth0` depending on what Claude finds on disk.
pub fn build_auth0_setup_prompt(html_path: &Path) -> String {
    format!(
        "You are eri's integration agent. Task: wire Auth0 into the user's current project.\n\n\
         {diagnosis}\n\
         INSTALL:\n\
         - Single-file HTML mode: add the Auth0 SPA JS CDN script tag (https://cdn.auth0.com/js/auth0-spa-js/2.1/auth0-spa-js.production.js) before </body>.\n\
         - Node mode with React: `npm install @auth0/auth0-react` and wrap the app root with <Auth0Provider>.\n\
         - Node mode with Next.js: `npm install @auth0/nextjs-auth0` and add the `/api/auth/[...auth0]` route.\n\n\
         BOILERPLATE TO WRITE:\n\
         - A visible \"Log in\" button when logged out, swapped for the user's name + \"Log out\" when logged in.\n\
         - A `handleRedirectCallback()` call on page load (SPA) or the App Router `auth()` helper (Next.js) so the login round trip completes.\n\
         - Tailwind classes if Tailwind is already in use; otherwise plain CSS that matches the page's existing style.\n\n\
         ENV VARS (scaffold in `.env.example`, never `.env`):\n\
         - `AUTH0_DOMAIN` (e.g. dev-xxxx.us.auth0.com)\n\
         - `AUTH0_CLIENT_ID`\n\
         - For Next.js also: `AUTH0_CLIENT_SECRET`, `AUTH0_SECRET` (32-byte hex), `AUTH0_BASE_URL`, `AUTH0_ISSUER_BASE_URL`\n\n\
         NEXT STEPS PRINTOUT (must appear at end of your output):\n\
         1. Go to https://manage.auth0.com → Applications → Create Application → Single Page Application.\n\
         2. Copy the Domain into `AUTH0_DOMAIN` and Client ID into `AUTH0_CLIENT_ID` in your `.env` (create from `.env.example`).\n\
         3. Add http://localhost:3000 (and your prod URL) to Allowed Callback URLs, Allowed Logout URLs, and Allowed Web Origins.\n\
         4. Reload the page; click Log in to test.\n\n\
         {rails}",
        diagnosis = project_diagnosis_block(html_path),
        rails = GUARD_RAILS,
    )
}

/// Build the Clerk setup prompt. Prefers `@clerk/clerk-js` for plain HTML and
/// `@clerk/clerk-react` / `@clerk/nextjs` for framework projects.
pub fn build_clerk_setup_prompt(html_path: &Path) -> String {
    format!(
        "You are eri's integration agent. Task: wire Clerk authentication into the user's current project.\n\n\
         {diagnosis}\n\
         INSTALL:\n\
         - Single-file HTML mode: add the `@clerk/clerk-js` CDN script (https://[your-frontend-api]/npm/@clerk/clerk-js@5/dist/clerk.browser.js) and call `window.Clerk.load()` on DOMContentLoaded.\n\
         - React mode: `npm install @clerk/clerk-react` and wrap the root in <ClerkProvider publishableKey={{import.meta.env.VITE_CLERK_PUBLISHABLE_KEY}}>.\n\
         - Next.js mode: `npm install @clerk/nextjs`, wrap `layout.tsx` in <ClerkProvider>, and add `middleware.ts` calling `clerkMiddleware()`.\n\n\
         BOILERPLATE TO WRITE:\n\
         - `<SignedOut><SignInButton /></SignedOut>` and `<SignedIn><UserButton /></SignedIn>` (or the vanilla-JS equivalent: `<div id=\"sign-in\">` + `Clerk.mountSignIn(...)`).\n\
         - A guarded route or section that only renders when the user is signed in.\n\n\
         ENV VARS (scaffold in `.env.example`):\n\
         - `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (or `VITE_CLERK_PUBLISHABLE_KEY` for Vite, or just `CLERK_PUBLISHABLE_KEY` for plain HTML)\n\
         - `CLERK_SECRET_KEY` (server side only — never expose to browser).\n\n\
         NEXT STEPS PRINTOUT (must appear at end of your output):\n\
         1. Go to https://dashboard.clerk.com → Create application → pick auth methods.\n\
         2. Copy the Publishable Key and Secret Key into your `.env`.\n\
         3. Restart the dev server so the new env vars load.\n\
         4. Click Sign in to test.\n\n\
         {rails}",
        diagnosis = project_diagnosis_block(html_path),
        rails = GUARD_RAILS,
    )
}

/// Build the Supabase Auth setup prompt. Distinct from the Postgres builder
/// even when the underlying project is the same: this one wires up
/// `@supabase/supabase-js`'s `auth` namespace and adds login/signup UI.
pub fn build_supabase_auth_setup_prompt(html_path: &Path) -> String {
    format!(
        "You are eri's integration agent. Task: wire Supabase Auth (the `supabase.auth.*` namespace) into the user's current project. DATABASE wiring is a SEPARATE task — only do auth here.\n\n\
         {diagnosis}\n\
         INSTALL:\n\
         - Single-file HTML: `<script src=\"https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2\"></script>` and `const supabase = window.supabase.createClient(URL, ANON_KEY)`.\n\
         - Node project: `npm install @supabase/supabase-js`.\n\
         - Next.js with auth helpers: `npm install @supabase/ssr @supabase/supabase-js` and create `lib/supabase/client.ts` + `lib/supabase/server.ts`.\n\n\
         BOILERPLATE TO WRITE:\n\
         - A login form (email + password OR magic link) that calls `supabase.auth.signInWithPassword` / `signInWithOtp`.\n\
         - A sign-out button that calls `supabase.auth.signOut()`.\n\
         - `supabase.auth.onAuthStateChange((event, session) => ...)` listener that flips the UI between logged-in and logged-out states.\n\n\
         ENV VARS (scaffold in `.env.example`):\n\
         - `NEXT_PUBLIC_SUPABASE_URL` (or `VITE_SUPABASE_URL`, or plain `SUPABASE_URL`)\n\
         - `NEXT_PUBLIC_SUPABASE_ANON_KEY` (or `VITE_SUPABASE_ANON_KEY`, or plain `SUPABASE_ANON_KEY`)\n\n\
         NEXT STEPS PRINTOUT (must appear at end of your output):\n\
         1. Go to https://supabase.com/dashboard → New project (or open an existing one).\n\
         2. Project Settings → API → copy Project URL and `anon` public key into `.env`.\n\
         3. Authentication → Providers → enable Email (and any social providers you want).\n\
         4. Reload the page; submit the login form to test.\n\n\
         {rails}",
        diagnosis = project_diagnosis_block(html_path),
        rails = GUARD_RAILS,
    )
}

/// Build the Neon Postgres setup prompt. Targets the serverless driver
/// (@neondatabase/serverless) which works in edge runtimes; falls back to
/// `pg` for plain Node projects when Claude detects that pattern.
pub fn build_neon_postgres_prompt(html_path: &Path) -> String {
    format!(
        "You are eri's integration agent. Task: wire a Neon Postgres database into the user's current project.\n\n\
         {diagnosis}\n\
         INSTALL:\n\
         - Edge / serverless / Next.js: `npm install @neondatabase/serverless` and import `neon` from it.\n\
         - Plain Node server: `npm install pg` and use a `Pool({{ connectionString: process.env.DATABASE_URL }})`.\n\
         - Single-file HTML: query a tiny server endpoint instead of opening a DB from the browser — explain to the user that they need a serverless function (Vercel, Netlify) to host the query and scaffold ONE example endpoint at `api/hello-db.js` that returns `SELECT now()`.\n\n\
         BOILERPLATE TO WRITE:\n\
         - A `lib/db.ts` (or `db.js`) module exporting a configured client.\n\
         - One example query call near the existing entry point so the user sees data flowing.\n\
         - DO NOT design a schema. If migrations are needed, scaffold a `migrations/0001_init.sql` placeholder and tell the user to fill it in.\n\n\
         ENV VARS (scaffold in `.env.example`):\n\
         - `DATABASE_URL` (the pooled connection string from Neon — looks like `postgresql://user:pass@ep-xxx.us-east-2.aws.neon.tech/dbname?sslmode=require`)\n\n\
         NEXT STEPS PRINTOUT (must appear at end of your output):\n\
         1. Go to https://console.neon.tech → New Project (free tier is fine).\n\
         2. Dashboard → Connection Details → copy the pooled connection string into `DATABASE_URL` in `.env`.\n\
         3. Restart the dev server.\n\
         4. Hit the example endpoint or the home page; you should see `now()` from Postgres.\n\n\
         {rails}",
        diagnosis = project_diagnosis_block(html_path),
        rails = GUARD_RAILS,
    )
}

/// Build the Supabase Postgres setup prompt. Same SDK as the auth builder but
/// targeted at the `supabase.from('table').select(...)` data-access surface,
/// NOT the auth namespace. Distinct prompt so the two flows produce different
/// boilerplate even though they share a dependency.
pub fn build_supabase_postgres_prompt(html_path: &Path) -> String {
    format!(
        "You are eri's integration agent. Task: wire a Supabase Postgres database into the user's current project. AUTH wiring is a SEPARATE task — only do database access here.\n\n\
         {diagnosis}\n\
         INSTALL:\n\
         - Single-file HTML: `<script src=\"https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2\"></script>` and use `window.supabase.createClient(URL, ANON_KEY).from('items').select('*')`.\n\
         - Node project: `npm install @supabase/supabase-js` and create `lib/supabase.ts` exporting a singleton client.\n\n\
         BOILERPLATE TO WRITE:\n\
         - A `lib/supabase.ts` module exporting the configured client.\n\
         - One example `from('demo').select('*').limit(5)` call that fetches and renders rows. If the `demo` table does not exist, the example must catch the error and render a friendly \"create a `demo` table in Supabase\" hint instead of crashing.\n\
         - DO NOT design a schema. Scaffold a `supabase/migrations/0001_init.sql` placeholder.\n\n\
         ENV VARS (scaffold in `.env.example`):\n\
         - `NEXT_PUBLIC_SUPABASE_URL` (or `VITE_SUPABASE_URL`, or plain `SUPABASE_URL`)\n\
         - `NEXT_PUBLIC_SUPABASE_ANON_KEY` (or `VITE_SUPABASE_ANON_KEY`, or plain `SUPABASE_ANON_KEY`)\n\n\
         NEXT STEPS PRINTOUT (must appear at end of your output):\n\
         1. Go to https://supabase.com/dashboard → New project (or open an existing one).\n\
         2. Project Settings → API → copy Project URL and `anon` public key into `.env`.\n\
         3. Table Editor → create a `demo` table with a few rows so the example query returns data.\n\
         4. Reload the page; you should see rows from `demo`.\n\n\
         {rails}",
        diagnosis = project_diagnosis_block(html_path),
        rails = GUARD_RAILS,
    )
}

/// Build the Stripe Checkout setup prompt. `plan_usd` is the monthly price
/// the user voiced ("add stripe for $20 a month" → 20.0). When the user does
/// not specify a price, callers pass `0.0` and the prompt instructs Claude to
/// use a `STRIPE_PRICE_ID` env var rather than a hard-coded amount.
pub fn build_stripe_checkout_prompt(html_path: &Path, plan_usd: f64) -> String {
    let pricing_instruction = if plan_usd > 0.0 {
        format!(
            "PLAN PRICE: the user asked for ${plan_usd:.2}/month.\n\
             - When you scaffold the price, use the exact value {plan_usd:.2} USD per month.\n\
             - The Stripe price id still comes from `STRIPE_PRICE_ID` env var; the dollar amount is for documentation and for the visible price label on the page.\n",
        )
    } else {
        "PLAN PRICE: not specified by the user.\n\
         - Read the price label from a `STRIPE_PRICE_LABEL` env var so the user can edit the display string without touching code.\n\
         - The Stripe price id still comes from `STRIPE_PRICE_ID`.\n"
            .to_string()
    };
    let pricing_next_step = if plan_usd > 0.0 {
        format!(
            "Products → New product → set the price to ${plan_usd:.2}/month → copy the `price_xxx` id into `STRIPE_PRICE_ID`."
        )
    } else {
        "Products → New product → set the price to whatever the user wants → copy the `price_xxx` id into `STRIPE_PRICE_ID`, and set `STRIPE_PRICE_LABEL` to the display string you want shown on the page.".to_string()
    };
    format!(
        "You are eri's integration agent. Task: wire a Stripe Checkout flow into the user's current project.\n\n\
         {diagnosis}\n\
         {pricing}\n\
         INSTALL:\n\
         - Server side (always required — Checkout sessions MUST be created server-side): `npm install stripe`.\n\
         - Client side: `npm install @stripe/stripe-js` for `redirectToCheckout`, OR use the bare `window.location = session.url` redirect pattern if no JS SDK is desired.\n\
         - Single-file HTML: scaffold ONE serverless function (`api/create-checkout-session.js` for Vercel-style hosting) that creates the Checkout Session; the static page POSTs to it and redirects to `session.url`.\n\n\
         BOILERPLATE TO WRITE:\n\
         - A `Subscribe` / `Buy` button that posts to the create-session endpoint.\n\
         - The `api/create-checkout-session.js` function: `stripe.checkout.sessions.create({{ mode: 'subscription', line_items: [{{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }}], success_url, cancel_url }})`.\n\
         - A success page (or success route) at `/success` showing \"thanks for subscribing\".\n\
         - A webhook route at `api/stripe-webhook.js` that verifies `stripe-signature` with `STRIPE_WEBHOOK_SECRET` and logs the event. DO NOT mark anything as paid in a database here — keep it minimal; the user will extend it later.\n\n\
         ENV VARS (scaffold in `.env.example`):\n\
         - `STRIPE_SECRET_KEY` (sk_test_... or sk_live_...)\n\
         - `STRIPE_PUBLISHABLE_KEY` (pk_test_... or pk_live_...) — only needed if you load `@stripe/stripe-js` client side.\n\
         - `STRIPE_PRICE_ID` (price_xxxxxxxxxxxx from the Stripe dashboard)\n\
         - `STRIPE_WEBHOOK_SECRET` (whsec_... from the webhook endpoint settings)\n\n\
         NEXT STEPS PRINTOUT (must appear at end of your output):\n\
         1. Go to https://dashboard.stripe.com → Developers → API keys → copy Secret and Publishable into `.env`.\n\
         2. {pricing_next}\n\
         3. Developers → Webhooks → Add endpoint pointing at `/api/stripe-webhook` → copy the signing secret into `STRIPE_WEBHOOK_SECRET`.\n\
         4. Restart the dev server; click Subscribe; use Stripe test card 4242 4242 4242 4242 to confirm.\n\n\
         {rails}",
        diagnosis = project_diagnosis_block(html_path),
        pricing = pricing_instruction,
        pricing_next = pricing_next_step,
        rails = GUARD_RAILS,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn html_path() -> PathBuf {
        PathBuf::from("/tmp/eri-project/index.html")
    }

    #[test]
    fn auth0_prompt_mentions_auth0_and_install_command() {
        let prompt = build_auth0_setup_prompt(&html_path());
        assert!(prompt.contains("Auth0"));
        assert!(prompt.contains("@auth0/auth0-spa-js") || prompt.contains("@auth0/auth0-react"));
        assert!(prompt.contains("AUTH0_DOMAIN"));
        assert!(prompt.contains("AUTH0_CLIENT_ID"));
        assert!(prompt.contains("manage.auth0.com"));
        assert!(prompt.contains("HARD GUARD RAILS"));
    }

    #[test]
    fn stripe_prompt_includes_plan_usd_value() {
        let prompt = build_stripe_checkout_prompt(&html_path(), 20.0);
        // Plan price must appear in the body the user can read back.
        assert!(prompt.contains("20.00"));
        assert!(prompt.contains("STRIPE_PRICE_ID"));
        assert!(prompt.contains("STRIPE_WEBHOOK_SECRET"));
        assert!(prompt.contains("dashboard.stripe.com"));
    }

    #[test]
    fn stripe_prompt_without_plan_falls_back_to_label_env() {
        let prompt = build_stripe_checkout_prompt(&html_path(), 0.0);
        assert!(prompt.contains("STRIPE_PRICE_LABEL"));
        // Zero plan price should NOT appear as "0.00" in the visible message.
        assert!(!prompt.contains("$0.00/month"));
    }

    #[test]
    fn supabase_prompts_distinct_for_auth_and_postgres() {
        let auth_prompt = build_supabase_auth_setup_prompt(&html_path());
        let pg_prompt = build_supabase_postgres_prompt(&html_path());
        assert_ne!(auth_prompt, pg_prompt);
        assert!(auth_prompt.contains("supabase.auth"));
        assert!(
            auth_prompt.contains("signInWithPassword") || auth_prompt.contains("signInWithOtp")
        );
        assert!(pg_prompt.contains(".from(") || pg_prompt.contains("from('demo')"));
        // Each must explicitly disclaim the other to avoid duplicate wiring.
        assert!(auth_prompt.contains("DATABASE wiring is a SEPARATE task"));
        assert!(pg_prompt.contains("AUTH wiring is a SEPARATE task"));
    }

    #[test]
    fn clerk_prompt_includes_publishable_key_and_dashboard_url() {
        let prompt = build_clerk_setup_prompt(&html_path());
        assert!(prompt.contains("Clerk"));
        assert!(prompt.contains("CLERK_PUBLISHABLE_KEY"));
        assert!(prompt.contains("dashboard.clerk.com"));
    }

    #[test]
    fn neon_prompt_mentions_connection_string_and_console() {
        let prompt = build_neon_postgres_prompt(&html_path());
        assert!(prompt.contains("DATABASE_URL"));
        assert!(prompt.contains("@neondatabase/serverless") || prompt.contains("neon"));
        assert!(prompt.contains("console.neon.tech"));
    }

    #[test]
    fn every_prompt_includes_guard_rails() {
        let path = html_path();
        for prompt in [
            build_auth0_setup_prompt(&path),
            build_clerk_setup_prompt(&path),
            build_supabase_auth_setup_prompt(&path),
            build_neon_postgres_prompt(&path),
            build_supabase_postgres_prompt(&path),
            build_stripe_checkout_prompt(&path, 9.99),
        ] {
            assert!(prompt.contains("HARD GUARD RAILS"));
            assert!(prompt.contains("DO NOT delete"));
            assert!(prompt.contains("DO NOT touch unrelated files"));
            assert!(prompt.contains("env"));
        }
    }
}
