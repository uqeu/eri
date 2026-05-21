# Supabase setup

The website backend (auth, billing, usage) runs on Supabase Postgres.
There is no ORM — API routes import helpers from `lib/db.ts`, which talks to
Postgres via the [`postgres`](https://www.npmjs.com/package/postgres) driver.
All writes use the **service role key** (server-only). Clients never query
Postgres directly.

## One-time project setup

1. **Create the project**
   Go to [supabase.com](https://supabase.com) → New project. Pick a region near
   your Vercel deployment region (default Vercel region is `iad1` →
   Supabase `us-east-1`).

2. **Copy credentials into Vercel**
   In Supabase → Project Settings, grab four values and add them as
   Environment Variables in the Vercel dashboard
   (`eri-sage` project → Settings → Environment Variables):

   | Vercel env var               | Where to find it in Supabase                                    |
   | ---------------------------- | --------------------------------------------------------------- |
   | `SUPABASE_URL`               | Settings → API → Project URL                                    |
   | `SUPABASE_ANON_KEY`          | Settings → API → Project API keys → `anon` `public`             |
   | `SUPABASE_SERVICE_ROLE_KEY`  | Settings → API → Project API keys → `service_role` `secret`     |
   | `DATABASE_URL`               | Settings → Database → Connection string → URI (substitute your DB password) |

   Optionally, reuse Supabase's JWT secret for `JWT_SECRET` (Settings → API
   → JWT Secret) so existing access tokens stay valid.

   **Never** prefix the service role key with `NEXT_PUBLIC_`. It bypasses RLS
   and must stay server-side.

3. **Run the schema migration**
   In the Supabase dashboard, open **SQL Editor → New query**, paste the
   contents of [`supabase/migrations/0001_init.sql`](./supabase/migrations/0001_init.sql),
   and click **Run**.

4. **Verify the four tables exist**
   In the SQL Editor, run:

   ```sql
   select table_name
     from information_schema.tables
    where table_schema = 'public'
    order by table_name;
   ```

   You should see exactly:

   ```
   password_reset_tokens
   refresh_tokens
   usage_pings
   users
   ```

5. **Redeploy on Vercel**
   Either push a commit or hit **Redeploy** so the new env vars are picked up.

## Optional: Supabase CLI for local development

```bash
brew install supabase/tap/supabase
cd website
supabase link --project-ref <your-ref>
supabase db push           # applies migrations/*.sql to the linked project
supabase db reset --linked # nukes & re-applies — use only on dev projects
```

## Row Level Security

`0001_init.sql` enables RLS on all four tables but declares no policies.
That is intentional: the API routes use the service role key (which bypasses
RLS), so an empty policy set blocks all direct anon/authenticated client
access. If you later add direct client queries, write narrow per-table
policies before relaxing this.
