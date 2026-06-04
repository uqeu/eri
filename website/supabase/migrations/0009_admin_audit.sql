-- Per-user admin analytics + event audit log.
--
-- eri meters its own users of its own product. `usage_records` already holds
-- per-user token/cost rows (no prompt content). This migration adds:
--   * users.is_admin -- gate for the cross-user admin analytics view.
--   * admin_audit_log -- an append-only trail of notable account events
--     (logins, tier changes, device-token create/revoke, quota crossings).
--     `detail` is small structured metadata only -- NEVER prompt/response text.

alter table users
  add column if not exists is_admin boolean not null default false;

create table if not exists admin_audit_log (
  id text primary key,
  user_id text references users (id) on delete cascade,
  action text not null,
  detail jsonb not null default '{}'::jsonb,
  ts timestamptz not null default now()
);

-- Recent-events feed, and per-user drill-down.
create index if not exists admin_audit_log_ts_idx
  on admin_audit_log (ts desc);
create index if not exists admin_audit_log_user_ts_idx
  on admin_audit_log (user_id, ts desc);
create index if not exists admin_audit_log_action_ts_idx
  on admin_audit_log (action, ts desc);

-- RLS on (matches every other table); no policies -> service-role only,
-- consistent with the rest of the schema. All access is server-side.
alter table admin_audit_log enable row level security;
