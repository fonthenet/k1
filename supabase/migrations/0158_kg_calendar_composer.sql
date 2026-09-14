-- 0158 — one composer for every dated thing: kg_calendar().
--
-- The staff month/week/day, the portal calendar and the portal home call this
-- one function and draw by `kind` (the dashboard's next-closure line and the
-- other closure readers go through lib/closures.ts over kg_holidays: one
-- predicate, package B). SECURITY INVOKER: each base read is narrowed by RLS
-- exactly as it is today (precedent kg_bookings, 0155), so an educator, an
-- accountant and a parent get different rows from the same call and the
-- function adds no permission of its own. Two narrow SECURITY DEFINER helpers
-- give a FAMILY the dates RLS hides behind `published` (a therapy appointment,
-- a test or exam date) — calendar columns only, gated by kg_is_parent_of,
-- never a clinical column. The owner can withdraw that decision by dropping
-- those two functions and nothing else: the union branches then return no rows.
--
-- The function returns FACTS, never colour: the app derives the register from
-- kind + tentative + cancelled + closure. Markers (invoice_due) fold rows into
-- one item with a count. Multi-day items are one row with date..last_date and
-- date <= last_date always holds (asserted below).
begin;
set local lock_timeout = '5s';

-- ── 1. Indexes the new branches need ───────────────────────────────────────
create index if not exists kg_invoices_tenant_due_open_idx
  on public.kg_invoices (tenant_id, due_date) where status in ('sent', 'unpaid', 'partial', 'overdue');
create index if not exists kg_applications_tenant_interview_idx
  on public.kg_applications (tenant_id, interview_at) where interview_at is not null;
create index if not exists kg_leave_requests_tenant_span_idx
  on public.kg_leave_requests (tenant_id, start_date, end_date);
create index if not exists kg_notifications_event_id_idx
  on public.kg_notifications ((data->>'eventId')) where type = 'event';

