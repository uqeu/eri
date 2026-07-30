-- Invite-by-number onboarding. An owner adds a friend's number on the web; the
-- friend's FIRST text to eri's line auto-creates + binds their account (hijack-proof,
-- atomic on phone_links.phone_e164) — no link, no sign-up form. See lib/phone/invite.ts.
-- NOTE: user ids are TEXT (`usr_<hex>`, see 0001_init.sql `users.id text primary key`),
-- not uuid. A uuid column here rejects every real id with 22P02 and the feature can
-- never write a row. Typed + foreign-keyed like every other table in this schema.
CREATE TABLE IF NOT EXISTS phone_invites (
  phone_e164       text PRIMARY KEY,          -- one pending invite per number
  invited_by       text NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- the owner who added them
  invited_by_name  text,                       -- denormalized for the welcome text
  created_at       timestamptz NOT NULL DEFAULT now(),
  consumed_at      timestamptz,                -- set when the friend's first text binds it
  consumed_user_id text REFERENCES users(id) ON DELETE SET NULL  -- the account it created
);
CREATE INDEX IF NOT EXISTS phone_invites_pending_idx ON phone_invites (phone_e164) WHERE consumed_at IS NULL;

-- Server-owned: RLS on with no policies = no client (anon/authed) access.
ALTER TABLE phone_invites ENABLE ROW LEVEL SECURITY;
