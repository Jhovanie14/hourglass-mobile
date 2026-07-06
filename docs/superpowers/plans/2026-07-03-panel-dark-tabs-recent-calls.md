# Panel Dark Tabbed UI + Recent Calls — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the `?mode=remote` panel (extension popup + setup tab) into a dark, tabbed UI (Dialpad · Recent · Settings) and add a Recent Calls tab that lets agents call back missed calls.

**Architecture:** `RemotePhone` becomes a thin tabbed shell that owns the `state-sync` subscription, the active tab, the dial `to`/`from` state, and the call overlays; three tab components render inside it. A new read-only bearer-auth endpoint `GET /api/calls/recent` returns the latest calls; a `use-recent-calls` hook fetches them; a pure `formatRecentRow` helper (unit-tested) shapes each row. One-phone rule unchanged — tabs are remotes that send `PanelCommand`s.

**Tech Stack:** Next.js 16 route handler (`runtime = "nodejs"`), React 19 client components, `@supabase/supabase-js` admin client, `date-fns`, `lucide-react`, Vitest (node env).

## Global Constraints

- **Do NOT touch server-side call handling:** `app/api/webhooks/telnyx/voice/route.ts`, `app/api/calls/presence`, ring-all, agent-credentials, the offscreen engine, and the `?mode=widget` view all stay unchanged.
- **One-phone rule.** Tabs never own call state — they render `SerializedCallState` from `state-sync` and send `PanelCommand`s via the shared `send()`. Only the offscreen `BackgroundPhone` opens WebRTC.
- **Panel auth is bearer-token, not cookies.** New API routes authenticate with `isRequestAuthenticated(req)` / `getRequestUserId(req)` from `@/lib/auth` and read with `createAdminClient()` from `@/lib/admin` — the exact pattern in `app/api/calls/phone-numbers/route.ts`. Calls are team-wide (same as the dashboard and phone-numbers); no per-user filtering is added.
- **Dark, always.** The panel root uses explicit dark utility classes (near-black bg, light text) so it stays black regardless of `next-themes`/OS setting. The Call button keeps a green accent.
- **Scope:** only `RemotePhone` (`?mode=remote`) changes + one new route/hook/helper. The web app dialer (`?mode=local`/`PanelDialer`), the widget (`?mode=widget`), and `BackgroundPhone` are untouched.
- **Vitest include** currently `["lib/**/*.test.ts", "extension/**/*.test.ts"]`; Task 1 adds `"components/**/*.test.ts"`.

---

## File Structure

New files:
- `components/calls/panel/panel-send.ts` — shared `send(cmd)` + `CmdPayload` type (lifted out of `remote-phone.tsx` so all tabs share it).
- `components/calls/panel/recent-row.ts` — pure `formatRecentRow(call)` + `RecentCall`/`RecentRowView` types.
- `components/calls/panel/recent-row.test.ts` — vitest for the helper.
- `app/api/calls/recent/route.ts` — `GET`, bearer-auth, latest 30 calls.
- `components/calls/panel/use-recent-calls.ts` — bearer-auth fetch hook.
- `components/calls/panel/panel-tabs.tsx` — 3-tab nav bar.
- `components/calls/panel/tabs/dialpad-tab.tsx` — "Make a call" form.
- `components/calls/panel/tabs/recent-tab.tsx` — recent calls list + callback.
- `components/calls/panel/tabs/settings-tab.tsx` — Online toggle + Sign out.

Modified files:
- `vitest.config.ts` — add `components/**/*.test.ts`.
- `components/calls/panel/remote-phone.tsx` — becomes the dark tabbed shell.
- `components/calls/panel/panel-app.tsx:78-84` — pass `accessToken` to `RemotePhone`.

Untouched: `background-phone.tsx`, `widget-phone.tsx`, `panel-dialer.tsx`, `lib/panel-bus.ts`, the extension shells.

---

### Task 1: `formatRecentRow` pure helper (TDD)