-- ── 2. The shape every reader consumes ─────────────────────────────────────
do $$ begin
  create type public.kg_calendar_item as (
    id            text,        -- '<kind>:<source id>' — activity occurrences add ':<yyyy-mm-dd>' (and ':<child>' for a family), family assessments add ':<child>', markers use the day
    kind          text,        -- holiday|event|lesson|session|activity|assessment|task|leave|interview|birthday|invoice_due|payroll
    date          date,        -- first Algiers day inside the window
    last_date     date,        -- last Algiers day inside the window (= date for a timed item); never < date
    starts_at     timestamptz, -- null when all_day
    ends_at       timestamptz,
    all_day       boolean,
    title         text,
    title_ar      text,
    subtitle      text,        -- room / class / child / person, raw; the app picks _ar by locale
    subtitle_ar   text,
    source_id     uuid,
    structure_id  uuid,        -- an event's own, or its class's when the event is class-scoped
    class_id      uuid,
    child_id      uuid,        -- the family's child this concerns; a session's or birthday's child for staff
    room_id       uuid,
    membership_id uuid,        -- teacher / therapist / assignee / person on leave
    tentative     boolean,     -- tentative holiday, pending leave, draft payroll
    cancelled     boolean,     -- cancelled lesson / session / event
    closure       boolean,     -- holiday rows: the door is shut
    count         integer,     -- markers: rows folded into this item
    meta          jsonb        -- kind-specific facts the hover card names (see kg_calendar's comment)
  );
exception when duplicate_object then null; end $$;

-- ── 3. The family helpers (definer, narrow) ────────────────────────────────
-- A therapy appointment the family must bring the child to. `published` on
-- kg_sessions is the OUTCOME text (parent_summary), not the appointment, so
-- ss_sel hides every upcoming session from its own family; this returns the
-- appointment columns only. Staff never reach it (they read kg_sessions).
create or replace function public.kg_family_appointments(p_tenant uuid, p_from timestamptz, p_to timestamptz)
returns setof public.kg_calendar_item
language sql stable security definer set search_path = pg_catalog, public as $$
  select 'session:' || s.id, 'session',
         (s.scheduled_at at time zone 'Africa/Algiers')::date,
         (s.scheduled_at at time zone 'Africa/Algiers')::date,
         s.scheduled_at, s.scheduled_at + s.duration_min * interval '1 minute', false,
         s.session_type::text, null::text,
         kg_member_name(s.therapist_id), null::text,
         s.id, ch.structure_id, ch.class_id, s.child_id, s.room_id, s.therapist_id,
         false, s.status = 'cancelled', false, 1,
         jsonb_build_object('sessionType', s.session_type, 'status', s.status, 'published', s.published,
                            'childName', ch.first_name || ' ' || ch.last_name,
                            'childNameAr', nullif(trim(coalesce(ch.first_name_ar, '') || ' ' || coalesce(ch.last_name_ar, '')), ''))
    from kg_sessions s join kg_children ch on ch.id = s.child_id
   where s.tenant_id = p_tenant
     and s.scheduled_at >= p_from and s.scheduled_at < p_to
     and s.status in ('scheduled', 'completed', 'cancelled')
     and not kg_is_staff(p_tenant) and kg_is_parent_of(s.child_id)
$$;
revoke all on function public.kg_family_appointments(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.kg_family_appointments(uuid, timestamptz, timestamptz) to authenticated;

-- The DATE of a test or exam is announced before it is graded; the results
-- stay behind learning_assessment_read as today. Observations are the
-- educator's instrument and never reach a family calendar. One row per child
-- of the family in that class, each with its own id (React keys, the child
-- switcher), never two rows sharing 'assessment:<id>'.
create or replace function public.kg_family_assessment_dates(p_tenant uuid, p_from date, p_to date)
returns setof public.kg_calendar_item
language sql stable security definer set search_path = pg_catalog, public as $$
  select 'assessment:' || x.id || ':' || ch.id, 'assessment', x.scheduled_on, x.scheduled_on,
         null::timestamptz, null::timestamptz, true,
         x.title, null::text, c.name, c.name_ar,
         x.id, c.structure_id, x.class_id, ch.id, null::uuid, null::uuid,
         false, false, false, 1,
         jsonb_build_object('assessmentKind', x.kind, 'published', x.published)
    from kg_learning_assessments x
    join kg_classes c on c.id = x.class_id
    join kg_children ch on ch.class_id = x.class_id and ch.status = 'enrolled'
   where x.tenant_id = p_tenant and x.kind in ('test', 'exam')
     and x.scheduled_on between p_from and p_to
     and not kg_is_staff(p_tenant) and kg_is_parent_of(ch.id)
$$;
revoke all on function public.kg_family_assessment_dates(uuid, date, date) from public, anon;
grant execute on function public.kg_family_assessment_dates(uuid, date, date) to authenticated;

-- A person's display name for the calendar's own tenant. kg_member_name (0044)
-- reads the profile behind a membership with no check of its own, which is
-- why 0087 keeps it off `authenticated`; the composer runs as the caller, so
-- it needs a door that checks: the caller must be a member of the tenant and
-- the membership must belong to it. Same resolution as kg_member_name.
create or replace function public.kg_member_name_in(p_tenant uuid, p_membership uuid) returns text
language sql stable security definer set search_path = pg_catalog, public as $$
  select case when kg_is_member(p_tenant) then kg_member_name(m.id) end
    from kg_memberships m
   where m.id = p_membership and m.tenant_id = p_tenant
$$;
revoke all on function public.kg_member_name_in(uuid, uuid) from public, anon;
grant execute on function public.kg_member_name_in(uuid, uuid) to authenticated;

-- ── 4. The composer ────────────────────────────────────────────────────────
-- p_kinds null = every kind the caller may read. p_structure = the rail's
-- scope (null = the building), applied as scoped() does: a row with no
-- structure belongs to everyone; a class-scoped event takes its class's
-- structure. p_scope 'mine' narrows lessons (my own or my classes'), sessions
-- (my therapist_id), tasks (my assignee_id) to the caller's membership; leave
-- is already own-or-admin by RLS.
create or replace function public.kg_calendar(
  p_tenant uuid, p_from date, p_to date,
  p_kinds text[] default null, p_structure uuid default null, p_scope text default 'all')
returns setof public.kg_calendar_item
language plpgsql stable security invoker set search_path = pg_catalog, public as $$
declare
  v_from  timestamptz := (p_from::timestamp) at time zone 'Africa/Algiers';
  v_to    timestamptz := ((p_to + 1)::timestamp) at time zone 'Africa/Algiers';
  v_today date := (now() at time zone 'Africa/Algiers')::date;
  v_staff boolean := kg_is_staff(p_tenant);
  v_me    uuid;
begin
  if p_to < p_from or p_to - p_from > 62 then
    raise exception 'kg_calendar: window must be at most 62 days' using errcode = '22023';
  end if;
  if p_scope not in ('all', 'mine') then
    raise exception 'kg_calendar: scope must be all or mine' using errcode = '22023';
  end if;
  select m.id into v_me from kg_memberships m
   where m.tenant_id = p_tenant and m.user_id = auth.uid() and m.status = 'active' and m.role <> 'parent'
   limit 1;

  return query
  -- holidays: one row per holiday, clipped to the window; scoped like scoped()
  select 'holiday:' || h.id, 'holiday',
         greatest(h.date, p_from), least(coalesce(h.end_date, h.date), p_to),
         null::timestamptz, null::timestamptz, true,
         h.name, h.name_ar, null::text, null::text,
         h.id, h.structure_id, null::uuid, null::uuid, null::uuid, null::uuid,
         h.tentative, false, h.closure, 1,
         jsonb_build_object('holidayKind', h.kind, 'from', h.date, 'to', coalesce(h.end_date, h.date))
    from kg_holidays h
   where h.tenant_id = p_tenant
     and h.date <= p_to and coalesce(h.end_date, h.date) >= p_from
     and (p_structure is null or h.structure_id is null or h.structure_id = p_structure)
     and (p_kinds is null or 'holiday' = any(p_kinds))
  union all
  -- events: ev_sel already answers "which family sees it"; cancelled rows stay,
  -- struck. Half-open window: an all-day row ending at 00:00 of p_from is not
  -- in the window (its exclusive end is the window's start). A class-scoped
  -- event belongs to its class's structure for the rail and the dot.
  select 'event:' || e.id, 'event',
         greatest((e.start_at at time zone 'Africa/Algiers')::date, p_from),
         least(((coalesce(e.end_at, e.start_at) - case when e.all_day then interval '1 second' else interval '0' end)
                 at time zone 'Africa/Algiers')::date, p_to),
         case when e.all_day then null else e.start_at end,
         case when e.all_day then null else e.end_at end,
         e.all_day,
         e.title, null::text, r.name, r.name_ar,
         e.id, coalesce(e.structure_id, c.structure_id), e.class_id, null::uuid, e.room_id, null::uuid,
         false, e.cancelled_at is not null, false, 1,
         jsonb_build_object('audience', e.audience, 'rsvp', e.rsvp, 'description', e.description,
                            'cancelledAt', e.cancelled_at, 'className', c.name, 'classNameAr', c.name_ar)
    from kg_events e
    left join kg_rooms r on r.id = e.room_id
    left join kg_classes c on c.id = e.class_id
   where e.tenant_id = p_tenant
     and e.start_at < v_to
     and (case when e.end_at is null then e.start_at >= v_from else e.end_at > v_from end)
     and (p_structure is null or coalesce(e.structure_id, c.structure_id) is null
          or coalesce(e.structure_id, c.structure_id) = p_structure)
     and (p_kinds is null or 'event' = any(p_kinds))
  union all
  -- lessons (cours): staff by RLS, a family its child's class; 'mine' = my own or my classes'
  select 'lesson:' || l.id, 'lesson',
         (l.starts_at at time zone 'Africa/Algiers')::date, (l.starts_at at time zone 'Africa/Algiers')::date,
         l.starts_at, l.ends_at, false,
         l.title, null::text, c.name, c.name_ar,
         l.id, c.structure_id, l.class_id, null::uuid, coalesce(l.room_id, c.room_id), l.membership_id,
         false, l.status = 'cancelled', false, 1,
         jsonb_build_object('lessonKind', l.kind, 'status', l.status, 'programId', l.program_id,
                            'roomInherited', l.room_id is null, 'teacher', kg_member_name_in(p_tenant, l.membership_id))
    from kg_learning_lessons l join kg_classes c on c.id = l.class_id
   where l.tenant_id = p_tenant
     and l.starts_at < v_to and l.ends_at > v_from
     and (p_structure is null or c.structure_id is null or c.structure_id = p_structure)
     and (p_scope <> 'mine' or l.membership_id = v_me
          or exists (select 1 from kg_class_staff cs where cs.class_id = l.class_id and cs.membership_id = v_me))
     and (p_kinds is null or 'lesson' = any(p_kinds))
  union all
  -- sessions (individual follow-ups): staff by RLS; the family through the helper below
  select 'session:' || s.id, 'session',
         (s.scheduled_at at time zone 'Africa/Algiers')::date, (s.scheduled_at at time zone 'Africa/Algiers')::date,
         s.scheduled_at, s.scheduled_at + s.duration_min * interval '1 minute', false,
         s.session_type::text, null::text,
         ch.first_name || ' ' || ch.last_name,
         nullif(trim(coalesce(ch.first_name_ar, '') || ' ' || coalesce(ch.last_name_ar, '')), ''),
         s.id, ch.structure_id, ch.class_id, s.child_id, s.room_id, s.therapist_id,
         false, s.status = 'cancelled', false, 1,
         jsonb_build_object('sessionType', s.session_type, 'status', s.status, 'published', s.published,
                            'therapist', kg_member_name_in(p_tenant, s.therapist_id))
    from kg_sessions s join kg_children ch on ch.id = s.child_id
   where s.tenant_id = p_tenant and v_staff
     and s.scheduled_at >= v_from and s.scheduled_at < v_to
     and (p_structure is null or ch.structure_id is null or ch.structure_id = p_structure)
     and (p_scope <> 'mine' or s.therapist_id = v_me)
     and (p_kinds is null or 'session' = any(p_kinds))
  union all
  select * from kg_family_appointments(p_tenant, v_from, v_to)
   where (p_kinds is null or 'session' = any(p_kinds))
  union all
  -- activities: weekly slots expanded per open day, exactly as kg_bookings does
  -- (0155), WITHOUT the room predicate — Natation has no room and still happens.
  -- Staff: every active activity, one row per slot per day. Family: one row per
  -- child of theirs actively enrolled that day (ae_sel narrows to their own
  -- children; two siblings in one activity are two rows, so the child switcher
  -- never hides one of them).
  select 'activity:' || a.id || ':' || to_char(days.day, 'YYYY-MM-DD') || coalesce(':' || enr.child_id::text, ''), 'activity',
         days.day, days.day, occ.starts, occ.ends, false,
         a.name, a.name_ar, r.name, r.name_ar,
         a.id, a.structure_id, null::uuid, enr.child_id, a.room_id, null::uuid,
         false, false, false, 1,
         jsonb_build_object('slot', jsonb_build_object('dow', s.dow, 'start', s.starts, 'end', s.ends))
    from kg_activities a
    left join kg_rooms r on r.id = a.room_id
    cross join lateral kg_activity_slots(a.schedule) s
    cross join lateral (select g::date as day from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') g) days
    cross join lateral (select (days.day + s.starts) at time zone 'Africa/Algiers' as starts,
                               (days.day + s.ends)   at time zone 'Africa/Algiers' as ends) occ
    cross join lateral (
      select null::uuid as child_id where v_staff
      union all
      select ae.child_id from kg_activity_enrollments ae
       where not v_staff and ae.activity_id = a.id and ae.status = 'active'
         and (ae.end_date is null or ae.end_date >= days.day)
         and (ae.start_date is null or ae.start_date <= days.day)) enr
   where a.tenant_id = p_tenant and a.active
     and s.dow = extract(dow from days.day)::int
     and not kg_structure_closed_on(a.structure_id, a.tenant_id, days.day)
     and (p_structure is null or a.structure_id is null or a.structure_id = p_structure)
     and (p_kinds is null or 'activity' = any(p_kinds))
  union all
  -- assessments: teachers by RLS (kg_can_teach); the family through the helper below
  select 'assessment:' || x.id, 'assessment', x.scheduled_on, x.scheduled_on,
         null::timestamptz, null::timestamptz, true,
         x.title, null::text, c.name, c.name_ar,
         x.id, c.structure_id, x.class_id, null::uuid, null::uuid, null::uuid,
         false, false, false, 1,
         jsonb_build_object('assessmentKind', x.kind, 'published', x.published, 'programId', x.program_id)
    from kg_learning_assessments x join kg_classes c on c.id = x.class_id
   where x.tenant_id = p_tenant and v_staff and kg_can_teach(p_tenant, x.class_id)
     and x.scheduled_on between p_from and p_to
     and (p_structure is null or c.structure_id is null or c.structure_id = p_structure)
     and (p_kinds is null or 'assessment' = any(p_kinds))
  union all
  select * from kg_family_assessment_dates(p_tenant, p_from, p_to)
   where (p_kinds is null or 'assessment' = any(p_kinds))
  union all
  -- tasks: open, by due date; tk_sel is staff-wide, 'mine' = assigned to me
  select 'task:' || t.id, 'task', t.due_date, t.due_date, null::timestamptz, null::timestamptz, true,
         t.title, null::text, kg_member_name_in(p_tenant, t.assignee_id), null::text,
         t.id, null::uuid, null::uuid, t.child_id, null::uuid, t.assignee_id,
         false, false, false, 1,
         jsonb_build_object('priority', t.priority, 'status', t.status, 'late', t.due_date < v_today)
    from kg_tasks t
   where t.tenant_id = p_tenant and t.due_date between p_from and p_to
     and t.status in ('todo', 'in_progress')
     and (p_scope <> 'mine' or t.assignee_id = v_me)
     and (p_kinds is null or 'task' = any(p_kinds))
  union all
  -- leave: lr_sel = admin or own; approved = neutral band, pending = tentative (gold, needs a decision)
  select 'leave:' || l.id, 'leave', greatest(l.start_date, p_from), least(l.end_date, p_to),
         null::timestamptz, null::timestamptz, true,
         kg_member_name_in(p_tenant, l.membership_id), null::text, null::text, null::text,
         l.id, null::uuid, null::uuid, null::uuid, null::uuid, l.membership_id,
         l.status = 'pending', false, false, 1,
         jsonb_build_object('leaveType', l.leave_type, 'status', l.status, 'from', l.start_date, 'to', l.end_date)
    from kg_leave_requests l
   where l.tenant_id = p_tenant and l.status in ('approved', 'pending')
     and l.start_date <= p_to and l.end_date >= p_from
     and (p_kinds is null or 'leave' = any(p_kinds))
  union all
  -- interviews: staff only (app_sel); an open application with a set interview
  select 'interview:' || ap.id, 'interview',
         (ap.interview_at at time zone 'Africa/Algiers')::date, (ap.interview_at at time zone 'Africa/Algiers')::date,
         ap.interview_at, ap.interview_at + interval '30 minutes', false,
         trim(coalesce(ap.child->>'first_name', '') || ' ' || coalesce(ap.child->>'last_name', '')),
         nullif(trim(coalesce(ap.child->>'first_name_ar', '') || ' ' || coalesce(ap.child->>'last_name_ar', '')), ''),
         null::text, null::text,
         ap.id, ap.structure_id, ap.class_id, null::uuid, null::uuid, null::uuid,
         false, false, false, 1,
         jsonb_build_object('status', ap.status)
    from kg_applications ap
   where ap.tenant_id = p_tenant and v_staff
     and ap.interview_at is not null and ap.interview_at >= v_from and ap.interview_at < v_to
     and ap.status not in ('rejected', 'approved')
     and (p_structure is null or ap.structure_id is null or ap.structure_id = p_structure)
     and (p_kinds is null or 'interview' = any(p_kinds))
  union all
  -- birthdays: staff only; computed for every calendar year the window touches;
  -- 29 February falls on 28 February in a non-leap year
  select 'birthday:' || ch.id || ':' || to_char(b.bd, 'YYYY-MM-DD'), 'birthday', b.bd, b.bd,
         null::timestamptz, null::timestamptz, true,
         ch.first_name || ' ' || ch.last_name,
         nullif(trim(coalesce(ch.first_name_ar, '') || ' ' || coalesce(ch.last_name_ar, '')), ''),
         c.name, c.name_ar,
         ch.id, ch.structure_id, ch.class_id, ch.id, null::uuid, null::uuid,
         false, false, false, 1,
         jsonb_build_object('age', yrs.y - extract(year from ch.dob)::int)
    from kg_children ch left join kg_classes c on c.id = ch.class_id
    cross join lateral (select distinct v.y from (values (extract(year from p_from)::int), (extract(year from p_to)::int)) v(y)) yrs
    cross join lateral (select make_date(yrs.y, extract(month from ch.dob)::int,
                          least(extract(day from ch.dob)::int,
                                extract(day from (make_date(yrs.y, extract(month from ch.dob)::int, 1) + interval '1 month - 1 day'))::int)) as bd) b
   where ch.tenant_id = p_tenant and v_staff and ch.status = 'enrolled'
     and b.bd between p_from and p_to
     and (p_structure is null or ch.structure_id is null or ch.structure_id = p_structure)
     and (p_kinds is null or 'birthday' = any(p_kinds))
  union all
  -- invoice due dates: ONE marker per day with a count (inv_sel: finance, or a
  -- family's own). child_id names one of the day's children so a family's door
  -- has a target; the min runs over the text form because Postgres ships no
  -- min(uuid).
  select 'invoice_due:' || to_char(i.due_date, 'YYYY-MM-DD'), 'invoice_due', i.due_date, i.due_date,
         null::timestamptz, null::timestamptz, true,
         null::text, null::text, null::text, null::text,
         null::uuid, null::uuid, null::uuid, min(i.child_id::text)::uuid, null::uuid, null::uuid,
         false, false, false, count(*)::int,
         jsonb_build_object('late', i.due_date < v_today, 'balance', sum(i.total - i.paid_amount))
    from kg_invoices i
   where i.tenant_id = p_tenant and i.due_date between p_from and p_to
     and i.status in ('sent', 'unpaid', 'partial', 'overdue')
     and (p_kinds is null or 'invoice_due' = any(p_kinds))
   group by i.due_date
  union all
  -- payroll: finance only, explicitly (prr_sel also lets a payslip holder see the run);
  -- placed on the month's last day by convention — the app names it "Paie de septembre"
  select 'payroll:' || pr.id, 'payroll',
         (pr.month + interval '1 month - 1 day')::date, (pr.month + interval '1 month - 1 day')::date,
         null::timestamptz, null::timestamptz, true,
         null::text, null::text, null::text, null::text,
         pr.id, null::uuid, null::uuid, null::uuid, null::uuid, null::uuid,
         pr.status = 'draft', false, false, 1,
         jsonb_build_object('status', pr.status, 'month', pr.month)
    from kg_payroll_runs pr
   where pr.tenant_id = p_tenant and kg_is_finance(p_tenant)
     and (pr.month + interval '1 month - 1 day')::date between p_from and p_to
     and (p_kinds is null or 'payroll' = any(p_kinds))
  order by 3, 7 desc, 5;
end $$;
comment on function public.kg_calendar(uuid, date, date, text[], uuid, text) is
  'Every dated fact of the establishment in [p_from, p_to] as kg_calendar_item rows, read under the caller''s RLS. Facts only: the app derives the mark from kind, tentative, cancelled and closure. meta per kind — holiday {holidayKind, from, to}; event {audience, rsvp, description, cancelledAt, className, classNameAr}; lesson {lessonKind, status, programId, roomInherited, teacher}; session {sessionType, status, published, therapist | childName, childNameAr}; activity {slot}; assessment {assessmentKind, published, programId}; task {priority, status, late}; leave {leaveType, status, from, to}; interview {status}; birthday {age}; invoice_due {late, balance}; payroll {status, month}.';
revoke all on function public.kg_calendar(uuid, date, date, text[], uuid, text) from public, anon;
grant execute on function public.kg_calendar(uuid, date, date, text[], uuid, text) to authenticated;

-- ── 5. Who was told about an event (the hover card and the dialog's one line) ──
-- kg_notifications is per user, so a staff reader cannot count them; this
-- definer counts for the staff of the event's tenant and nobody else. A person
-- counts once, by their LATEST row: a family moved away ('removed') is no
-- longer "told", so a structure move never double counts old and new audience.
create or replace function public.kg_event_reach(p_tenant uuid, p_event_ids uuid[])
returns table (event_id uuid, families int, staff int, read int)
language sql stable security definer set search_path = pg_catalog, public as $$
  with told as (
    select e.id as event_id, e.tenant_id, n.user_id,
           bool_or(n.read_at is not null) as read_any,
           (array_agg(n.data->>'kind' order by n.created_at desc, n.id desc))[1] as last_kind
      from kg_events e
      join kg_notifications n on n.type = 'event' and n.data->>'eventId' = e.id::text
     where e.tenant_id = p_tenant and kg_is_staff(p_tenant) and e.id = any(p_event_ids)
     group by e.id, e.tenant_id, n.user_id)
  select t.event_id,
         count(*) filter (where not exists (
           select 1 from kg_memberships m where m.user_id = t.user_id and m.tenant_id = t.tenant_id
             and m.status = 'active' and m.role <> 'parent'))::int,
         count(*) filter (where exists (
           select 1 from kg_memberships m where m.user_id = t.user_id and m.tenant_id = t.tenant_id
             and m.status = 'active' and m.role <> 'parent'))::int,
         count(*) filter (where t.read_any)::int
    from told t
   where t.last_kind <> 'removed'
   group by t.event_id
$$;
revoke all on function public.kg_event_reach(uuid, uuid[]) from public, anon;
grant execute on function public.kg_event_reach(uuid, uuid[]) to authenticated;

-- ── 6. What sits on a day about to be closed ───────────────────────────────
-- Read by the confirm and add dialogs of Jours fériés before Save. Only what
-- is still ahead and still scheduled: yesterday's séance is attendance history.
create or replace function public.kg_closure_impact(p_tenant uuid, p_structure uuid, p_from date, p_to date)
returns jsonb
language sql stable security definer set search_path = pg_catalog, public as $$
  select case when not kg_is_admin(p_tenant) then null else jsonb_build_object(
    'lessons', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'title', l.title, 'startsAt', l.starts_at, 'classId', l.class_id) order by l.starts_at)
                  from kg_learning_lessons l join kg_classes c on c.id = l.class_id
                 where l.tenant_id = p_tenant and l.status = 'scheduled'
                   and (l.starts_at at time zone 'Africa/Algiers')::date
                       between greatest(p_from, (now() at time zone 'Africa/Algiers')::date) and p_to
                   and (p_structure is null or c.structure_id is null or c.structure_id = p_structure)), '[]'::jsonb),
    'sessions', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'scheduledAt', s.scheduled_at, 'childId', s.child_id,
                                                        'child', ch.first_name || ' ' || ch.last_name) order by s.scheduled_at)
                  from kg_sessions s join kg_children ch on ch.id = s.child_id
                 where s.tenant_id = p_tenant and s.status = 'scheduled'
                   and (s.scheduled_at at time zone 'Africa/Algiers')::date
                       between greatest(p_from, (now() at time zone 'Africa/Algiers')::date) and p_to
                   and (p_structure is null or ch.structure_id is null or ch.structure_id = p_structure)), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'startAt', e.start_at) order by e.start_at)
                  from kg_events e left join kg_classes c on c.id = e.class_id
                 where e.tenant_id = p_tenant and e.cancelled_at is null
                   and (e.start_at at time zone 'Africa/Algiers')::date
                       between greatest(p_from, (now() at time zone 'Africa/Algiers')::date) and p_to
                   and (p_structure is null or coalesce(e.structure_id, c.structure_id) is null
                        or coalesce(e.structure_id, c.structure_id) = p_structure)), '[]'::jsonb),
    'activitySlots', (select count(*) from kg_activities a
                        cross join lateral kg_activity_slots(a.schedule) s
                        cross join lateral (select g::date as day from generate_series(
                          greatest(p_from, (now() at time zone 'Africa/Algiers')::date)::timestamp, p_to::timestamp, interval '1 day') g) d
                       where a.tenant_id = p_tenant and a.active and s.dow = extract(dow from d.day)::int
                         and (p_structure is null or a.structure_id is null or a.structure_id = p_structure)))
  end
