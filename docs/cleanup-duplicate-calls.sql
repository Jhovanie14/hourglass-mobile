-- One-off cleanup of duplicate call rows created before the dual-logging fix.
-- Run in the Supabase SQL editor. PREVIEW FIRST, then delete.
--
-- Background: before the fix, both the client (WebRTC provider) and the Telnyx
-- voice webhook logged each call. The artifact, confirmed on outbound calls:
--   • a CORRECT client row  → status 'completed', telnyx_call_id IS NULL
--   • a PHANTOM webhook row → status 'failed',    telnyx_call_id IS NOT NULL
-- both for the same number (one with a leading +1) at the same time.
--
-- This script deletes ONLY the phantom 'failed' rows that have a matching
-- 'completed' twin — a signature a legitimate failed call would never have, so
-- real call history is left intact.

-- ── STEP 1: PREVIEW — review these rows before deleting anything ──────────────
select f.id, f.contact_number, f.status, f.telnyx_call_id, f.created_at
from public.calls f
where f.status = 'failed'
  and f.telnyx_call_id is not null
  and exists (
    select 1
    from public.calls c
    where c.status = 'completed'
      and c.telnyx_call_id is null
      and c.phone_number_id = f.phone_number_id
      -- same number, ignoring formatting / leading country code (compare last 10 digits)
      and right(regexp_replace(c.contact_number, '\D', '', 'g'), 10)
        = right(regexp_replace(f.contact_number, '\D', '', 'g'), 10)
      -- created close together (the two loggers fire within seconds)
      and abs(extract(epoch from (c.created_at - f.created_at))) < 120
  )
order by f.created_at desc;

-- ── STEP 2: DELETE — run only after the preview looks right ───────────────────
-- delete from public.calls f
-- where f.status = 'failed'
--   and f.telnyx_call_id is not null
--   and exists (
--     select 1
--     from public.calls c
--     where c.status = 'completed'
--       and c.telnyx_call_id is null
--       and c.phone_number_id = f.phone_number_id
--       and right(regexp_replace(c.contact_number, '\D', '', 'g'), 10)
--         = right(regexp_replace(f.contact_number, '\D', '', 'g'), 10)
--       and abs(extract(epoch from (c.created_at - f.created_at))) < 120
--   );
