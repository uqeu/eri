-- Device identity for the CLI/IDE sign-in flow.
--
-- The CLI sends its machine hostname at /start so the issued api_token can be
-- labelled by device, and so a re-login from the same machine REPLACES that
-- machine's prior token (one active token per host) instead of accumulating.
-- api_tokens.label already exists; this carries the label through the grant.

alter table device_code_grants
  add column if not exists device_label text;
