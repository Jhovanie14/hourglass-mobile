# Web Notes & Add Contact Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the phone app's post-call **Notes** (disposition) capture and **Add/Edit contact** features to the web admin (`hourglass-mobile`), on both the `/dashboard/calls` table and the `/panel` extension Recent tab, reusing the shared Supabase tables so notes and contacts sync with the phone app.

**Architecture:** Port the phone app's pure logic and data-access into two framework-agnostic `lib/` modules that take a Supabase client as a parameter. Notes write **directly to `call_dispositions` under RLS** (`agent_id = auth.uid()`) via `@/lib/client`'s `createClient()` (which returns the correct browser/panel client by pathname). Contacts write through the **existing** `POST /api/contacts` (service-role). Two reusable bottom-sheet components (`Sheet side="bottom"`) are wired into both surfaces.

**Tech Stack:** Next.js 16 App Router, React 19, `@supabase/ssr` + `@supabase/supabase-js`, `radix-ui` + shadcn wrappers, Tailwind v4, `lucide-react`, Vitest.

## Global Constraints

- **No new DB schema.** `call_dispositions` and `contacts` already exist in the shared Supabase. This feature adds UI + wiring only. Verify `call_dispositions` exists before Task 5 (see Task 0).
- **Outcome values (verbatim):** `"answered" | "no_answer" | "rejected" | "spam"`. Labels: `Answered`, `No answer`, `Rejected`, `Spam`. Outcome is **required** to save.
- **Follow-up presets (verbatim):** `"none" | "tomorrow" | "in_3_days" | "next_week"` → `none`=null, else +1/+3/+7 days at **09:00 local**.
- **Notes are per-agent.** Never send `agent_id` from the client — it defaults to `auth.uid()` server-side. Upsert conflict target is `"telnyx_call_id,agent_id"`.
- **Contacts unchanged on the write side.** Reuse `POST /api/contacts` + `lib/contacts.ts` exactly; do not modify them. Upsert conflict target is `"phone_number_id,contact_number"`.
- **No automated component tests** — the repo has no jsdom/RTL. Automated tests cover pure `lib/` modules only (Vitest, colocated `*.test.ts`, run with `npm test`). Components get manual verification steps.
- **Commit after each task.** The repo's `main` already has unrelated uncommitted changes in the tree; **stage only the files each task names** (never `git add -A`).

---

## File Structure

**New files:**
- `lib/disposition-logic.ts` — pure outcome/follow-up logic (ported verbatim). + `lib/disposition-logic.test.ts`.
- `lib/dispositions.ts` — `Disposition` type, `saveDisposition(client, input)`, `fetchDispositionsForCalls(client, ids)`. + `lib/dispositions.test.ts`.
- `lib/contact-names.ts` — pure `buildContactNameMap(rows)`. + `lib/contact-names.test.ts`.
- `lib/contacts-client.ts` — `saveContact(input, accessToken?)` (POSTs to `/api/contacts`). + `lib/contacts-client.test.ts`.
- `components/calls/use-dispositions.ts` — client hook fetching dispositions for the visible calls (works on both surfaces).
- `components/calls/notes-sheet.tsx` — the Notes bottom sheet.
- `components/calls/contact-sheet.tsx` — the Add/Edit contact bottom sheet.

**Modified files:**
- `types/calls.ts` — add `contact_name?: string | null` to `Call`.
- `app/dashboard/calls/page.tsx` — merge contact names into the server fetch.
- `components/calls/calls-table.tsx` — name display + Notes/Contact actions + disposition badge.
- `app/api/calls/recent/route.ts` — add `telnyx_call_id` to select + merge contact names.
- `components/calls/panel/recent-row.ts` — add `telnyx_call_id` + `contact_name` to `RecentCall`; title uses saved name. + update `recent-row.test.ts` if present.
- `components/calls/panel/tabs/recent-tab.tsx` — Notes/Contact actions per row.

**Task order:** shared modules (1–3) → sheets (4–5) → dashboard wiring (6) → panel wiring (7–8).

---

## Task 0: Verify preconditions (no code)

- [ ] **Step 1: Confirm `call_dispositions` exists in the shared Supabase.**

The phone app writes this table in production, so it almost certainly exists. Confirm before building the Notes UI. If you have the Supabase dashboard, check the table list. If not, this is validated at manual-test time in Task 6/8 — a save failing with `relation "call_dispositions" does not exist` means apply `D:\dev\hourglass-app\docs\call-dispositions.sql` in the Supabase SQL editor first. No code change here; just be aware.

- [ ] **Step 2: Confirm the test command.**

Run: `npm test`
Expected: existing Vitest suite runs green (this establishes the baseline before adding tests).

---

## Task 1: Port pure disposition logic

**Files:**
- Create: `lib/disposition-logic.ts`
- Test: `lib/disposition-logic.test.ts`

**Interfaces:**
- Produces: `type Outcome = "answered" | "no_answer" | "rejected" | "spam"`; `type CallDirection = "inbound" | "outbound"`; `type FollowUpPreset = "none" | "tomorrow" | "in_3_days" | "next_week"`; `OUTCOME_OPTIONS`, `FOLLOW_UP_OPTIONS: { value; label }[]`; `outcomeLabel(o: Outcome): string`; `shouldPromptForDisposition(direction, wasAnswered): boolean`; `followUpDate(preset, now: Date): Date | null`.

- [ ] **Step 1: Write the failing test**

