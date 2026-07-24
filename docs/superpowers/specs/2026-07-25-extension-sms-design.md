# SMS in the Chrome Extension — Design Spec

> Status: implemented, with one correction below · 2026-07-25 · single repo
> (`hourglass-mobile`, the Next.js web app + Chrome extension).

## Correction — where the tabs actually live

**This spec originally placed the Messages tab in the 340×220 floating widget.
That was wrong**, and the sections below still describe that constraint. The
extension has five distinct surfaces:

| File | `?mode=` | Component | What it is |
|---|---|---|---|
| `popup.html` | `remote` | `RemotePhone` | **The toolbar popup — where PanelTabs lives.** 360×560 |
| `setup.html` | `remote` | `RemotePhone` | Setup page, same tabbed UI |
| `call-widget.html` | `widget` | `WidgetPhone` | Floating in-call overlay, 340×220 |
| `call-window.html` | `call` | `CallWindowPhone` | Popped-out call window |
| `offscreen.html` | `background` | `BackgroundPhone` | Headless SIP registration |

`PanelTabs` is rendered by `remote-phone.tsx`, not `panel-app.tsx`. And
`widget-phone.tsx` returns `null` when the call state is idle — it is a call
overlay, not a container for tabs, so a Messages tab could never have lived
there.

**What changed as a result:** the Messages tab is mounted in `remote-phone.tsx`
(the popup), still beside Recent as specified. The widget resize to 340×360 was
dropped — it would only have stretched the in-call overlay. The popup is
already 360×560, which is roomier than the size that section argues for, so the
"one real constraint" analysis below is moot in practice.

Everything else in this spec — the shared hook, the API-route migration, the
RLS-scoped client, the Realtime DELETE fix — was implemented as written.

## Context — what already exists

**The extension is a thin shell, not an app.** All of `extension/` is ~550
lines of vanilla JS with no build step. `call-widget.html` embeds an iframe
pointing at the web app's `/panel` route, and `panel.js` bridges the two
directions: `postMessage` from the panel UI → `chrome.runtime` commands, and
`chrome.runtime` events → `postMessage` into the iframe.
`scripts/package-extension.mjs` rewrites the dev origin to
`https://www.megestic.com` at package time.

The practical consequence: **SMS in the extension is almost entirely a web-app
change.** The panel UI is React, served by Next.js, and lives in
`components/calls/panel/`.

**The panel is already tabbed.** `panel-tabs.tsx` renders Dialpad / Recent /
Settings against a `PanelTab` union, with one file per tab under
`components/calls/panel/tabs/` (54–117 lines each).

**The panel is already authenticated.** `panel-app.tsx:27` creates a Supabase
browser client, tracks the session, and derives `accessToken` at line 44.
`use-recent-calls.ts` establishes the fetch convention: pass `accessToken`,
send `Authorization: Bearer`.

**The web SMS UI** is `components/conversations/` — 1321 lines across six
files, built around a two-pane desktop layout. `conversations-layout.tsx`
(320 lines) does two jobs at once: data orchestration (fetch, two realtime
channels, mark-read, selection, optimistic send) *and* desktop presentation.

## Goal

Give agents a Messages tab inside the existing floating call widget so they can
triage and reply to texts without leaving the page they are working in, with
the same capabilities the website has.

## Scope

**In scope:** conversation list with unread badge on the tab, open a thread and
reply, start a new conversation, filter by brand line, delete a message, delete
a conversation.

**Out of scope:** `resendMessage` (exists on the website, not requested here),
media/MMS attachment upload, and any new extension surface — no Chrome side
panel and no pop-out window. The Messages tab lives beside Recent inside the
existing widget. This was decided explicitly.

## The constraint that shapes everything

The floating widget is **340×220px** (`extension/content-widget.js:20-21`).
The web SMS UI cannot be reused at that width: a two-pane list-plus-thread does
not fit in 340px, and `chat-view.tsx` alone is 385 lines built for a wide
column.

The widget grows to **340×360**. That is a one-line change, adds no new
surface, and takes a thread from ~3 visible messages to ~7. Everything below
assumes 360px tall: 40px tab bar leaves ~320px of content.

## Architecture — one shared hook, two presentations

```
                        ┌─ conversations-layout.tsx (desktop, two-pane)
   useConversations ────┤
    (shared hook)       └─ messages-tab.tsx (panel, single-pane drill-down)
           │
           ├── reads/realtime ──→ supabase browser client (RLS)
           └── mutations ───────→ /api/messages/* (Bearer or cookie)
```

