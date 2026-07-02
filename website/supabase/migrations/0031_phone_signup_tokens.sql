-- Magic sign-up link tokens. A stranger texts eri from number X; we mint a
-- single-use token that binds ONLY X to the new account (hijack-proof — the
-- number is fixed here, never user-supplied; see lib/phone/signup_link.ts).
CREATE TABLE IF NOT EXISTS phone_signup_tokens (
  token_hash text PRIMARY KEY,          -- sha256(raw); the raw is only in the texted link
  phone_e164 text NOT NULL,             -- the number this token binds
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz                    -- single-use
);
CREATE INDEX IF NOT EXISTS phone_signup_tokens_expires_idx ON phone_signup_tokens (expires_at);

-- Server-owned: RLS on with no policies = no client (anon/authed) access.
ALTER TABLE phone_signup_tokens ENABLE ROW LEVEL SECURITY;
