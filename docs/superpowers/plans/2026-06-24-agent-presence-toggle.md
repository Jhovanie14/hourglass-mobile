# Agent Online/Offline Presence Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an agent manually toggle Online/Offline; while Offline they receive no inbound calls (but can still place outbound).

**Architecture:** Approach A — heartbeat-gating + instant-offline expire. The agent's Online/Offline intent lives in the WebRTC client. Online keeps the existing 15s presence heartbeat running; Offline stops it and immediately deletes the agent's `agent_presence` row so ring-all's `getOnlineReachableAgents` skips them at once. No DB schema change; default Online each session (non-sticky).

**Tech Stack:** Next.js (App Router), React 19, Supabase (service-role admin client), Telnyx WebRTC, Vitest, Tailwind + radix-ui Switch, sonner toasts.

## Global Constraints

- No database schema change — presence-row existence is the source of truth for "dialable".
- `agent_presence` table writes happen server-side via the service-role admin client only (`lib/admin.ts`).
- Offline affects inbound only; outbound calling stays available.
- Default state on (re)connect is Online; state is NOT persisted across sessions.
- Two states only: Online / Offline.
- Match existing presence patterns: pure functions take `admin` and are unit-tested with the `makeAdmin` mock style in `lib/telnyx/presence.test.ts`.

---

### Task 1: `expirePresence` server function + DELETE route

**Files:**
- Modify: `lib/telnyx/presence.ts`
- Test: `lib/telnyx/presence.test.ts`
- Modify: `app/api/calls/presence/route.ts`

**Interfaces:**
- Consumes: `createAdminClient` type (existing `Admin` alias in `presence.ts`); `getRequestUserId` from `@/lib/auth` (existing, used by the POST handler).
- Produces: `expirePresence(admin: Admin, userId: string): Promise<void>` — deletes the agent's `agent_presence` row; and a `DELETE` handler on `/api/calls/presence`.

- [ ] **Step 1: Write the failing test**

Add to `lib/telnyx/presence.test.ts`. First extend the existing `makeAdmin` mock so `from()` also returns a chainable `delete().eq()`:

```typescript
// In makeAdmin, add alongside upsert/select:
const deleteEq = vi.fn().mockResolvedValue({ error: opts.writeErr ?? null })
const del = vi.fn(() => ({ eq: deleteEq }))
const from = vi.fn(() => ({ upsert, select, delete: del }))
// update the return to expose them:
return { client: { from } as any, upsert, select, gte, from, del, deleteEq }
```

Then add the import and tests:

```typescript
import { recordHeartbeat, getOnlineAgentUserIds, expirePresence } from "./presence"

describe("expirePresence", () => {
  it("deletes the agent's presence row by user_id", async () => {
    const admin = makeAdmin({})
    await expirePresence(admin.client, "user-1")
    expect(admin.from).toHaveBeenCalledWith("agent_presence")
    expect(admin.deleteEq).toHaveBeenCalledWith("user_id", "user-1")
  })

  it("throws when the delete returns an error", async () => {
    const admin = makeAdmin({ writeErr: new Error("delete failed") })
    await expect(expirePresence(admin.client, "user-1")).rejects.toThrow(
      /delete failed/
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/telnyx/presence.test.ts --no-file-parallelism`
Expected: FAIL — `expirePresence is not a function` (collection/type error).

- [ ] **Step 3: Write minimal implementation**

Add to `lib/telnyx/presence.ts` (after `getOnlineAgentUserIds`):

```typescript
/**
 * Immediately drop an agent from the online set (manual "go offline").
 *
 * Deletes the agent's single `agent_presence` row so ring-all stops dialing them
 * right away, instead of waiting out the ~30s staleness window.
 */
export async function expirePresence(
  admin: Admin,
  userId: string
): Promise<void> {
  const { error } = await admin
    .from("agent_presence")
    .delete()
    .eq("user_id", userId)
  if (error) throw error
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/telnyx/presence.test.ts --no-file-parallelism`
Expected: PASS (all presence tests green).

- [ ] **Step 5: Add the DELETE route handler**

Modify `app/api/calls/presence/route.ts` — add the import and a `DELETE` export (leave `POST` unchanged):

```typescript
import { getRequestUserId } from "@/lib/auth"
import { createAdminClient } from "@/lib/admin"
import { recordHeartbeat, expirePresence } from "@/lib/telnyx/presence"

// ...existing POST handler stays as-is...

/**
 * Manual "go offline" — the WebRTC client calls this when the agent toggles
 * Offline. Deletes the agent's presence row so ring-all skips them immediately.
 */
export async function DELETE(req: Request) {
  const userId = await getRequestUserId(req)
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const admin = createAdminClient()
    await expirePresence(admin, userId)
    return Response.json({ ok: true })
  } catch (err) {
    console.error("⚠️ Failed to expire presence:", err)
    return Response.json({ error: "Failed to expire presence" }, { status: 500 })
  }
}
```

