# Dashboard Contacts / Follow-ups / AI Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface saved contacts, note follow-ups, and AI-answered calls in the dashboard: two new sidebar pages (Contacts, Follow-ups) and an AI badge + "Answered by" filter on the Calls page.

**Architecture:** Mirror the calls-page pattern exactly — server component fetches with the cookie-scoped Supabase client (RLS applies), passes plain props to a `"use client"` page component; pure logic in `lib/` with colocated Vitest tests; writes go through existing channels (`saveContact` → `POST /api/contacts`; dispositions updated under RLS).

**Tech Stack:** Next.js 16 App Router, shadcn/ui (Table, Sheet, Button, Input, Skeleton), date-fns, sonner, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-14-dashboard-contacts-followups-ai-design.md`

## Global Constraints

- **No DB schema changes; no extension/panel changes.** Web deploy only.
- Prettier style: no semicolons, double quotes, 2-space indent.
- Tests cover pure `lib/` modules only (repo has no jsdom); components get manual verification.
- Stage only files each task names — the tree has unrelated uncommitted changes.
- `ContactSheet` changes must default to today's behavior (`allowNumberEdit` optional, default false) — it's used by calls-table and the panel Recent tab.
- Follow-ups are per-agent (RLS `agent_id = auth.uid()`); do not widen visibility.

## File Structure

**New:** `lib/follow-ups.ts` (+test), `app/dashboard/contacts/{page,loading}.tsx`, `components/contacts/contacts-page-client.tsx`, `app/dashboard/follow-ups/{page,loading}.tsx`, `components/follow-ups/follow-ups-page-client.tsx`.
**Modified:** `lib/dispositions.ts` (+test cases), `components/calls/contact-sheet.tsx` (allowNumberEdit), `app/dashboard/calls/page.tsx` (select ai_handled), `components/calls/calls-table.tsx` (AI badge), `components/calls/calls-filter-bar.tsx` + `components/calls/calls-page-client.tsx` (answeredBy filter), `components/sidebar-nav.tsx` (nav items), `types/calls.ts` (AnsweredByFilter type).

---

## Task 1: Pure lib — `groupFollowUps` + `clearFollowUp`

- [ ] Failing tests: `lib/follow-ups.test.ts` — rows sort ascending into `overdue` (< now), `today` (≥ now, same local day), `upcoming` (later days); null `follow_up_at` excluded. Extend `lib/dispositions.test.ts`: `clearFollowUp` issues `update({ follow_up_at: null, updated_at: <iso> }).eq("id", id)` and throws a friendly error on failure (mock idiom: chainable `from→update→eq` like `makeAdmin` in call-logging tests).
- [ ] Implement `lib/follow-ups.ts` (`FollowUpGroups`, `groupFollowUps(rows: Disposition[], now: Date)`) and `clearFollowUp(db: Db, id: string)` in `lib/dispositions.ts`.
- [ ] `npm test` green → commit `feat(follow-ups): grouping logic + clearFollowUp`.

## Task 2: Contacts page

- [ ] `contact-sheet.tsx`: optional `allowNumberEdit` — number `Input` above name, state-seeded, saves typed number; default false preserves current callers.
- [ ] `app/dashboard/contacts/page.tsx`: fetch active phone_numbers + contacts (`id, phone_number_id, contact_number, name, updated_at`, order `updated_at desc`, limit 1000); pass to client.
- [ ] `components/contacts/contacts-page-client.tsx`: header + "Add contact" (ContactSheet with `allowNumberEdit`, empty number), search input (name/number, case-insensitive), Table rows (name, number, line chip via phone_number_id lookup, updated relative, Edit button → ContactSheet fixed-number), empty states, `router.refresh()` on save.
- [ ] `loading.tsx` skeleton (calls-loading style, no stats block).
- [ ] Typecheck → commit `feat(contacts): dashboard contacts directory`.

## Task 3: Follow-ups page

- [ ] `app/dashboard/follow-ups/page.tsx`: fetch `call_dispositions` `.not("follow_up_at", "is", null).order("follow_up_at")` (RLS = own rows) + contact-name map via `buildContactNameMap`; pass rows+names.
- [ ] `components/follow-ups/follow-ups-page-client.tsx`: groups from `groupFollowUps` (recompute on state), section headers with counts (Overdue styled destructive), row = name/number + outcome label + notes + due (absolute + `formatDistanceToNow`), Done button → optimistic remove, `clearFollowUp` via `createClient()` from `@/lib/client`, rollback + toast on error; empty state.
- [ ] `loading.tsx` skeleton.
- [ ] Typecheck → commit `feat(follow-ups): dashboard follow-ups page with mark done`.

## Task 4: AI badge, Answered-by filter, sidebar

- [ ] `types/calls.ts`: `export type AnsweredByFilter = "all" | "ai" | "team"`.
- [ ] `app/dashboard/calls/page.tsx`: add `ai_handled` to SELECT + row mapping.
- [ ] `calls-table.tsx`: `AIBadge` (Bot icon + "AI", `bg-violet-500/15 text-violet-600 dark:text-violet-400` pill); render in desktop icon cluster + mobile status cluster when `call.ai_handled`; expanded `Agent` detail → `"AI assistant"` when set.
- [ ] `calls-filter-bar.tsx`: `answeredBy` in `CallFilters` + "Answered by" select (All / AI assistant / Team).
- [ ] `calls-page-client.tsx`: default `answeredBy: "all"`, filter clause.
- [ ] `sidebar-nav.tsx`: `Contacts` (Users) + `Follow-ups` (CalendarClock) after Calls.
- [ ] Typecheck → commit `feat(calls): AI badge + answered-by filter; nav for contacts/follow-ups`.

## Task 5: Verify

- [ ] `npm run typecheck && npm test && npm run build`; `npx eslint` on all touched files.
- [ ] Manual pass per spec's testing list (dev server) where feasible.
