# Message & conversation DELETE policies (RLS)

**Run in:** Supabase dashboard → SQL Editor. This repo keeps no migrations, same
convention as `voicemails` and `call_transcript_segments`.

## Why this is needed

`DELETE /api/messages/[id]` and `DELETE /api/messages/conversations/[id]` rely on
RLS for authorization — that was a deliberate constraint of the extension-SMS
plan, which forbade using the admin client so that a delete could not bypass
row-level checks.

But the plan never added the DELETE policies. With RLS enabled and no DELETE
policy, every delete matches zero rows. PostgREST does not treat that as an
error, so the routes used to report success for a delete that never happened —
the message vanished from the UI and came back on refresh.

The routes were fixed in `9c977b0` to return 404 when zero rows are removed, so
the failure is now visible. **This SQL is what makes deletes actually work.**

## Recommended: different scope per operation

The two deletes have very different blast radius, so they get different rules.

**Deleting one message** is routine and low-stakes — an agent clearing a failed
outbound text, which is exactly the case that surfaced this bug. Any
authenticated agent may do it.

**Deleting a conversation** cascades to every message in it and cannot be undone.
That is admin-shaped. It is also the specific hazard the original plan called
out: *"the admin client … would let any authenticated agent delete any
conversation in the system."* Scoping conversation deletes to admins is what
actually delivers that intent — `using (true)` would grant precisely what the
plan was trying to prevent.

```sql
-- Table privilege and RLS policy are separate layers. A policy without the
-- grant still blocks the delete, so grant explicitly. Both are idempotent
-- enough to be safe if already present.
grant delete on public.messages to authenticated;
grant delete on public.conversations to authenticated;

-- A single message: any signed-in agent.
create policy "Authenticated users can delete messages"
  on public.messages for delete
  to authenticated
  using (true);

-- A whole conversation: admins only, because this cascades to every message.
-- is_admin() is wrapped in a SELECT so it evaluates once per statement rather
-- than once per row.
create policy "Admins can delete conversations"
  on public.conversations for delete
  to authenticated
  using ((select public.is_admin()));
```

### Alternative: allow any agent to delete conversations

If admin-only is too restrictive for how the team actually works, replace the
second policy with this and skip the UI change below:

```sql
create policy "Authenticated users can delete conversations"
  on public.conversations for delete
  to authenticated
  using (true);
```

## Verify

```sql
select tablename, policyname, cmd, roles, qual
  from pg_policies
 where tablename in ('messages', 'conversations')
 order by tablename, cmd;
```

Expect a `DELETE` row for each table. Also confirm the grant landed:

```sql
select table_name, privilege_type
  from information_schema.role_table_grants
 where grantee = 'authenticated'
   and table_name in ('messages', 'conversations')
   and privilege_type = 'DELETE';
```

Then test in the app: delete a failed message and refresh. It should stay gone.
There are 19 `delivery_failed` rows available to test on.

## Known consequence if you take the recommended option

A non-admin who tries to delete a conversation will see **"Conversation not
found."** The row exists — they simply are not allowed to remove it — so that
copy is misleading.

Two fixes, either is fine:

1. **Hide the affordance.** Don't render "Delete conversation" in the thread menu
   for non-admins. The dashboard already knows the role (`isAdmin()` in
   `lib/auth.ts`, and `SidebarNav` receives `isAdmin`).
2. **Distinguish 403 from 404** in `app/api/messages/conversations/[id]/route.ts`:
   after a zero-row delete, re-select the row; if it is readable the caller
   lacked permission (403), if not it genuinely does not exist (404).

Doing both is better — hide it so the case is rare, and return the honest status
for when it still happens.