`lib/disposition-logic.test.ts`:
```ts
import { describe, it, expect } from "vitest"
import {
  OUTCOME_OPTIONS,
  FOLLOW_UP_OPTIONS,
  outcomeLabel,
  shouldPromptForDisposition,
  followUpDate,
} from "./disposition-logic"

describe("disposition-logic", () => {
  it("exposes the four outcomes in order", () => {
    expect(OUTCOME_OPTIONS.map((o) => o.value)).toEqual([
      "answered",
      "no_answer",
      "rejected",
      "spam",
    ])
    expect(OUTCOME_OPTIONS.map((o) => o.label)).toEqual([
      "Answered",
      "No answer",
      "Rejected",
      "Spam",
    ])
  })

  it("exposes the four follow-up presets", () => {
    expect(FOLLOW_UP_OPTIONS.map((o) => o.value)).toEqual([
      "none",
      "tomorrow",
      "in_3_days",
      "next_week",
    ])
  })

  it("labels an outcome", () => {
    expect(outcomeLabel("no_answer")).toBe("No answer")
  })

  it("prompts for outbound always, inbound only when answered", () => {
    expect(shouldPromptForDisposition("outbound", false)).toBe(true)
    expect(shouldPromptForDisposition("inbound", true)).toBe(true)
    expect(shouldPromptForDisposition("inbound", false)).toBe(false)
  })

  it("resolves follow-up presets to N days out at 09:00 local", () => {
    const now = new Date("2026-08-12T15:30:00")
    expect(followUpDate("none", now)).toBeNull()

    const t = followUpDate("tomorrow", now)!
    expect(t.getDate()).toBe(13)
    expect(t.getHours()).toBe(9)
    expect(t.getMinutes()).toBe(0)

    expect(followUpDate("in_3_days", now)!.getDate()).toBe(15)
    expect(followUpDate("next_week", now)!.getDate()).toBe(19)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- disposition-logic`
Expected: FAIL — `Cannot find module './disposition-logic'`.

- [ ] **Step 3: Write the implementation**

`lib/disposition-logic.ts` (ported verbatim from `hourglass-app/lib/disposition-logic.ts` so web and phone never drift):
```ts
/**
 * Pure decision logic for call dispositions — the agent's post-call
 * "how did it go?" record. Import-free (no supabase, no React) so it runs
 * under Vitest.
 */
export type Outcome = "answered" | "no_answer" | "rejected" | "spam"
export type CallDirection = "inbound" | "outbound"
export type FollowUpPreset = "none" | "tomorrow" | "in_3_days" | "next_week"

export const OUTCOME_OPTIONS: { value: Outcome; label: string }[] = [
  { value: "answered", label: "Answered" },
  { value: "no_answer", label: "No answer" },
  { value: "rejected", label: "Rejected" },
  { value: "spam", label: "Spam" },
]

export const FOLLOW_UP_OPTIONS: { value: FollowUpPreset; label: string }[] = [
  { value: "none", label: "None" },
  { value: "tomorrow", label: "Tomorrow" },
  { value: "in_3_days", label: "In 3 days" },
  { value: "next_week", label: "Next week" },
]

export function outcomeLabel(outcome: Outcome): string {
  return OUTCOME_OPTIONS.find((o) => o.value === outcome)?.label ?? outcome
}

/**
 * Should the post-call sheet appear for this call?
 * - Outbound: always. - Inbound: only if THIS device answered.
 */
export function shouldPromptForDisposition(
  direction: CallDirection,
  wasAnswered: boolean
): boolean {
  return direction === "outbound" || wasAnswered
}

const PRESET_DAYS: Record<Exclude<FollowUpPreset, "none">, number> = {
  tomorrow: 1,
  in_3_days: 3,
  next_week: 7,
}

/** N days out at 09:00 local, or null for "none". */
export function followUpDate(preset: FollowUpPreset, now: Date): Date | null {
  if (preset === "none") return null
  const d = new Date(now)
  d.setDate(d.getDate() + PRESET_DAYS[preset])
  d.setHours(9, 0, 0, 0)
  return d
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- disposition-logic`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/disposition-logic.ts lib/disposition-logic.test.ts
git commit -m "feat(notes): port pure call-disposition logic to web"
```

---

## Task 2: Disposition data-access module

**Files:**
- Create: `lib/dispositions.ts`
- Test: `lib/dispositions.test.ts`

**Interfaces:**
- Consumes: `Outcome`, `CallDirection` from `@/lib/disposition-logic`.
- Produces:
  - `type Disposition = { id; telnyx_call_id; outcome: Outcome; notes: string | null; follow_up_at: string | null; contact_number: string | null; direction: CallDirection | null; created_at; updated_at }`.
  - `saveDisposition(client, input: { telnyxCallId; outcome: Outcome; notes: string; followUpAt: string | null; contactNumber: string; direction: CallDirection }): Promise<Disposition>`.
  - `fetchDispositionsForCalls(client, telnyxCallIds: string[]): Promise<Record<string, Disposition>>`.
  - `client` is typed `SupabaseClient<any, any, any>` (matches `lib/contacts.ts`'s `Db`).

- [ ] **Step 1: Write the failing test**

`lib/dispositions.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest"
import { saveDisposition, fetchDispositionsForCalls } from "./dispositions"

function upsertClient(result: { data: unknown; error: unknown }) {
  const single = vi.fn().mockResolvedValue(result)
  const select = vi.fn(() => ({ single }))
  const upsert = vi.fn(() => ({ select }))
  const from = vi.fn(() => ({ upsert }))
  return { client: { from } as never, upsert }
}

function selectInClient(rows: unknown[]) {
  const inFn = vi.fn().mockResolvedValue({ data: rows, error: null })
  const select = vi.fn(() => ({ in: inFn }))
  const from = vi.fn(() => ({ select }))
  return { client: { from } as never, from, inFn }
}

