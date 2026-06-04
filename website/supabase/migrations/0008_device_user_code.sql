-- RFC 8628 OAuth 2.0 Device Authorization Grant — split the two codes.
--
-- Before this migration the verify URL carried the *device_code* (the
-- polling secret) in the browser, so anything that saw the URL could redeem
-- the token before the originating client polled. RFC 8628 requires:
--   * device_code: high-entropy SECRET, held only by the polling client,
--     used at the token endpoint (/poll). Never shown to the user.  (= `code`)
--   * user_code:   short, human-enterable code shown in the browser and used
--     to APPROVE the grant (/approve). Never able to redeem the token.
--
-- `code` stays the primary key / device_code. We add the user-facing code.
alter table device_code_grants
  add column if not exists user_code text;

-- user_code must be unique while it can be looked up. Partial index keeps
-- legacy rows (user_code IS NULL) from colliding.
create unique index if not exists device_code_grants_user_code_key
  on device_code_grants (user_code)
  where user_code is not null;
