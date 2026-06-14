-- Typed remote turns: control vs recall (architecture review candidate A).
--
-- Phone eri dispatches two kinds of work to the computer: `control` (actuation —
-- open/click/type, run through the control stack) and `recall` (a deep Tier-B
-- memory lookup answered locally and texted back). The daemon routes on `kind`;
-- a recall row's `goal` carries a JSON {query, as_of} spec instead of prose.
-- Defaults to 'control' so rows enqueued before this column read unchanged.

alter table command_queue
  add column if not exists kind text not null default 'control';
