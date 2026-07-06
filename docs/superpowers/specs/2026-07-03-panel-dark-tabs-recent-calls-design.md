# Extension Popup: Dark Tabbed UI + Recent Calls (callback missed calls)

**Date:** 2026-07-03
**Status:** Approved design — ready for implementation planning
**Scope:** Redesign the `?mode=remote` panel (popup + setup tab) into a dark, tabbed UI (smrtPhone-style) and add a **Recent Calls** tab for calling back missed calls. Builds on the popup/widget rework in `2026-07-03-extension-popup-call-widget-design.md`.

## Goal

Give the extension popup the cleaner smrtPhone layout the client showed — a
tabbed dark surface (Dialpad · Recent · Settings) — and let agents **call back
missed calls** from a Recent Calls list.

## Non-goals

- SMS / Inbox tab — deferred to its own spec (`docs/sms-multi-brand-todo.md`).
- Call dispositions — separate spec.
- Realtime updates of the Recent list — YAGNI; the popup is short-lived and
  re-fetches on open.
- Redesigning the web app's own dialer (`?mode=local` / `PanelDialer`) or the
  compact call widget (`?mode=widget`) — untouched.
- Any change to server-side call handling (voice webhook, ring-all, presence,
  agent-credentials).

## Surfaces affected

Only `RemotePhone` (`components/calls/panel/remote-phone.tsx`), which renders for
`?mode=remote` — used by the **popup** and the **setup tab**. One new read-only
API route. Nothing else changes.

## Architecture — UI structure

`RemotePhone` becomes a thin **tabbed shell** and the current monolith splits
into focused tab components:

```
RemotePhone (shell)
  owns: state-sync subscription, activeTab, prefillTo, call overlays
  ├─ header      → "Call Panel" + online status dot
  ├─ PanelTabs   → Dialpad · Recent · Settings
  ├─ DialpadTab  → From select + "To" input + big green Call button ("Make a call")
  ├─ RecentTab   → recent calls list + tap-to-callback
  └─ SettingsTab → Online toggle + Sign out
  (IncomingCallPopup + active-call HUD stay mounted at the shell root, above tabs)
```

**One-phone rule preserved:** every tab is a remote — renders `state-sync`, sends
`PanelCommand`s. No WebRTC in these components.

**Dark, always:** the panel root is wrapped in an explicit dark surface
(near-black background, light text) so it stays black regardless of the OS/`next-themes`
setting. The Call button keeps the green accent from the reference screenshot.

**Callback flow (approved option A):** tapping a Recent row sets the shell's
`prefillTo` to the row's `contact_number` and switches `activeTab` to Dialpad
(agent presses Call). Each row also has a phone icon for one-tap dial via the
existing `dial` command. One-tap dial is disabled when `!isReady` or a call is
in progress, reusing the shell's existing guards.

## New files

- `components/calls/panel/panel-tabs.tsx` — the 3-tab nav bar.
- `components/calls/panel/tabs/dialpad-tab.tsx` — the "Make a call" form (From + To + Call), lifted out of today's `RemotePhone`.
- `components/calls/panel/tabs/recent-tab.tsx` — recent calls list + callback.
- `components/calls/panel/tabs/settings-tab.tsx` — Online toggle + Sign out.
- `components/calls/panel/use-recent-calls.ts` — bearer-auth fetch hook.
- `components/calls/panel/recent-row.ts` — pure `formatRecentRow(call)` helper (testable).
- `components/calls/panel/recent-row.test.ts` — vitest for the helper. (Colocated; add `components/**/*.test.ts` to the vitest include, or place the test under `lib/`. Plan will choose; default: extend include.)
- `app/api/calls/recent/route.ts` — `GET`, bearer-auth, returns latest ~30 calls.

## Modified files

- `components/calls/panel/remote-phone.tsx` — shrinks to the tabbed shell; keeps the `state-sync` subscription, call overlays, and command `send`.
- `vitest.config.ts` — include the new colocated test (if colocated under `components/`).

