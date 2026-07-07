# Design: Unread-conversations nav badge (web)

**Date:** 2026-07-08
**Status:** Approved design, pending spec review

## Goal

Mirror the mobile Messages tab's **tab-level unread badge** in the web dashboard.
Mobile shows three levels of unread signalling; web already has two of them (per-line
avatar dots and per-conversation counts, both in `conversations-layout.tsx`). The
missing piece is the **top-level badge**: a count of conversations with
`unread_count > 0`, shown on the Conversations entry in the dashboard sidebar nav.

Out of scope: the per-line dots and per-conversation counts already exist and are not
changing.

## Problem

The unread data (`conversations` state + the `.channel("conversations")` realtime
subscription) currently lives **inside `components/conversations/conversations-layout.tsx`**,
which is only mounted on `/dashboard/conversations`. The sidebar is global — rendered on
every dashboard page by `app/dashboard/layout.tsx` → `AppSidebar` → `SidebarNav`. So the
badge cannot read from the page's subscription; it needs a source alive dashboard-wide.

## Approach: shared context provider (single source of truth)

Introduce one client provider at the dashboard layout that owns the single
`conversations` subscription. Both the sidebar and the conversations page consume it.
This follows the existing `WebRTCProvider` precedent already wrapping the layout.

```
app/dashboard/layout.tsx  (server component)
  └─ <UnreadProvider initialConversations={…}>        ← NEW (client)
       ├─ <AppSidebar> → <SidebarNav> → useUnread()    reads unreadCount
       └─ {children} → <ConversationsLayout> → useUnread()   reads/writes conversations
```

### Components

1. **`components/conversations/unread-provider.tsx`** (new, client component)
   - Owns canonical `conversations: Conversation[]` state, seeded from `initialConversations` prop.
   - Owns the **single** `.channel("conversations")` postgres_changes subscription —
     moved verbatim from `conversations-layout.tsx` (INSERT/UPDATE/DELETE merge + sort logic
     preserved, including the `phoneById` join-preservation).
   - Exposes via `useUnread()` context:
     - `conversations: Conversation[]`
     - `setConversations: Dispatch<SetStateAction<Conversation[]>>`
     - `unreadCount: number` — derived: `conversations.filter(c => c.unread_count > 0).length`
   - `useUnread()` throws if used outside the provider (standard guard).

2. **`components/sidebar-nav.tsx`** (edit)
   - Read `unreadCount` from `useUnread()`.
   - Render a badge on the Conversations nav item only. `NAV_ITEMS` stays a static array;
     the Conversations row is special-cased to slot the badge (e.g. match on `href`).
   - Expanded: count pill, right-aligned in the row, capped at `9+`, hidden when `0`.
   - Collapsed (`group-data-[collapsible=icon]`): a small dot overlay on the icon, hidden when `0`.

3. **`components/conversations/conversations-layout.tsx`** (edit)
   - Remove local `conversations`/`setConversations` `useState` and the conversations
     subscription `useEffect`; consume both from `useUnread()`.
   - Everything else stays: messages state, selection, compose, optimistic send,
     `mark_conversation_read` RPC, `unreadByInbox`, sorting. Marking a conversation read
     updates the shared list, so the nav badge drops automatically — no cross-component
     signalling needed.
   - `initialConversations` prop is removed (now seeded at the provider).

4. **Data seeding** (edit `app/dashboard/layout.tsx`, `app/dashboard/conversations/page.tsx`)
   - Move the `conversations` fetch (the `limit(50)` joined query currently in
     `conversations/page.tsx`) into the layout so the provider is seeded on every dashboard
     page. One indexed query; cost is negligible.
   - `conversations/page.tsx` keeps fetching `phoneNumbers` (page-specific) and its
     `prefillContact`/`prefillInbox` search params; it no longer passes `initialConversations`.

### Data flow

- Server (`layout.tsx`) fetches conversations → seeds `UnreadProvider`.
- Provider's realtime subscription keeps the list live for the whole dashboard session.
- `SidebarNav` renders `unreadCount` reactively.
- On the conversations page, opening a thread calls `mark_conversation_read` and updates
  the shared list (`unread_count → 0`) → badge decrements. Inbound SMS (via the Telnyx
  webhook → DB insert/update) triggers a postgres_changes event → list updates → badge
  increments — on any dashboard page, not just Conversations.

## Visual spec

shadcn/Tailwind, consistent with the existing per-line dot styling.

- **Count pill (expanded):** `inline-flex items-center justify-center min-w-5 h-5 px-1
  rounded-full bg-primary text-primary-foreground text-xs font-medium tabular-nums`.
  Right-aligned via `ml-auto` in the `SidebarMenuButton` row. Text is `count > 9 ? "9+" : count`.
- **Dot (collapsed):** small `bg-primary` (or destructive, matching per-line dots) dot
  positioned over the icon; visible only in `group-data-[collapsible=icon]` mode.
- Both hidden entirely when `unreadCount === 0`.

## Edge cases

- **50-row window:** `unreadCount` derives from the loaded list (`limit(50)`). Unread
  conversations sort to the top (inbound bumps `last_message_at`), so this is accurate in
  practice and matches mobile's behavior. Accepted as a known bound; not exact-counting.
- **Collapsed sidebar:** count pill won't fit → dot instead (above).
- **Provider misuse:** `useUnread()` outside `<UnreadProvider>` throws a clear error.

## Testing

- Unit-test the pure `unreadCount` derivation (list → count, including the `> 9` cap
  formatting if extracted to a helper).
- Typecheck + existing suite must stay green (currently 138 tests).
- The subscription/provider wiring mirrors existing patterns (`WebRTCProvider`,
  the current conversations subscription) which are not unit-tested in this repo;
  no new integration test harness is introduced.

## Non-goals

- No change to per-line dots or per-conversation counts.
- No exact-count query; no new API route (uses existing client-side Supabase + realtime).
- No pagination changes to the conversations list.
