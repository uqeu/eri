-- Phone↔user binding for phone eri (Phase 1, ADR-0002).
--
-- A separate table, NOT a users.phone column: a user may link multiple numbers,
-- and an UNVERIFIED number must never authenticate. The Sendblue webhook only
-- acts on links where verified_at IS NOT NULL. last_service records the last
-- transport used (iMessage/SMS/RCS) so the SMS/RCS fallback can route (Phase 2).

create table if not exists phone_links (
  id           text primary key,
  user_id      text not null references users(id) on delete cascade,
  phone_e164   text not null unique,
  verified_at  timestamptz,
  last_service text,
  created_at   timestamptz not null default now()
);

create index if not exists phone_links_user_idx on phone_links(user_id);

comment on table phone_links is
  'Phone eri: verified phone<->user bindings; only verified_at IS NOT NULL links authenticate.';

-- Short-lived pairing codes. `eri phone link` (CLI) mints a code; the user texts
-- it to the eri number; the webhook matches it, binds + verifies the number, and
-- consumes the code. Codes expire so a leaked code is useless after the window.
create table if not exists phone_pairings (
  code        text primary key,
  user_id     text not null references users(id) on delete cascade,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);

create index if not exists phone_pairings_user_idx on phone_pairings(user_id);

comment on table phone_pairings is
  'Phone eri: short-lived codes the user texts to verify a phone_links binding.';
