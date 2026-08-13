# Dashboard: Contacts page, Follow-ups page, AI-call visibility — Design Spec

**Date:** 2026-08-14
**Status:** Scope approved by Jhovanie (3 AskUserQuestion decisions, all "Recommended")
**Author:** Jhovanie + Claude

## Problem

Three kinds of data are captured but invisible outside a call row's expander:
saved **contacts**, note **follow-ups** (`call_dispositions.follow_up_at`), and
**AI-answered calls** (`calls.ai_handled`). The client can't find any of them
from the sidebar.

## Goal (decided scope)

1. **Contacts** sidebar page — full directory: search (name/number), each row
   shows name, number, business line; edit and add-new reuse the existing
   `ContactSheet` flow (`POST /api/contacts`).
2. **Follow-ups** sidebar page — the agent's follow-ups grouped
   Overdue / Today / Upcoming, with the call's outcome + notes and a
   **Done** action that clears the reminder. *Known limitation (by design of
   the notes feature): dispositions are per-agent under RLS — each user sees
   only their own follow-ups.*
3. **AI calls** — "AI" badge on calls-table rows where `ai_handled`, an
   **Answered by** filter (All / AI assistant / Team), and the expanded row's
   `Agent` detail shows "AI assistant".

## Non-goals

- No panel/extension changes (dashboard only; web deploy).
- No shared/team-wide follow-up visibility (RLS change = separate decision).
- No call-back/SMS actions on the Follow-ups page v1 (dispositions don't
  store `phone_number_id`, so there's no line to originate from).
- No pagination on Contacts v1 (fetch capped; revisit if the directory grows).

## Key facts grounding the design

- `contacts` has team-wide RLS read (calls page already SELECTs it from a
  user-scoped server client); writes are service-role-only via
  `POST /api/contacts` (`lib/contacts-client.ts` → `saveContact`).
- `call_dispositions` RLS scopes to `agent_id = auth.uid()` — both the
  server-component fetch (cookie-scoped client) and browser updates inherit
  it. Clearing a follow-up = `update … set follow_up_at = null` on own row.
- `calls.ai_handled` exists since the AI voice agent feature; the calls page
  SELECT just doesn't request it. Realtime UPDATE payloads spread all columns,
  so the badge stays live.
- `ContactSheet` seeds state on mount and posts via `saveContact`; it takes a
  fixed `contactNumber`. Add-new needs a number field → new optional
  `allowNumberEdit` prop (default false = today's behavior everywhere).
- Sidebar items live in `components/sidebar-nav.tsx` `NAV_ITEMS`.

## Design

### Contacts (`/dashboard/contacts`)

Server page fetches active `phone_numbers` + `contacts` (id, phone_number_id,
contact_number, name, updated_at; limit 1000, newest first) and passes to a
client component: search box filtering name/number, shadcn Table (Name,
Number, Line chip with color, Updated, Edit), "Add contact" button. Edit opens
`ContactSheet` as-is; Add opens it with `allowNumberEdit` and an empty number.
`onSaved → router.refresh()`.

### Follow-ups (`/dashboard/follow-ups`)

Server page fetches the agent's dispositions where `follow_up_at is not null`
(ascending) + contact-name map, passes to a client component that renders
three groups via a new pure helper:

`lib/follow-ups.ts` → `groupFollowUps(rows, now)`:
- `overdue`: `follow_up_at < startOfDay(now)`… no — simpler and truer to
  intent: `overdue` = strictly before `now`; `today` = ≥ now and same
  calendar day; `upcoming` = later days. Sorted ascending inside each group.

Row: contact name (fallback number), outcome label, notes, due time
(absolute + relative), **Done** button → new `clearFollowUp(db, id)` in
`lib/dispositions.ts` (update `follow_up_at = null`, RLS-owned), optimistic
removal + sonner toast with error rollback. Empty state: "No follow-ups
scheduled."

### AI visibility (Calls page)

- Page SELECT adds `ai_handled`; `Call` type already carries it.
- `AIBadge` (Bot icon + "AI", violet pill) in the leading icon cluster
  (desktop) and next to the status badge (mobile); expanded `Agent` detail
  row: `call.ai_handled ? "AI assistant" : "—"`.
- `CallFilters` gains `answeredBy: "all" | "ai" | "team"`; new "Answered by"
  select in the filter bar; client filter: `ai → c.ai_handled === true`,
  `team → !c.ai_handled`.

### Sidebar

`NAV_ITEMS` += Contacts (`Users` icon), Follow-ups (`CalendarClock` icon),
after Calls. Both pages get `loading.tsx` skeletons matching the calls page
pattern.

## Error handling

- Contacts/Follow-ups fetch errors → empty arrays render empty states (same
  posture as calls page).
- `clearFollowUp` failure → toast + restore the row (no silent loss).
- Contacts save errors surface inside `ContactSheet` (existing behavior).

## Testing

- **Unit:** `lib/follow-ups.test.ts` (group boundaries: past/now/today/
  tomorrow, ascending order, null follow_up_at excluded);
  `lib/dispositions.test.ts` extended for `clearFollowUp` (update payload +
  id filter, error throw). Filter logic for `answeredBy` lives inline in the
  existing client memo (same as status/direction — not separately tested).
- **Manual:** each page renders with data and empty; add + edit contact
  round-trip; Done removes and persists after refresh; AI badge appears on
  the verified AI test call; Answered-by filter isolates it; sidebar
  highlights active page.

## Delivery

Web deploy only. No DB changes. No extension changes.
