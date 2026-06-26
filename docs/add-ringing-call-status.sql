-- Fix: inbound calls never get logged; caller hears a ring then an immediate hangup.
--
-- Root cause: the ring-all webhook (app/api/webhooks/telnyx/voice/route.ts) inserts
-- the inbound caller row with status 'ringing', but the calls_status_check constraint
-- predates ring-all and does NOT allow 'ringing'. The INSERT fails with 23514, the
-- error was swallowed, so no row was ever written and every downstream lookup (dial
-- fan-out, hangup finalize) saw a missing row.
--
-- Verified allowed values before this change:
--   initiated, answered, completed, failed, missed, voicemail   (ringing REJECTED)
--
-- Run this in the Supabase SQL editor (project tied to NEXT_PUBLIC_SUPABASE_URL).

alter table public.calls drop constraint calls_status_check;

alter table public.calls add constraint calls_status_check
  check (status in (
    'initiated',
    'ringing',
    'answered',
    'completed',
    'failed',
    'missed',
    'voicemail'
  ));
