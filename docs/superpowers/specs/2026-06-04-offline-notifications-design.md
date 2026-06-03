# Offline Notifications — Design Spec

**Date:** 2026-06-04
**Status:** Approved

## Problem

When agents are logged out or offline, inbound calls and messages still arrive via Telnyx webhooks. The server already records missed calls (`status: 'missed'`) and inbound messages to Supabase correctly — the data is never lost. What is missing is a way to surface that backlog to agents when they log back in, and to alert agents in real-time when new events arrive while they are active.

## Solution Overview

A `notifications` table acts as a fan-out point for all agent-facing alerts. Webhooks write a row on every missed call and inbound message. A `NotificationBell` client component in the dashboard header reads from this table, subscribes to Supabase Realtime for live updates, and renders a popover listing unread items. Clicking an item marks it read and navigates to the relevant page.

The `notifications` table is designed to support future channels (push notifications, email digests) without schema changes — just new consumers reading from the same rows.

## Database

### Table: `notifications`

```sql
create table notifications (
  id           uuid primary key default gen_random_uuid(),
  type         text not null,         -- 'missed_call' | 'unread_message'
  reference_id text not null,         -- calls.id or conversations.id
  metadata     jsonb not null default '{}',
  is_read      boolean not null default false,
  created_at   timestamptz not null default now()
);

create index on notifications (is_read, created_at desc);
```

`type` is plain `text` (not an enum) so new notification types can be inserted without a migration.

`metadata` stores denormalized display info at insert time to avoid joins in the browser:
- Missed call: `{ contact_number, phone_label, phone_color }`
- Unread message: `{ contact_number, phone_label, last_message }`

### RLS Policies

```sql
alter table notifications enable row level security;

create policy "Agents can read notifications"
  on notifications for select
  to authenticated using (true);

create policy "Agents can update notifications"
  on notifications for update
  to authenticated using (true) with check (true);
```

Service role (used by webhook routes) bypasses RLS and handles all inserts.

### Realtime

The `notifications` table must be added to Supabase Replication (Database → Replication) so the client receives live INSERT events.

## Webhook Changes

### `app/api/webhooks/telnyx/voice/route.ts`

In `handleCallHangup`, after the existing `calls` update, when `finalStatus === 'missed'`:

1. Extend the existing `calls` select to also join `phone_numbers` (label, color).
2. Insert a `missed_call` notification:

```ts
await supabase.from("notifications").insert({
  type: "missed_call",
  reference_id: call.id,
  metadata: {
    contact_number: payload.from,
    phone_label: phoneNumber.label,
    phone_color: phoneNumber.color,
  },
})
```

Failure is logged but does not affect the webhook response — the call record is already saved.

### `app/api/webhooks/telnyx/message/route.ts`

In `handleMessageReceived`, after the message insert succeeds:

```ts
await supabase.from("notifications").insert({
  type: "unread_message",
  reference_id: conversation.id,
  metadata: {
    contact_number: fromNumber,
    phone_label: phoneNumber.label,
    last_message: messageText?.slice(0, 60) ?? "[Media]",
  },
})
```

`phoneNumber` and `conversation` are already in scope — no extra queries needed.

Duplicate protection is inherited from the existing `telnyx_message_id` deduplication check that runs before this point.

## NotificationBell Component

**File:** `components/notifications/notification-bell.tsx`

Client component (`"use client"`).

### Behavior

1. **On mount** — fetches `notifications` where `is_read = false`, ordered by `created_at desc`, limit 20.
2. **Realtime** — subscribes to Supabase Realtime `INSERT` events on `notifications`. New rows are prepended to the list and the badge count increments.
3. **Unmount** — unsubscribes from the Realtime channel to prevent memory leaks.
4. **Badge** — red dot/count on the `Bell` icon (lucide-react) showing total unread count. Hidden when count is zero.
5. **Popover** — shadcn `Popover` component. Two sections: **Missed Calls** and **Unread Messages**. Each item shows contact number, phone line label, and relative time ("2 min ago"). Empty state: "All caught up" message.
6. **On item click** — optimistically removes item from local list, calls `UPDATE notifications SET is_read = true WHERE id = ?`, then navigates:
   - `missed_call` → `/dashboard/calls`
   - `unread_message` → `/dashboard/conversations?id={reference_id}`

### Realtime resilience

Supabase JS auto-reconnects on network drops. The badge count re-syncs from a fresh DB query on reconnect, so it cannot drift from the real state.

## Layout Change

**File:** `app/dashboard/layout.tsx`

Replace the standalone `SidebarTrigger` with a flex header row:

```
[ SidebarTrigger ]  ..................  [ NotificationBell ]
```

Left-aligned trigger, right-aligned bell, both in a thin bar above `<main>`.

## Error Handling

| Scenario | Behavior |
|---|---|
| Notification insert fails in webhook | Error logged, webhook still returns 200. Call/message record is unaffected. |
| Telnyx retries a webhook | Existing deduplication guards prevent duplicate call/message records, so notification insert never runs twice. |
| Realtime socket drops | Supabase JS auto-reconnects. Badge re-syncs from DB on reconnect. |
| No unread notifications | Bell shows no badge. Popover shows "All caught up." |

## Future Extensibility

Push notifications and email digests read from the same `notifications` table. A background job or edge function queries `is_read = false` rows and fans out to the appropriate channel. No schema changes required — add `pushed_at` or `emailed_at` columns when needed.
