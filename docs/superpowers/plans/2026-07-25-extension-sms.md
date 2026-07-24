# SMS in the Chrome Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Messages tab beside Recent inside the existing floating call widget, giving agents the same SMS capabilities the website has — list, reply, compose, filter by line, delete message, delete conversation.

**Architecture:** One shared `useConversations` hook drives both the desktop conversations page and the new panel tab, so the two cannot drift. All mutations move from cookie-bound server actions to API routes, because the panel iframe is cross-origin and has no cookies. Two new DELETE routes are added, authorized through an RLS-scoped client rather than the admin client.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Supabase (auth + Postgres + Realtime), Tailwind, lucide-react, `date-fns`, `sonner` for toasts, Vitest (`environment: "node"`).

**Spec:** `docs/superpowers/specs/2026-07-25-extension-sms-design.md`

## Global Constraints

- **Vitest runs with `environment: "node"`** and the repo has **no jsdom and no testing-library**. React components and hooks **cannot** be unit-tested. Do not add a test harness. Tests cover pure logic modules and API routes only.
- **Deletes must never use `createAdminClient()`.** They rely on RLS for authorization; the admin client bypasses it and would let any authenticated agent delete any conversation in the system.
- **The panel iframe is cross-origin and has no cookies.** Anything the panel calls must accept `Authorization: Bearer <access_token>`. Server actions (`"use server"`) do not work there.
- The Messages tab lives **beside Recent inside the existing widget**. No Chrome side panel, no pop-out window. This was decided explicitly.
- Widget size becomes **340×360** (from 340×220).
- Existing panel convention: tabs receive `accessToken` and fetch with a Bearer header — see `components/calls/panel/use-recent-calls.ts:19-20`.
- Commit after every task.

## File Structure

| File | Responsibility |
|---|---|
| `lib/auth.ts` (modify) | Add `createRequestScopedClient` — RLS-scoped client from cookie or Bearer |
| `app/api/messages/[id]/route.ts` (create) | `DELETE` a single message |
| `app/api/messages/conversations/[id]/route.ts` (create) | `DELETE` a conversation |
| `components/conversations/use-conversations.ts` (create) | Shared orchestration: list, realtime, mark-read, send, compose, deletes |
| `components/conversations/conversations-layout.tsx` (modify) | Desktop presentation only; consumes the hook |
| `components/calls/panel/tabs/messages/conversation-row.ts` (create) | Pure row formatting (testable) |
| `components/calls/panel/panel-tabs.tsx` (modify) | Fourth tab + unread badge |
| `components/calls/panel/tabs/messages-tab.tsx` (create) | View state, consumes the hook |
| `components/calls/panel/tabs/messages/conversation-rows.tsx` (create) | List + line filter + compose button |
| `components/calls/panel/tabs/messages/thread-view.tsx` (create) | Bubbles, composer, delete affordances |
| `components/calls/panel/tabs/messages/compose-view.tsx` (create) | New-message form |
| `components/calls/panel/panel-app.tsx` (modify) | Render the Messages tab, pass badge count |
| `extension/content-widget.js` (modify) | Widget height 220 → 360 |

---

### Task 1: RLS-scoped request client

**Files:**
- Modify: `lib/auth.ts` (append after `getRequestUserId`, which ends at line 62)
- Create: `lib/auth.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `createRequestScopedClient(req: Request): Promise<SupabaseClient | null>`

- [ ] **Step 1: Write the failing test**

Create `lib/auth.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const cookieClient = { auth: { getClaims: vi.fn() } }
vi.mock("@/lib/server", () => ({ createClient: vi.fn(async () => cookieClient) }))

const createSupabaseClient = vi.fn(() => ({ marker: "bearer-client" }))
vi.mock("@supabase/supabase-js", () => ({ createClient: createSupabaseClient }))

import { createRequestScopedClient } from "./auth"

function req(headers: Record<string, string> = {}) {
  return new Request("http://test/api/whatever", { headers })
}

