# Web Notes & Add Contact — Design Spec

**Date:** 2026-08-12
**Status:** Draft for review
**Author:** Jhovanie + Claude

## Problem

The phone app (`hourglass-app`, Expo) lets an agent, right after a call, tap
**Notes** to record how the call went — an outcome (**Answered / No answer /
Rejected / Spam**), a free-text note, and a follow-up reminder — and lets them
**save a contact name** for a number under a specific phone line. The web admin
(`hourglass-mobile`, Next.js — the dashboard and the Chrome-extension call
panel) has neither. Calls there show only the raw phone number and carry no
disposition, so the web and the phone are out of sync on the two things agents
touch most.

## Goal

Bring both features to the web admin, on **both** of its call surfaces — the
`/dashboard/calls` table and the `/panel` extension Recent tab — reusing the
**same Supabase tables the phone app already writes**, so a note or contact
saved on one device shows up on the other with no extra sync work.

## Non-goals

- **No new database schema.** Both `call_dispositions` and `contacts` already
  exist in the shared Supabase (created for the phone app). This feature adds
  UI and read/write wiring only. (Precondition check below.)
- **No dedicated web follow-ups list.** Follow-ups are *captured* (saved to
  `call_dispositions.follow_up_at`) and already surface in the phone app's
  Follow-ups screen. A web list view can be a fast follow-up later.
- **No post-call auto-prompt.** The phone app auto-opens the sheet when a
  handled call ends (`shouldPromptForDisposition`). The web opens the sheet
  from an explicit **Notes** action on a call row. (The logic is ported so a
  future auto-prompt is a small addition.)
- **No contact profile page, no SMS ties, no de-dup/merge tooling.**

## Decisions locked with the client (2026-08-12)

- **Both surfaces** get both features (dashboard table + extension panel).
- **Per-agent notes.** Reuse `call_dispositions` as-is: a note is scoped to the
  logged-in user (`agent_id = auth.uid()`) and syncs with that same agent in
  the phone app. Not a shared team note.

## Key facts grounding the design (verified in code)

### Reused tables (already in Supabase)

**`call_dispositions`** — phone-app schema, `hourglass-app/docs/call-dispositions.sql`:

```sql
create table public.call_dispositions (
  id             uuid primary key default gen_random_uuid(),
  telnyx_call_id text not null,
  agent_id       uuid not null default auth.uid(),
  outcome        text not null
                 check (outcome in ('answered','no_answer','rejected','spam')),
  notes          text,
  follow_up_at   timestamptz,          -- null = no follow-up
  contact_number text,
  direction      text check (direction in ('inbound','outbound')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (telnyx_call_id, agent_id)
);
-- RLS: "agents manage own dispositions" for ALL ops,
--      using/with check: agent_id = auth.uid()
```

- **Not FK'd to `calls`** — matched by `telnyx_call_id` text, merged in JS. A
  disposition can exist before the `calls` row does.
- **Upsert on `(telnyx_call_id, agent_id)`**; `agent_id` is *not sent* by the
  client — it defaults to `auth.uid()` server-side, and the conflict target
  still resolves.

**`contacts`** — already reachable from the web app:

```sql
create table public.contacts (
  id              uuid primary key default gen_random_uuid(),
  phone_number_id uuid not null references public.phone_numbers(id),
  contact_number  text not null,  -- E.164, the external party
  name            text not null,
  created_by      uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (phone_number_id, contact_number)
);
-- RLS: SELECT open to authenticated (team-wide); NO insert/update policy —
-- writes go through POST /api/contacts (service-role).
```

### What the web app already has

- **`POST /api/contacts`** (`app/api/contacts/route.ts`) + `upsertContactWithClient`
  (`lib/contacts.ts`) — the contact **write path is already built**: auth via
  `getRequestUserId` (cookie *or* Bearer), E.164 + non-empty-name validation,
  upsert on `(phone_number_id, contact_number)`. Nothing reads `contacts` yet.
