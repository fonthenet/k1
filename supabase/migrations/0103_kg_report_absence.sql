-- 0103 — a parent's absence report reaches the register.
--
-- ---------------------------------------------------------------------------
-- What is wrong
-- ---------------------------------------------------------------------------
--
-- "Report an absence" in the parent portal opened a message thread — subject
-- 'Absence — Ali Benali — 2026-09-02', in Latin whatever the family's
-- language — and did nothing else. kg_attendance never learned. The child's
-- card on the portal home kept saying "not yet arrived" under the very
-- report the parent had just sent; the office read the message, then typed
-- the same absence into the register by hand; and if an educator pressed
-- "mark all present" before reading the inbox, the child was recorded
-- present for a morning the family had said they were at the doctor's.
--
-- The parent cannot write kg_attendance directly, and must not be able to:
-- policy att_ins/att_upd are kg_is_educator only, which is what keeps the
-- register a staff record with provenance. An .upsert() from the portal
-- would fail with 42501 on any existing row, and opening RLS would let a
-- parent rewrite a row the kiosk had already stamped.
--
-- Production today: 0 absence threads, 68 staff-typed absence_reason rows.
--
-- A second, older gap surfaces here because the new function leans on it:
-- kg_is_open_on (0068) ignores both `closure` and `end_date` on kg_holidays.
-- A confirmed public holiday marked closure = false (the crèche stays open
-- on a bank holiday) closed the day anyway, and a two-week summer closure
-- only closed its first day. The TypeScript side (attendance/dates.ts,
-- attendance/page.tsx) now reads closures correctly, so the SQL rule is
-- brought to the same definition rather than left to drift.
--
-- ---------------------------------------------------------------------------
-- The fix
-- ---------------------------------------------------------------------------
--
-- One SECURITY DEFINER function, kg_report_absence, that a parent may call
-- for their own child only (kg_is_parent_of). It writes an 'excused' or
-- 'sick' row for each OPEN day of the requested range — closed days, from
-- the tenant's own week and confirmed closures via kg_is_open_on, are
-- skipped and counted — with the reason and the reporting guardian on the
-- row, and it opens (or reuses) the conversation with the message the
-- parent typed. An existing row that already carries a check_in_at is left
-- alone: the child is in the building, and the register knows more than the
-- parent's phone does.
--
-- The new column reported_by_guardian_id is the provenance: the register
-- shows "reported by the parent" on such rows in words and nothing else.
-- trg_kg_notify_attendance already skips the self-notification (0049:
-- "a family reporting their own child sick does not need telling") because
-- auth.uid() stays the parent's inside a definer function.
--
-- "Mark all present" needs no change here — it inserts only for children
-- with no row yet, so the parent's row is exactly what stops it.
--
-- ---------------------------------------------------------------------------
-- Data note for the director — NOT acted on by this file
-- ---------------------------------------------------------------------------
--
-- Manually typed check-in / check-out times used to be parsed in the host's
-- zone (attendance/actions.ts, toIso), so a time typed on Vercel (UTC) was
-- stored one hour late in Algiers terms. The code is fixed; the rows are
-- not, on purpose: only rows typed through the dialog have second = 0 and
-- millisecond = 0, but a kiosk stamp can land on a round second too, and
-- one repair too many is worse than five left alone. Please confirm each
-- row below with the office before any -1h correction is written:
--
--   select a.id, a.date, c.first_name, c.last_name,
--          a.check_in_at  at time zone 'Africa/Algiers' as check_in_algiers,
--          a.check_out_at at time zone 'Africa/Algiers' as check_out_algiers,
--          a.check_in_method, a.check_out_method, a.updated_at
--     from kg_attendance a
--     join kg_children c on c.id = a.child_id
--    where a.tenant_id = 'fb050631-e62f-43f1-9e12-933e564974e8'   -- the Jijel client
--      and a.date >= current_date - 30
--      and (   (a.check_in_method  = 'manual' and a.check_in_at  is not null
--               and extract(second from a.check_in_at)  = 0
--               and extract(milliseconds from a.check_in_at)  = 0)
--           or (a.check_out_method = 'manual' and a.check_out_at is not null
--               and extract(second from a.check_out_at) = 0
--               and extract(milliseconds from a.check_out_at) = 0))
--    order by a.date desc, c.last_name;
--
-- On 2026-09-02 this listed 5 rows for the client, including the 2026-08-30
-- arrival stored as 23:40Z on the 29th (00:40 Algiers — typed as 23:40 the
-- previous evening and shifted forward). The demo tenant's seeded rows also
-- match the shape and are not to be touched.

begin;

/* ---------------------------------------------------------- provenance */

alter table kg_attendance
  add column if not exists reported_by_guardian_id uuid
    references kg_guardians(id) on delete set null;

comment on column kg_attendance.reported_by_guardian_id is
  'Set when the family reported this absence from the portal (kg_report_absence). '
  'NULL for everything staff or the kiosk wrote. Cleared when staff override the status.';

/* --------------------------------------------------------- open on day */

-- The weekly pattern says which weekdays; kg_holidays says which dates are
-- shut anyway. A holiday closes the day only when it is CONFIRMED and marked
-- as a closure, and it closes every day of its range, not just the first.
create or replace function kg_is_open_on(p_tenant uuid, p_date date)
returns boolean language sql stable security definer set search_path = public as $fn$
  select coalesce((
    select t.opening_hours -> lower(to_char(p_date, 'Dy')) <> 'null'::jsonb
      from kg_tenants t where t.id = p_tenant
  ), false)
  and not exists (
    select 1 from kg_holidays h
     where h.tenant_id = p_tenant
       and h.closure
       and not h.tentative
       and p_date between h.date and coalesce(h.end_date, h.date)
  );