**Files:**
- Modify: `vitest.config.ts`
- Create: `components/calls/panel/recent-row.ts`
- Test: `components/calls/panel/recent-row.test.ts`

**Interfaces:**
- Consumes: `CallStatus` from `@/types/calls`; `formatDistanceToNow` from `date-fns`.
- Produces:
  - `type RecentCall = { id: string; contact_number: string; direction: "inbound"|"outbound"; status: CallStatus; started_at: string|null; created_at: string; phone_numbers?: { label: string; phone_number: string; color: string } | null }`
  - `type RecentRowView = { title: string; missed: boolean; directionIcon: "in"|"out"; lineLabel: string|null; timeText: string; callbackTo: string }`
  - `formatRecentRow(call: RecentCall): RecentRowView`

- [ ] **Step 1: Extend the vitest include for component tests**

Modify `vitest.config.ts` so its `include` array is:

```ts
    include: ["lib/**/*.test.ts", "extension/**/*.test.ts", "components/**/*.test.ts"],
```

- [ ] **Step 2: Write the failing test**

Create `components/calls/panel/recent-row.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { formatRecentRow, type RecentCall } from "./recent-row"

const base: RecentCall = {
  id: "1",
  contact_number: "+15551230000",
  direction: "inbound",
  status: "completed",
  started_at: "2026-07-01T10:00:00.000Z",
  created_at: "2026-07-01T10:00:05.000Z",
  phone_numbers: { label: "Sales", phone_number: "+15559999999", color: "#000" },
}

describe("formatRecentRow", () => {
  it("flags missed inbound calls", () => {
    const row = formatRecentRow({ ...base, status: "missed" })
    expect(row.missed).toBe(true)
    expect(row.directionIcon).toBe("in")
    expect(row.callbackTo).toBe("+15551230000")
    expect(row.lineLabel).toBe("Sales")
  })
  it("marks outbound direction and non-missed", () => {
    const row = formatRecentRow({ ...base, direction: "outbound", status: "completed" })
    expect(row.directionIcon).toBe("out")
    expect(row.missed).toBe(false)
  })
  it("falls back to created_at when started_at is null", () => {
    const row = formatRecentRow({ ...base, started_at: null })
    expect(row.timeText.length).toBeGreaterThan(0)
  })
  it("hides the line label when the join is missing", () => {
    const row = formatRecentRow({ ...base, phone_numbers: null })
    expect(row.lineLabel).toBeNull()
  })
  it("shows a placeholder title when the number is empty", () => {
    const row = formatRecentRow({ ...base, contact_number: "" })
    expect(row.title).toBe("Unknown")
    expect(row.callbackTo).toBe("")
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test -- components/calls/panel/recent-row.test.ts`
Expected: FAIL — cannot resolve `./recent-row`.

- [ ] **Step 4: Write the implementation**

Create `components/calls/panel/recent-row.ts`:

```ts
import { formatDistanceToNow } from "date-fns"
import type { CallStatus } from "@/types/calls"

export type RecentCall = {
  id: string
  contact_number: string
  direction: "inbound" | "outbound"
  status: CallStatus
  started_at: string | null
  created_at: string
  phone_numbers?: { label: string; phone_number: string; color: string } | null
}

export type RecentRowView = {
  title: string
  missed: boolean
  directionIcon: "in" | "out"
  lineLabel: string | null
  timeText: string
  callbackTo: string
}

/** Shape one call row for the Recent tab. Pure + defensive against legacy rows. */
export function formatRecentRow(call: RecentCall): RecentRowView {
  const ts = call.started_at ?? call.created_at
  let timeText = ""
  if (ts) {
    const d = new Date(ts)
    if (!Number.isNaN(d.getTime())) {
      timeText = formatDistanceToNow(d, { addSuffix: true })
    }
  }
  return {
    title: call.contact_number || "Unknown",
    missed: call.status === "missed",
    directionIcon: call.direction === "outbound" ? "out" : "in",
    lineLabel: call.phone_numbers?.label ?? null,
    timeText,
    callbackTo: call.contact_number,
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -- components/calls/panel/recent-row.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add vitest.config.ts components/calls/panel/recent-row.ts components/calls/panel/recent-row.test.ts
git commit -m "feat(panel): formatRecentRow helper (pure)"
```