(Update the existing `recordHeartbeat` import line to also import `expirePresence` as shown.)

- [ ] **Step 6: Verify typecheck + lint**

Run: `npm run typecheck`
Expected: no output (clean).
Run: `npx eslint lib/telnyx/presence.ts app/api/calls/presence/route.ts`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add lib/telnyx/presence.ts lib/telnyx/presence.test.ts app/api/calls/presence/route.ts
git commit -m "feat: expirePresence + DELETE /api/calls/presence for manual offline"
```

---

### Task 2: WebRTC context — online state + heartbeat gating

**Files:**
- Modify: `components/calls/hooks/use-webrtc-client.ts`
- Modify: `components/calls/webrtc-provider.tsx`

**Interfaces:**
- Consumes: `expirePresence` DELETE route (`DELETE /api/calls/presence`) from Task 1.
- Produces: `useWebRTC()` context now also exposes `online: boolean` and `setOnline: (next: boolean) => void`. `useWebRTCClient(audioRef, onNotification, online)` gains a third `online: boolean` param.

No unit test: this is React client wiring (the repo does not unit-test hooks/providers). It is verified by typecheck, lint, and the manual check in Step 5.

- [ ] **Step 1: Add the `online` param + gate the heartbeat in `use-webrtc-client.ts`**

Change the signature:

```typescript
export function useWebRTCClient(
  audioRef: RefObject<HTMLAudioElement | null>,
  onNotification: (n: Notification) => void,
  online: boolean
) {
```

Replace the existing presence-heartbeat `useEffect` (the block starting `// Presence heartbeat:` through its `}, [isReady])`) with:

```typescript
  // Presence: while Online + connected, heartbeat every ~15s so ring-all can
  // reach this agent. Going Offline stops the heartbeat AND expires the presence
  // row immediately (DELETE), so the agent leaves the dial set at once.
  useEffect(() => {
    if (!isReady) return
    let active = true

    async function ping(method: "POST" | "DELETE") {
      try {
        const supabase = createClient()
        const {
          data: { session },
        } = await supabase.auth.getSession()
        if (!active) return
        await fetch("/api/calls/presence", {
          method,
          headers: session?.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : {},
        })
      } catch (err) {
        console.warn(`WebRTC: presence ${method} failed`, err)
      }
    }

    if (!online) {
      ping("DELETE")
      return () => {
        active = false
      }
    }

    ping("POST")
    const id = setInterval(() => ping("POST"), 15_000)
    return () => {
      active = false
      clearInterval(id)
    }
  }, [isReady, online])
```

- [ ] **Step 2: Wire `online` state into the provider `components/calls/webrtc-provider.tsx`**

Add the state near the other `useState` calls in `WebRTCProvider`:

```typescript
  // Manual availability. Default Online each session (non-sticky).
  const [online, setOnline] = useState(true)
```

Pass it to the client hook (update the existing call):

```typescript
  const { isReady, newCall } = useWebRTCClient(
    remoteAudioRef,
    handleNotification,
    online
  )
```

- [ ] **Step 3: Expose `online`/`setOnline` on the context**

Update the context type and default value at the top of the file:

```typescript
type WebRTCContextType = {
  isReady: boolean
  makeCall: (to: string, phoneNumber: PhoneNumber) => Promise<void>
  online: boolean
  setOnline: (next: boolean) => void
}

const WebRTCContext = createContext<WebRTCContextType>({
  isReady: false,
  makeCall: async () => {},
  online: true,
  setOnline: () => {},
})
```

Update the provider's value (the `<WebRTCContext.Provider value={...}>`):

```typescript
    <WebRTCContext.Provider value={{ isReady, makeCall, online, setOnline }}>
```

- [ ] **Step 4: Verify typecheck + lint**

Run: `npm run typecheck`
Expected: no output (clean).
Run: `npx eslint components/calls/hooks/use-webrtc-client.ts components/calls/webrtc-provider.tsx`
Expected: no NEW errors (the provider has pre-existing `any`/ref warnings; do not add new ones).

- [ ] **Step 5: Commit**

```bash
git add components/calls/hooks/use-webrtc-client.ts components/calls/webrtc-provider.tsx
git commit -m "feat: online/offline state in WebRTC context, gates presence heartbeat"
```

---

### Task 3: `PresenceToggle` component

**Files:**
- Create: `components/calls/ui/presence-toggle.tsx`

**Interfaces:**
- Consumes: `useWebRTC()` (`online`, `setOnline`, `isReady`) from Task 2; `Switch` from `@/components/ui/switch`; `toast` from `sonner`; `cn` from `@/lib/utils`.
- Produces: `<PresenceToggle className?: string />` for mounting in Task 4.

No unit test: presentational client component, verified by typecheck/lint + manual check.

- [ ] **Step 1: Create the component**

```tsx
"use client"

import { toast } from "sonner"
import { Switch } from "@/components/ui/switch"
import { useWebRTC } from "@/components/calls/webrtc-provider"
import { cn } from "@/lib/utils"

export function PresenceToggle({ className }: { className?: string }) {
  const { isReady, online, setOnline } = useWebRTC()

  function handleChange(next: boolean) {
    setOnline(next)
    toast(
      next
        ? "You're online — you'll receive calls."
        : "You're offline — you won't receive calls."
    )
  }

  const label = !isReady ? "Connecting…" : online ? "Online" : "Offline"

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <span
        className={cn(
          "inline-block size-2 shrink-0 rounded-full",
          isReady && online ? "bg-green-500" : "bg-muted-foreground"
        )}
        aria-hidden
      />
      <span className="text-sm text-muted-foreground">{label}</span>
      <Switch
        checked={online}
        onCheckedChange={handleChange}
        disabled={!isReady}
        aria-label="Toggle availability for inbound calls"
        className="ml-auto"
      />
    </div>
  )
}
```

- [ ] **Step 2: Verify typecheck + lint**

Run: `npm run typecheck`
Expected: no output (clean).
Run: `npx eslint components/calls/ui/presence-toggle.tsx`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add components/calls/ui/presence-toggle.tsx
git commit -m "feat: PresenceToggle component (online/offline pill + switch)"
```

---

### Task 4: Mount the toggle in the sidebar and the extension panel

**Files:**
- Modify: `components/sidebar-nav.tsx`
- Modify: `components/calls/panel/panel-dialer.tsx`

**Interfaces:**
- Consumes: `<PresenceToggle />` from Task 3. Both shells already mount `WebRTCProvider` (`app/dashboard/layout.tsx` and `components/calls/panel/panel-app.tsx`), so the context is available.

No unit test: UI mount, verified by typecheck/lint + the manual end-to-end check in Step 4.

- [ ] **Step 1: Mount in the dashboard sidebar**

In `components/sidebar-nav.tsx`, add the import:

```tsx
import { PresenceToggle } from "@/components/calls/ui/presence-toggle"
```

Then add a presence group as the first child inside `<SidebarContent>` (immediately after the opening tag, before the existing `<SidebarGroup>`):

```tsx
      <SidebarGroup>
        <SidebarGroupLabel>Availability</SidebarGroupLabel>
        <SidebarGroupContent>
          <PresenceToggle className="px-2 py-1.5" />
        </SidebarGroupContent>
      </SidebarGroup>
```

- [ ] **Step 2: Mount in the extension panel header**

In `components/calls/panel/panel-dialer.tsx`, add the import:

```tsx
import { PresenceToggle } from "@/components/calls/ui/presence-toggle"
```

Then render it under the header row. Replace the header block:

```tsx
      <div className="flex items-center justify-between">
        <h1 className="text-base font-semibold text-foreground">Call Panel</h1>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onSignOut}
          aria-label="Sign out"
        >
          <LogOut className="h-4 w-4" />
        </Button>
      </div>
