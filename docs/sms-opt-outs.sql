-- SMS opt-out / suppression records (10DLC compliance).
-- Run this in the Supabase SQL editor (no local migrations dir in this repo).
--
-- Telnyx keeps the authoritative suppression list and automatically blocks
-- outbound texts to anyone who replied STOP. This table MIRRORS that into our
-- own DB so the team has visibility (dashboard shows "opted out") and so voice /
-- in-person opt-out requests — which Telnyx never sees — are also recorded and
-- enforced before we even call Telnyx.
--
-- One row per phone = currently suppressed. Re-subscribing (START, or an agent
-- re-subscribing on request) deletes the row.

create table if not exists public.sms_opt_outs (
  id          uuid primary key default gen_random_uuid(),
  phone       text not null unique,        -- E.164, e.g. +12109348999
  source      text not null,               -- e.g. sms_keyword:STOP, voice:agent
  note        text,                        -- optional free-text reason
  created_at  timestamptz not null default now()
);

alter table public.sms_opt_outs enable row level security;
-- No policies on purpose: only the service role (which bypasses RLS) may access.