$$;
revoke all on function public.kg_closure_impact(uuid, uuid, date, date) from public, anon;
grant execute on function public.kg_closure_impact(uuid, uuid, date, date) to authenticated;

-- ── 7. What a person on leave is scheduled to do ───────────────────────────
-- Invoker: the admin who decides reads lessons and sessions under their own RLS.
create or replace function public.kg_leave_conflicts(p_tenant uuid, p_membership uuid, p_from date, p_to date)
returns jsonb
language sql stable security invoker set search_path = pg_catalog, public as $$
  select jsonb_build_object(
    'lessons', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'title', l.title, 'startsAt', l.starts_at, 'classId', l.class_id) order by l.starts_at)
                  from kg_learning_lessons l
                 where l.tenant_id = p_tenant and l.membership_id = p_membership and l.status = 'scheduled'
                   and (l.starts_at at time zone 'Africa/Algiers')::date between p_from and p_to), '[]'::jsonb),
    'sessions', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'scheduledAt', s.scheduled_at, 'childId', s.child_id) order by s.scheduled_at)
                  from kg_sessions s
                 where s.tenant_id = p_tenant and s.therapist_id = p_membership and s.status = 'scheduled'
                   and (s.scheduled_at at time zone 'Africa/Algiers')::date between p_from and p_to), '[]'::jsonb))
