-- User settings (eri Everywhere) — per-user preferences eri reads at reply time
-- and the eri-authored Settings mini-app writes back. Server-owned: RLS on with
-- no policies, so it's reachable only via the privileged server connection
-- (service role), same posture as composio_accounts / command_queue.

create table if not exists user_settings (
  user_id text primary key references users(id) on delete cascade,
  -- voice-reply mode: 'never' (text only) | 'auto' (mirror: voice-in → voice-out)
  -- | 'always'. Default text — voice is opt-in because TTS can be flaky.
  voice_mode text not null default 'never',
  -- whether eri may send proactive location-aware nudges (opt-in, off by default).
  location_nudges boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table user_settings enable row level security;
