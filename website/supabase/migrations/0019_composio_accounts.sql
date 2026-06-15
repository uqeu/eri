-- Composio connected accounts (phone-eri connector layer, ADR-0002).
--
-- Composio holds the OAuth tokens in its own vault; eri only records WHICH
-- toolkits a user has connected and the Composio connected-account id, so the
-- computer-resident eri can reach them via its per-user MCP URL
-- (…/v3/mcp/<server>?user_id=<eri user>, resolved by eri_mcp ${VAR} expansion).
-- Strictly per-user: a row is keyed by (user_id, toolkit).

create table if not exists composio_accounts (
  user_id text not null,
  -- Composio toolkit slug, e.g. "gmail", "github", "googlecalendar".
  toolkit text not null,
  -- Composio's id for the connected account once linked (null while pending).
  connected_account_id text,
  -- pending (redirect issued, not yet authorized) | active | error.
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, toolkit)
);

create index if not exists composio_accounts_user_idx
  on composio_accounts (user_id);
