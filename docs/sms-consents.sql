-- SMS opt-in consent records (10DLC compliance proof).
-- Run this in the Supabase SQL editor (no local migrations dir in this repo).
--
-- Each row is a timestamped record of a subscriber agreeing to the exact
-- consent text shown on /sms-signup. Writes happen only from the server via the
-- service-role key (lib/admin.ts), so RLS is enabled with NO public policies —
-- the anon/auth roles cannot read or write this table.

create table if not exists public.sms_consents (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  phone           text not null,           -- E.164, e.g. +12109348999
  consent_text    text not null,           -- exact wording the user agreed to
  consent_version text not null,           -- bump when consent_text changes
  source          text not null,           -- e.g. web_form:/sms-signup
  ip_address      text,
  user_agent      text,
  created_at      timestamptz not null default now()
);

-- Look up the latest consent for a number quickly.
create index if not exists sms_consents_phone_idx
  on public.sms_consents (phone, created_at desc);

alter table public.sms_consents enable row level security;
-- No policies on purpose: only the service role (which bypasses RLS) may access.
