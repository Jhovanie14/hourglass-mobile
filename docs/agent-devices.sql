-- Devices registered for SMS push notifications (one row per app install).
-- Created 2026-07-08 for the mobile app's Messages tab (see the mobile repo's
-- docs/superpowers/specs/2026-07-08-sms-messages-tab-design.md).
-- Run in the Supabase SQL editor.

create table if not exists public.agent_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  fcm_token text not null unique,
  platform text not null default 'android',
  updated_at timestamptz not null default now()
);

-- Service-role only: the /api/devices/register route is the sole reader/writer.
alter table public.agent_devices enable row level security;

-- Added 2026-07-09: declared call availability. A backgrounded phone cannot
-- heartbeat (Android suspends JS timers), so the app's Online toggle sets this
-- flag instead, and ring-all dials agents with an available device regardless
-- of presence freshness (the FCM push wakes the phone).
alter table public.agent_devices
  add column if not exists is_available boolean not null default false;