describe("createRequestScopedClient", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co"
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "publishable-key"
    cookieClient.auth.getClaims.mockResolvedValue({ data: null })
  })

  it("returns the cookie client when a cookie session exists", async () => {
    cookieClient.auth.getClaims.mockResolvedValue({ data: { claims: { sub: "user-1" } } })
    const client = await createRequestScopedClient(req())
    expect(client).toBe(cookieClient)
    expect(createSupabaseClient).not.toHaveBeenCalled()
  })

  it("builds a client carrying the caller's Bearer token so RLS sees the real user", async () => {
    const client = await createRequestScopedClient(req({ authorization: "Bearer abc123" }))
    expect(client).toEqual({ marker: "bearer-client" })
    expect(createSupabaseClient).toHaveBeenCalledWith(
      "https://project.supabase.co",
      "publishable-key",
      { global: { headers: { Authorization: "Bearer abc123" } } }
    )
  })

  it("accepts a lowercase bearer scheme", async () => {
    await createRequestScopedClient(req({ authorization: "bearer abc123" }))
    expect(createSupabaseClient).toHaveBeenCalledWith(
      "https://project.supabase.co",
      "publishable-key",
      { global: { headers: { Authorization: "Bearer abc123" } } }
    )
  })

  it("returns null with neither a cookie session nor a token", async () => {
    expect(await createRequestScopedClient(req())).toBeNull()
  })

  it("returns null when the Authorization header is not a Bearer scheme", async () => {
    expect(await createRequestScopedClient(req({ authorization: "Basic abc" }))).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run lib/auth.test.ts`
Expected: FAIL — `createRequestScopedClient` is not exported from `./auth`.

- [ ] **Step 3: Implement the helper**

Append to `lib/auth.ts`:

```ts
/**
 * A Supabase client scoped to the requesting user, so RLS applies to whatever
 * it does. Cookie session when present (the web app), otherwise the Bearer
 * token (the extension panel, which has no cross-site cookies in its iframe).
 *
 * Mutations that rely on RLS for authorization — deletes especially — MUST use
 * this rather than createAdminClient(), which bypasses policies entirely.
 */
export async function createRequestScopedClient(
  req: Request
): Promise<SupabaseClient | null> {
  // 1. Cookie-based session (the web app).
  const claims = await getCurrentUser()
  if (claims?.sub) return (await createClient()) as unknown as SupabaseClient

  // 2. Bearer access token (the extension panel). Passing it as a global header
  // makes Postgres evaluate policies as that user rather than anon.
  const authHeader = req.headers.get("authorization") ?? ""
  const token = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : null
  if (!token) return null

  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  )
}
```

Add the type import at the top of `lib/auth.ts`, beside the existing imports:

```ts
import type { SupabaseClient } from "@supabase/supabase-js"
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run lib/auth.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/auth.ts lib/auth.test.ts
git commit -m "feat: RLS-scoped request client for cookie or Bearer callers"
```

---

### Task 2: DELETE a message

**Files:**
- Create: `app/api/messages/[id]/route.ts`
- Create: `app/api/messages/[id]/route.test.ts`

**Interfaces:**
- Consumes: `createRequestScopedClient(req)` from Task 1
- Produces: `DELETE /api/messages/{id}` → `200 { ok: true }` / `401` / `422 { error }`

- [ ] **Step 1: Write the failing test**

Create `app/api/messages/[id]/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/auth", () => ({ createRequestScopedClient: vi.fn() }))

import { DELETE } from "./route"
import { createRequestScopedClient } from "@/lib/auth"

const params = Promise.resolve({ id: "msg-1" })
const req = () => new Request("http://test/api/messages/msg-1", { method: "DELETE" })

function clientReturning(error: { message: string } | null) {
  const eq = vi.fn().mockResolvedValue({ error })
  const del = vi.fn(() => ({ eq }))
  const from = vi.fn(() => ({ delete: del }))
  return { client: { from }, from, del, eq }
}

describe("DELETE /api/messages/[id]", () => {
  beforeEach(() => vi.clearAllMocks())

  it("401s when the caller has no cookie session and no Bearer token", async () => {
    vi.mocked(createRequestScopedClient).mockResolvedValue(null)
    expect((await DELETE(req(), { params })).status).toBe(401)
  })

  it("deletes the message through the caller's own client, so RLS applies", async () => {
    const { client, from, del, eq } = clientReturning(null)
    vi.mocked(createRequestScopedClient).mockResolvedValue(client as never)

    const res = await DELETE(req(), { params })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(from).toHaveBeenCalledWith("messages")
    expect(del).toHaveBeenCalled()
    expect(eq).toHaveBeenCalledWith("id", "msg-1")
  })

  it("422s and surfaces the error when the delete is rejected", async () => {
    const { client } = clientReturning({ message: "row-level security" })
    vi.mocked(createRequestScopedClient).mockResolvedValue(client as never)

    const res = await DELETE(req(), { params })

    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: "row-level security" })
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run "app/api/messages/[id]"`
Expected: FAIL — cannot resolve `./route`.

- [ ] **Step 3: Implement the route**

Create `app/api/messages/[id]/route.ts`:

```ts
import { createRequestScopedClient } from "@/lib/auth"

export const runtime = "nodejs"

/**
 * Delete one message. Mirrors the dashboard's deleteMessage server action, but
 * reachable from the extension panel, which is cross-origin and sends a Bearer
 * token instead of cookies.
 *
 * Uses the caller's own RLS-scoped client on purpose — never the admin client,
 * which would let any authenticated agent delete anyone's messages.
 */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createRequestScopedClient(req)
  if (!supabase) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const { error } = await supabase.from("messages").delete().eq("id", id)
  if (error) return Response.json({ error: error.message }, { status: 422 })

  return Response.json({ ok: true })
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run "app/api/messages/[id]"`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add "app/api/messages/[id]"
git commit -m "feat: DELETE /api/messages/[id] for message deletion from the panel"
```

---

### Task 3: DELETE a conversation

**Files:**
- Create: `app/api/messages/conversations/[id]/route.ts`
- Create: `app/api/messages/conversations/[id]/route.test.ts`

**Interfaces:**
- Consumes: `createRequestScopedClient(req)` from Task 1
- Produces: `DELETE /api/messages/conversations/{id}` → `200 { ok: true }` / `401` / `422 { error }`

- [ ] **Step 1: Write the failing test**

Create `app/api/messages/conversations/[id]/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/auth", () => ({ createRequestScopedClient: vi.fn() }))

import { DELETE } from "./route"
import { createRequestScopedClient } from "@/lib/auth"

const params = Promise.resolve({ id: "conv-1" })
const req = () =>
  new Request("http://test/api/messages/conversations/conv-1", { method: "DELETE" })

function clientReturning(error: { message: string } | null) {
  const eq = vi.fn().mockResolvedValue({ error })
  const del = vi.fn(() => ({ eq }))
  const from = vi.fn(() => ({ delete: del }))
  return { client: { from }, from, del, eq }
}

describe("DELETE /api/messages/conversations/[id]", () => {
  beforeEach(() => vi.clearAllMocks())

  it("401s when the caller has no cookie session and no Bearer token", async () => {
    vi.mocked(createRequestScopedClient).mockResolvedValue(null)
    expect((await DELETE(req(), { params })).status).toBe(401)
  })

  it("deletes the conversation through the caller's own client, so RLS applies", async () => {
    const { client, from, eq } = clientReturning(null)
    vi.mocked(createRequestScopedClient).mockResolvedValue(client as never)

    const res = await DELETE(req(), { params })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(from).toHaveBeenCalledWith("conversations")
    expect(eq).toHaveBeenCalledWith("id", "conv-1")
  })

  it("422s and surfaces the error when the delete is rejected", async () => {
    const { client } = clientReturning({ message: "row-level security" })
    vi.mocked(createRequestScopedClient).mockResolvedValue(client as never)

    const res = await DELETE(req(), { params })

    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: "row-level security" })
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run "app/api/messages/conversations/[id]"`
Expected: FAIL — cannot resolve `./route`.

- [ ] **Step 3: Implement the route**

Create `app/api/messages/conversations/[id]/route.ts`:

```ts
import { createRequestScopedClient } from "@/lib/auth"

export const runtime = "nodejs"

/**
 * Permanently delete a conversation. Its messages go with it via the
 * messages→conversations FK cascade. Opt-out suppression (sms_opt_outs, keyed
 * by phone) is deliberately left untouched so a deleted contact stays
 * suppressed — same rule as the dashboard's deleteConversation server action.
 *
 * Uses the caller's own RLS-scoped client on purpose — never the admin client.
 */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createRequestScopedClient(req)
  if (!supabase) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const { error } = await supabase.from("conversations").delete().eq("id", id)
  if (error) return Response.json({ error: error.message }, { status: 422 })

  return Response.json({ ok: true })
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run "app/api/messages/conversations/[id]"`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add "app/api/messages/conversations/[id]"
git commit -m "feat: DELETE /api/messages/conversations/[id] for conversation deletion"
```

---

### Task 4: Extract the shared `useConversations` hook

The largest task. It lifts orchestration out of `conversations-layout.tsx:38-232` and switches mutations from server actions to API routes.

**Files:**
- Create: `components/conversations/use-conversations.ts`
- Modify: `components/conversations/conversations-layout.tsx`

**Interfaces:**
- Consumes: the routes from Tasks 2 and 3; existing `POST /api/messages/send` and `POST /api/messages/conversations`
- Produces:

```ts
useConversations(input: {
  supabase: SupabaseClient
  phoneNumbers: PhoneNumber[]
  initialConversations: Conversation[]
  /** Panel only. Omit on the desktop, where same-origin cookies authenticate. */
  accessToken?: string
}): {
  conversations: Conversation[]
  selected: Conversation | null
  messages: Message[]
  loadingMessages: boolean
  sending: boolean
  unreadByInbox: Record<string, boolean>
  totalUnread: number
  selectConversation: (c: Conversation) => Promise<void>
  clearSelection: () => void
  /** `into` overrides `selected` — needed by compose, which sends into a
   *  conversation it just created, before selection state has committed. */
  send: (body: string, into?: Conversation) => Promise<void>
  startConversation: (input: { phoneNumberId: string; contactNumber: string }) => Promise<string | null>
  deleteMessage: (id: string) => Promise<void>
  deleteConversation: (id: string) => Promise<void>
  refresh: () => Promise<void>
}
```

- [ ] **Step 1: Create the hook**

Create `components/conversations/use-conversations.ts`:

```ts
"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import type { SupabaseClient } from "@supabase/supabase-js"
import { toast } from "sonner"
import type { Conversation, Message, PhoneNumber } from "@/types/conversations"

const MESSAGE_COLUMNS =
  "id, conversation_id, phone_number_id, direction, body, media_urls, status, telnyx_message_id, sent_at, created_at"

/**
 * Shared SMS orchestration for the dashboard page and the extension panel:
 * the conversation list, both Realtime channels, mark-read, optimistic send,
 * compose, and deletes.
 *
 * Mutations go through /api/messages/* rather than the dashboard's server
 * actions, because the panel runs in a cross-origin iframe with no cookies and
 * server actions cannot authenticate there. getRequestUserId /
 * createRequestScopedClient accept a cookie session OR a Bearer token, so one
 * path serves both callers.
 */
export function useConversations({
  supabase,
  phoneNumbers,
  initialConversations,
  accessToken,
}: {
  supabase: SupabaseClient
  phoneNumbers: PhoneNumber[]
  initialConversations: Conversation[]
  accessToken?: string
}) {
  const [conversations, setConversations] =
    useState<Conversation[]>(initialConversations)
  const [selected, setSelected] = useState<Conversation | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [sending, setSending] = useState(false)

  // Same-origin fetch from the dashboard carries cookies; the panel iframe must
  // present the Bearer token instead.
  const authHeaders = useMemo<Record<string, string>>(
    () => (accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    [accessToken]
  )

  const phoneById = useMemo(() => {
    const map: Record<string, PhoneNumber> = {}
    for (const p of phoneNumbers) map[p.id] = p
    return map
  }, [phoneNumbers])

  const unreadByInbox = useMemo(() => {
    const map: Record<string, boolean> = {}
    for (const c of conversations) {
      if (c.unread_count > 0) map[c.phone_number_id] = true
    }
    return map
  }, [conversations])

  // Conversations with anything unread — NOT the sum of unread messages, so the
  // tab badge and the per-line dots agree.
  const totalUnread = useMemo(
    () => conversations.filter((c) => c.unread_count > 0).length,
    [conversations]
  )

  const sortConversations = useCallback((list: Conversation[]) => {
    return [...list].sort((a, b) => {
      const at = a.last_message_at ? new Date(a.last_message_at).getTime() : 0
      const bt = b.last_message_at ? new Date(b.last_message_at).getTime() : 0
      return bt - at
    })
  }, [])

  const refresh = useCallback(async () => {
    const { data } = await supabase
      .from("conversations")
      .select("*, phone_numbers(id, label, phone_number, color, is_active)")
      .order("last_message_at", { ascending: false, nullsFirst: false })
    if (data) setConversations(data as Conversation[])
  }, [supabase])

  // ---- Realtime: conversations ----
  useEffect(() => {
    const channel = supabase
      .channel("conversations")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversations" },
        (payload) => {
          setConversations((prev) => {
            if (payload.eventType === "DELETE") {
              return prev.filter((c) => c.id !== (payload.old as Conversation).id)
            }
            const row = payload.new as Conversation
            // Preserve any joined phone_numbers we already have.
            const existing = prev.find((c) => c.id === row.id)
            const merged: Conversation = {
              ...row,
              phone_numbers:
                existing?.phone_numbers ?? phoneById[row.phone_number_id],
            }
            const without = prev.filter((c) => c.id !== row.id)
            return sortConversations([merged, ...without])
          })
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [supabase, phoneById, sortConversations])

  // ---- Realtime: messages for the active conversation ----
  // INSERT *and* DELETE: a message deleted elsewhere used to linger until
  // reload, which is glaring with the panel and the website open side by side.
  useEffect(() => {
    if (!selected) return
    const channel = supabase
      .channel(`messages:${selected.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${selected.id}`,
        },
        (payload) => {
          if (payload.eventType === "DELETE") {
            const gone = payload.old as { id: string }
            setMessages((prev) => prev.filter((m) => m.id !== gone.id))
            return
          }
          if (payload.eventType !== "INSERT") return
          const incoming = payload.new as Message
          setMessages((prev) => {
            // Skip if we already have it (e.g. our own optimistic/confirmed msg).
            if (prev.some((m) => m.id === incoming.id)) return prev
            return [...prev, incoming]
          })
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [supabase, selected])

  // ---- Load messages + mark read when selecting ----
  const selectConversation = useCallback(
    async (c: Conversation) => {
      setSelected(c)
      setLoadingMessages(true)
      setMessages([])

      const { data } = await supabase
        .from("messages")
        .select(MESSAGE_COLUMNS)
        .eq("conversation_id", c.id)
        .order("created_at", { ascending: true })

      setMessages((data ?? []) as Message[])
      setLoadingMessages(false)

      setConversations((prev) =>
        prev.map((x) => (x.id === c.id ? { ...x, unread_count: 0 } : x))
      )
      await supabase.rpc("mark_conversation_read", { conversation_id: c.id })
    },
    [supabase]
  )

  const clearSelection = useCallback(() => {
    setSelected(null)
    setMessages([])
  }, [])

  // ---- Send (optimistic) ----
  const send = useCallback(
    /**
     * `into` overrides the selected conversation. Compose needs it: it selects a
     * freshly created conversation and sends in the same tick, before the
     * `selected` state this closure captured has committed — without the
     * override the first message of a new thread would silently do nothing.
     */
    async (body: string, into?: Conversation) => {
      const target = into ?? selected
      if (!target) return
      setSending(true)

      const tempId = `temp-${Date.now()}`
      const optimistic: Message = {
        id: tempId,
        conversation_id: target.id,
        phone_number_id: target.phone_number_id,
        direction: "outbound",
        body,
        media_urls: null,
        status: "queued",
        telnyx_message_id: null,
        sent_at: null,
        created_at: new Date().toISOString(),
      }
      setMessages((prev) => [...prev, optimistic])

      let ok = false
      let saved: Message | null = null
      try {
        const res = await fetch("/api/messages/send", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders },
          body: JSON.stringify({
            conversationId: target.id,
            phoneNumberId: target.phone_number_id,
            to: target.contact_number,
            body,
          }),
        })
        const json = await res.json()
        ok = res.ok
        saved = ok ? (json.message as Message) : null
        if (!ok) toast.error(json.error ?? "Could not send message.")
      } catch {
        toast.error("Could not send message.")
      }

      setMessages((prev) => {
        if (!ok || !saved) {
          return prev.map((m) =>
            m.id === tempId ? { ...m, status: "delivery_failed" } : m
          )
        }
        // Drop the optimistic temp row. The messages Realtime subscription may
        // have already inserted the real row (keyed by its real id) before this
        // request resolved — if so, don't add it again or we'd render two
        // children with the same key.
        const withoutTemp = prev.filter((m) => m.id !== tempId)
        if (withoutTemp.some((m) => m.id === saved!.id)) return withoutTemp
        return [...withoutTemp, saved!]
      })
      setSending(false)
    },
    [selected, authHeaders]
  )

  // ---- Compose: get-or-create a conversation ----
  const startConversation = useCallback(
    async ({
      phoneNumberId,
      contactNumber,
    }: {
      phoneNumberId: string
      contactNumber: string
    }): Promise<string | null> => {
      try {
        const res = await fetch("/api/messages/conversations", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders },
          body: JSON.stringify({ phoneNumberId, contactNumber }),
        })
        const json = await res.json()
        if (!res.ok) {
          toast.error(json.error ?? "Could not start conversation.")
          return null
        }
        await refresh()
        return json.conversationId as string
      } catch {
        toast.error("Could not start conversation.")
        return null
      }
    },
    [authHeaders, refresh]
  )

  // ---- Deletes (optimistic, rolled back on failure) ----
  const deleteMessage = useCallback(
    async (id: string) => {
      const snapshot = messages
      setMessages((prev) => prev.filter((m) => m.id !== id))
      try {
        const res = await fetch(`/api/messages/${id}`, {
          method: "DELETE",
          headers: authHeaders,
        })
        if (!res.ok) {
          const json = await res.json()
          setMessages(snapshot)
          toast.error(json.error ?? "Could not delete message.")
        }
      } catch {
        setMessages(snapshot)
        toast.error("Could not delete message.")
      }
    },
    [messages, authHeaders]
  )

  const deleteConversation = useCallback(
    async (id: string) => {
      const snapshot = conversations
      setConversations((prev) => prev.filter((c) => c.id !== id))
      if (selected?.id === id) clearSelection()
      try {
        const res = await fetch(`/api/messages/conversations/${id}`, {
          method: "DELETE",
          headers: authHeaders,
        })
        if (!res.ok) {
          const json = await res.json()
          setConversations(snapshot)
          toast.error(json.error ?? "Could not delete conversation.")
          return
        }
        toast.success("Conversation deleted")
      } catch {
        setConversations(snapshot)
        toast.error("Could not delete conversation.")
      }
    },
    [conversations, selected, clearSelection, authHeaders]
  )

  // Realtime sockets drop while a widget sits on a page for hours — heal on focus.
  useEffect(() => {
    const onFocus = () => {
      refresh()
    }
    window.addEventListener("focus", onFocus)
    return () => window.removeEventListener("focus", onFocus)
  }, [refresh])

  return {
    conversations,
    selected,
    messages,
    loadingMessages,
    sending,
    unreadByInbox,
    totalUnread,
    selectConversation,
    clearSelection,
    send,
    startConversation,
    deleteMessage,
    deleteConversation,
    refresh,
  }
}
```

- [ ] **Step 2: Rewire the desktop layout to consume the hook**

In `components/conversations/conversations-layout.tsx`:

Replace the import block at lines 8-12:

```ts
import { toast } from "sonner"
import { useConversations } from "./use-conversations"
```

(The `deleteConversation` / `sendMessage` server-action import is removed entirely — those now live behind the hook. `toast` is still used by the layout's own code.)

Delete lines 38-39 and 49-52 (the `conversations`, `selected`, `messages`, `loadingMessages`, `sending` state), lines 58-79 (`phoneById`, `unreadByInbox`, `sortConversations`), lines 81-140 (both realtime effects), lines 142-167 (`selectConversation`), lines 169-214 (`handleSend`), and lines 216-232 (`handleDeleteConversation`).

In their place, immediately after `const pathname = usePathname()`:

```ts
  const {
    conversations,
    selected,
    messages,
    loadingMessages,
    sending,
    unreadByInbox,
    selectConversation,
    send,
    startConversation,
    deleteMessage,
    deleteConversation,
  } = useConversations({ supabase, phoneNumbers, initialConversations })
```

Keep `selectedInbox`, `switchInbox`, and `composeOpen` exactly as they are — inbox selection writes to the URL via `router.replace`, which is desktop-only and deliberately stays out of the hook.

Then update the JSX prop wiring so the names line up:
- `onSend={handleSend}` → `onSend={send}`
- `onDeleteConversation={handleDeleteConversation}` → `onDeleteConversation={() => selected && deleteConversation(selected.id)}`
- Wherever `ChatView` receives a delete-message callback, pass `deleteMessage`
- Wherever `ComposeModal` created a conversation, pass `startConversation`

Run `npx tsc --noEmit` after this step and fix any prop-name mismatches it reports — that is exactly what it is for here.

- [ ] **Step 3: Typecheck and run the full suite**

Run: `npm run typecheck && npm test`
Expected: typecheck clean; all previously passing tests still pass (181 before this plan, plus the 11 added in Tasks 1-3).

- [ ] **Step 4: Verify the desktop page by hand**

This is the risky step of the whole plan — the desktop's send and deletes now travel a different path. Start the app (`npm run dev`), open `/dashboard/conversations`, and confirm:

1. The conversation list loads and is sorted newest-first.
2. Opening a conversation loads its messages and clears its unread badge.
3. Sending a message shows it once — **not twice**. (That is the duplicate-key guard; a regression here shows as a React duplicate-key warning in the console.)
4. Sending to an opted-out contact marks the bubble failed and toasts the reason.
5. Deleting a message removes it.
6. Deleting a conversation removes it and clears the open thread.
7. Open a second browser tab on the same page: deleting a message in one tab now removes it in the other **without a reload** (the widened Realtime subscription).
8. The inbox switcher still filters, and the URL still updates.

- [ ] **Step 5: Commit**

```bash
git add components/conversations/use-conversations.ts components/conversations/conversations-layout.tsx
git commit -m "refactor: extract useConversations hook shared by dashboard and panel

Mutations move from cookie-bound server actions to /api/messages/*, so the
cross-origin extension panel can use the same code path. Widens the messages
Realtime subscription to DELETE so removals propagate between clients."
```

---

### Task 5: Pure row formatting for the panel list

**Files:**
- Create: `components/calls/panel/tabs/messages/conversation-row.ts`
- Create: `components/calls/panel/tabs/messages/conversation-row.test.ts`

**Interfaces:**
- Consumes: `Conversation` from `@/types/conversations`
- Produces: `formatConversationRow(c: Conversation, now?: Date): ConversationRowView`

```ts
type ConversationRowView = {
  title: string
  preview: string
  timeText: string
  lineLabel: string | null
  lineColor: string | null
  unread: boolean
}
```

Mirrors the existing `recent-row.ts` / `recent-row.test.ts` pair in `components/calls/panel/` — pure, testable, no React.

- [ ] **Step 1: Write the failing test**

Create `components/calls/panel/tabs/messages/conversation-row.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { formatConversationRow } from "./conversation-row"
import type { Conversation } from "@/types/conversations"

const NOW = new Date("2026-07-25T12:00:00Z")

function conv(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: "c1",
    phone_number_id: "p1",
    contact_number: "+15550104477",
    last_message_at: "2026-07-25T11:58:00Z",
    last_message_text: "Sounds good, see you then",
    unread_count: 0,
    created_at: "2026-07-01T00:00:00Z",
    phone_numbers: {
      id: "p1",
      label: "Ridgeline",
      phone_number: "+18326501126",
      color: "#3b82f6",
      is_active: true,
    },
    ...overrides,
  }
}

describe("formatConversationRow", () => {
  it("shows the contact number and the brand line", () => {
    const v = formatConversationRow(conv(), NOW)
    expect(v.title).toBe("+15550104477")
    expect(v.lineLabel).toBe("Ridgeline")
    expect(v.lineColor).toBe("#3b82f6")
  })

  it("truncates a long preview to fit the narrow panel", () => {
    const v = formatConversationRow(
      conv({ last_message_text: "x".repeat(80) }),
      NOW
    )
    expect(v.preview.length).toBeLessThanOrEqual(41) // 40 chars + ellipsis
    expect(v.preview.endsWith("…")).toBe(true)
  })

  it("does not truncate a short preview or add an ellipsis", () => {
    const v = formatConversationRow(conv({ last_message_text: "Short" }), NOW)
    expect(v.preview).toBe("Short")
  })

  it("falls back to a placeholder when there is no message text", () => {
    expect(formatConversationRow(conv({ last_message_text: null }), NOW).preview)
      .toBe("No messages yet")
  })

  it("marks a conversation unread when unread_count is positive", () => {
    expect(formatConversationRow(conv({ unread_count: 3 }), NOW).unread).toBe(true)
    expect(formatConversationRow(conv({ unread_count: 0 }), NOW).unread).toBe(false)
  })

  it("uses compact relative times", () => {
    expect(formatConversationRow(conv(), NOW).timeText).toBe("2m")
    expect(
      formatConversationRow(conv({ last_message_at: "2026-07-25T09:00:00Z" }), NOW).timeText
    ).toBe("3h")
  })

  it("shows a weekday inside the last week", () => {
    const v = formatConversationRow(
      conv({ last_message_at: "2026-07-22T09:00:00Z" }),
      NOW
    )
    expect(v.timeText).toMatch(/^[A-Z][a-z]{2}$/)
  })

  it("shows a short date beyond a week", () => {
    const v = formatConversationRow(
      conv({ last_message_at: "2026-06-02T09:00:00Z" }),
      NOW
    )
    expect(v.timeText).toMatch(/Jun/)
  })

  it("survives a conversation with no joined line and no timestamp", () => {
    const v = formatConversationRow(
      conv({ phone_numbers: undefined, last_message_at: null }),
      NOW
    )
    expect(v.lineLabel).toBeNull()
    expect(v.lineColor).toBeNull()
    expect(v.timeText).toBe("")
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run components/calls/panel/tabs/messages`
Expected: FAIL — cannot resolve `./conversation-row`.

- [ ] **Step 3: Implement the formatter**

Create `components/calls/panel/tabs/messages/conversation-row.ts`:

```ts
import { format, isSameDay, differenceInDays } from "date-fns"
import type { Conversation } from "@/types/conversations"

export type ConversationRowView = {
  title: string
  preview: string
  timeText: string
  lineLabel: string | null
  lineColor: string | null
  unread: boolean
}

/** The panel is 340px wide — anything longer than this cannot render on one line. */
const PREVIEW_MAX = 40

function truncate(text: string): string {
  return text.length > PREVIEW_MAX ? `${text.slice(0, PREVIEW_MAX)}…` : text
}

/**
 * Compact relative time for a narrow row: "2m", "3h", "Tue", "Jun 2".
 * date-fns's formatDistanceToNow ("about 2 hours ago") is far too wide here,
 * which is why this does not reuse recent-row.ts's approach.
 */
function compactTime(iso: string | null, now: Date): string {
  if (!iso) return ""
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""

  const mins = Math.floor((now.getTime() - d.getTime()) / 60_000)
  if (mins < 1) return "now"
  if (mins < 60) return `${mins}m`
  if (isSameDay(d, now)) return `${Math.floor(mins / 60)}h`
  if (differenceInDays(now, d) < 7) return format(d, "EEE")
  return format(d, "MMM d")
}

/** Shape one conversation for the panel's Messages list. Pure. */
export function formatConversationRow(
  c: Conversation,
  now: Date = new Date()
): ConversationRowView {
  return {
    title: c.contact_number || "Unknown",
    preview: c.last_message_text ? truncate(c.last_message_text) : "No messages yet",
    timeText: compactTime(c.last_message_at, now),
    lineLabel: c.phone_numbers?.label ?? null,
    lineColor: c.phone_numbers?.color ?? null,
    unread: c.unread_count > 0,
  }
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run components/calls/panel/tabs/messages`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add components/calls/panel/tabs/messages/conversation-row.ts components/calls/panel/tabs/messages/conversation-row.test.ts
git commit -m "feat: pure conversation row formatting for the panel Messages list"
```

---

### Task 6: Fourth tab with unread badge

**Files:**
- Modify: `components/calls/panel/panel-tabs.tsx` (whole file)

**Interfaces:**
- Consumes: nothing
- Produces: `PanelTab` union now includes `"messages"`; `PanelTabs` accepts `badges?: Partial<Record<PanelTab, number>>`

- [ ] **Step 1: Replace the file**

```tsx
"use client"

import { Clock, LayoutGrid, MessageSquare, Settings } from "lucide-react"

export type PanelTab = "dialpad" | "recent" | "messages" | "settings"

const TABS: { id: PanelTab; label: string; Icon: typeof Clock }[] = [
  { id: "dialpad", label: "Dialpad", Icon: LayoutGrid },
  { id: "recent", label: "Recent", Icon: Clock },
  { id: "messages", label: "Messages", Icon: MessageSquare },
  { id: "settings", label: "Settings", Icon: Settings },
]

export function PanelTabs({
  active,
  onChange,
  badges,
}: {
  active: PanelTab
  onChange: (t: PanelTab) => void
  /** Unread counts per tab; only non-zero entries render a badge. */
  badges?: Partial<Record<PanelTab, number>>
}) {
  return (
    <div className="flex border-b border-neutral-800">
      {TABS.map(({ id, label, Icon }) => {
        const count = badges?.[id] ?? 0
        return (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            className={`relative flex flex-1 flex-col items-center gap-1 py-2.5 text-xs font-medium transition ${
              active === id
                ? "text-white"
                : "text-neutral-500 hover:text-neutral-300"
            }`}
            aria-current={active === id}
          >
            <span className="relative">
              <Icon className="h-4 w-4" />
              {count > 0 && (
                <span
                  className="absolute -right-2 -top-1.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-semibold text-white"
                  aria-label={`${count} unread`}
                >
                  {count > 9 ? "9+" : count}
                </span>
              )}
            </span>
            {label}
          </button>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: errors ONLY in `panel-app.tsx`, reporting that `"messages"` is not handled in its tab switch. Task 8 resolves them. If any other file errors, stop and investigate.

- [ ] **Step 3: Commit**

```bash
git add components/calls/panel/panel-tabs.tsx
git commit -m "feat: Messages tab and per-tab unread badge in the panel tab bar"
```

---

### Task 7: Conversation list view

**Files:**
- Create: `components/calls/panel/tabs/messages/conversation-rows.tsx`

**Interfaces:**
- Consumes: `formatConversationRow` (Task 5); `Conversation`, `PhoneNumber` types
- Produces: `<ConversationRows conversations phoneNumbers selectedLine onSelectLine onOpen onCompose />`

- [ ] **Step 1: Create the component**

```tsx
"use client"

import { Plus } from "lucide-react"
import type { Conversation, PhoneNumber } from "@/types/conversations"
import { formatConversationRow } from "./conversation-row"

export const ALL_LINES = "all"

export function ConversationRows({
  conversations,
  phoneNumbers,
  selectedLine,
  onSelectLine,
  onOpen,
  onCompose,
}: {
  conversations: Conversation[]
  phoneNumbers: PhoneNumber[]
  selectedLine: string
  onSelectLine: (id: string) => void
  onOpen: (c: Conversation) => void
  onCompose: () => void
}) {
  const visible =
    selectedLine === ALL_LINES
      ? conversations
      : conversations.filter((c) => c.phone_number_id === selectedLine)

  return (
    <div className="flex h-full flex-col">
      {/* Filter and compose share one row — a separate switcher row would cost
          height the thread cannot spare at 340x360. */}
      <div className="flex items-center gap-2 border-b border-neutral-800 px-2 py-1.5">
        <select
          value={selectedLine}
          onChange={(e) => onSelectLine(e.target.value)}
          className="flex-1 truncate rounded bg-neutral-900 px-1.5 py-1 text-xs text-neutral-300 outline-none"
          aria-label="Filter by line"
        >
          <option value={ALL_LINES}>All lines</option>
          {phoneNumbers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={onCompose}
          className="rounded p-1 text-neutral-400 transition hover:bg-neutral-800 hover:text-white"
          aria-label="New message"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {visible.length === 0 ? (
          <p className="p-4 text-center text-xs text-neutral-500">
            No conversations yet.
          </p>
        ) : (
          visible.map((c) => {
            const v = formatConversationRow(c)
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => onOpen(c)}
                className="flex w-full items-start gap-2 border-b border-neutral-900 px-2 py-2 text-left transition hover:bg-neutral-900"
              >
                <span
                  className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                    v.unread ? "bg-red-500" : "bg-transparent"
                  }`}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    {v.lineColor && (
                      <span
                        className="h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ backgroundColor: v.lineColor }}
                      />
                    )}
                    <span
                      className={`truncate text-xs ${
                        v.unread ? "font-semibold text-white" : "text-neutral-300"
                      }`}
                    >
                      {v.title}
                    </span>
                  </span>
                  <span className="block truncate text-[11px] text-neutral-500">
                    {v.preview}
                  </span>
                </span>
                <span className="shrink-0 text-[10px] text-neutral-600">
                  {v.timeText}
                </span>
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: the same `panel-app.tsx` error from Task 6 and nothing new.

- [ ] **Step 3: Commit**

```bash
git add components/calls/panel/tabs/messages/conversation-rows.tsx
git commit -m "feat: panel conversation list with line filter and compose button"
```

---

### Task 8: Thread view, compose view, and the Messages tab

These three land together because none is independently reviewable — the tab is the only thing that renders the other two, and `panel-app.tsx` will not typecheck until the tab exists.

**Files:**
- Create: `components/calls/panel/tabs/messages/thread-view.tsx`
- Create: `components/calls/panel/tabs/messages/compose-view.tsx`
- Create: `components/calls/panel/tabs/messages-tab.tsx`
- Modify: `components/calls/panel/panel-app.tsx`

**Interfaces:**
- Consumes: `useConversations` (Task 4), `ConversationRows` + `ALL_LINES` (Task 7), `PanelTab` (Task 6)
- Produces: `<MessagesTab supabase phoneNumbers accessToken onUnreadChange />`

- [ ] **Step 1: Create the thread view**

```tsx
"use client"

import { useEffect, useRef, useState } from "react"
import { ArrowLeft, Send, Trash2 } from "lucide-react"
import type { Conversation, Message } from "@/types/conversations"

export function ThreadView({
  conversation,
  messages,
  loading,
  sending,
  onBack,
  onSend,
  onDeleteMessage,
  onDeleteConversation,
}: {
  conversation: Conversation
  messages: Message[]
  loading: boolean
  sending: boolean
  onBack: () => void
  onSend: (body: string) => void
  onDeleteMessage: (id: string) => void
  onDeleteConversation: () => void
}) {
  const [draft, setDraft] = useState("")
  // Two-step inline confirm. A window.confirm modal inside a 340px
  // cross-origin iframe blocks the whole panel and is disproportionate.
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" })
  }, [messages.length])

  function submit() {
    const body = draft.trim()
    if (!body || sending) return
    onSend(body)
    setDraft("")
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1.5 border-b border-neutral-800 px-2 py-1.5">
        <button
          type="button"
          onClick={onBack}
          className="rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-white"
          aria-label="Back to conversations"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <span className="min-w-0 flex-1 truncate text-xs text-neutral-200">
          {conversation.contact_number}
          {conversation.phone_numbers?.label && (
            <span className="text-neutral-500">
              {" · "}
              {conversation.phone_numbers.label}
            </span>
          )}
        </span>
        {confirmingDelete ? (
          <span className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={onDeleteConversation}
              className="rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] font-medium text-red-400"
            >
              Delete?
            </button>
            <button
              type="button"
              onClick={() => setConfirmingDelete(false)}
              className="rounded px-1.5 py-0.5 text-[10px] text-neutral-400"
            >
              Cancel
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmingDelete(true)}
            className="rounded p-1 text-neutral-500 hover:bg-neutral-800 hover:text-red-400"
            aria-label="Delete conversation"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <div className="flex-1 space-y-1.5 overflow-y-auto px-2 py-2">
        {loading ? (
          <p className="text-center text-xs text-neutral-500">Loading…</p>
        ) : messages.length === 0 ? (
          <p className="text-center text-xs text-neutral-500">No messages yet.</p>
        ) : (
          messages.map((m) => {
            const outbound = m.direction === "outbound"
            return (
              <div
                key={m.id}
                className={`group flex items-center gap-1 ${
                  outbound ? "justify-end" : "justify-start"
                }`}
              >
                {outbound && (
                  <button
                    type="button"
                    onClick={() => onDeleteMessage(m.id)}
                    className="shrink-0 p-0.5 text-neutral-600 opacity-0 transition group-hover:opacity-100 hover:text-red-400"
                    aria-label="Delete message"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
                <span
                  className={`max-w-[80%] rounded-lg px-2 py-1 text-[11px] ${
                    outbound
                      ? m.status === "delivery_failed"
                        ? "bg-red-500/15 text-red-300"
                        : "bg-sky-600 text-white"
                      : "bg-neutral-800 text-neutral-200"
                  }`}
                >
                  {m.body}
                  {m.status === "delivery_failed" && (
                    <span className="mt-0.5 block text-[9px] opacity-80">
                      Not delivered
                    </span>
                  )}
                </span>
                {!outbound && (
                  <button
                    type="button"
                    onClick={() => onDeleteMessage(m.id)}
                    className="shrink-0 p-0.5 text-neutral-600 opacity-0 transition group-hover:opacity-100 hover:text-red-400"
                    aria-label="Delete message"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </div>
            )
          })
        )}
        <div ref={bottomRef} />
      </div>

      <div className="flex items-center gap-1.5 border-t border-neutral-800 px-2 py-1.5">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
          }}
          placeholder="Message…"
          className="flex-1 rounded bg-neutral-900 px-2 py-1 text-xs text-white outline-none placeholder:text-neutral-600"
        />
        <button
          type="button"
          onClick={submit}
          disabled={!draft.trim() || sending}
          className="rounded bg-sky-600 p-1.5 text-white transition disabled:opacity-40"
          aria-label="Send message"
        >
          <Send className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create the compose view**

```tsx
"use client"

import { useState } from "react"
import { ArrowLeft } from "lucide-react"
import type { PhoneNumber } from "@/types/conversations"

/** Loose E.164: leading +, 8–15 digits. Server-side validation is authoritative. */
const E164 = /^\+[1-9]\d{7,14}$/

export function ComposeView({
  phoneNumbers,
  onBack,
  onSubmit,
}: {
  phoneNumbers: PhoneNumber[]
  onBack: () => void
  onSubmit: (input: {
    phoneNumberId: string
    contactNumber: string
    body: string
  }) => void
}) {
  const [to, setTo] = useState("")
  const [lineId, setLineId] = useState(phoneNumbers[0]?.id ?? "")
  const [body, setBody] = useState("")
  const [error, setError] = useState<string | null>(null)

  function submit() {
    const number = to.trim()
    if (!E164.test(number)) {
      setError("Enter a number like +15550104477.")
      return
    }
    if (!body.trim()) {
      setError("Message can't be empty.")
      return
    }
    setError(null)
    onSubmit({ phoneNumberId: lineId, contactNumber: number, body: body.trim() })
  }

  if (phoneNumbers.length === 0) {
    return (
      <div className="flex h-full flex-col">
        <Header onBack={onBack} />
        <p className="p-4 text-center text-xs text-neutral-500">
          No phone lines are set up for your account yet.
        </p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <Header onBack={onBack} />
      <div className="flex-1 space-y-2 overflow-y-auto p-2">
        <label className="block">
          <span className="mb-0.5 block text-[10px] text-neutral-500">To</span>
          <input
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="+15550104477"
            className="w-full rounded bg-neutral-900 px-2 py-1 text-xs text-white outline-none placeholder:text-neutral-600"
          />
        </label>
        <label className="block">
          <span className="mb-0.5 block text-[10px] text-neutral-500">From</span>
          <select
            value={lineId}
            onChange={(e) => setLineId(e.target.value)}
            className="w-full rounded bg-neutral-900 px-2 py-1 text-xs text-white outline-none"
          >
            {phoneNumbers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Message…"
          rows={3}
          className="w-full resize-none rounded bg-neutral-900 px-2 py-1 text-xs text-white outline-none placeholder:text-neutral-600"
        />
        {error && <p className="text-[10px] text-red-400">{error}</p>}
        <button
          type="button"
          onClick={submit}
          className="w-full rounded bg-sky-600 py-1.5 text-xs font-medium text-white"
        >
          Send
        </button>
      </div>
    </div>
  )
}

function Header({ onBack }: { onBack: () => void }) {
  return (
    <div className="flex items-center gap-1.5 border-b border-neutral-800 px-2 py-1.5">
      <button
        type="button"
        onClick={onBack}
        className="rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-white"
        aria-label="Back to conversations"
      >
        <ArrowLeft className="h-4 w-4" />
      </button>
      <span className="text-xs text-neutral-200">New message</span>
    </div>
  )
}
```

- [ ] **Step 3: Create the Messages tab**

```tsx
"use client"

import { useEffect, useState } from "react"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Conversation, PhoneNumber } from "@/types/conversations"
import { useConversations } from "@/components/conversations/use-conversations"
import { ConversationRows, ALL_LINES } from "./messages/conversation-rows"
import { ThreadView } from "./messages/thread-view"
import { ComposeView } from "./messages/compose-view"

type View = "list" | "thread" | "compose"

export function MessagesTab({
  supabase,
  phoneNumbers,
  accessToken,
  onUnreadChange,
}: {
  supabase: SupabaseClient
  phoneNumbers: PhoneNumber[]
  accessToken: string | undefined
  onUnreadChange: (count: number) => void
}) {
  const {
    conversations,
    selected,
    messages,
    loadingMessages,
    sending,
    totalUnread,
    selectConversation,
    clearSelection,
    send,
    startConversation,
    deleteMessage,
    deleteConversation,
    refresh,
  } = useConversations({
    supabase,
    phoneNumbers,
    initialConversations: [],
    accessToken,
  })

  const [view, setView] = useState<View>("list")
  const [line, setLine] = useState(ALL_LINES)

  // The dashboard is handed a server-rendered list; the panel has none, so it
  // must fetch its own on mount or the list stays empty until a focus event.
  useEffect(() => {
    refresh()
  }, [refresh])

  // Lift the badge count to the tab bar.
  useEffect(() => {
    onUnreadChange(totalUnread)
  }, [totalUnread, onUnreadChange])

  async function open(c: Conversation) {
    await selectConversation(c)
    setView("thread")
  }

  function back() {
    clearSelection()
    setView("list")
  }

  async function compose(input: {
    phoneNumberId: string
    contactNumber: string
    body: string
  }) {
    const conversationId = await startConversation({
      phoneNumberId: input.phoneNumberId,
      contactNumber: input.contactNumber,
    })
    if (!conversationId) return

    // `conversations` in this closure is from the render before
    // startConversation's refresh landed, so the new row may not be in it yet.
    // Build the minimum viable row rather than depending on that timing.
    const created: Conversation =
      conversations.find((c) => c.id === conversationId) ?? {
        id: conversationId,
        phone_number_id: input.phoneNumberId,
        contact_number: input.contactNumber,
        last_message_at: null,
        last_message_text: null,
        unread_count: 0,
        created_at: new Date().toISOString(),
      }

    await selectConversation(created)
    setView("thread")
    // Pass `created` explicitly — selectConversation's state has not committed
    // yet, so send() would otherwise see a stale null selection and no-op.
    await send(input.body, created)
  }

  if (view === "compose") {
    return (
      <ComposeView
        phoneNumbers={phoneNumbers}
        onBack={() => setView("list")}
        onSubmit={compose}
      />
    )
  }

  if (view === "thread" && selected) {
    return (
      <ThreadView
        conversation={selected}
        messages={messages}
        loading={loadingMessages}
        sending={sending}
        onBack={back}
        onSend={send}
        onDeleteMessage={deleteMessage}
        onDeleteConversation={async () => {
          await deleteConversation(selected.id)
          setView("list")
        }}
      />
    )
  }

  return (
    <ConversationRows
      conversations={conversations}
      phoneNumbers={phoneNumbers}
      selectedLine={line}
      onSelectLine={setLine}
      onOpen={open}
      onCompose={() => setView("compose")}
    />
  )
}
```

- [ ] **Step 4: Wire it into `panel-app.tsx`**

`panel-app.tsx` already holds `supabase` (line 27), `session` / `accessToken` (lines 29, 44), `phoneNumbers` (line 31), and the active-tab state. Add unread state beside them:

```tsx
const [messagesUnread, setMessagesUnread] = useState(0)
```

Pass it to the tab bar:

```tsx
<PanelTabs active={tab} onChange={setTab} badges={{ messages: messagesUnread }} />
```

And add the branch alongside the existing tab renders:

```tsx
{tab === "messages" && (
  <MessagesTab
    supabase={supabase}
    phoneNumbers={phoneNumbers}
    accessToken={accessToken}
    onUnreadChange={setMessagesUnread}
  />
)}
```

Import it: `import { MessagesTab } from "./tabs/messages-tab"`.

Note the tab content area must be able to fill the panel — if the existing tab container is not already `flex-1` with `overflow-hidden`, add those classes, since all three Messages views use `h-full`.

- [ ] **Step 5: Typecheck and run the suite**

Run: `npm run typecheck && npm test`
Expected: typecheck clean — the `panel-app.tsx` errors from Task 6 are now resolved. All tests pass.

- [ ] **Step 6: Commit**

```bash
git add components/calls/panel/tabs/messages-tab.tsx components/calls/panel/tabs/messages components/calls/panel/panel-app.tsx
git commit -m "feat: Messages tab with thread, compose, and delete in the call panel"
```

---

### Task 9: End-to-end verification

> **Step 1 (widget resize) was dropped during execution.** The Messages tab
> lives in the toolbar popup (`popup.html`, 360×560), not the floating widget
> (`call-widget.html`, 340×220) — the widget is `WidgetPhone`, an in-call
> overlay that renders `null` when idle and has no tabs. Resizing it would do
> nothing for Messages. See the correction at the top of the spec.

**Files:**
- None. Verification only.

**Interfaces:**
- Consumes: everything above
- Produces: nothing

- [ ] **Step 2: Build and verify the web side**

Run: `npm run build`
Expected: `✓ Compiled successfully`.

- [ ] **Step 3: Load the extension and verify end to end**

Run `npm run dev`, then load `extension/` as an unpacked extension at `chrome://extensions` (Developer mode → Load unpacked). **Click the extension's toolbar icon** to open the popup — that is the surface with the tabs. Sign in, and confirm:

1. A **Messages** tab sits between Recent and Settings.
2. The tab shows an unread badge matching the number of conversations with unread messages.
3. The list shows conversations with brand dot, preview, and compact time.
4. The line filter narrows the list; "All lines" restores it.
5. Opening a conversation loads its messages and clears its unread state — and the badge drops.
6. Sending a reply shows it once and it arrives on the recipient's phone.
7. Composing to a new number creates the thread and sends the first message.
8. A malformed number is rejected inline without firing a request.
9. Hovering a message reveals a trash button; deleting removes it.
10. The conversation trash asks "Delete?" inline, and confirming removes the thread and returns to the list.
11. With the website open in another tab, a message sent there appears in the panel live, and one deleted there disappears from the panel live.

- [ ] **Step 4: Commit**

```bash
git add extension/content-widget.js
git commit -m "feat: grow the call widget to 340x360 to fit the Messages tab"
```

---

## Verification

After all tasks:

```bash
npm run typecheck    # clean
npm test             # 181 pre-existing + 20 added by this plan
npm run build        # compiles
```

Manual checklists are Task 4 Step 4 (the desktop regression pass — the riskiest part of this plan, since the dashboard's send and deletes change path) and Task 9 Step 3 (the panel end-to-end pass).

`useConversations` and the four panel components have no automated coverage by design — see Global Constraints.