describe("saveDisposition", () => {
  it("upserts on (telnyx_call_id, agent_id) without sending agent_id", async () => {
    const row = {
      id: "d1",
      telnyx_call_id: "call-1",
      outcome: "answered",
      notes: "hi",
      follow_up_at: null,
      contact_number: "+12105551234",
      direction: "outbound",
      created_at: "t",
      updated_at: "t",
    }
    const { client, upsert } = upsertClient({ data: row, error: null })
    const result = await saveDisposition(client, {
      telnyxCallId: "call-1",
      outcome: "answered",
      notes: "  hi  ",
      followUpAt: null,
      contactNumber: "+12105551234",
      direction: "outbound",
    })
    expect(result).toEqual(row)
    const [payload, opts] = upsert.mock.calls[0]
    expect(payload).toMatchObject({
      telnyx_call_id: "call-1",
      outcome: "answered",
      notes: "hi", // trimmed
      follow_up_at: null,
      contact_number: "+12105551234",
      direction: "outbound",
    })
    expect(payload).not.toHaveProperty("agent_id")
    expect(opts).toEqual({ onConflict: "telnyx_call_id,agent_id" })
  })

  it("throws with a friendly message on error", async () => {
    const { client } = upsertClient({ data: null, error: { message: "boom" } })
    await expect(
      saveDisposition(client, {
        telnyxCallId: "c",
        outcome: "spam",
        notes: "",
        followUpAt: null,
        contactNumber: "",
        direction: "inbound",
      })
    ).rejects.toThrow(/boom/)
  })
})