The hook is the single source of truth for realtime, mark-read, unread
counting, and optimistic send. Two implementations would drift, and the whole
point of this work is that the extension behaves the same as the website.

### Why mutations move to API routes

`sendMessage`, `deleteMessage`, and `deleteConversation` are `"use server"`
server actions (`app/dashboard/conversations/actions.ts`) that authenticate
through the cookie-based client from `@/lib/server`. **The panel iframe is
cross-origin and has no cookies**, so server actions cannot authenticate there.

API routes work in both contexts because `getRequestUserId` (`lib/auth.ts:43`)
tries the cookie session first and falls back to a Bearer token. Routing all
mutations through API routes therefore gives one path for both callers rather
than two.

`/api/messages/send` and `/api/messages/conversations` already exist and
already use `getRequestUserId`. Delete needs two new routes.

## New API routes

```
DELETE /api/messages/[id]                 → replaces the deleteMessage action
DELETE /api/messages/conversations/[id]   → replaces the deleteConversation action
```

Both mirror their server-action bodies: authenticate, then
`.delete().eq("id", …)`.

### Security — deletes must run as the caller

The existing actions delete through the **user's RLS-scoped client**, so
Postgres policies decide what may be removed. `getRequestUserId` returns only
an id; using `createAdminClient()` with it would bypass RLS entirely and let
any authenticated agent delete any conversation in the system.

So `lib/auth.ts` gains one helper:

```ts
/**
 * A Supabase client scoped to the requesting user, so RLS applies. Cookie
 * session when present, otherwise the Bearer token. Mutations that rely on RLS
 * for authorization — deletes especially — MUST use this, never
 * createAdminClient().
 */
export async function createRequestScopedClient(req: Request): Promise<SupabaseClient | null>
```

It returns the cookie client when a cookie session exists; otherwise it builds
a client with the caller's token set as a global `Authorization` header, so
Postgres sees the real user. Returns `null` when neither is present, which the
routes turn into a 401.

## `useConversations` — the extracted hook

New file `components/conversations/use-conversations.ts`, lifted from
`conversations-layout.tsx:40-232`.

```ts
useConversations({ supabase, phoneNumbers, initialConversations }) → {
  conversations, selected, messages, loadingMessages, sending,
  unreadByInbox,        // existing — per-line dots
  totalUnread,          // new — drives the Messages tab badge. Counts
                        // CONVERSATIONS with unread_count > 0, not the sum of
                        // unread messages, matching how unreadByInbox already
                        // derives its per-line dots.
  selectConversation,   // loads messages + mark_conversation_read RPC
  clearSelection,       // new — the panel's "back to list"
  send,                 // → POST /api/messages/send
  startConversation,    // → POST /api/messages/conversations
  deleteMessage,        // → DELETE /api/messages/[id]
  deleteConversation,   // → DELETE /api/messages/conversations/[id]
}
```

Preserved verbatim from the existing implementation:

- Both realtime channels — `conversations` for the list, `messages:${id}` for
  the open thread.
- The optimistic-send reconciliation at lines 197-210. The duplicate-key guard
  there is subtle: the realtime INSERT can land before the send resolves, and
  dropping it would render two children with the same key. It is not rewritten.
- The `mark_conversation_read` RPC and local unread reset.
- Sort-by-`last_message_at`, newest first.

Deliberately **not** moved into the hook: inbox selection. It writes to the URL
via `router.replace` (`conversations-layout.tsx:46`), which is meaningless
inside an iframe. The desktop keeps its URL-backed switcher; the panel filters
in local state.

### Realtime fix — deletes must propagate

The messages channel currently subscribes to `INSERT` only
(`conversations-layout.tsx:121`). A message deleted on the website therefore
stays visible to everyone else watching that thread until they reload. With the
panel and the website open side by side that becomes obvious and wrong, so the
subscription widens to `INSERT` and `DELETE`, removing deleted rows from local
state. This fixes existing behavior rather than working around it.

## Panel UI

### Tab bar

`PanelTab` gains `"messages"`. Order is Dialpad · Recent · **Messages** ·
Settings — beside Recent, as specified. Icon is lucide's `MessageSquare`,
matching the one-icon-per-tab pattern. `PanelTabs` gains an optional badge
count so Messages can show unread without opening the tab.

### Three views, single pane

