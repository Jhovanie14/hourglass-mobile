# Multi-Agent Ring-All — Phase 1: Per-Agent SIP Credentials (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each agent their own Telnyx SIP credential (auto-provisioned on first use, stored server-side, reused forever) instead of the single shared `TELNYX_SIP_USERNAME`/`TELNYX_SIP_PASSWORD`.

**Architecture:** A new server-only table `agent_sip_credentials` maps `user_id → {telnyx_credential_id, sip_username, sip_password}`. A small provisioning module reads that row and, if absent, creates a telephony credential under the existing `hourglass-webrtc` connection via the Telnyx API and stores it (idempotent per user — this avoids the per-session credential leak seen previously). The `/api/calls/webrtc-token` endpoint resolves the authenticated user's id and returns that user's own credential.

**Tech Stack:** TypeScript, Next.js route handler, Telnyx Node SDK (`telnyx.telephonyCredentials`), Supabase (admin/service-role client), Vitest.

**Scope of this plan:** Phase 1 only. After this ships, every agent registers with a distinct SIP identity. Inbound calls still ring a single agent (the ring-all fan-out is Phase 3). This is intentionally behavior-preserving for the current single-agent setup.

---

## File Structure

- DB (Supabase dashboard, not in repo): new table `agent_sip_credentials` + RLS. The project has no in-repo migration tooling, so this is SQL run in the Supabase SQL editor.
- Create `lib/telnyx/agent-credentials.ts` — provisioning logic (`getOrCreateAgentCredential`). One responsibility: return a user's SIP credential, creating+storing it once if needed. Dependencies (Supabase admin client, Telnyx client) are passed in so it is unit-testable.
- Create `lib/telnyx/agent-credentials.test.ts` — unit tests (Vitest includes `lib/**/*.test.ts`).
- Modify `app/api/calls/webrtc-token/route.ts` — resolve the authenticated user's id, call the provisioning module, return `{ login, password }`.

---

## Task 1: Create the `agent_sip_credentials` table (Supabase dashboard)

**This is a manual step — not a git commit.** Run SQL in the Supabase SQL editor.

- [ ] **Step 1: Run the table + RLS SQL**

In the Supabase dashboard → SQL Editor → New query, paste and run:

```sql
create table if not exists public.agent_sip_credentials (
  user_id uuid primary key references auth.users(id) on delete cascade,
  telnyx_credential_id text not null,
  sip_username text not null,
  sip_password text not null,
  created_at timestamptz not null default now()
);

-- Lock the table down: enable RLS and add NO policies. Clients (anon /
-- authenticated) then have no access at all; the service-role key used by
-- createAdminClient() bypasses RLS, so only server code can read/write.
alter table public.agent_sip_credentials enable row level security;
```

- [ ] **Step 2: Verify the table exists and is locked down**

In the SQL editor run:

```sql
select tablename, rowsecurity
from pg_tables where schemaname = 'public' and tablename = 'agent_sip_credentials';
```

Expected: one row, `rowsecurity = true`.

- [ ] **Step 3: Verify clients cannot read it (optional sanity check)**

From the project (Bash), with anon access this should return an error/empty, confirming RLS denies it:

```bash
set -a; source .env.local; set +a
curl -s "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/agent_sip_credentials?select=user_id" \
  -H "apikey: $NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY" \
  -H "Authorization: Bearer $NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
```

Expected: a permission error or `[]` (NOT a list of rows). This confirms the table is not client-readable.

---

## Task 2: Provisioning module `getOrCreateAgentCredential`

**Files:**
- Create: `lib/telnyx/agent-credentials.ts`
- Test: `lib/telnyx/agent-credentials.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `lib/telnyx/agent-credentials.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest"
import { getOrCreateAgentCredential } from "./agent-credentials"

// Build a minimal Supabase-admin-like mock supporting:
//   from(t).select(c).eq(col,val).maybeSingle()  -> { data, error }
//   from(t).insert(row)                           -> { error }
function makeAdmin(opts: {
  existing?: { sip_username: string; sip_password: string } | null
  readErr?: unknown
  writeErr?: unknown
}) {
  const insert = vi.fn().mockResolvedValue({ error: opts.writeErr ?? null })
  const maybeSingle = vi
    .fn()
    .mockResolvedValue({ data: opts.existing ?? null, error: opts.readErr ?? null })
  const eq = vi.fn(() => ({ maybeSingle }))
  const select = vi.fn(() => ({ eq }))
  const from = vi.fn(() => ({ select, insert }))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { client: { from } as any, insert, from }
}

