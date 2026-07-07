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