- **Supabase clients** (`lib/`): `server.ts` `createClient()` (cookie SSR,
  server components/actions), `client.ts` `createClient()` (browser; returns a
  localStorage JS client under `/panel`), `admin.ts` `createAdminClient()`
  (service-role), `auth.ts` `getRequestUserId(req)` (cookie or Bearer).
- **`components/ui/sheet.tsx`** — Radix Dialog sheet with `side="bottom"`, the
  bottom-sheet primitive. Plus `input`, `textarea`, `button`, `badge`,
  `dialog`; toasts via `sonner`; `cn()` from `@/lib/utils`.
- **`calls-table.tsx`** — each row expands to a detail panel (`:299-345`) that
  already renders a `<dl>` of call details (with an empty `Agent —` slot). The
  call select includes `telnyx_call_id`, `contact_number`, `direction`.
- **`recent-tab.tsx`** / `recent-row.ts` — the panel Recent list. Its data
  comes from `GET /api/calls/recent`, whose `RecentCall` type currently
  **omits `telnyx_call_id`** — must be added (it is the disposition key).
- **`phone_numbers`** is the "phone line": `{ id, label, phone_number, color,
  is_active }`. Dashboard server component already fetches them; the panel
  fetches via `GET /api/calls/phone-numbers`.

### Ported outcome / follow-up logic (verbatim from phone app)

```ts
type Outcome = "answered" | "no_answer" | "rejected" | "spam";
const OUTCOME_OPTIONS = [
  { value: "answered",  label: "Answered" },
  { value: "no_answer", label: "No answer" },
  { value: "rejected",  label: "Rejected" },
  { value: "spam",      label: "Spam" },
];

type FollowUpPreset = "none" | "tomorrow" | "in_3_days" | "next_week";
// tomorrow=+1d, in_3_days=+3d, next_week=+7d, each at 09:00 local; none=null
```

## Architecture

### New shared modules (framework-agnostic, ported from phone app)

- **`lib/disposition-logic.ts`** — `Outcome`, `OUTCOME_OPTIONS`,
  `FollowUpPreset`, `FOLLOW_UP_OPTIONS`, `followUpDate(preset, now)`,
  `shouldPromptForDisposition(direction, wasAnswered)`, `outcomeLabel()`. Pure
  functions, unit-tested. Copied nearly verbatim so web and phone can never
  drift.
- **`lib/dispositions.ts`** — `saveDisposition(client, input)` (upsert on
  `telnyx_call_id,agent_id`, notes trimmed → null, `updated_at` stamped) and
  `fetchDispositionsForCalls(client, telnyxCallIds)` (`.in(...)`, merged in JS).
  Takes a Supabase client as a parameter so the dashboard passes its cookie
  client and the panel passes its JS client.

### Write / read paths

| | Write | Read |
|---|---|---|
| **Notes** | Browser → Supabase **directly under RLS** (`saveDisposition`), `agent_id = auth.uid()`. No API route. | Dashboard server component + panel both `fetchDispositionsForCalls` for the visible calls, merge by `telnyx_call_id`. |
| **Contacts** | Browser → **existing `POST /api/contacts`** (service-role). | Merge `contacts` into the call lists (see below). |

Direct-to-Supabase for notes exactly mirrors the phone app and needs no new
server code; RLS enforces per-agent scoping on both surfaces because both hold
an authenticated Supabase session.

### Feature 1 — Notes / disposition sheet

- **Component:** `components/calls/notes-sheet.tsx` — `Sheet side="bottom"`.
  Content mirrors the phone app: outcome chips (2-col, **required** to enable
  Save), a notes `Textarea`, a follow-up preset row (None / Tomorrow / In 3
  days / Next week). `sonner` toast on success; on error the sheet stays open
  with typed content intact.
- **Seed:** opened from a call row — seeds `telnyxCallId`, `contactNumber`,
  `direction` from the row, and any existing disposition (edit mode keeps the
  existing `follow_up_at` untouched unless a preset chip is picked).
- **Dashboard trigger:** a **Notes** button in the `calls-table.tsx` expanded
  detail panel. The saved outcome + note snippet renders on the row.
