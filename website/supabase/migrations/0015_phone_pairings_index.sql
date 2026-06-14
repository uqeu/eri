-- Index for the phone_pairings retention sweep + expiry lookups (review M3).
-- The cleanup cron deletes WHERE expires_at < now(); consumePairing filters on
-- expires_at > now(). Both want this index.

create index if not exists phone_pairings_expires_idx
  on phone_pairings(expires_at);