---

### Task 2: `GET /api/calls/recent` route

**Files:**
- Create: `app/api/calls/recent/route.ts`
- Verify: `npm run typecheck`

**Interfaces:**
- Consumes: `isRequestAuthenticated` from `@/lib/auth`; `createAdminClient` from `@/lib/admin`.
- Produces: `GET` returning `{ recentCalls: RecentCall[] }` (200) or `{ error: string }` (401/500). Shape matches `RecentCall` from Task 1.

- [ ] **Step 1: Create the route (mirrors phone-numbers/route.ts)**

Create `app/api/calls/recent/route.ts`:

```ts
import { isRequestAuthenticated } from "@/lib/auth"
import { createAdminClient } from "@/lib/admin"

export const runtime = "nodejs"

// Latest calls for the Recent tab. Bearer-auth + admin client, same pattern as
// phone-numbers/route.ts: the panel runs client-side and cannot rely on
// RLS-scoped reads, so calls are returned team-wide (as on the dashboard).
export async function GET(req: Request) {
  if (!(await isRequestAuthenticated(req))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("calls")
    .select(
      "id, contact_number, direction, status, started_at, created_at, phone_numbers(label, phone_number, color)"
    )
    .order("created_at", { ascending: false })
    .limit(30)

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  // Supabase returns the joined phone_numbers as an array; flatten to one object.
  const recentCalls = (data ?? []).map((c) => ({
    ...c,
    phone_numbers: Array.isArray(c.phone_numbers)
      ? (c.phone_numbers[0] ?? null)
      : (c.phone_numbers ?? null),
  }))

  return Response.json({ recentCalls })
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add app/api/calls/recent/route.ts
git commit -m "feat(api): GET /api/calls/recent (bearer, latest 30)"
```

---

### Task 3: `use-recent-calls` hook + shared `send`

**Files:**
- Create: `components/calls/panel/panel-send.ts`
- Create: `components/calls/panel/use-recent-calls.ts`
- Verify: `npm run typecheck`

**Interfaces:**
- Consumes: `RecentCall` from `./recent-row`; `PANEL_SOURCE`, `PanelCommand` from `@/lib/panel-bus`.
- Produces:
  - `send(cmd: CmdPayload): void` and `type CmdPayload` (from `panel-send.ts`).
  - `useRecentCalls(accessToken: string | undefined): { calls: RecentCall[]; loading: boolean; error: string | null; reload: () => void }`.

- [ ] **Step 1: Create the shared command sender**

Create `components/calls/panel/panel-send.ts`:

```ts
import { PANEL_SOURCE, type PanelCommand } from "@/lib/panel-bus"

export type CmdPayload = PanelCommand extends infer U
  ? U extends { source: unknown; type: unknown }
    ? Omit<U, "source" | "type">
    : never
  : never

/** Send a PanelCommand to the offscreen engine via the extension shell. */
export function send(cmd: CmdPayload) {
  window.parent.postMessage({ source: PANEL_SOURCE, type: "cmd", ...cmd }, "*")
}
```

- [ ] **Step 2: Create the fetch hook**

Create `components/calls/panel/use-recent-calls.ts`:

```ts
"use client"

import { useCallback, useEffect, useState } from "react"
import type { RecentCall } from "./recent-row"

/**
 * Fetches the latest calls for the Recent tab using the panel's bearer token.
 * One fetch per mount (+ manual reload); no realtime subscription (YAGNI).
 */
export function useRecentCalls(accessToken: string | undefined) {
  const [calls, setCalls] = useState<RecentCall[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(() => {
    if (!accessToken) return
    setLoading(true)
    setError(null)
    fetch("/api/calls/recent", {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then(async (res) => {
        const body = await res.json()
        if (!res.ok) throw new Error(body.error || "Request failed")
        setCalls(Array.isArray(body.recentCalls) ? body.recentCalls : [])
      })
      .catch((err) => setError(err.message || "Couldn't load recent calls"))
      .finally(() => setLoading(false))
  }, [accessToken])

  useEffect(() => {
    reload()
  }, [reload])

  return { calls, loading, error, reload }
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add components/calls/panel/panel-send.ts components/calls/panel/use-recent-calls.ts
git commit -m "feat(panel): shared send() + useRecentCalls hook"
```