```

with:

```tsx
      <div className="flex items-center justify-between">
        <h1 className="text-base font-semibold text-foreground">Call Panel</h1>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onSignOut}
          aria-label="Sign out"
        >
          <LogOut className="h-4 w-4" />
        </Button>
      </div>
      <PresenceToggle />
```

- [ ] **Step 3: Verify typecheck + lint + full test suite**

Run: `npm run typecheck`
Expected: no output (clean).
Run: `npx eslint components/sidebar-nav.tsx components/calls/panel/panel-dialer.tsx`
Expected: clean.
Run: `npx vitest run --no-file-parallelism`
Expected: all tests pass (presence suite includes the new `expirePresence` tests).

- [ ] **Step 4: Manual verification (record result)**

1. `npm run dev`, sign in, open the dashboard. Confirm the sidebar shows an **Availability** pill that reads **Online** (green dot) once WebRTC connects (it shows "Connecting…" disabled until then).
2. Toggle to **Offline** → toast appears; in Supabase, the agent's `agent_presence` row is **deleted** within a second.
3. Toggle back to **Online** → row reappears (heartbeat re-inserts it).
4. While Offline, place an inbound call to a DID this agent would normally ring → confirm the agent is **not** rung (routes to other online agents / voicemail).
5. While Offline, place an **outbound** call → confirm it still works.

- [ ] **Step 5: Commit**

```bash
git add components/sidebar-nav.tsx components/calls/panel/panel-dialer.tsx
git commit -m "feat: mount PresenceToggle in dashboard sidebar and extension panel"
```

---

## Notes / edge cases (from the spec)

- **Offline during an incoming ring:** the call already routed; the agent can still answer/reject it. No new calls ring.
- **Multiple tabs:** if any tab is Online it keeps re-inserting the row, so the agent stays reachable — correct.
- **DELETE failure:** logged; the row goes stale within ~30s anyway, so the agent still ends up Offline. UI still reflects Offline (client intent).
