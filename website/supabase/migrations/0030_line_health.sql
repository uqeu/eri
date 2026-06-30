-- Single-row line-health state for the liveness alarm (webhook model).
-- The imessage cron probes the line every ~10 min and updates this row; the
-- anti-spam alert policy lives in lib/health/line_health.ts.
CREATE TABLE IF NOT EXISTS line_health (
  id integer PRIMARY KEY DEFAULT 1,
  consecutive_failures integer NOT NULL DEFAULT 0,
  last_ok_at timestamptz,
  last_check_at timestamptz,
  last_alert_at timestamptz,
  CONSTRAINT line_health_singleton CHECK (id = 1)
);

-- Seed the singleton row.
INSERT INTO line_health (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Server-owned: RLS on with no policies = no client (anon/authed) access.
ALTER TABLE line_health ENABLE ROW LEVEL SECURITY;