$$;
revoke all on function public.kg_leave_conflicts(uuid, uuid, date, date) from public, anon;
grant execute on function public.kg_leave_conflicts(uuid, uuid, date, date) to authenticated;

-- ── 8. Rehearsal: the RLS truth table, as three demo people ────────────────
-- Dry run: keep the final `raise exception`. Apply: change it to `raise notice`.
-- pg_temp lives for this session only: the impersonation helper never
-- persists; OR REPLACE so the file and supabase/tests/calendar_rls.sql can run
-- in one editor session. Every count is a DELTA around the block's own rows,
-- never an absolute: the seed and later demo data must not break this file.
create or replace function pg_temp.as_user(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
do $$
declare
  t uuid := '732bdf7d-775a-4ed7-875f-8c04ea4e4778';
  u_parent1 uuid := '22b11eb4-70ad-414c-9206-9adf41992bc8';
  u_educ uuid := 'a1b0536f-e473-4506-a9e1-a1abbf302a55';
  u_owner uuid := 'd9485859-48e8-4aad-85e7-d09e1cd16f4d';
  m_educ uuid := '98b14d98-a898-4c62-8f90-b5607ae281c8';
  ines uuid := 'ec4cea7d-a134-4cd2-a7d7-42bcfc10265c';
  n int; n2 int; n_before int; v_session uuid; v_event uuid; v_json jsonb;
begin
  if not exists (select 1 from public.kg_tenants where id = t) then
    raise notice '0158 rehearsal skipped: demo tenant absent'; return;
  end if;

  -- parent1, before the block writes anything: how many appointments she sees
  perform pg_temp.as_user(u_parent1);
  select count(*) into n_before from public.kg_calendar(t, '2026-09-01', '2026-09-30') where kind = 'session';
  execute 'reset role';

  -- an unpublished session with a clinical note for parent1's child, so the widening is testable
  insert into public.kg_sessions (tenant_id, child_id, session_type, therapist_id, scheduled_at, duration_min, status, published, notes, created_by)
  values (t, ines, 'speech', '791ee0f0-6451-47e3-8b3a-1b064fb81333',
          '2026-09-22 18:00+01', 30, 'scheduled', false, 'REHEARSAL CLINICAL NOTE', u_owner)
  returning id into v_session;

  -- parent1: her child's appointment appears as a DATE (published false), no clinical column, no staff kinds
  perform pg_temp.as_user(u_parent1);
  select count(*) into n from public.kg_calendar(t, '2026-09-01', '2026-09-30') where kind in ('task', 'leave', 'interview', 'payroll', 'birthday');
  if n <> 0 then raise exception 'parent1 sees staff kinds: %', n; end if;
  select count(*) into n from public.kg_calendar(t, '2026-09-01', '2026-09-30') where kind = 'session';
  if n <> n_before + 1 then raise exception 'parent1 must gain exactly one appointment (% → %)', n_before, n; end if;
  if not exists (select 1 from public.kg_calendar(t, '2026-09-01', '2026-09-30') where kind = 'session' and source_id = v_session and child_id = ines) then
    raise exception 'the unpublished appointment must reach its family as a date';
  end if;
  select count(*) into n from public.kg_calendar(t, '2026-09-01', '2026-09-30') x
   where kind = 'session' and not public.kg_is_parent_of(x.child_id);
  if n <> 0 then raise exception 'parent1 sees another family''s session'; end if;
  select jsonb_agg(to_jsonb(x)) into v_json from public.kg_calendar(t, '2026-09-01', '2026-09-30') x where kind = 'session';
  if v_json::text like '%REHEARSAL CLINICAL NOTE%' or jsonb_path_exists(v_json, '$[*].**.notes') or jsonb_path_exists(v_json, '$[*].**.progress_rating') or jsonb_path_exists(v_json, '$[*].**.parent_summary') then
    raise exception 'a clinical column leaked to the family';
  end if;
  select count(*) into n from public.kg_calendar(t, '2026-09-01', '2026-09-30') where kind = 'assessment' and (meta->>'assessmentKind') = 'observation';
  if n <> 0 then raise exception 'an observation reached a family'; end if;
  select count(*) into n from public.kg_calendar(t, '2026-09-01', '2026-09-30') where kind = 'assessment' and child_id is null;
  if n <> 0 then raise exception 'a family assessment row must name the child'; end if;
  select count(*) into n from (select id from public.kg_calendar(t, '2026-09-01', '2026-09-30') group by id having count(*) > 1) d;
  if n <> 0 then raise exception 'duplicate item ids for parent1: %', n; end if;
  select count(*) into n from public.kg_calendar(t, '2026-09-01', '2026-09-30') where kind = 'event' and (meta->>'audience') = 'staff';
  if n <> 0 then raise exception 'a staff event reached a family'; end if;
  select count(*) into n from public.kg_calendar(t, '2026-09-01', '2026-09-30') x
   where kind = 'lesson' and not public.kg_is_parent_of_class(t, x.class_id);
  if n <> 0 then raise exception 'parent1 sees a lesson of a class not hers'; end if;
  select count(*) into n from public.kg_calendar(t, '2026-09-01', '2026-09-30') where kind = 'activity' and child_id is null;
  if n <> 0 then raise exception 'a family activity row must name the child'; end if;
  execute 'reset role';

  -- educatrice: 'mine' narrows lessons to her own or her classes'; no invoices; her own leave only
  perform pg_temp.as_user(u_educ);
  select count(*) into n from public.kg_calendar(t, '2026-09-01', '2026-09-30', null, null, 'all') where kind = 'lesson';
  select count(*) into n2 from public.kg_calendar(t, '2026-09-01', '2026-09-30', null, null, 'mine') where kind = 'lesson';
  if n2 = 0 or n2 > n then raise exception 'mine must narrow lessons (%, %)', n, n2; end if;
  select count(*) into n from public.kg_calendar(t, '2026-09-01', '2026-09-30', null, null, 'mine') where kind = 'lesson' and membership_id <> m_educ
     and class_id not in (select class_id from public.kg_class_staff where membership_id = m_educ);
  if n <> 0 then raise exception 'mine leaked a lesson'; end if;
  select count(*) into n from public.kg_calendar(t, '2026-09-01', '2026-09-30') where kind in ('invoice_due', 'payroll');
  if n <> 0 then raise exception 'an educator sees money'; end if;
  select count(*) into n from public.kg_calendar(t, '2026-09-01', '2026-09-30') where kind = 'leave' and membership_id <> m_educ;
  if n <> 0 then raise exception 'an educator sees a colleague''s leave'; end if;
  -- the family helpers return nothing to staff
  select count(*) into n from public.kg_family_appointments(t, '2026-09-01', '2026-10-01');
  if n <> 0 then raise exception 'kg_family_appointments must be empty for staff'; end if;
  select count(*) into n from public.kg_family_assessment_dates(t, '2026-09-01', '2026-12-31');
  if n <> 0 then raise exception 'kg_family_assessment_dates must be empty for staff'; end if;
  execute 'reset role';

  -- owner: every kind; invoice markers equal the group-by; activities once per slot per open day;
  -- birthdays equal the enrolled September birthdays; every row has date <= last_date
  perform pg_temp.as_user(u_owner);
  select count(*) into n from public.kg_calendar(t, '2026-09-01', '2026-09-30') where kind = 'invoice_due';
  execute 'reset role';
  select count(distinct due_date) into n2 from public.kg_invoices where tenant_id = t and due_date between '2026-09-01' and '2026-09-30' and status in ('sent', 'unpaid', 'partial', 'overdue');
  if n <> n2 then raise exception 'invoice markers % <> due days %', n, n2; end if;
  select count(*) into n2 from public.kg_children where tenant_id = t and status = 'enrolled' and extract(month from dob) = 9;
  perform pg_temp.as_user(u_owner);
  select count(*) into n from public.kg_calendar(t, '2026-09-01', '2026-09-30') where kind = 'birthday';
  if n <> n2 then raise exception 'expected % September birthdays, got %', n2, n; end if;
  select count(*) into n from public.kg_calendar(t, '2026-09-01', '2026-09-30') where kind = 'activity' and date = '2026-09-15';
  if n = 0 then raise exception 'activities must run on the tentative 15 Sept'; end if;
  select count(*) into n from public.kg_calendar(t, '2026-09-01', '2026-09-30') where kind = 'activity' and child_id is not null;
  if n <> 0 then raise exception 'a staff activity row names no child'; end if;
  select count(*) into n from public.kg_calendar(t, '2026-11-01', '2026-11-01') where kind = 'activity';
  if n <> 0 then raise exception 'no activity on a confirmed closure'; end if;
  select count(*) into n from public.kg_calendar(t, '2026-09-01', '2026-09-30') where kind = 'holiday' and tentative;
  if n <> 1 then raise exception 'expected the one tentative holiday'; end if;
  select count(*) into n from public.kg_calendar(t, '2026-08-20', '2026-10-20') where date > last_date;
  if n <> 0 then raise exception '% rows with date > last_date', n; end if;
  -- the window cap and the scope word are refused
  begin
    perform count(*) from public.kg_calendar(t, '2026-09-01', '2026-12-31');
    raise exception 'window cap missing';
  exception when sqlstate '22023' then null; end;
  begin
    perform count(*) from public.kg_calendar(t, '2026-09-01', '2026-09-30', null, null, 'team');
    raise exception 'scope word not checked';
  exception when sqlstate '22023' then null; end;
  execute 'reset role';

  -- an all-day event 20–21 Sept viewed from the 22nd is not a phantom row; viewed
  -- from the 15th it is one row 20..21 (the live 0091 insert trigger writes staff
  -- rows for it: source row deleted first, then swept)
  perform set_config('request.jwt.claims', json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  insert into public.kg_events (tenant_id, title, start_at, end_at, all_day, audience, created_by)
  values (t, 'rehearsal span', '2026-09-20 00:00+01', '2026-09-22 00:00+01', true, 'staff', u_owner)
  returning id into v_event;
  perform pg_temp.as_user(u_owner);
  if exists (select 1 from public.kg_calendar(t, '2026-09-22', '2026-09-30') where source_id = v_event) then raise exception 'phantom all-day row past its exclusive end'; end if;
  if not exists (select 1 from public.kg_calendar(t, '2026-09-15', '2026-09-30') where source_id = v_event and date = '2026-09-20' and last_date = '2026-09-21' and all_day and starts_at is null) then
    raise exception 'all-day span must be one row 20..21 with no clock';
  end if;
  if not exists (select 1 from public.kg_calendar(t, '2026-09-21', '2026-09-30') where source_id = v_event and date = '2026-09-21' and last_date = '2026-09-21') then
    raise exception 'all-day span must clip to the window';
  end if;
  execute 'reset role';
  delete from public.kg_events where id = v_event;
  delete from public.kg_notifications where type = 'event' and data->>'eventId' = v_event::text;
  delete from public.kg_sessions where id = v_session;
  raise exception '0158 rehearsal ok — rolled back';
end $$;
notify pgrst, 'reload schema';
commit;