## Data path — Recent Calls

**Endpoint `GET /api/calls/recent`** (mirrors `app/api/calls/phone-numbers/route.ts`):

- Auth: `getRequestUserId(req)` → `401` if absent.
- Query (admin/user client per existing route pattern; RLS scopes to the agent):
  ```
  from("calls")
    .select("id, contact_number, direction, status, started_at, created_at,
             phone_numbers(label, phone_number, color)")
    .order("created_at", { ascending: false })
    .limit(30)
  ```
- **RLS does the scoping** — same row-level security that protects the dashboard;
  the route adds no ad-hoc user filtering.
- Response: `{ recentCalls: RecentCall[] }` on success; `{ error: string }` with a
  non-200 on failure.

**`RecentCall` shape** (trimmed `Call`):
```ts
type RecentCall = {
  id: string
  contact_number: string
  direction: "inbound" | "outbound"
  status: CallStatus            // includes "missed"
  started_at: string | null
  created_at: string
  phone_numbers?: { label: string; phone_number: string; color: string }
}
```

**Hook `use-recent-calls(accessToken)`:** fetches on first Recent-tab open;
exposes `{ calls, loading, error, reload }`. One fetch per open, no subscription.

**`formatRecentRow(call): RecentRowView`** (pure, tested):
```ts
type RecentRowView = {
  title: string          // contact_number (display)
  missed: boolean        // status === "missed"
  directionIcon: "in" | "out"
  lineLabel: string | null   // phone_numbers?.label ?? null
  timeText: string       // formatDistanceToNow(started_at ?? created_at)
  callbackTo: string     // contact_number (raw, for dial/prefill)
}
```

**Flow:** `RecentTab` → `use-recent-calls` → `fetch("/api/calls/recent",
{ Authorization: Bearer })` → route → Supabase (RLS) → rows. Row tap →
`prefillTo(callbackTo)` + `setActiveTab("dialpad")`; row icon →
`send({ cmd:"dial", to: callbackTo, callerId: selectedLine })`.

## Error handling

- **Fetch failure (401/network/500)** → inline "Couldn't load recent calls" + Retry (calls `reload`).
- **Empty history** → "No recent calls yet" empty state, not a blank pane.
- **One-tap dial** → icon disabled when `!state.isReady` or `inCall` (reuse existing guards).
- **Legacy/partial rows** → null `started_at` falls back to `created_at`; missing `phone_numbers` join hides the label line; never throws.
- **Callback number** → `contact_number` passed as-is to the existing `dial` path (engine/Telnyx handle E.164); no new normalization.

## Testing

**Unit (vitest, node):** `formatRecentRow` — table-driven: missed inbound,
completed outbound, null `started_at`, missing join, voicemail status.

**Typecheck:** `npm run typecheck` for components + route.

**Manual acceptance (popup, load-unpacked):**
1. Recent tab lists newest-first; missed flagged red.
2. Tap a missed row → Dialpad opens prefilled → Call connects.
3. Row phone icon one-tap dials; disabled mid-call.
4. Empty state on a fresh account; Retry works after a forced failure.
5. Settings tab: Online toggle + Sign out work.
6. Panel stays black in both light and dark OS themes.

**Regression guard:** no change to the voice webhook, ring-all, presence,
agent-credentials, the offscreen engine, or the widget. Adds one read-only bearer
endpoint + popup UI only.

## Open questions / risks

- **Vitest include location:** colocate the test under `components/` (extend
  include to `components/**/*.test.ts`) or drop the pure helper + test under
  `lib/`. Plan will pick one; extending the include is the default.
- **Selected line for one-tap dial:** the Dialpad's `From` selection is the
  caller ID; if the Recent tab dials directly it uses the first active phone
  number as `callerId` (same default the Dialpad uses).