---

### Task 4: Dark tabbed shell (Dialpad + Settings + nav)

**Files:**
- Create: `components/calls/panel/panel-tabs.tsx`
- Create: `components/calls/panel/tabs/dialpad-tab.tsx`
- Create: `components/calls/panel/tabs/settings-tab.tsx`
- Create: `components/calls/panel/tabs/recent-tab.tsx` (stub; real body in Task 5)
- Modify: `components/calls/panel/remote-phone.tsx` (full rewrite → shell)
- Modify: `components/calls/panel/panel-app.tsx` (pass `accessToken`)
- Verify: `npm run typecheck`

**Interfaces:**
- Consumes: `send`/`CmdPayload` (Task 3); `SerializedCallState`, `IDLE_STATE`, `isPanelEvent` from `@/lib/panel-bus`; `IncomingCallPopup`, `ActiveCallHud`; `PhoneNumber`.
- Produces:
  - `type PanelTab = "dialpad" | "recent" | "settings"`; `PanelTabs({ active, onChange })`.
  - `DialpadTab({ phoneNumbers, state, to, setTo, phoneNumberId, setPhoneNumberId })`.
  - `SettingsTab({ state, onSignOut })`.
  - `RecentTab({ accessToken, phoneNumbers, state, onCallback })` (stub now).
  - `RemotePhone({ phoneNumbers, accessToken, onSignOut })` — note the new `accessToken` prop.

- [ ] **Step 1: Create the tab nav**

Create `components/calls/panel/panel-tabs.tsx`:

```tsx
"use client"

import { Clock, LayoutGrid, Settings } from "lucide-react"

export type PanelTab = "dialpad" | "recent" | "settings"

const TABS: { id: PanelTab; label: string; Icon: typeof Clock }[] = [
  { id: "dialpad", label: "Dialpad", Icon: LayoutGrid },
  { id: "recent", label: "Recent", Icon: Clock },
  { id: "settings", label: "Settings", Icon: Settings },
]

export function PanelTabs({
  active,
  onChange,
}: {
  active: PanelTab
  onChange: (t: PanelTab) => void
}) {
  return (
    <div className="flex border-b border-neutral-800">
      {TABS.map(({ id, label, Icon }) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          className={`flex flex-1 flex-col items-center gap-1 py-2.5 text-xs font-medium transition ${
            active === id
              ? "text-white"
              : "text-neutral-500 hover:text-neutral-300"
          }`}
          aria-current={active === id}
        >
          <Icon className="h-4 w-4" />
          {label}
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Create the Dialpad tab (lifted from today's dialer body)**

Create `components/calls/panel/tabs/dialpad-tab.tsx`:

```tsx
"use client"

import { Phone } from "lucide-react"
import type { SerializedCallState } from "@/lib/panel-bus"
import type { PhoneNumber } from "@/types/calls"
import { send } from "../panel-send"