$fn$;

comment on function kg_is_open_on(uuid, date) is
  'Is the crèche open on this date: the tenant''s weekly pattern minus confirmed '
  'closures (closure = true, tentative = false), ranges included. The one rule '
  'attendance/dates.ts mirrors in TypeScript.';

/* ------------------------------------------------------ report absence */

create or replace function kg_report_absence(
  p_child   uuid,
  p_from    date,
  p_to      date,
  p_status  kg_attendance_status,
  p_reason  text,
  p_subject text,
  p_body    text
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_child    kg_children;
  v_guardian uuid;
  v_today    date := kg_today();
  v_thread   uuid;
  v_day      date;
  v_touched  int;
  v_recorded int := 0;
  v_kept     int := 0;
  v_closed   int := 0;
begin
  if auth.uid() is null then raise exception 'forbidden'; end if;
  if not kg_is_parent_of(p_child) then raise exception 'forbidden'; end if;

  select * into v_child from kg_children where id = p_child and status = 'enrolled';
  if v_child.id is null then raise exception 'forbidden'; end if;

  -- A parent reports that the child is away, not that they were on time.
  if p_status not in ('excused', 'sick') then raise exception 'invalid_status'; end if;

  -- Yesterday through fourteen days ahead, at most fourteen days long. Today
  -- is the crèche's today, not the server's.
  if p_from is null or p_to is null or p_to < p_from
     or p_from < v_today - 1 or p_from > v_today + 14
     or p_to > v_today + 14 or p_to > p_from + 13 then
    raise exception 'window';
  end if;

  if nullif(btrim(coalesce(p_reason, '')), '') is null or length(p_reason) > 500 then
    raise exception 'invalid_reason';
  end if;
  if nullif(btrim(coalesce(p_subject, '')), '') is null or length(p_subject) > 200 then
    raise exception 'invalid_subject';
  end if;
  if nullif(btrim(coalesce(p_body, '')), '') is null or length(p_body) > 5000 then
    raise exception 'invalid_body';
  end if;

  -- Which of the child's guardians is speaking: the one this login belongs to.
  select g.id into v_guardian
    from kg_guardians g
    join kg_child_guardians cg on cg.guardian_id = g.id
   where cg.child_id = p_child and g.user_id = auth.uid()
   limit 1;

  v_day := p_from;
  while v_day <= p_to loop
    if kg_is_open_on(v_child.tenant_id, v_day) then
      -- Insert, or take over a row that has no arrival yet. A row with a
      -- check_in_at is the kiosk's or the office's word that the child is
      -- here; the report is kept as a message and the row is left as it is.
      insert into kg_attendance
        (tenant_id, child_id, date, status, absence_reason, reported_by_guardian_id)
      values
        (v_child.tenant_id, p_child, v_day, p_status, btrim(p_reason), v_guardian)
      on conflict (child_id, date) do update
        set status                  = excluded.status,
            absence_reason          = excluded.absence_reason,
            reported_by_guardian_id = excluded.reported_by_guardian_id
        where kg_attendance.check_in_at is null;
      get diagnostics v_touched = row_count;
      if v_touched > 0 then v_recorded := v_recorded + 1;
      else v_kept := v_kept + 1;
      end if;
    else
      v_closed := v_closed + 1;
    end if;
    v_day := v_day + 1;
  end loop;

  -- The conversation. Reused when this parent already opened one with the
  -- same subject, so a double tap (or a corrected reason) lands as a second
  -- message in one thread rather than two threads in the office's inbox.
  select th.id into v_thread
    from kg_threads th
   where th.tenant_id = v_child.tenant_id
     and th.child_id = p_child
     and th.created_by = auth.uid()
     and th.subject = btrim(p_subject)
   order by th.created_at desc
   limit 1;

  if v_thread is null then
    insert into kg_threads (tenant_id, child_id, subject, created_by)
    values (v_child.tenant_id, p_child, btrim(p_subject), auth.uid())
    returning id into v_thread;
  end if;

  -- trg_kg_notify_thread_message tells the office; trg_kg_thread_message_activity
  -- bumps last_message_at. Nothing here duplicates either.
  insert into kg_thread_messages (thread_id, tenant_id, sender_id, body)
  values (v_thread, v_child.tenant_id, auth.uid(), btrim(p_body));

  return jsonb_build_object(
    'thread_id', v_thread,
    'recorded', v_recorded,
    'kept', v_kept,
    'closed', v_closed
  );
end $$;

comment on function kg_report_absence(uuid, date, date, kg_attendance_status, text, text, text) is
  'Parent-side absence report: writes excused/sick rows for every open day of '
  'the range (closed days skipped, rows with a check_in_at kept) and opens or '
  'reuses the conversation. Returns {thread_id, recorded, kept, closed}.';

-- Definer functions are executable by PUBLIC unless told otherwise.
revoke all on function kg_report_absence(uuid, date, date, kg_attendance_status, text, text, text)
  from public, anon;
grant execute on function kg_report_absence(uuid, date, date, kg_attendance_status, text, text, text)
  to authenticated;

commit;