```
LIST                          THREAD                        COMPOSE
┌────────────────────────┐    ┌────────────────────────┐    ┌────────────────────────┐
│ All lines ▾         + │    │ ← +1 555-0104 · Ridge 🗑│    │ ← New message          │
├────────────────────────┤    ├────────────────────────┤    ├────────────────────────┤
│● ●Jane Doe        2m  │    │   Hey, are you around? │    │ To  [+1 555-0199     ] │
│  Sounds good, see…    │    │              ┌────────┐│    │ From[Ridgeline      ▾] │
├────────────────────────┤    │           🗑 │ On my  ││    │ ┌────────────────────┐ │
│  ●Mark Ruiz       1h  │    │              │ way    ││    │ │ Message…           │ │
│  On my way            │    ├────────────────────────┤    │ └────────────────────┘ │
├────────────────────────┤    │ [Message…        ] [→]│    │            [   Send   ]│
│  ●Ana Cruz      Tue   │    └────────────────────────┘    └────────────────────────┘
└────────────────────────┘
```

The list header does double duty — line filter and compose button in one 26px
row — because a separate `inbox-switcher` row costs height the thread cannot
spare.

Delete uses hover affordances rather than a new gesture, because the panel runs
in a desktop browser: a trash button in the thread header deletes the
conversation, and a trash button appears on message-bubble hover.

Deleting a conversation is destructive and cascades to every message, so it
confirms first — as an **inline two-step button** (trash → "Delete?" /
"Cancel" in the header row), not `window.confirm`. A native modal inside a
340px cross-origin iframe is disproportionate and blocks the whole panel.
Message delete does not confirm, matching the website.

### Files

| File | Responsibility |
|---|---|
| `tabs/messages-tab.tsx` | View state (`list`/`thread`/`compose`), consumes the hook |
| `tabs/messages/conversation-rows.tsx` | List, line filter, compose button |
| `tabs/messages/thread-view.tsx` | Bubbles, composer, delete affordances |
| `tabs/messages/compose-view.tsx` | New-message form |
| `tabs/messages/conversation-row.ts` | Pure row formatting (see Testing) |

`chat-view.tsx` and `message-bubble.tsx` are **not** reused — they carry
avatars, media handling, and wide-column layout the panel has no room for. The
panel's bubble is roughly 30 lines. Sharing logic through the hook while
writing panel-native presentation is the entire point of this approach.

## Error handling

| Case | Behavior |
|---|---|
| Send fails, 422 (opt-out or Telnyx rejection) | Optimistic bubble flips to `delivery_failed`, inline error |
| Send fails, 400 | Same failed-bubble treatment, inline validation message |
| Any 401 | Session expired; the panel's existing `PanelLogin` takes over |
| Delete fails | Optimistic removal rolls back, toast with the error |
| Compose to a malformed number | Validated before sending; inline message, no request fired |
| Agent has no phone lines | Empty state on the compose view instead of a broken picker |
| Realtime socket drops | Refetch the list on window focus. The desktop page never needed this; a widget injected into a page that sits open for hours does |
| No session at all | Existing `PanelLogin` path, unchanged |

## Testing

Vitest runs with `environment: "node"` and the repo has no jsdom or
testing-library. **React components and hooks cannot be unit-tested here**, and
this spec does not add a test harness the project does not use.

What is covered:

- `tabs/messages/conversation-row.ts` — pure formatting, tested in
  `conversation-row.test.ts` beside it, mirroring the existing `recent-row.ts`
  / `recent-row.test.ts` pair in the same directory. Covers preview truncation,
  empty and media-only bodies, relative timestamps (`2m` / `1h` / `Tue`), and
  unread state.
- The two new DELETE routes get `route.test.ts` files following the pattern in
  `app/api/devices/register/route.test.ts`: 401 without credentials,
  authenticated via Bearer, and RLS-scoped client used rather than the admin
  client.
- `/api/messages/send` and `/api/messages/conversations` already have route
  tests, which continue to cover the desktop now that it calls them.

What is **not** covered: `useConversations` and all four panel components.
Verified by hand.

## Verification the desktop still works

The desktop conversations page changes underneath — its send and both deletes
move from server actions to API routes. Same underlying `lib/messaging`
functions, so behavior should be identical, but that must be confirmed rather
than assumed. Before this is considered done, on the website:

1. Send a message; confirm it appears once, not twice (the duplicate-key guard).
2. Send to an opted-out contact; confirm the failed-bubble treatment.
3. Delete a message; confirm it disappears, and confirm it now also disappears
   in a second browser tab without reloading (the realtime fix).
4. Delete a conversation; confirm it leaves the list and its messages go with it.
5. Confirm unread counts and the inbox switcher still behave.

## Open dependency

None. All work is in this repo, and no Supabase schema or policy changes are
required — the new routes rely on the RLS policies that already govern the
server actions.