export function DialpadTab({
  phoneNumbers,
  state,
  to,
  setTo,
  phoneNumberId,
  setPhoneNumberId,
}: {
  phoneNumbers: PhoneNumber[]
  state: SerializedCallState
  to: string
  setTo: (v: string) => void
  phoneNumberId: string
  setPhoneNumberId: (v: string) => void
}) {
  const selectedId = phoneNumberId || phoneNumbers[0]?.id || ""
  const selectedPhone = phoneNumbers.find((p) => p.id === selectedId)
  const inCall = state.status !== "idle" && state.status !== "incoming"

  function handleCall() {
    if (!state.isReady || inCall) return
    if (!to.trim() || !selectedPhone) return
    send({ cmd: "dial", to: to.trim(), callerId: selectedPhone.phone_number })
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <h2 className="pt-2 text-center text-lg font-semibold text-white">
        Make a call
      </h2>

      {state.micBlocked && (
        <button
          type="button"
          onClick={() =>
            navigator.mediaDevices
              .getUserMedia({ audio: true })
              .then((s) => s.getTracks().forEach((t) => t.stop()))
              .catch(() => {})
          }
          className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-left text-sm text-red-400"
        >
          Microphone blocked — click to grant access
        </button>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="panel-from" className="text-xs font-medium text-neutral-400">
          From
        </label>
        <select
          id="panel-from"
          value={selectedId}
          onChange={(e) => setPhoneNumberId(e.target.value)}
          className="flex h-9 w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-1 text-sm text-white focus:ring-1 focus:ring-neutral-500 focus:outline-none"
        >
          {phoneNumbers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label} · {p.phone_number}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="panel-to" className="text-xs font-medium text-neutral-400">
          To
        </label>
        <input
          id="panel-to"
          type="tel"
          placeholder="Contact name, phone number or agent"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleCall()}
          className="flex h-11 w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 text-sm text-white placeholder:text-neutral-500 focus:ring-1 focus:ring-neutral-500 focus:outline-none"
        />
      </div>

      <button
        type="button"
        onClick={handleCall}
        disabled={!state.isReady || inCall || !to.trim() || !selectedPhone}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-green-500 py-3 text-sm font-semibold text-white transition hover:bg-green-600 disabled:opacity-50"
      >
        <Phone className="h-4 w-4" />
        {!state.isReady ? "Connecting…" : "Call"}
      </button>
    </div>
  )
}
```

- [ ] **Step 3: Create the Settings tab**

Create `components/calls/panel/tabs/settings-tab.tsx`:

```tsx
"use client"

import { LogOut } from "lucide-react"
import type { SerializedCallState } from "@/lib/panel-bus"
import { send } from "../panel-send"

export function SettingsTab({
  state,
  onSignOut,
}: {
  state: SerializedCallState
  onSignOut: () => void
}) {
  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between rounded-lg border border-neutral-800 px-3 py-3">
        <span className="text-sm font-medium text-white">
          {state.online ? "Online — receiving calls" : "Offline"}
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={state.online}
          onClick={() => send({ cmd: "set-online", online: !state.online })}
          className={`relative h-6 w-11 rounded-full transition ${
            state.online ? "bg-green-500" : "bg-neutral-700"
          }`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${
              state.online ? "left-5" : "left-0.5"
            }`}
          />
        </button>
      </div>

      <button
        type="button"
        onClick={() => {
          if (
            state.status !== "idle" &&
            !window.confirm("A call is in progress — signing out will end it. Continue?")
          )
            return
          onSignOut()
        }}
        className="flex items-center justify-center gap-2 rounded-lg border border-neutral-800 py-2.5 text-sm font-medium text-neutral-300 transition hover:bg-neutral-900"
      >
        <LogOut className="h-4 w-4" />
        Sign out
      </button>
    </div>
  )
}
```

- [ ] **Step 4: Create the Recent tab stub (real body in Task 5)**

Create `components/calls/panel/tabs/recent-tab.tsx`:

```tsx
"use client"

import type { SerializedCallState } from "@/lib/panel-bus"
import type { PhoneNumber } from "@/types/calls"

export function RecentTab(_props: {
  accessToken: string | undefined
  phoneNumbers: PhoneNumber[]
  state: SerializedCallState
  onCallback: (to: string) => void
}) {
  return (
    <div className="p-4 text-sm text-neutral-500">Loading recent calls…</div>
  )
}
```

- [ ] **Step 5: Rewrite `remote-phone.tsx` as the dark tabbed shell**

Replace the entire contents of `components/calls/panel/remote-phone.tsx` with:

```tsx
"use client"

import { useEffect, useState } from "react"
import {
  IDLE_STATE,
  isPanelEvent,
  type SerializedCallState,
} from "@/lib/panel-bus"
import { IncomingCallPopup } from "@/components/calls/ui/incoming-call-popup"
import { ActiveCallHud } from "@/components/calls/ui/active-call-hud"
import type { PhoneNumber } from "@/types/calls"
import { send } from "./panel-send"
import { PanelTabs, type PanelTab } from "./panel-tabs"
import { DialpadTab } from "./tabs/dialpad-tab"
import { RecentTab } from "./tabs/recent-tab"
import { SettingsTab } from "./tabs/settings-tab"

function useRemoteDuration(startedAt: number | null): string {
  const [, tick] = useState(0)
  useEffect(() => {
    if (startedAt === null) return
    const id = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [startedAt])
  if (startedAt === null) return "0:00"
  const s = Math.max(0, Math.floor((Date.now() - startedAt) / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
}

/**
 * Dark, tabbed remote control for the background phone (one-phone rule: never
 * opens WebRTC). Owns the state-sync subscription, the active tab, the dial
 * inputs, and the call overlays; tabs render inside.
 */
export function RemotePhone({
  phoneNumbers,
  accessToken,
  onSignOut,
}: {
  phoneNumbers: PhoneNumber[]
  accessToken: string | undefined
  onSignOut: () => void
}) {
  const [state, setState] = useState<SerializedCallState>(IDLE_STATE)
  const [tab, setTab] = useState<PanelTab>("dialpad")
  const [to, setTo] = useState("")
  const [phoneNumberId, setPhoneNumberId] = useState("")
  const [speakText, setSpeakText] = useState("")

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin && !event.origin.startsWith("chrome-extension://")) return
      const msg = event.data
      if (!isPanelEvent(msg)) return
      if (msg.type === "state-sync") setState(msg.state)
    }
    window.addEventListener("message", onMessage)
    send({ cmd: "request-state" })
    return () => window.removeEventListener("message", onMessage)
  }, [])

  const duration = useRemoteDuration(
    state.status === "active" ? state.startedAt : null
  )
  const inCall = state.status !== "idle" && state.status !== "incoming"

  function handleCallback(number: string) {
    setTo(number)
    setTab("dialpad")
  }

  return (
    <div className="flex h-full min-h-screen flex-col bg-neutral-950 text-neutral-100">
      <div className="flex items-center justify-between px-4 py-3">
        <h1 className="text-sm font-semibold">Call Panel</h1>
        <span
          className={`h-2.5 w-2.5 rounded-full ${
            state.online ? "bg-green-500" : "bg-neutral-600"
          }`}
          aria-label={state.online ? "Online" : "Offline"}
        />
      </div>

      <PanelTabs active={tab} onChange={setTab} />

      <div className="flex-1 overflow-y-auto">
        {tab === "dialpad" && (
          <DialpadTab
            phoneNumbers={phoneNumbers}
            state={state}
            to={to}
            setTo={setTo}
            phoneNumberId={phoneNumberId}
            setPhoneNumberId={setPhoneNumberId}
          />
        )}
        {tab === "recent" && (
          <RecentTab
            accessToken={accessToken}
            phoneNumbers={phoneNumbers}
            state={state}
            onCallback={handleCallback}
          />
        )}
        {tab === "settings" && (
          <SettingsTab state={state} onSignOut={onSignOut} />
        )}
      </div>

      {state.status === "incoming" && (
        <IncomingCallPopup
          callerNumber={state.callerNumber ?? "Unknown"}
          companyLabel={state.companyLabel}
          companyNumber={state.companyNumber}
          busy={false}
          onAnswer={() => send({ cmd: "answer" })}
          onReject={() => send({ cmd: "decline" })}
        />
      )}

      {inCall && (
        <ActiveCallHud
          callState={state.status}
          duration={duration}
          remoteNumber={state.remoteNumber ?? "Unknown"}
          muted={state.muted}
          speakText={speakText}
          speaking={false}
          onHangup={() => send({ cmd: "hangup" })}
          onToggleMute={() => send({ cmd: state.muted ? "unmute" : "mute" })}
          onSpeakTextChange={setSpeakText}
          onSpeak={() => {
            if (speakText.trim()) {
              send({ cmd: "speak", text: speakText.trim() })
              setSpeakText("")
            }
          }}
          onDtmf={(digit) => send({ cmd: "dtmf", digit })}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 6: Pass `accessToken` from `panel-app.tsx`**

In `components/calls/panel/panel-app.tsx`, the `mode === "remote"` branch currently renders:

```tsx
  if (mode === "remote") {
    return (
      <RemotePhone
        phoneNumbers={phoneNumbers}
        onSignOut={() => supabase.auth.signOut()}
      />
    )
  }
```

Change it to pass the token (already available as `accessToken` on line 40):

```tsx
  if (mode === "remote") {
    return (
      <RemotePhone
        phoneNumbers={phoneNumbers}
        accessToken={accessToken}
        onSignOut={() => supabase.auth.signOut()}
      />
    )
  }
```

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add components/calls/panel/panel-tabs.tsx components/calls/panel/tabs/ components/calls/panel/remote-phone.tsx components/calls/panel/panel-app.tsx
git commit -m "feat(panel): dark tabbed shell (Dialpad + Settings + nav)"
```

---

### Task 5: Recent tab body (list + callback)

**Files:**
- Modify: `components/calls/panel/tabs/recent-tab.tsx` (replace stub)
- Verify: `npm run typecheck`, then manual acceptance

**Interfaces:**
- Consumes: `useRecentCalls` (Task 3); `formatRecentRow` (Task 1); `send` (Task 3); `SerializedCallState`, `PhoneNumber`.
- Produces: full `RecentTab` — same prop signature as the Task 4 stub.

- [ ] **Step 1: Replace the stub with the real Recent tab**

Replace the entire contents of `components/calls/panel/tabs/recent-tab.tsx` with:

```tsx
"use client"

import { ArrowDownLeft, ArrowUpRight, Phone } from "lucide-react"
import type { SerializedCallState } from "@/lib/panel-bus"
import type { PhoneNumber } from "@/types/calls"
import { send } from "../panel-send"
import { formatRecentRow } from "../recent-row"
import { useRecentCalls } from "../use-recent-calls"

export function RecentTab({
  accessToken,
  phoneNumbers,
  state,
  onCallback,
}: {
  accessToken: string | undefined
  phoneNumbers: PhoneNumber[]
  state: SerializedCallState
  onCallback: (to: string) => void
}) {
  const { calls, loading, error, reload } = useRecentCalls(accessToken)
  const inCall = state.status !== "idle" && state.status !== "incoming"
  const canDial = state.isReady && !inCall
  const defaultCallerId = phoneNumbers[0]?.phone_number

  if (loading) {
    return <div className="p-4 text-sm text-neutral-500">Loading recent calls…</div>
  }

  if (error) {
    return (
      <div className="flex flex-col items-start gap-2 p-4 text-sm">
        <span className="text-neutral-400">Couldn&apos;t load recent calls.</span>
        <button
          type="button"
          onClick={reload}
          className="rounded-md border border-neutral-700 px-3 py-1.5 text-neutral-200 hover:bg-neutral-900"
        >
          Retry
        </button>
      </div>
    )
  }

  if (calls.length === 0) {
    return <div className="p-4 text-sm text-neutral-500">No recent calls yet.</div>
  }

  return (
    <ul className="divide-y divide-neutral-900">
      {calls.map((call) => {
        const row = formatRecentRow(call)
        return (
          <li
            key={call.id}
            className="flex items-center gap-3 px-4 py-3 hover:bg-neutral-900"
          >
            <button
              type="button"
              onClick={() => onCallback(row.callbackTo)}
              className="flex min-w-0 flex-1 items-center gap-3 text-left"
            >
              {row.directionIcon === "out" ? (
                <ArrowUpRight className="h-4 w-4 shrink-0 text-neutral-500" />
              ) : (
                <ArrowDownLeft
                  className={`h-4 w-4 shrink-0 ${row.missed ? "text-red-500" : "text-neutral-500"}`}
                />
              )}
              <span className="min-w-0">
                <span
                  className={`block truncate text-sm font-medium ${
                    row.missed ? "text-red-400" : "text-white"
                  }`}
                >
                  {row.title}
                </span>
                <span className="block truncate text-xs text-neutral-500">
                  {row.lineLabel ? `${row.lineLabel} · ` : ""}
                  {row.timeText}
                </span>
              </span>
            </button>
            <button
              type="button"
              aria-label={`Call ${row.title}`}
              disabled={!canDial || !defaultCallerId || !row.callbackTo}
              onClick={() =>
                defaultCallerId &&
                send({ cmd: "dial", to: row.callbackTo, callerId: defaultCallerId })
              }
              className="rounded-full bg-green-500 p-2 text-white transition hover:bg-green-600 disabled:opacity-40"
            >
              <Phone className="h-4 w-4" />
            </button>
          </li>
        )
      })}
    </ul>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Run the full test suite (guard against regressions)**

Run: `npm run test`
Expected: PASS (all suites, including `recent-row.test.ts`).

- [ ] **Step 4: Manual acceptance (popup, load-unpacked)**

Preconditions: dev server running, logged in, extension reloaded.
1. Open the popup → it's dark, with Dialpad · Recent · Settings tabs.
2. Recent tab → lists newest-first; missed calls show a red number + red inbound arrow.
3. Tap a missed row → switches to Dialpad with the number prefilled → press Call → connects.
4. Recent row's green phone icon → dials directly; it is disabled while a call is active.
5. Empty account → "No recent calls yet."; kill the dev server and reopen Recent → "Couldn't load recent calls" + Retry.
6. Settings tab → Online toggle flips; Sign out works (confirms if mid-call).
7. Switch the OS to light mode → the panel stays black.

- [ ] **Step 5: Commit**

```bash
git add components/calls/panel/tabs/recent-tab.tsx
git commit -m "feat(panel): Recent tab list + tap-to-callback"
```

---

## Self-Review

**Spec coverage:**
- Dark tabbed shell (Dialpad · Recent · Settings) → Task 4. ✓
- Dark-always styling → Task 4 (explicit `bg-neutral-950`, no theme dependency). ✓
- Split monolith into focused tab files + shared `send` → Tasks 3, 4. ✓
- `GET /api/calls/recent` bearer-auth, latest 30 → Task 2 (admin-client pattern per the real codebase; deviation from spec's RLS note documented in Global Constraints + Task 2 comment). ✓
- `use-recent-calls` hook → Task 3. ✓
- `formatRecentRow` pure + tested (missed/direction/time-fallback/missing-join/empty) → Task 1. ✓
- Callback flow A (row tap prefills Dialpad; icon one-tap dial with guards) → Tasks 4-5. ✓
- Error/empty/legacy-row handling → Task 1 (defensive helper) + Task 5 (error/empty states, disabled dial). ✓
- Regression guard (server call-handling/widget/engine untouched) → Global Constraints; no task touches them. ✓

**Placeholder scan:** No TBD/TODO. The Task 4 `RecentTab` stub is intentional and explicitly replaced in Task 5 (both tasks show full code; not a "similar to" reference).

**Type consistency:** `RecentCall`/`RecentRowView` (Task 1) are consumed unchanged by the route (Task 2), hook (Task 3), and Recent tab (Task 5). `send`/`CmdPayload` defined once (Task 3) and imported by every tab + shell. `RemotePhone` gains `accessToken: string | undefined` in Task 4 and `panel-app.tsx` passes `accessToken` (already in scope). `PanelTab` union (`dialpad`/`recent`/`settings`) matches the shell's `tab` state and `PanelTabs` props. `dial` command uses `{ to, callerId }` matching `PanelCommand`.

**Known deviation (intentional):** the route returns team-wide calls via the admin client, matching `phone-numbers/route.ts`, rather than the RLS-scoped read the spec speculated about. Same user-visible result; documented.
