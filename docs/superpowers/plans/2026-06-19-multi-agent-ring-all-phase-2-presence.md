# Multi-Agent Ring-All — Phase 2: Presence (Implementation Record)

**Date:** 2026-06-19
**Status:** Implemented (code) — pending manual DB step + deploy + verify
**Design:** `docs/superpowers/specs/2026-06-18-multi-agent-ring-all-design.md` (§Architecture #2, §Data model `agent_presence`)

## Goal

The app heartbeats "online" so the server keeps a live list of which agents can be
rung. This is the input to Phase 3's dial-all fan-out. Phase 2 changes **no call
behavior** — it only adds the presence table, a heartbeat endpoint, and the client
heartbeat. Inbound calls still ring the single shared identity (unchanged).

## Why this ships separately from the credential re-revert

Re-applying per-agent SIP credentials (re-reverting `868bd95`) **must not ship alone**:
agents would register with their own `gencred…` identity while `dialAgent`
(`voice-orchestrator.ts`) still dials the shared `sip:usercontact74348@…` that nobody
registers as — inbound calls would reach no agent. That's why PR #5 was hotfix-reverted
by PR #6 (`hotfix/restore-shared-webrtc-credential`). Per-agent **registration + dialing
must ship together** = Phase 1 + Phase 3. Presence (Phase 2) is independent and safe.

## DB — run BEFORE deploying this code

> **Deploy ordering (learned):** the presence endpoint reads/writes `agent_presence`,
> so the table must exist in Supabase **before** this code is deployed, or heartbeats
> 500. Schema is managed in the Supabase dashboard (no in-repo migrations).

Supabase dashboard → SQL Editor → New query:

```sql
create table if not exists public.agent_presence (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_seen_at timestamptz not null default now()
);

-- Server-only, same lockdown as agent_sip_credentials: enable RLS, add NO
-- policies. The heartbeat goes through /api/calls/presence (authenticates the
-- user, writes with the service-role admin client, which bypasses RLS). No
-- client touches this table directly.
alter table public.agent_presence enable row level security;
```

Verify: `select tablename, rowsecurity from pg_tables where tablename = 'agent_presence';`
→ one row, `rowsecurity = true`.

## Code (this branch)

- **`lib/telnyx/presence.ts`** (+ `presence.test.ts`, 5 tests) — `recordHeartbeat(admin, userId, now?)`
  upserts the agent's row keyed on `user_id`; `getOnlineAgentUserIds(admin, now?, windowSeconds=30)`
  returns ids seen within the freshness window. Cutoff computed in JS (not SQL) so the
  window is explicit and unit-testable. `getOnlineAgentUserIds` is the seam Phase 3's
  fan-out consumes.
- **`lib/auth.ts`** — extracted `getRequestUserId(req)` (cookie session OR `Bearer` token →
  user id). Reused by the presence endpoint; also the resolver the Phase 1 re-apply needs.
- **`app/api/calls/presence/route.ts`** — `POST`: resolve user → `recordHeartbeat` → `{ ok: true }`;
  401 unauth, 500 on failure.
- **`components/calls/hooks/use-webrtc-client.ts`** — heartbeat effect: while `isReady`, POST
  `/api/calls/presence` immediately then every 15s (with the Bearer token for the panel),
  cleared on unmount / disconnect.

## Verification

- `npm test` → 14 passed (incl. 5 new presence tests). `npm run typecheck` → clean.
- Manual (after SQL + deploy): sign in as an agent, open the dialer → a row appears in
  `agent_presence`, `last_seen_at` advances every ~15s. Close the tab → the row stops
  advancing and ages out of the 30s window. Inbound call still rings as before (no
  behavior change).

## Next

Phase 3 — ring-all: `call_agent_legs`, dial each online agent (`getOnlineAgentUserIds` ⋈
`agent_sip_credentials`) in parallel, first-answer-wins, sibling cancellation,
all-failed → voicemail. **Bundle the credential re-revert here** (per-agent register +
per-agent dial together). Use natural ringback (don't answer the caller leg early), NOT
`play_ringtone`-on-bridge.