function makeTelnyx(createImpl: ReturnType<typeof vi.fn>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { telephonyCredentials: { create: createImpl } } as any
}

describe("getOrCreateAgentCredential", () => {
  it("returns the stored credential and does NOT call Telnyx when one exists", async () => {
    const admin = makeAdmin({ existing: { sip_username: "u1", sip_password: "p1" } })
    const create = vi.fn()
    const telnyx = makeTelnyx(create)

    const result = await getOrCreateAgentCredential(admin.client, telnyx, "user-1", "conn-1")

    expect(result).toEqual({ login: "u1", password: "p1" })
    expect(create).not.toHaveBeenCalled()
    expect(admin.insert).not.toHaveBeenCalled()
  })

  it("creates, stores, and returns a new credential when none exists", async () => {
    const admin = makeAdmin({ existing: null })
    const create = vi.fn().mockResolvedValue({
      data: { id: "cred-9", sip_username: "u2", sip_password: "p2" },
    })
    const telnyx = makeTelnyx(create)

    const result = await getOrCreateAgentCredential(admin.client, telnyx, "user-2", "conn-1")

    expect(create).toHaveBeenCalledWith({ connection_id: "conn-1", name: "agent-user-2" })
    expect(admin.insert).toHaveBeenCalledWith({
      user_id: "user-2",
      telnyx_credential_id: "cred-9",
      sip_username: "u2",
      sip_password: "p2",
    })
    expect(result).toEqual({ login: "u2", password: "p2" })
  })

  it("throws if the Telnyx response is missing sip fields", async () => {
    const admin = makeAdmin({ existing: null })
    const create = vi.fn().mockResolvedValue({ data: { id: "cred-9" } })
    const telnyx = makeTelnyx(create)

    await expect(
      getOrCreateAgentCredential(admin.client, telnyx, "user-3", "conn-1")
    ).rejects.toThrow(/sip_username/)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- agent-credentials`
Expected: FAIL — module `./agent-credentials` / `getOrCreateAgentCredential` does not exist yet.

- [ ] **Step 3: Implement the module**

Create `lib/telnyx/agent-credentials.ts`:

```ts
import type { createAdminClient } from "@/lib/admin"
import type Telnyx from "telnyx"

type Admin = ReturnType<typeof createAdminClient>

/**
 * Return the agent's SIP credential, creating it once if needed.
 *
 * Idempotent per user: the first call provisions a Telnyx telephony credential
 * under the given connection and stores it; later calls return the stored one.
 * This is deliberately keyed to user_id (not per session) to avoid leaking a
 * new credential on every page load.
 */
export async function getOrCreateAgentCredential(
  admin: Admin,
  telnyx: Telnyx,
  userId: string,
  connectionId: string
): Promise<{ login: string; password: string }> {
  const { data: existing, error: readErr } = await admin
    .from("agent_sip_credentials")
    .select("sip_username, sip_password")
    .eq("user_id", userId)
    .maybeSingle()
  if (readErr) throw readErr
  if (existing) {
    return { login: existing.sip_username, password: existing.sip_password }
  }

  const res = await telnyx.telephonyCredentials.create({
    connection_id: connectionId,
    name: `agent-${userId}`,
  })
  const cred = res.data
  const login = cred?.sip_username
  const password = cred?.sip_password
  if (!cred?.id || !login || !password) {
    throw new Error(
      "Telnyx telephony credential response missing id/sip_username/sip_password"
    )
  }

  const { error: writeErr } = await admin.from("agent_sip_credentials").insert({
    user_id: userId,
    telnyx_credential_id: cred.id,
    sip_username: login,
    sip_password: password,
  })
  if (writeErr) throw writeErr

  return { login, password }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- agent-credentials`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/telnyx/agent-credentials.ts lib/telnyx/agent-credentials.test.ts
git commit -m "feat: per-agent Telnyx SIP credential provisioning (idempotent)"
```

---

## Task 3: Return the per-user credential from the token endpoint

**Files:**
- Modify: `app/api/calls/webrtc-token/route.ts`

- [ ] **Step 1: Replace the boolean auth check with user-id resolution and per-user provisioning**

Replace the entire contents of `app/api/calls/webrtc-token/route.ts` with:

```ts
import { getCurrentUser } from "@/lib/auth"
import { createClient as createSupabaseClient } from "@supabase/supabase-js"
import { createAdminClient } from "@/lib/admin"
import { getTelnyxClient } from "@/lib/telnyx/client"
import { getOrCreateAgentCredential } from "@/lib/telnyx/agent-credentials"

export const runtime = "nodejs"

/** Resolve the authenticated user's id from a cookie session (web app) or a
 *  Bearer access token (extension panel). Returns null if unauthenticated. */
async function getUserId(req: Request): Promise<string | null> {
  // 1. Cookie-based session (the web app). Claims `sub` is the user id.
  const claims = await getCurrentUser()
  if (claims?.sub) return claims.sub as string

  // 2. Bearer access token (the extension panel).
  const authHeader = req.headers.get("authorization") ?? ""
  const token = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : null
  if (!token) return null

  const supabase = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
  )
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user) return null
  return data.user.id
}

export async function GET(req: Request) {
  const userId = await getUserId(req)
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const connectionId = process.env.TELNYX_CREDENTIAL_CONNECTION_ID
  if (!connectionId) {
    return Response.json(
      { error: "TELNYX_CREDENTIAL_CONNECTION_ID not set" },
      { status: 500 }
    )
  }

  try {
    const admin = createAdminClient()
    const telnyx = getTelnyxClient()
    const { login, password } = await getOrCreateAgentCredential(
      admin,
      telnyx,
      userId,
      connectionId
    )
    return Response.json({ login, password })
  } catch (err) {
    console.error("⚠️ Failed to provision/return agent SIP credential:", err)
    return Response.json({ error: "Failed to obtain credential" }, { status: 500 })
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Lint the changed file**

Run: `npm run lint`
Expected: no NEW errors for `app/api/calls/webrtc-token/route.ts` (pre-existing errors in unrelated files may appear; ignore those).

- [ ] **Step 4: Run the full unit test suite (no regressions)**

Run: `npm test`
Expected: PASS — existing suites plus the new `agent-credentials` suite.

- [ ] **Step 5: Commit**

```bash
git add app/api/calls/webrtc-token/route.ts
git commit -m "feat: webrtc-token returns each agent's own SIP credential"
```

---

## Task 4: Manual verification (deployed)

This endpoint depends on a real Telnyx call and the live DB, so verify against a deployment (or `npm run dev` locally with `.env.local`). The Telnyx connection used is `TELNYX_CREDENTIAL_CONNECTION_ID` (`hourglass-webrtc`).

- [ ] **Step 1: First agent loads the dialer**
  - Sign in as agent A, open the dialer.
  - Expected: the WebRTC client connects (no "could not fetch credentials" warning in console).
  - DB check: `select user_id, sip_username, telnyx_credential_id from agent_sip_credentials;` shows one row for agent A.

- [ ] **Step 2: Reload — idempotency**
  - Reload agent A's dialer a few times.
  - Expected: still exactly ONE row for agent A (no new credential per load). Telnyx telephony-credential count does not grow per reload.

- [ ] **Step 3: Second agent gets a distinct credential**
  - Sign in as agent B in a separate browser/profile, open the dialer.
  - Expected: a second row in `agent_sip_credentials` with a DIFFERENT `sip_username` and `telnyx_credential_id`.

- [ ] **Step 4: Current call flow still works (behavior preserved)**
  - Place an inbound call to a routed DID with agent A online.
  - Expected: agent A's browser rings and can answer/connect; no-answer still goes to voicemail. (Still single-agent ring — multi-agent is Phase 3.)

---

## Self-Review Notes

- **Spec coverage (Phase 1 portions):** `agent_sip_credentials` table + RLS (Task 1); idempotent per-user provisioning under the existing connection (Task 2); token endpoint returns the user's own credential (Task 3); behavior-preserving for current single agent (Task 4 Step 4). Presence, `call_agent_legs`, dial-all, ringback swap, and orphan cleanup are explicitly Phases 2/3 + housekeeping — NOT in this plan.
- **Placeholder scan:** none — all steps contain concrete SQL/code/commands.
- **Type consistency:** `getOrCreateAgentCredential(admin, telnyx, userId, connectionId)` returns `{ login, password }` in Task 2 and is called with exactly those args in Task 3. The Telnyx response is read as `res.data.{id,sip_username,sip_password}`, matching `TelephonyCredentialCreateResponse { data?: TelephonyCredential }`.
- **Note:** the shared `TELNYX_SIP_USERNAME`/`TELNYX_SIP_PASSWORD` env vars are no longer read after Task 3. Leave them in place until after verification; their telephony credential is cleaned up in the separate housekeeping task (post-verification).
```