- **Panel trigger:** a **Notes** action on each `recent-tab.tsx` row. Requires
  adding `telnyx_call_id` to the `/api/calls/recent` select + `RecentCall` type.

### Feature 2 — Add / edit contact sheet

- **Component:** `components/calls/contact-sheet.tsx` — `Sheet side="bottom"`
  with a **name** `Input` (required) and a **phone-line chip row** (the agent's
  `phone_numbers`, color dot + label). `contact_number` is prefilled from the
  call row, not typed. Title flips **Add ⇄ Edit** based on whether a saved name
  already exists for the selected line.
- **Save:** `POST /api/contacts` with `{ phoneNumberId, contactNumber, name }`
  (the existing route/validation). Small client helper `saveContact()` wraps the
  fetch on both surfaces.
- **Trigger:** an **Add / Edit contact** action on each call row (dashboard
  detail panel + panel recent row).
- **Name display:** merge `contacts` into both call lists so a row shows the
  **saved name instead of the raw number**; when a number has names under
  multiple lines, the latest `updated_at` wins (matches phone-app resolution).
  Dashboard merges in its server component (`.in('contact_number', numbers)`
  under the team-wide read policy); panel merges inside `/api/calls/recent`.

## Data flow (Notes, panel example)

1. Agent taps **Notes** on a Recent row → `notes-sheet` opens, seeded from the
   row + `fetchDispositionsForCalls([telnyx_call_id])`.
2. Agent picks outcome (required), types a note, optionally a follow-up preset.
3. Save → `saveDisposition(jsClient, input)` upserts under RLS. `follow_up_at`
   is resolved from the preset via `followUpDate`.
4. Toast; the row now shows the saved outcome. The same row in the phone app's
   history (same agent account) reflects it on next fetch.

## Error handling

- **Outcome required** — Save disabled until one is picked (client), and the DB
  CHECK backs it.
- **Notes** trimmed → `null` when blank.
- **Contact name** required + `contact_number` must be valid E.164 — enforced
  server-side by the existing `/api/contacts` (422 with a friendly message).
- **Save failure** keeps the sheet open with content intact and shows an inline
  error for retry (mirrors phone app).
- **Missing `telnyx_call_id`** on a row → the Notes action is hidden/disabled
  for that row (can't key a disposition without it).

## Testing

- **Vitest** unit tests for `lib/disposition-logic.ts`: outcome/preset tables,
  `followUpDate` (+1/+3/+7 days at 09:00, `none → null`),
  `shouldPromptForDisposition` truth table.
- **Vitest** for `lib/dispositions.ts`: `saveDisposition` builds the correct
  upsert payload + `onConflict`; `fetchDispositionsForCalls` merges by id
  (Supabase client mocked, matching the existing `route.test.ts` mock style).
- Manual: save a note on the dashboard, confirm it reads back and (same
  account) appears in the phone app; add a contact name and confirm it displays
  in both call lists.

## Precondition to verify before coding

1. **`call_dispositions` exists in the shared Supabase.** The phone app writes
   it in production, so it almost certainly does. If not, apply the ready-made
   `hourglass-app/docs/call-dispositions.sql`. First implementation step.
2. **`/api/calls/recent` must return `telnyx_call_id`** (add to select + type)
   for the panel Notes action to key its disposition.

## Rollout / files touched (summary)

- **New:** `lib/disposition-logic.ts`, `lib/dispositions.ts`,
  `components/calls/notes-sheet.tsx`, `components/calls/contact-sheet.tsx`,
  small `lib/contacts` client helper + a contacts read/merge helper, tests.
- **Edited:** `calls-table.tsx` (detail-panel actions + name display),
  `recent-tab.tsx` (row actions + name display), `app/api/calls/recent/route.ts`
  (+`telnyx_call_id`, +contact-name merge), `app/dashboard/calls/page.tsx`
  (contact-name merge in the server fetch), `RecentCall` type.
- **Unchanged:** `contacts` write path (`/api/contacts`, `lib/contacts.ts`),
  both DB schemas.