describe("fetchDispositionsForCalls", () => {
  it("returns {} for empty ids without querying", async () => {
    const { client, from } = selectInClient([])
    expect(await fetchDispositionsForCalls(client, [])).toEqual({})
    expect(from).not.toHaveBeenCalled()
  })

  it("maps rows by telnyx_call_id", async () => {
    const rows = [
      { id: "d1", telnyx_call_id: "a", outcome: "answered" },
      { id: "d2", telnyx_call_id: "b", outcome: "spam" },
    ]
    const { client, inFn } = selectInClient(rows)
    const map = await fetchDispositionsForCalls(client, ["a", "b", ""])
    expect(inFn).toHaveBeenCalledWith("telnyx_call_id", ["a", "b"]) // "" filtered
    expect(map.a.outcome).toBe("answered")
    expect(map.b.id).toBe("d2")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- dispositions`
Expected: FAIL — `Cannot find module './dispositions'`.

- [ ] **Step 3: Write the implementation**

`lib/dispositions.ts`:
```ts
import type { SupabaseClient } from "@supabase/supabase-js"
import type { CallDirection, Outcome } from "@/lib/disposition-logic"

export type Db = SupabaseClient<any, any, any>

/**
 * One agent-owned record of how a call went. Keyed by telnyx_call_id
 * (matches calls.telnyx_call_id) by value, not FK — a disposition can exist
 * before/without its calls row. RLS scopes rows to the agent.
 */
export type Disposition = {
  id: string
  telnyx_call_id: string
  outcome: Outcome
  notes: string | null
  follow_up_at: string | null // ISO, null = no follow-up
  contact_number: string | null
  direction: CallDirection | null
  created_at: string
  updated_at: string
}

/**
 * Save (insert or edit) the agent's disposition for a call. Upserts on
 * (telnyx_call_id, agent_id): re-saving edits the row. agent_id is NOT sent —
 * it defaults to auth.uid() server-side.
 */
export async function saveDisposition(
  db: Db,
  input: {
    telnyxCallId: string
    outcome: Outcome
    notes: string
    followUpAt: string | null
    contactNumber: string
    direction: CallDirection
  }
): Promise<Disposition> {
  const { data, error } = await db
    .from("call_dispositions")
    .upsert(
      {
        telnyx_call_id: input.telnyxCallId,
        outcome: input.outcome,
        notes: input.notes.trim() || null,
        follow_up_at: input.followUpAt,
        contact_number: input.contactNumber || null,
        direction: input.direction,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "telnyx_call_id,agent_id" }
    )
    .select()
    .single()

  if (error) throw new Error(`Failed to save call notes (${error.message})`)
  return data as Disposition
}

/**
 * The agent's dispositions for a set of calls, keyed by telnyx_call_id.
 * RLS scopes rows to this agent.
 */
export async function fetchDispositionsForCalls(
  db: Db,
  telnyxCallIds: string[]
): Promise<Record<string, Disposition>> {
  const ids = telnyxCallIds.filter(Boolean)
  if (ids.length === 0) return {}

  const { data, error } = await db
    .from("call_dispositions")
    .select("*")
    .in("telnyx_call_id", ids)

  if (error) throw new Error(`Failed to load call notes (${error.message})`)

  const map: Record<string, Disposition> = {}
  for (const d of (data ?? []) as Disposition[]) map[d.telnyx_call_id] = d
  return map
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- dispositions`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/dispositions.ts lib/dispositions.test.ts
git commit -m "feat(notes): add disposition read/write module (client param)"
```

---

## Task 3: Contact-name map + save helper

**Files:**
- Create: `lib/contact-names.ts`, `lib/contacts-client.ts`
- Test: `lib/contact-names.test.ts`, `lib/contacts-client.test.ts`

**Interfaces:**
- Produces:
  - `buildContactNameMap(rows: { contact_number: string; name: string; updated_at: string }[]): Record<string, string>` — keyed by `contact_number`, latest `updated_at` wins.
  - `saveContact(input: { phoneNumberId: string; contactNumber: string; name: string }, accessToken?: string): Promise<{ ok: true } | { ok: false; error: string }>` — POSTs to `/api/contacts`; adds `Authorization: Bearer` when `accessToken` is given (panel), else relies on same-origin cookies (dashboard).

- [ ] **Step 1: Write the failing tests**

`lib/contact-names.test.ts`:
```ts
import { describe, it, expect } from "vitest"
import { buildContactNameMap } from "./contact-names"

describe("buildContactNameMap", () => {
  it("keys names by contact_number", () => {
    const map = buildContactNameMap([
      { contact_number: "+1", name: "Alice", updated_at: "2026-01-01T00:00:00Z" },
    ])
    expect(map["+1"]).toBe("Alice")
  })

  it("keeps the latest updated_at when a number has multiple rows", () => {
    const map = buildContactNameMap([
      { contact_number: "+1", name: "Old", updated_at: "2026-01-01T00:00:00Z" },
      { contact_number: "+1", name: "New", updated_at: "2026-05-01T00:00:00Z" },
    ])
    expect(map["+1"]).toBe("New")
  })

  it("returns {} for empty input", () => {
    expect(buildContactNameMap([])).toEqual({})
  })
})
```

`lib/contacts-client.test.ts`:
```ts
import { describe, it, expect, vi, afterEach } from "vitest"
import { saveContact } from "./contacts-client"

afterEach(() => vi.restoreAllMocks())

describe("saveContact", () => {
  it("posts to /api/contacts and returns ok on success", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ contact: { id: "c1" } }), { status: 200 })
      )
    const res = await saveContact({
      phoneNumberId: "p1",
      contactNumber: "+12105551234",
      name: "Jane",
    })
    expect(res.ok).toBe(true)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("/api/contacts")
    expect((init as RequestInit).method).toBe("POST")
    expect((init as RequestInit).headers).not.toHaveProperty("Authorization")
  })

  it("adds a bearer header when a token is given", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ contact: {} }), { status: 200 }))
    await saveContact(
      { phoneNumberId: "p1", contactNumber: "+12105551234", name: "Jane" },
      "tok-123"
    )
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok-123")
  })

  it("returns the server error message on failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "Name is required." }), { status: 422 })
    )
    const res = await saveContact({ phoneNumberId: "p1", contactNumber: "+1", name: "" })
    expect(res).toEqual({ ok: false, error: "Name is required." })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- contact-names contacts-client`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the implementations**

`lib/contact-names.ts`:
```ts
/**
 * Reduce raw contacts rows to a { contact_number -> name } map for display in
 * call lists. A number saved under multiple phone lines can have several rows;
 * the most recently updated name wins (matches the phone app's resolution).
 */
export function buildContactNameMap(
  rows: { contact_number: string; name: string; updated_at: string }[]
): Record<string, string> {
  const latest: Record<string, { name: string; updated_at: string }> = {}
  for (const r of rows) {
    const prev = latest[r.contact_number]
    if (!prev || r.updated_at > prev.updated_at) {
      latest[r.contact_number] = { name: r.name, updated_at: r.updated_at }
    }
  }
  const map: Record<string, string> = {}
  for (const [num, v] of Object.entries(latest)) map[num] = v.name
  return map
}
```

`lib/contacts-client.ts`:
```ts
/**
 * Save (create or rename) a contact via the existing POST /api/contacts.
 * On the dashboard, same-origin cookies authenticate the request; in the
 * extension panel, pass the Supabase access token for Bearer auth.
 */
export async function saveContact(
  input: { phoneNumberId: string; contactNumber: string; name: string },
  accessToken?: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`

  let res: Response
  try {
    res = await fetch("/api/contacts", {
      method: "POST",
      headers,
      body: JSON.stringify(input),
    })
  } catch {
    return { ok: false, error: "Network error. Please try again." }
  }

  if (res.ok) return { ok: true }
  const body = await res.json().catch(() => ({}))
  return { ok: false, error: body.error ?? "Failed to save contact." }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- contact-names contacts-client`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/contact-names.ts lib/contact-names.test.ts lib/contacts-client.ts lib/contacts-client.test.ts
git commit -m "feat(contacts): add name-map + saveContact client helper"
```

---

## Task 4: Notes bottom sheet + dispositions hook

**Files:**
- Create: `components/calls/notes-sheet.tsx`, `components/calls/use-dispositions.ts`

**Interfaces:**
- Consumes: `Sheet`, `SheetContent`, `SheetHeader`, `SheetTitle`, `SheetFooter` from `@/components/ui/sheet`; `Button`, `Textarea`; `createClient` from `@/lib/client`; `saveDisposition`, `fetchDispositionsForCalls`, `Disposition` from `@/lib/dispositions`; `OUTCOME_OPTIONS`, `FOLLOW_UP_OPTIONS`, `followUpDate`, `Outcome`, `FollowUpPreset`, `CallDirection` from `@/lib/disposition-logic`; `cn` from `@/lib/utils`.
- Produces:
  - `NotesSheet(props: { open; onOpenChange(open): void; call: { telnyxCallId: string; contactNumber: string; direction: CallDirection }; existing?: Disposition | null; onSaved?(d: Disposition): void })`.
  - `useDispositions(telnyxCallIds: (string | null | undefined)[]): { map: Record<string, Disposition>; setLocal(d: Disposition): void }`.

- [ ] **Step 1: Write `use-dispositions.ts`**

`components/calls/use-dispositions.ts`:
```ts
"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { createClient } from "@/lib/client"
import {
  fetchDispositionsForCalls,
  type Disposition,
} from "@/lib/dispositions"

/**
 * Load the agent's dispositions for the visible calls, keyed by
 * telnyx_call_id. `createClient()` returns the browser client on the dashboard
 * and the localStorage panel client under /panel, so this hook works on both
 * surfaces; RLS scopes rows to the agent either way. `setLocal` lets a save
 * update the map without a refetch.
 */
export function useDispositions(
  telnyxCallIds: (string | null | undefined)[]
): { map: Record<string, Disposition>; setLocal: (d: Disposition) => void } {
  const [map, setMap] = useState<Record<string, Disposition>>({})
  const supabase = useMemo(() => createClient(), [])

  const ids = telnyxCallIds.filter(Boolean) as string[]
  const key = ids.slice().sort().join(",")

  const load = useCallback(async () => {
    try {
      const result = await fetchDispositionsForCalls(supabase, ids)
      setMap(result)
    } catch {
      // Non-fatal: the row just shows no note badge.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, key])

  useEffect(() => {
    if (ids.length) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const setLocal = useCallback((d: Disposition) => {
    setMap((prev) => ({ ...prev, [d.telnyx_call_id]: d }))
  }, [])

  return { map, setLocal }
}
```

- [ ] **Step 2: Write `notes-sheet.tsx`**

`components/calls/notes-sheet.tsx`:
```tsx
"use client"

import { useEffect, useState } from "react"
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { createClient } from "@/lib/client"
import { saveDisposition, type Disposition } from "@/lib/dispositions"
import {
  OUTCOME_OPTIONS,
  FOLLOW_UP_OPTIONS,
  followUpDate,
  type CallDirection,
  type FollowUpPreset,
  type Outcome,
} from "@/lib/disposition-logic"

export function NotesSheet({
  open,
  onOpenChange,
  call,
  existing,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  call: { telnyxCallId: string; contactNumber: string; direction: CallDirection }
  existing?: Disposition | null
  onSaved?: (d: Disposition) => void
}) {
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [notes, setNotes] = useState("")
  // null in edit mode = "leave the saved follow-up untouched"; "none" for new.
  const [preset, setPreset] = useState<FollowUpPreset | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Re-seed whenever the sheet opens for a (possibly different) call.
  useEffect(() => {
    if (!open) return
    setOutcome((existing?.outcome as Outcome) ?? null)
    setNotes(existing?.notes ?? "")
    setPreset(existing ? null : "none")
    setError(null)
    setSaving(false)
  }, [open, existing])

  async function handleSave() {
    if (!outcome || saving) return
    setSaving(true)
    setError(null)

    // preset null (edit, untouched) keeps the existing follow-up; else resolve.
    const followUpAt =
      preset === null
        ? (existing?.follow_up_at ?? null)
        : (followUpDate(preset, new Date())?.toISOString() ?? null)

    try {
      const saved = await saveDisposition(createClient(), {
        telnyxCallId: call.telnyxCallId,
        outcome,
        notes,
        followUpAt,
        contactNumber: call.contactNumber,
        direction: call.direction,
      })
      onSaved?.(saved)
      onOpenChange(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save call notes.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="mx-auto max-w-lg gap-0">
        <SheetHeader>
          <SheetTitle>How did the call go?</SheetTitle>
        </SheetHeader>

        <div className="space-y-4 px-4 pb-2">
          {/* Outcome */}
          <div className="grid grid-cols-2 gap-2">
            {OUTCOME_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => setOutcome(o.value)}
                className={cn(
                  "rounded-lg border px-3 py-2 text-sm font-medium transition",
                  outcome === o.value
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border text-muted-foreground hover:bg-muted"
                )}
              >
                {o.label}
              </button>
            ))}
          </div>

          {/* Notes */}
          <Textarea
            placeholder="Add a note (optional)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
          />

          {/* Follow-up */}
          <div>
            <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Follow up
            </p>
            <div className="flex flex-wrap gap-2">
              {FOLLOW_UP_OPTIONS.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => setPreset(f.value)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs font-medium transition",
                    preset === f.value
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border text-muted-foreground hover:bg-muted"
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
            {existing && preset === null && (
              <p className="mt-1 text-xs text-muted-foreground">
                Keeping the existing follow-up. Pick an option to change it.
              </p>
            )}
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <SheetFooter>
          <Button onClick={handleSave} disabled={!outcome || saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors in the two new files. (Fix any import path typos before moving on.)

- [ ] **Step 4: Commit**

```bash
git add components/calls/notes-sheet.tsx components/calls/use-dispositions.ts
git commit -m "feat(notes): add NotesSheet + useDispositions hook"
```

---

## Task 5: Add/Edit contact bottom sheet

**Files:**
- Create: `components/calls/contact-sheet.tsx`

**Interfaces:**
- Consumes: `Sheet*` from `@/components/ui/sheet`; `Button`, `Input`; `saveContact` from `@/lib/contacts-client`; `cn`; `PhoneNumber` from `@/types/calls`.
- Produces: `ContactSheet(props: { open; onOpenChange(open): void; contactNumber: string; phoneNumbers: PhoneNumber[]; defaultPhoneNumberId?: string | null; existingName?: string | null; accessToken?: string; onSaved?(): void })`.

- [ ] **Step 1: Write `contact-sheet.tsx`**

`components/calls/contact-sheet.tsx`:
```tsx
"use client"

import { useEffect, useState } from "react"
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { saveContact } from "@/lib/contacts-client"
import type { PhoneNumber } from "@/types/calls"

export function ContactSheet({
  open,
  onOpenChange,
  contactNumber,
  phoneNumbers,
  defaultPhoneNumberId,
  existingName,
  accessToken,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  contactNumber: string
  phoneNumbers: PhoneNumber[]
  defaultPhoneNumberId?: string | null
  existingName?: string | null
  accessToken?: string
  onSaved?: () => void
}) {
  const [name, setName] = useState("")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setName(existingName ?? "")
    setSelectedId(defaultPhoneNumberId ?? phoneNumbers[0]?.id ?? null)
    setError(null)
    setSaving(false)
  }, [open, existingName, defaultPhoneNumberId, phoneNumbers])

  const canSave = Boolean(selectedId && name.trim()) && !saving

  async function handleSave() {
    if (!selectedId || !name.trim() || saving) return
    setSaving(true)
    setError(null)
    const res = await saveContact(
      { phoneNumberId: selectedId, contactNumber, name: name.trim() },
      accessToken
    )
    setSaving(false)
    if (res.ok) {
      onSaved?.()
      onOpenChange(false)
    } else {
      setError(res.error)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="mx-auto max-w-lg gap-0">
        <SheetHeader>
          <SheetTitle>{existingName ? "Edit contact" : "Add contact"}</SheetTitle>
        </SheetHeader>

        <div className="space-y-4 px-4 pb-2">
          <Input
            placeholder="Contact name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />

          <div>
            <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Save under line
            </p>
            <div className="flex flex-wrap gap-2">
              {phoneNumbers.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelectedId(p.id)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition",
                    selectedId === p.id
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border text-muted-foreground hover:bg-muted"
                  )}
                >
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: p.color }}
                  />
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            Saving {contactNumber}
          </p>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <SheetFooter>
          <Button onClick={handleSave} disabled={!canSave}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/calls/contact-sheet.tsx
git commit -m "feat(contacts): add ContactSheet (name + phone-line chips)"
```

---

## Task 6: Wire both features into the dashboard calls table

**Files:**
- Modify: `types/calls.ts` (add `contact_name`)
- Modify: `app/dashboard/calls/page.tsx` (server-merge contact names)
- Modify: `components/calls/calls-table.tsx` (name display + Notes/Contact actions + disposition badge)

**Interfaces:**
- Consumes: `NotesSheet`, `ContactSheet`, `useDispositions`, `outcomeLabel`, `buildContactNameMap`.
- Produces: `Call.contact_name?: string | null`.

- [ ] **Step 1: Add `contact_name` to the `Call` type**

In `types/calls.ts`, inside `export type Call = { ... }` (after `created_at`, near line 22), add:
```ts
  contact_name?: string | null
```

- [ ] **Step 2: Merge contact names in the server fetch**

In `app/dashboard/calls/page.tsx`, add the import at the top:
```ts
import { buildContactNameMap } from "@/lib/contact-names"
```
Then, after `initialCalls` is built (currently returned directly), replace the `return` block with a name-merge. Full updated tail of the function:
```ts
  const numbers = Array.from(new Set(initialCalls.map((c) => c.contact_number)))
  let nameMap: Record<string, string> = {}
  if (numbers.length) {
    const { data: contactRows } = await supabase
      .from("contacts")
      .select("contact_number, name, updated_at")
      .in("contact_number", numbers)
    nameMap = buildContactNameMap(contactRows ?? [])
  }

  const callsWithNames = initialCalls.map((c) => ({
    ...c,
    contact_name: nameMap[c.contact_number] ?? null,
  }))

  return (
    <CallsPageClient phoneNumbers={phoneNumbers} initialCalls={callsWithNames} />
  )
```
(The `contacts` SELECT is allowed by its team-wide RLS read policy; the cookie client is authenticated.)

- [ ] **Step 3: Add state, hook, and imports to `CallsTable`**

In `components/calls/calls-table.tsx`:

Add imports (with the other lucide icons / component imports):
```ts
import { StickyNote, UserPlus } from "lucide-react"
import { NotesSheet } from "@/components/calls/notes-sheet"
import { ContactSheet } from "@/components/calls/contact-sheet"
import { useDispositions } from "@/components/calls/use-dispositions"
import { outcomeLabel } from "@/lib/disposition-logic"
import type { PhoneNumber } from "@/types/calls"
```

Extend the component signature to receive `phoneNumbers` (needed by ContactSheet):
```ts
export function CallsTable({
  calls,
  loading,
  statusFilter,
  dateFilter,
  phoneNumbers,
}: {
  calls: Call[]
  loading?: boolean
  statusFilter: StatusFilter
  dateFilter: string
  phoneNumbers: PhoneNumber[]
}) {
```

Just below the existing `const [expanded, setExpanded] = useState<string | null>(null)`:
```ts
  const [notesFor, setNotesFor] = useState<Call | null>(null)
  const [contactFor, setContactFor] = useState<Call | null>(null)
  const { map: dispoMap, setLocal } = useDispositions(
    calls.map((c) => c.telnyx_call_id)
  )
```

- [ ] **Step 4: Show the saved name in the table + card**

Desktop cell (the `<div className="font-medium text-foreground">{call.contact_number}</div>` at ~line 224) becomes:
```tsx
                    <TableCell>
                      <div className="font-medium text-foreground">
                        {call.contact_name ?? call.contact_number}
                      </div>
                      {call.contact_name && (
                        <div className="text-xs text-muted-foreground tabular-nums">
                          {call.contact_number}
                        </div>
                      )}
                      {call.phone_numbers && (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <span
                            className="h-2 w-2 rounded-full"
                            style={{ backgroundColor: call.phone_numbers.color }}
                          />
                          {call.phone_numbers.label}
                        </div>
                      )}
                    </TableCell>
```
Mobile card (`<p className="font-medium text-foreground">{call.contact_number}</p>` at ~line 369) becomes:
```tsx
                    <p className="font-medium text-foreground">
                      {call.contact_name ?? call.contact_number}
                    </p>
```

- [ ] **Step 5: Add Notes + Add-contact actions and a note badge to the expanded detail**

Replace the `<dl>` grid closing area inside the `{open && (...)}` block — specifically, after the `</dl>` (line ~341) and before `</div>` — insert the disposition summary + action buttons. The full expanded `<div className="px-2 py-2 space-y-3">` inner content ends like this:
```tsx
                          <dl className="grid gap-x-8 gap-y-1.5 text-xs sm:grid-cols-2 lg:grid-cols-4">
                            <DetailRow label="Telnyx Call ID" value={call.telnyx_call_id?.slice(0, 24) ?? "—"} mono />
                            <DetailRow
                              label="Started"
                              value={call.started_at ? format(new Date(call.started_at), "PPpp") : "—"}
                            />
                            <DetailRow
                              label="Ended"
                              value={call.ended_at ? format(new Date(call.ended_at), "PPpp") : "—"}
                            />
                            <DetailRow label="Agent" value="—" />
                          </dl>

                          {call.telnyx_call_id && dispoMap[call.telnyx_call_id] && (
                            <div className="rounded-lg border border-border/60 bg-background/50 p-2 text-xs">
                              <span className="font-medium text-foreground">
                                {outcomeLabel(dispoMap[call.telnyx_call_id].outcome)}
                              </span>
                              {dispoMap[call.telnyx_call_id].notes && (
                                <span className="text-muted-foreground">
                                  {" · "}
                                  {dispoMap[call.telnyx_call_id].notes}
                                </span>
                              )}
                            </div>
                          )}

                          <div className="flex flex-wrap gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={!call.telnyx_call_id}
                              onClick={() => setNotesFor(call)}
                            >
                              <StickyNote className="h-4 w-4" />
                              {call.telnyx_call_id && dispoMap[call.telnyx_call_id]
                                ? "Edit notes"
                                : "Notes"}
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setContactFor(call)}
                            >
                              <UserPlus className="h-4 w-4" />
                              {call.contact_name ? "Edit contact" : "Add contact"}
                            </Button>
                          </div>
```

- [ ] **Step 6: Render the two sheets once, after the mobile card list**

Immediately before the final closing `</>` of the returned fragment (after the `{/* Mobile card list */}` block), add:
```tsx
      {notesFor?.telnyx_call_id && (
        <NotesSheet
          open={!!notesFor}
          onOpenChange={(o) => !o && setNotesFor(null)}
          call={{
            telnyxCallId: notesFor.telnyx_call_id,
            contactNumber: notesFor.contact_number,
            direction: notesFor.direction,
          }}
          existing={dispoMap[notesFor.telnyx_call_id] ?? null}
          onSaved={(d) => setLocal(d)}
        />
      )}
      {contactFor && (
        <ContactSheet
          open={!!contactFor}
          onOpenChange={(o) => !o && setContactFor(null)}
          contactNumber={contactFor.contact_number}
          phoneNumbers={phoneNumbers}
          defaultPhoneNumberId={contactFor.phone_number_id}
          existingName={contactFor.contact_name ?? null}
          onSaved={() => router.refresh()}
        />
      )}
```

- [ ] **Step 7: Pass `phoneNumbers` from the client shell to `CallsTable`**

In `components/calls/calls-page-client.tsx`, find where `<CallsTable ... />` is rendered and add the `phoneNumbers={phoneNumbers}` prop (the shell already receives `phoneNumbers` — confirm the prop name and thread it through). Run:
```bash
npm run typecheck
```
Expected: a type error at the `<CallsTable>` call site if the prop is missing — add it until typecheck is clean. This is the guard that Step 3's new required prop is satisfied.

- [ ] **Step 8: Manual verification**

Run: `npm run dev`, open `/dashboard/calls`, sign in.
- Expand a call with a `telnyx_call_id` → click **Notes** → pick an outcome, type a note, pick a follow-up → **Save**. Re-expand: the outcome + note badge shows, and the button reads **Edit notes**.
- Click **Add contact** → type a name, pick a line → **Save**. The row's contact column now shows the name with the number beneath.
- If Save fails with `relation "call_dispositions" does not exist`, apply `hourglass-app/docs/call-dispositions.sql` (Task 0) and retry.

- [ ] **Step 9: Commit**

```bash
git add types/calls.ts app/dashboard/calls/page.tsx components/calls/calls-table.tsx components/calls/calls-page-client.tsx
git commit -m "feat: notes + add-contact on the dashboard calls table"
```

---

## Task 7: Recent API — expose `telnyx_call_id` + saved names

**Files:**
- Modify: `app/api/calls/recent/route.ts`
- Modify: `components/calls/panel/recent-row.ts` (type + title)
- Modify: `components/calls/panel/recent-row.test.ts` (if it exists — add coverage)

**Interfaces:**
- Produces: `RecentCall` gains `telnyx_call_id: string | null` and `contact_name?: string | null`; `formatRecentRow` uses the saved name for `title` when present.

- [ ] **Step 1: Add `telnyx_call_id` + `contact_name` to `RecentCall` and use the name in the title**

In `components/calls/panel/recent-row.ts`, extend the type:
```ts
export type RecentCall = {
  id: string
  telnyx_call_id: string | null
  contact_number: string
  contact_name?: string | null
  direction: "inbound" | "outbound"
  status: CallStatus
  started_at: string | null
  created_at: string
  phone_numbers?: { label: string; phone_number: string; color: string } | null
}
```
In `formatRecentRow`, change the `title` line:
```ts
    title: call.contact_name || call.contact_number || "Unknown",
```

- [ ] **Step 2: Update the recent-row test (if the file exists)**

If `components/calls/panel/recent-row.test.ts` exists, add a case (matching its existing style) asserting the saved name wins:
```ts
it("prefers the saved contact name for the title", () => {
  const row = formatRecentRow({
    id: "1",
    telnyx_call_id: "t1",
    contact_number: "+12105551234",
    contact_name: "Jane Doe",
    direction: "inbound",
    status: "completed",
    started_at: null,
    created_at: "2026-08-12T00:00:00Z",
    phone_numbers: null,
  })
  expect(row.title).toBe("Jane Doe")
})
```
Also add `telnyx_call_id: null` (or a value) to any existing `RecentCall` fixtures in that file so it typechecks.

Run: `npm test -- recent-row`
Expected: PASS (existing + new case). If the file doesn't exist, skip this step.

- [ ] **Step 3: Select `telnyx_call_id` and merge names in the route**

In `app/api/calls/recent/route.ts`, add the import:
```ts
import { buildContactNameMap } from "@/lib/contact-names"
```
Change the `.select(...)` to include `telnyx_call_id`:
```ts
    .select(
      "id, telnyx_call_id, contact_number, direction, status, started_at, created_at, phone_numbers(label, phone_number, color)"
    )
```
Then replace the flatten/return block with one that also merges saved names:
```ts
  const flattened = (data ?? []).map((c) => ({
    ...c,
    phone_numbers: Array.isArray(c.phone_numbers)
      ? (c.phone_numbers[0] ?? null)
      : (c.phone_numbers ?? null),
  }))

  const numbers = Array.from(new Set(flattened.map((c) => c.contact_number)))
  let nameMap: Record<string, string> = {}
  if (numbers.length) {
    const { data: contactRows } = await supabase
      .from("contacts")
      .select("contact_number, name, updated_at")
      .in("contact_number", numbers)
    nameMap = buildContactNameMap(contactRows ?? [])
  }

  const recentCalls = flattened.map((c) => ({
    ...c,
    contact_name: nameMap[c.contact_number] ?? null,
  }))

  return Response.json({ recentCalls })
```
(`supabase` here is the service-role admin client, so the `contacts` read is unrestricted.)

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add app/api/calls/recent/route.ts components/calls/panel/recent-row.ts components/calls/panel/recent-row.test.ts
git commit -m "feat: recent API returns telnyx_call_id + saved contact names"
```

---

## Task 8: Wire both features into the panel Recent tab

**Files:**
- Modify: `components/calls/panel/tabs/recent-tab.tsx`

**Interfaces:**
- Consumes: `NotesSheet`, `ContactSheet`, `useDispositions`, `RecentCall`, `PhoneNumber`, `CallDirection`.

- [ ] **Step 1: Add imports, state, and the dispositions hook**

In `components/calls/panel/tabs/recent-tab.tsx`, add imports:
```ts
import { useState } from "react"
import { StickyNote, UserPlus } from "lucide-react"
import { NotesSheet } from "@/components/calls/notes-sheet"
import { ContactSheet } from "@/components/calls/contact-sheet"
import { useDispositions } from "@/components/calls/use-dispositions"
import type { RecentCall } from "../recent-row"
```
Inside `RecentTab`, after `const { calls, loading, error, reload } = useRecentCalls(accessToken)`:
```ts
  const [notesFor, setNotesFor] = useState<RecentCall | null>(null)
  const [contactFor, setContactFor] = useState<RecentCall | null>(null)
  const { map: dispoMap, setLocal } = useDispositions(
    calls.map((c) => c.telnyx_call_id)
  )
```

- [ ] **Step 2: Add per-row Notes + Add-contact buttons**

In the row `<li>`, after the green call `<button>` (the one with the `Phone` icon, ~line 111) and before the `</li>`, add two icon buttons:
```tsx
            <button
              type="button"
              aria-label="Notes"
              disabled={!call.telnyx_call_id}
              onClick={() => setNotesFor(call)}
              className="rounded-full p-2 text-neutral-300 transition hover:bg-neutral-800 disabled:opacity-40"
            >
              <StickyNote className="h-4 w-4" />
            </button>
            <button
              type="button"
              aria-label="Add contact"
              onClick={() => setContactFor(call)}
              className="rounded-full p-2 text-neutral-300 transition hover:bg-neutral-800"
            >
              <UserPlus className="h-4 w-4" />
            </button>
```
(Optional: under the title line, when `call.telnyx_call_id && dispoMap[call.telnyx_call_id]`, the row already has a status pill — leave it; the sheet is the source of truth. Keep this step focused on the two buttons.)

- [ ] **Step 3: Render the two sheets once, after the `</ul>`**

Wrap the returned list so the sheets render alongside it. Change the final `return (<ul>…</ul>)` to a fragment:
```tsx
  return (
    <>
      <ul className="divide-y divide-neutral-900">
        {/* …existing row mapping unchanged… */}
      </ul>

      {notesFor?.telnyx_call_id && (
        <NotesSheet
          open={!!notesFor}
          onOpenChange={(o) => !o && setNotesFor(null)}
          call={{
            telnyxCallId: notesFor.telnyx_call_id,
            contactNumber: notesFor.contact_number,
            direction: notesFor.direction,
          }}
          existing={dispoMap[notesFor.telnyx_call_id] ?? null}
          onSaved={(d) => setLocal(d)}
        />
      )}
      {contactFor && (
        <ContactSheet
          open={!!contactFor}
          onOpenChange={(o) => !o && setContactFor(null)}
          contactNumber={contactFor.contact_number}
          phoneNumbers={phoneNumbers}
          existingName={contactFor.contact_name ?? null}
          accessToken={accessToken}
          onSaved={() => reload()}
        />
      )}
    </>
  )
```
Note: `RecentCall` has no `phone_number_id`, so `defaultPhoneNumberId` is omitted — the ContactSheet defaults to the first line (`phoneNumbers[0]`), which the agent can change with the chips. `accessToken` is passed so the contact POST uses Bearer auth (the panel has no cookies). `reload()` refreshes the list so the saved name appears.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Manual verification (panel)**

Load the extension panel (or visit `/panel` with a signed-in session), open the **Recent** tab:
- Tap the **Notes** icon on a row → pick outcome + note → Save. Reopen → seeded from the saved values.
- Tap the **Add contact** icon → name + line → Save → the list reloads and the row title shows the saved name.
- Confirm (same account) the note appears in the phone app's history and the contact name shows on both surfaces.

- [ ] **Step 6: Commit**

```bash
git add components/calls/panel/tabs/recent-tab.tsx
git commit -m "feat: notes + add-contact on the panel Recent tab"
```

---

## Final verification

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: all suites pass (existing + the new `disposition-logic`, `dispositions`, `contact-names`, `contacts-client`, and any `recent-row` additions).

- [ ] **Step 2: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 3: Cross-device sanity (manual)**

With the same agent account on the phone app and the web: save a note and a contact on the web, confirm both appear on the phone (and vice-versa). This proves the shared-table reuse.

---

## Notes for the implementer

- **Why notes write directly to Supabase but contacts go through an API:** dispositions have a per-agent RLS policy (`agent_id = auth.uid()`), so a direct client upsert is safe and mirrors the phone app. `contacts` has **no** insert/update RLS policy — writes must use the service-role route (`POST /api/contacts`), which already exists. Do not add an RLS write policy to `contacts`.
- **`createClient()` picks the right client by pathname** (`@/lib/client`): browser client on the dashboard, localStorage client under `/panel`. Both hold the authenticated session, so `useDispositions`/`NotesSheet` work unchanged on both surfaces.
- **Never send `agent_id`.** The upsert relies on its `auth.uid()` default + the `(telnyx_call_id, agent_id)` conflict target.
- **Staging discipline:** the repo tree has unrelated uncommitted changes — stage only the files each task lists.
