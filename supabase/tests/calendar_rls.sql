-- psql -v ON_ERROR_STOP=1 -f supabase/tests/calendar_rls.sql
-- The RLS truth table of the calendar composer (0158), run against the
-- connected database AFTER 0157–0159 are applied and after every later
-- migration: one transaction, the demo tenant only, rolled back at the end so
-- nothing persists even when the file is pasted whole into the SQL editor.
--
-- This is the rehearsal block of 0158 verbatim (the migration ends it with a
-- `raise exception` for its dry run; here the block ends with a notice and the
-- ROLLBACK below does the undoing). Keep the two in step: a change to one is
-- a change to the other.
--
-- Three demo people read the same window through kg_calendar and get three
-- different answers: parent1 gains exactly ONE appointment — the unpublished
-- session this block writes for her child — as a date with no clinical column,
-- never a staff kind, never another family's child, one row per item id;
-- educatrice's `mine` narrows lessons to her own or her classes' and shows her
-- no money and no colleague's leave; the owner's invoice markers equal the
-- distinct due days, her September birthdays equal the enrolled children born
-- in September, activities run on the tentative 15 Sept and not on the
-- confirmed 1 Nov, every row has date <= last_date, the 62-day cap and the
-- scope word are refused, and a temporary all-day span 20–21 Sept is absent
-- from a window starting the 22nd and clipped from one starting the 21st.
-- Every count is a DELTA around the block's own rows, so the demo seed and
-- later demo data do not break it.
--
-- The impersonation helper lives in pg_temp: it never persists, and OR
-- REPLACE lets this file run in the same editor session as the migration.
\set ON_ERROR_STOP on
begin;
-- ── 8. Rehearsal: the RLS truth table, as three demo people ────────────────
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
  raise notice '0158 rehearsal ok — every write of this block is rolled back below';
end $$;
rollback;
select 'PASS: calendar RLS — parent1, educatrice and the owner each read their own calendar; the family helpers hand out dates and never a clinical column; all fixture rows rolled back' result;
