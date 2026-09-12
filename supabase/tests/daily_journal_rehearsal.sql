-- Rehearsal of 0152 (part B, the daily journal) and 0153 (part A, lessons
-- without a programme) against the connected database. Every part is one
-- transaction that applies the migration's body, exercises it on the demo
-- tenant, prints its observations inside a RAISE and rolls back, so nothing
-- persists even when a block is pasted alone into the SQL editor.
--
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/daily_journal_rehearsal.sql               part B
--   psql -v ON_ERROR_STOP=1 -v run_0153=1 -f supabase/tests/daily_journal_rehearsal.sql part B, then part A
--
-- Run from the repository root: the migration bodies are read from
-- supabase/migrations by the two \set lines below (begin/commit/lock_timeout/
-- notify stripped, since this file opens its own transaction). Without psql
-- (the SQL editor, an MCP runner) replace the `:body_0152` / `:body_0153` line
-- with that body by hand and run the part as one statement block. After the
-- migration is applied the same file re-tests the live objects: CREATE OR
-- REPLACE inside a rolled-back transaction changes nothing.
--
-- Demo tenant only. The real client (fb050631-…) is never named; every write
-- is scoped to the demo tenant or to one of its children, and the ROLLBACK
-- undoes them anyway. Three facts about the clock, all handled inside the
-- transaction: the sender refuses to run after 22:30 Algiers, so part B must
-- run before that; the demo is closed on Fridays and Saturdays, so the
-- current weekday is opened for the demo tenant with a close already behind
-- us (the sender otherwise skips every child before the ledger — correctly,
-- and there would be nothing to observe); and the sender's session flag
-- kg.journal_sender is transaction-local, which in production ends with the
-- cron's transaction but here would silence the trigger for the rest of the
-- rehearsal, so it is cleared after every call.
--
-- Part A books the Crèche educator 11:00–11:30 on the next open weekday, then
-- 12:00–12:30 on that day and the three following weeks: her free slots on
-- those days at the time of writing. A 23P01 there means the demo timetable
-- moved — pick another slot, it is not a regression.
--
-- Part B ends by running the owner's one-off scripts/demo/daily_journal_seed.sql
-- (read the same way, begin/commit stripped) and then the teardown it carries
-- in a comment, so the seed's first real run is not its first run: the counts
-- of 2026-09-10 must go from nothing to the seeded rows and back to nothing.
\set ON_ERROR_STOP on
\set body_0152 `sed -e '/^begin;$/d' -e '/^commit;$/d' -e '/^set local lock_timeout/d' -e '/^notify pgrst/d' supabase/migrations/0152_kg_daily_journal.sql`
\set body_0153 `sed -e '/^begin;$/d' -e '/^commit;$/d' -e '/^set local lock_timeout/d' -e '/^notify pgrst/d' supabase/migrations/0153_kg_lessons_without_program.sql`
\set body_seed `sed -e '/^begin;$/d' -e '/^commit;$/d' scripts/demo/daily_journal_seed.sql`

-- ═══════════════════════════════════════════════════════════════════════════
-- PART B — 0152, the daily journal
-- ═══════════════════════════════════════════════════════════════════════════
begin;
set local lock_timeout = '5s';
:body_0152

-- ── Harness ────────────────────────────────────────────────────────────────
create temp table rehearsal_log (n serial, step text, observed text) on commit drop;
create function pg_temp.note(p_step text, p_observed text) returns void
language sql as $$ insert into rehearsal_log (step, observed) values ($1, $2) $$;
-- Runs a statement that must fail; returns "SQLSTATE message" for the log.
create function pg_temp.expect_error(p_statement text, p_state text, p_message text default null) returns text
language plpgsql as $$
begin
  begin
    execute p_statement;
  exception when others then
    if sqlstate = p_state and (p_message is null or sqlerrm = p_message) then
      return sqlstate || ' ' || sqlerrm;
    end if;
    raise exception 'expected % %, got % %', p_state, coalesce(p_message, ''), sqlstate, sqlerrm;
  end;
  raise exception 'expected % but the statement succeeded', p_state;
end $$;

-- The people and places of the rehearsal, resolved once. Adam is the child
-- the spec reasons about; Ines is his sister (same guardian account, another
-- crèche class); the préscolaire child with an account stands for a
-- structure that is closed today; a child of another family tests the guard.
create temp table fx on commit drop as
select '732bdf7d-775a-4ed7-875f-8c04ea4e4778'::uuid as tenant,
       '809202b0-ab41-4523-8f4c-298aae11fa5e'::uuid as adam,
       'ec4cea7d-a134-4cd2-a7d7-42bcfc10265c'::uuid as ines,
       '276abb6b-8660-4dd7-8f77-20a2da44dc08'::uuid as petite_section,
       '6c54e142-2174-4e1a-af3f-69cedaa788c6'::uuid as prescolaire,
       (select u.id from auth.users u where u.email = 'parent1@rawdatik.com') as parent1,
       (now() at time zone 'Africa/Algiers')::date as today,
       lower(to_char((now() at time zone 'Africa/Algiers')::date, 'Dy')) as today_key,
       clock_timestamp() as started_at;
do $$
declare f fx;
begin
  select * into f from fx;
  if f.parent1 is null then raise exception 'parent1@rawdatik.com is not an auth user'; end if;
  if not exists (select 1 from public.kg_tenants where id = f.tenant and settings ->> 'demo' = 'true') then
    raise exception 'tenant % is not flagged demo — refusing', f.tenant;
  end if;
  if (now() at time zone 'Africa/Algiers')::time > time '22:30' then
    raise exception 'after the 22:30 cutoff: the sender would refuse to run, rehearse tomorrow';
  end if;
end $$;
alter table fx add column other_child uuid, add column closed_child uuid;
update fx set
  other_child = (select ch.id from public.kg_children ch
                  where ch.tenant_id = fx.tenant and ch.status = 'enrolled'
                    and not exists (select 1 from public.kg_parent_user_ids(ch.id) u where u = fx.parent1)
                  order by ch.id limit 1),
  closed_child = (select ch.id from public.kg_children ch
                   where ch.tenant_id = fx.tenant and ch.status = 'enrolled' and ch.structure_id = fx.prescolaire
                     and exists (select 1 from public.kg_parent_user_ids(ch.id))
                   order by ch.id limit 1);

-- ── The clock, made deterministic inside the transaction ───────────────────
-- Today is opened for the building with a close already behind us; the
-- préscolaire alone stays closed today (its own hours, today null) so one
-- structure exercises the closed-day branch. Confirmed closures of today and
-- any row the day already holds for the demo are cleared so the counts below
-- mean what they say.
update public.kg_structures s
   set opening_hours = (select t.opening_hours from public.kg_tenants t where t.id = s.tenant_id)
                       || jsonb_build_object((select today_key from fx), null)
 where s.id = (select prescolaire from fx);
update public.kg_tenants t
   set opening_hours = t.opening_hours
                       || jsonb_build_object((select today_key from fx), jsonb_build_object('open', '00:00', 'close', '00:01'))
 where t.id = (select tenant from fx);
delete from public.kg_holidays h using fx
 where h.tenant_id = fx.tenant and h.closure and not h.tentative
   and fx.today between h.date and coalesce(h.end_date, h.date);
delete from public.kg_daily_journal_ledger l using fx where l.tenant_id = fx.tenant and l.day = fx.today;
delete from public.kg_daily_reports r using fx where r.tenant_id = fx.tenant and r.date = fx.today;
delete from public.kg_attendance a using fx where a.tenant_id = fx.tenant and a.date = fx.today;
delete from public.kg_notifications n using fx
 where n.tenant_id = fx.tenant and n.type = 'daily_report' and n.data ->> 'date' = fx.today::text;

-- ── 1. Schema facts (§5.1) ─────────────────────────────────────────────────
do $$
declare f fx; v text;
begin
  select * into f from fx;
  select string_agg(jobname, ', ' order by jobname) into v from cron.job;
  perform pg_temp.note('1 cron.job', (select count(*) from cron.job) || ' jobs: ' || v);
  perform pg_temp.note('1 pg_net', case when exists (select 1 from pg_extension where extname = 'pg_net') then 'installed' else 'MISSING' end);
  perform pg_temp.note('1 send_at 21:15', public.kg_valid_daily_journal_settings('{"daily_journal":{"enabled":true,"send_at":"21:15"}}')::text);
  perform pg_temp.note('1 send_at 21:00', public.kg_valid_daily_journal_settings('{"daily_journal":{"enabled":true,"send_at":"21:00"}}')::text);
  perform pg_temp.note('1 stray key', public.kg_valid_daily_journal_settings('{"daily_journal":{"enabled":true,"send_at":"17:00","extra":1}}')::text);
  perform pg_temp.note('1 kg_repeat_menu', (select count(*) from pg_proc where proname = 'kg_repeat_menu') || ' row(s)');
  -- 0109's audit lists anon-executable definers; none of the new ones may be.
  select coalesce(string_agg(p.oid::regprocedure::text, ', '), 'none') into v
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'EXECUTE')
     and p.proname in ('kg_kick_push_dispatch','kg_dispatch_pending_push','kg_set_daily_journal',
       'kg_child_placement_on','kg_child_day_compose','kg_child_day','kg_child_record_dates','kg_child_days',
       'kg_daily_journal_data','kg_daily_journal_preview','kg_send_daily_journal_preview','kg_send_daily_journals');
  perform pg_temp.note('1 anon-executable new functions', v);
  perform pg_temp.note('1 ledger write policies', (select count(*) from pg_policies
     where tablename = 'kg_daily_journal_ledger' and cmd <> 'SELECT')::text);
  perform pg_temp.note('1 digest index', case when exists (select 1 from pg_indexes where indexname = 'kg_notifications_daily_digest_once') then 'present' else 'MISSING' end);
end $$;

-- ── 4. The guard, as parent1 (§2.3 step 4) ─────────────────────────────────
-- A draft exists so that "journal null" means "hidden", not "absent"; it is
-- deleted afterwards (a delete never fires the notify trigger) so step 6 still
-- finds nobody marked and nobody written about.
insert into public.kg_daily_reports (tenant_id, child_id, date, mood, published)
select tenant, adam, today, 'calm', false from fx;
do $$
declare f fx; v jsonb; v_dates date[]; v_err text;
begin
  select * into f from fx;
  perform set_config('request.jwt.claim.sub', f.parent1::text, true);
  execute 'set local role authenticated';
  v_err := pg_temp.expect_error(format('select public.kg_child_day(%L, %L)', f.other_child, f.today), 'P0001', 'forbidden');
  v := public.kg_child_day(f.adam, f.today);
  v_dates := public.kg_child_record_dates(f.adam, f.today - 60, f.today + 60);
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  perform pg_temp.note('4 other family''s child', v_err);
  perform pg_temp.note('4 own child, draft journal', 'journal ' || jsonb_typeof(v -> 'journal') || ', profile ' || (v -> 'child' ->> 'profile')
    || ', className ' || coalesce(v -> 'child' ->> 'className', 'null') || ', closed ' || (v ->> 'closed'));
  perform pg_temp.note('4 record dates ±60', pg_typeof(v_dates)::text || ' of ' || coalesce(array_length(v_dates, 1), 0) || ' dates');
  -- The staff-only RPCs refuse a parent whatever the child.
  perform set_config('request.jwt.claim.sub', f.parent1::text, true);
  execute 'set local role authenticated';
  v_err := pg_temp.expect_error(format('select public.kg_daily_journal_preview(%L, %L)', f.adam, f.today), 'P0001', 'forbidden');
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  perform pg_temp.note('4 preview as parent', v_err);
  perform set_config('request.jwt.claim.sub', f.parent1::text, true);
  execute 'set local role authenticated';
  v_err := pg_temp.expect_error(format('select public.kg_set_daily_journal(%L, true, ''17:00'')', f.tenant), 'P0001', 'forbidden');
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  perform pg_temp.note('4 set setting as parent', v_err);
end $$;
delete from public.kg_daily_reports r using fx where r.child_id = fx.adam and r.date = fx.today;

-- ── 5. Compose and placement (§2.3 step 5) ─────────────────────────────────
do $$
declare f fx; d jsonb; day jsonb;
begin
  select * into f from fx;
  day := public.kg_child_day_compose(f.adam, '2026-09-10', false);
  d := public.kg_daily_journal_data(day);
  perform pg_temp.note('5 Adam 2026-09-10', format('lessons %s, menu %s, tellable %s, profile %s, attendance %s, journal %s, class %s',
    d ->> 'lessons', d ->> 'menu', d ->> 'tellable', d ->> 'profile', coalesce(d ->> 'attendance', 'null'),
    jsonb_typeof(day -> 'journal'), day -> 'child' ->> 'className'));
  perform pg_temp.note('5 placement 2026-09-09', (select class_id::text from public.kg_child_placement_on(f.adam, '2026-09-09'))
    || case when (select class_id from public.kg_child_placement_on(f.adam, '2026-09-09')) = f.petite_section then ' (= from_class_id of the earliest move)' else ' UNEXPECTED' end);
  perform pg_temp.note('5 placement today', (select class_id::text from public.kg_child_placement_on(f.adam, f.today))
    || case when (select class_id from public.kg_child_placement_on(f.adam, f.today)) = (select class_id from public.kg_children where id = f.adam) then ' (= current class)' else ' UNEXPECTED' end);
  perform pg_temp.note('5 nap typo', coalesce(public.kg_daily_journal_data(
    '{"date":"2026-09-10","child":{"profile":"care"},"journal":{"nap":{"start":"14:00","end":"13:00"}}}'::jsonb) ->> 'napMinutes', 'null'));
  perform pg_temp.note('5 nap minutes', (public.kg_daily_journal_data(
    '{"date":"2026-09-10","child":{"profile":"care"},"journal":{"nap":{"slept":true,"minutes":90},"meals":[{"meal":"snack","eaten":"all"},{"meal":"lunch","eaten":"half"}]}}'::jsonb) ->> 'napMinutes')
    || ' min, eaten ' || (public.kg_daily_journal_data(
    '{"date":"2026-09-10","child":{"profile":"care"},"journal":{"meals":[{"meal":"snack","eaten":"all"},{"meal":"breakfast","eaten":"none"}]}}'::jsonb) ->> 'eaten') || ' (least eaten when no lunch line)');
end $$;

-- ── 6. Switch on at 00:00; nobody marked (§2.3 step 6) ─────────────────────
update public.kg_tenants t set settings = coalesce(t.settings, '{}'::jsonb)
  || '{"daily_journal":{"enabled":true,"send_at":"00:00"}}' from fx where t.id = fx.tenant;
do $$
declare f fx; n int; v text; before_at timestamptz; after_at timestamptz; before_n int; after_n int;
begin
  select * into f from fx;
  n := public.kg_send_daily_journals(f.tenant);
  perform set_config('kg.journal_sender', '', true);
  select string_agg(status || ' ' || c, ', ' order by status) into v
    from (select status, count(*) c from public.kg_daily_journal_ledger where tenant_id = f.tenant and day = f.today group by 1) s;
  perform pg_temp.note('6 first run', 'returned ' || n || '; ledger: ' || coalesce(v, 'empty') || '; digest rows: ' ||
    (select count(*) from public.kg_notifications where tenant_id = f.tenant and type = 'daily_report' and data ->> 'source' = 'digest' and data ->> 'date' = f.today::text));
  perform pg_temp.note('6 préscolaire (closed today) rows', (select count(*) from public.kg_daily_journal_ledger where tenant_id = f.tenant and day = f.today and structure_id = f.prescolaire)::text);
  select max(decided_at), count(*) into before_at, before_n from public.kg_daily_journal_ledger where tenant_id = f.tenant and day = f.today;
  n := public.kg_send_daily_journals(f.tenant);
  perform set_config('kg.journal_sender', '', true);
  select max(decided_at), count(*) into after_at, after_n from public.kg_daily_journal_ledger where tenant_id = f.tenant and day = f.today;
  perform pg_temp.note('6 second run', 'returned ' || n || '; rows ' || before_n || ' → ' || after_n || '; max decided_at ' ||
    case when before_at = after_at then 'unchanged' else 'CHANGED' end);
end $$;

-- ── 7. Adam present with a draft journal (§2.3 step 7) ─────────────────────
insert into public.kg_attendance (tenant_id, child_id, date, status, check_in_at, check_in_method)
select tenant, adam, today, 'present', (today::timestamp + time '08:12') at time zone 'Africa/Algiers', 'manual' from fx;
insert into public.kg_daily_reports (tenant_id, child_id, date, mood, meals, nap, notes, published)
select tenant, adam, today, 'happy', '[{"meal":"lunch","eaten":"all"}]', '{"start":"13:00","end":"14:00"}', 'A bien joué dehors.', false from fx;
do $$
declare f fx; n int; r record; before_n int; after_n int;
begin
  select * into f from fx;
  perform pg_temp.note('7 before', 'journal rows for Adam today, source: ' ||
    (select count(*) from public.kg_notifications where user_id = f.parent1 and type = 'daily_report' and data ->> 'childId' = f.adam::text and data ->> 'date' = f.today::text));
  n := public.kg_send_daily_journals(f.tenant);
  perform set_config('kg.journal_sender', '', true);
  select status, recipients, note into r from public.kg_daily_journal_ledger where child_id = f.adam and day = f.today;
  perform pg_temp.note('7 run', format('returned %s; Adam ledger %s, recipients %s, note %s; journal published %s',
    n, r.status, r.recipients, coalesce(r.note, 'null'),
    (select published from public.kg_daily_reports where child_id = f.adam and date = f.today)));
  select count(*) into after_n from public.kg_notifications
   where user_id = f.parent1 and type = 'daily_report' and data ->> 'childId' = f.adam::text and data ->> 'date' = f.today::text;
  select data into r from public.kg_notifications
   where user_id = f.parent1 and type = 'daily_report' and data ->> 'childId' = f.adam::text and data ->> 'date' = f.today::text
     and data ->> 'source' = 'digest' limit 1;
  perform pg_temp.note('7 notification', format('%s daily_report row(s) for Adam today; digest data: %s', after_n, r.data::text));
  perform pg_temp.note('7 text fields in data', case when r.data ?| array['title','body','notes','activitiesText','description','lunch','menuText']
    then 'PRESENT' else 'none' end || '; body ' || coalesce((select body from public.kg_notifications where user_id = f.parent1 and type = 'daily_report'
      and data ->> 'childId' = f.adam::text and data ->> 'date' = f.today::text and data ->> 'source' = 'digest' limit 1), 'null'));
  perform pg_temp.note('7 source journal rows', (select count(*) from public.kg_notifications where user_id = f.parent1 and type = 'daily_report'
    and data ->> 'childId' = f.adam::text and data ->> 'date' = f.today::text and data ->> 'source' = 'journal')::text);
  before_n := after_n;
  n := public.kg_send_daily_journals(f.tenant);
  perform set_config('kg.journal_sender', '', true);
  select count(*) into after_n from public.kg_notifications
   where user_id = f.parent1 and type = 'daily_report' and data ->> 'childId' = f.adam::text and data ->> 'date' = f.today::text;
  perform pg_temp.note('7 run again', format('returned %s; Adam rows %s → %s; ledger %s', n, before_n, after_n,
    (select status from public.kg_daily_journal_ledger where child_id = f.adam and day = f.today)));
  -- The index, called directly: a second notify of the same digest inserts nothing.
  n := public.kg_notify_family(f.tenant, f.adam, 'daily_report',
    public.kg_daily_journal_data(public.kg_child_day_compose(f.adam, f.today, false)) - 'tellable', null);
  perform pg_temp.note('7 direct second notify', 'inserted ' || n);
end $$;

-- ── 8. A fresh publish after the sender decided (§2.3 step 8) ──────────────
update public.kg_daily_reports r set published = false from fx where r.child_id = fx.adam and r.date = fx.today;
update public.kg_daily_reports r set published = true from fx where r.child_id = fx.adam and r.date = fx.today;
select pg_temp.note('8 republish after sent', (select count(*) from public.kg_notifications n, fx
  where n.user_id = fx.parent1 and n.type = 'daily_report' and n.data ->> 'childId' = fx.adam::text
    and n.data ->> 'date' = fx.today::text and n.data ->> 'source' = 'journal') || ' source=journal row(s)');

-- ── 9. Publishing by hand while the send is still due, and when it is not ──
update public.kg_tenants t set settings = coalesce(t.settings, '{}'::jsonb)
  || '{"daily_journal":{"enabled":true,"send_at":"21:00"}}' from fx where t.id = fx.tenant;
-- Ines: open structure, ledger skipped_unmarked → the sender will come → quiet.
insert into public.kg_daily_reports (tenant_id, child_id, date, mood, published)
select tenant, ines, today, 'calm', false from fx;
update public.kg_daily_reports r set published = true from fx where r.child_id = fx.ines and r.date = fx.today;
select pg_temp.note('9 due (Ines, open, unmarked)', 'ledger ' || coalesce((select status from public.kg_daily_journal_ledger l, fx where l.child_id = fx.ines and l.day = fx.today), 'none')
  || '; daily_report rows ' || (select count(*) from public.kg_notifications n, fx where n.type = 'daily_report' and n.data ->> 'childId' = fx.ines::text and n.data ->> 'date' = fx.today::text));
-- The préscolaire child: structure closed today → the sender never comes → told now.
insert into public.kg_daily_reports (tenant_id, child_id, date, mood, published)
select tenant, closed_child, today, 'calm', true from fx;
select pg_temp.note('9 closed structure today', 'ledger ' || coalesce((select status from public.kg_daily_journal_ledger l, fx where l.child_id = fx.closed_child and l.day = fx.today), 'none')
  || '; rows ' || (select count(*) from public.kg_notifications n, fx where n.type = 'daily_report' and n.data ->> 'childId' = fx.closed_child::text and n.data ->> 'date' = fx.today::text)
  || ', source ' || coalesce((select string_agg(distinct n.data ->> 'source', ',') from public.kg_notifications n, fx where n.type = 'daily_report' and n.data ->> 'childId' = fx.closed_child::text and n.data ->> 'date' = fx.today::text), 'none'));
-- A past date: never due.
insert into public.kg_daily_reports (tenant_id, child_id, date, mood, published)
select tenant, ines, today - 1, 'tired', true from fx;
select pg_temp.note('9 past date (Ines, yesterday)', (select count(*) from public.kg_notifications n, fx where n.type = 'daily_report' and n.data ->> 'childId' = fx.ines::text and n.data ->> 'date' = (fx.today - 1)::text)
  || ' row(s), source ' || coalesce((select string_agg(distinct n.data ->> 'source', ',') from public.kg_notifications n, fx where n.type = 'daily_report' and n.data ->> 'childId' = fx.ines::text and n.data ->> 'date' = (fx.today - 1)::text), 'none'));
-- Switched off: the trigger is the delivery, as before this build.
update public.kg_tenants t set settings = coalesce(t.settings, '{}'::jsonb)
  || '{"daily_journal":{"enabled":false,"send_at":"21:00"}}' from fx where t.id = fx.tenant;
update public.kg_daily_reports r set published = false from fx where r.child_id = fx.ines and r.date = fx.today;
update public.kg_daily_reports r set published = true from fx where r.child_id = fx.ines and r.date = fx.today;
select pg_temp.note('9 switch off, Ines republished', (select count(*) from public.kg_notifications n, fx where n.type = 'daily_report' and n.data ->> 'childId' = fx.ines::text and n.data ->> 'date' = fx.today::text) || ' row(s)');
update public.kg_tenants t set settings = coalesce(t.settings, '{}'::jsonb)
  || '{"daily_journal":{"enabled":true,"send_at":"21:00"}}' from fx where t.id = fx.tenant;

-- ── 10. The sender's flag silences the trigger (§2.3 step 10) ──────────────
insert into public.kg_daily_reports (tenant_id, child_id, date, mood, published)
select tenant, closed_child, today - 1, 'happy', false from fx;
set local kg.journal_sender = 'on';
update public.kg_daily_reports r set published = true from fx where r.child_id = fx.closed_child and r.date = fx.today - 1;
set local kg.journal_sender = '';
select pg_temp.note('10 published under the flag', (select count(*) from public.kg_notifications n, fx where n.type = 'daily_report' and n.data ->> 'childId' = fx.closed_child::text and n.data ->> 'date' = (fx.today - 1)::text) || ' row(s)');

-- ── 11. The sweep backs off within the hour (§2.3 step 11) ─────────────────
-- A URL that cannot resolve and a subscription for parent1, both rolled back
-- with everything else: the kick only enqueues a pg_net request in this
-- transaction, and the queue row dies with it.
update public.kg_push_config set dispatch_url = 'https://rehearsal.invalid/api/push/dispatch';
insert into public.kg_push_subscriptions (user_id, tenant_id, endpoint, p256dh, auth)
select parent1, tenant, 'https://rehearsal.invalid/push/' || gen_random_uuid(), 'p', 'a' from fx;
do $$
declare a bigint; b bigint; c public.kg_push_config;
begin
  a := public.kg_dispatch_pending_push();
  select * into c from public.kg_push_config limit 1;
  b := public.kg_dispatch_pending_push();
  perform pg_temp.note('11 sweep twice', format('first %s, second %s; last_kicked_at %s, last_kick_newest %s; queued requests %s',
    coalesce(a::text, 'null'), coalesce(b::text, 'null'),
    case when c.last_kicked_at is null then 'null' else 'set' end,
    case when c.last_kick_newest is null then 'null' else 'set' end,
    (select count(*) from net.http_request_queue)));
end $$;

-- ── 12. The preview RPCs as the directrice ─────────────────────────────────
do $$
declare f fx; v jsonb; v_id uuid; v_uid uuid; v_err text;
begin
  select * into f from fx;
  select u.id into v_uid from auth.users u where u.email = 'directrice@rawdatik.com';
  perform set_config('request.jwt.claim.sub', v_uid::text, true);
  execute 'set local role authenticated';
  v := public.kg_daily_journal_preview(f.adam, f.today);
  v_id := public.kg_send_daily_journal_preview(f.adam, f.today);
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  perform pg_temp.note('12 preview', format('keys %s; tellable %s; data.source %s; data has tellable: %s',
    (select string_agg(k, ',' order by k) from jsonb_object_keys(v) k), v ->> 'tellable', v -> 'data' ->> 'source', (v -> 'data') ? 'tellable'));
  perform pg_temp.note('12 preview row', (select format('user is directrice %s, read_at set %s, audience %s, preview %s',
    n.user_id = v_uid, n.read_at is not null, n.data ->> 'audience', n.data ->> 'preview') from public.kg_notifications n where n.id = v_id));
  -- The setting's only writer, as the admin it is meant for: the CHECK refuses
  -- a time past 21:00 with the SQLSTATE the action maps to 'invalid'.
  perform set_config('request.jwt.claim.sub', v_uid::text, true);
  execute 'set local role authenticated';
  v := public.kg_set_daily_journal(f.tenant, true, '18:30');
  v_err := pg_temp.expect_error(format('select public.kg_set_daily_journal(%L, true, ''21:15'')', f.tenant), '23514');
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  perform pg_temp.note('12 set as directrice', v::text || '; stored ' || (select t.settings -> 'daily_journal' from public.kg_tenants t where t.id = f.tenant)::text
    || '; demo flag kept ' || (select t.settings ->> 'demo' from public.kg_tenants t where t.id = f.tenant));
  perform pg_temp.note('12 send_at 21:15 via RPC', v_err);
end $$;

-- ── 13. The demo seed of 2026-09-10, then its teardown ─────────────────────
-- The seed writes under its own kg.journal_sender flag, which is why it runs
-- last: the flag would otherwise silence the trigger for the steps above.
-- The counts are taken before, after the seed and after the teardown; the
-- last must equal the first. The seed's summary arrives as a NOTICE.
create function pg_temp.day_counts() returns text
language sql as $$
  select format('attendance %s, journals %s (published %s), ledger %s, digests %s, consent %s',
    (select count(*) from public.kg_attendance a, fx where a.tenant_id = fx.tenant and a.date = date '2026-09-10'),
    (select count(*) from public.kg_daily_reports r, fx where r.tenant_id = fx.tenant and r.date = date '2026-09-10'),
    (select count(*) from public.kg_daily_reports r, fx where r.tenant_id = fx.tenant and r.date = date '2026-09-10' and r.published),
    (select count(*) from public.kg_daily_journal_ledger l, fx where l.tenant_id = fx.tenant and l.day = date '2026-09-10'),
    (select count(*) from public.kg_notifications n, fx where n.tenant_id = fx.tenant and n.type = 'daily_report'
       and n.data ->> 'source' = 'digest' and n.data ->> 'date' = '2026-09-10'),
    (select count(*) from public.kg_consents k, fx where k.tenant_id = fx.tenant and k.note = 'demo seed 2026-09-10'))
$$;
select pg_temp.note('13 before the seed', pg_temp.day_counts());
:body_seed
select pg_temp.note('13 after the seed', pg_temp.day_counts());
select pg_temp.note('13 ledger by status', (select string_agg(status || ' ' || c, ', ' order by status)
  from (select l.status, count(*) c from public.kg_daily_journal_ledger l, fx
         where l.tenant_id = fx.tenant and l.day = date '2026-09-10' group by 1) s));
select pg_temp.note('13 Adam digest', (select format('recipients %s, lessons %s, menu %s, eaten %s, nap %s, mood %s, photos %s, incidents %s, pushed %s, at %s',
    (select count(*) from public.kg_notifications n where n.type = 'daily_report' and n.data ->> 'source' = 'digest'
       and n.data ->> 'childId' = fx.adam::text and n.data ->> 'date' = '2026-09-10'),
    n.data ->> 'lessons', n.data ->> 'menu', n.data ->> 'eaten', n.data ->> 'napMinutes', n.data ->> 'mood',
    n.data ->> 'photos', n.data ->> 'incidents', n.pushed_at is not null, (n.created_at at time zone 'Africa/Algiers')::time)
  from public.kg_notifications n, fx
  where n.type = 'daily_report' and n.data ->> 'source' = 'digest'
    and n.data ->> 'childId' = fx.adam::text and n.data ->> 'date' = '2026-09-10' limit 1));
-- The seed again: idempotent, nothing may change. Its temp table dies with
-- the owner's commit; here the same transaction goes on, so it is dropped.
drop table seed_children;
:body_seed
select pg_temp.note('13 seed run twice', pg_temp.day_counts());
-- The teardown block of the seed, as the owner would paste it.
delete from public.kg_daily_journal_ledger
 where tenant_id = '732bdf7d-775a-4ed7-875f-8c04ea4e4778' and day = date '2026-09-10';
delete from public.kg_notifications
 where tenant_id = '732bdf7d-775a-4ed7-875f-8c04ea4e4778' and type = 'daily_report'
   and data ->> 'date' = '2026-09-10' and data ->> 'source' = 'digest';
delete from public.kg_daily_reports
 where tenant_id = '732bdf7d-775a-4ed7-875f-8c04ea4e4778' and date = date '2026-09-10';
delete from public.kg_attendance
 where tenant_id = '732bdf7d-775a-4ed7-875f-8c04ea4e4778' and date = date '2026-09-10';
delete from public.kg_consents
 where tenant_id = '732bdf7d-775a-4ed7-875f-8c04ea4e4778' and note = 'demo seed 2026-09-10';
select pg_temp.note('13 after the teardown', pg_temp.day_counts());

-- ── Report and roll back ───────────────────────────────────────────────────
do $$
declare v text;
begin
  select string_agg(step || ' → ' || observed, E'\n' order by n) into v from rehearsal_log;
  raise exception E'REHEARSAL part B (0152) — everything below is rolled back\n%', v;
end $$;
rollback;

-- ═══════════════════════════════════════════════════════════════════════════
-- PART A — 0153, lessons without a programme (psql -v run_0153=1)
-- ═══════════════════════════════════════════════════════════════════════════
\if :{?run_0153}
begin;
set local lock_timeout = '5s';
:body_0153

create temp table rehearsal_log (n serial, step text, observed text) on commit drop;
create function pg_temp.note(p_step text, p_observed text) returns void
language sql as $$ insert into rehearsal_log (step, observed) values ($1, $2) $$;
create function pg_temp.expect_error(p_statement text, p_state text, p_message text default null) returns text
language plpgsql as $$
begin
  begin
    execute p_statement;
  exception when others then
    if sqlstate = p_state and (p_message is null or sqlerrm = p_message) then
      return sqlstate || ' ' || sqlerrm;
    end if;
    raise exception 'expected % %, got % %', p_state, coalesce(p_message, ''), sqlstate, sqlerrm;
  end;
  raise exception 'expected % but the statement succeeded', p_state;
end $$;

-- The Crèche class of the demo, its main educator, and the first weekday from
-- tomorrow that is open together with the three following weeks (the series
-- of step 3 must not land on a closure).
create temp table fx on commit drop as
select '732bdf7d-775a-4ed7-875f-8c04ea4e4778'::uuid as tenant,
       '94fdfd08-927f-419c-9ccd-2a8b41bec6bd'::uuid as creche,
       (select c.structure_id from public.kg_classes c where c.id = '94fdfd08-927f-419c-9ccd-2a8b41bec6bd') as structure,
       (select cs.membership_id from public.kg_class_staff cs join public.kg_memberships m on m.id = cs.membership_id
         where cs.class_id = '94fdfd08-927f-419c-9ccd-2a8b41bec6bd' and m.status = 'active'
         order by cs.is_main desc limit 1) as educator,
       null::date as day;
update fx set day = (
  select d from generate_series((now() at time zone 'Africa/Algiers')::date + 1, (now() at time zone 'Africa/Algiers')::date + 30, '1 day') d
   where (select bool_and(
            public.kg_structure_hours(fx.structure, fx.tenant) -> lower(to_char(d + w * 7, 'Dy')) is not null
            and public.kg_structure_hours(fx.structure, fx.tenant) -> lower(to_char(d + w * 7, 'Dy')) <> 'null'::jsonb
            and not public.kg_structure_closed_on(fx.structure, fx.tenant, (d + w * 7)::date))
          from generate_series(0, 3) w)
   order by d limit 1);
do $$
declare f fx;
begin
  select * into f from fx;
  if f.educator is null or f.day is null then raise exception 'no educator or no open weeks found for the Crèche class'; end if;
  if not exists (select 1 from public.kg_tenants where id = f.tenant and settings ->> 'demo' = 'true') then
    raise exception 'tenant % is not flagged demo — refusing', f.tenant;
  end if;
  perform pg_temp.note('A fixture', format('day %s (%s), educator %s', f.day, to_char(f.day, 'Dy'), f.educator));
  perform pg_temp.note('A constraints', (select string_agg(conname, ', ' order by conname) from pg_constraint
    where conrelid = 'public.kg_learning_lessons'::regclass and conname in ('kg_learning_lessons_class_id_tenant_id_fkey', 'kg_learning_lessons_lesson_needs_program')));
  perform pg_temp.note('A program_id nullable', (select is_nullable from information_schema.columns where table_name = 'kg_learning_lessons' and column_name = 'program_id'));
end $$;

-- 1. A moment of daily life without a programme.
do $$
declare f fx; v_id uuid;
begin
  select * into f from fx;
  insert into public.kg_learning_lessons (tenant_id, class_id, program_id, membership_id, title, kind, starts_at, ends_at)
  values (f.tenant, f.creche, null, f.educator, 'Accueil', 'care',
          (f.day::timestamp + time '11:00') at time zone 'Africa/Algiers', (f.day::timestamp + time '11:30') at time zone 'Africa/Algiers')
  returning id into v_id;
  perform pg_temp.note('A1 care block, no programme', 'inserted ' || v_id || ', program_id ' ||
    coalesce((select program_id::text from public.kg_learning_lessons where id = v_id), 'null'));
  -- 2. A cours still needs a programme: the guard's token, not the CHECK's name.
  perform pg_temp.note('A2 lesson without programme', pg_temp.expect_error(format(
    'insert into public.kg_learning_lessons (tenant_id, class_id, program_id, membership_id, title, kind, starts_at, ends_at) values (%L, %L, null, %L, ''Maths'', ''lesson'', %L, %L)',
    f.tenant, f.creche, f.educator, (f.day::timestamp + time '12:00') at time zone 'Africa/Algiers', (f.day::timestamp + time '12:30') at time zone 'Africa/Algiers'),
    '23514', 'lesson_needs_program'));
  -- The other guards are untouched: a closed day is still refused.
  perform pg_temp.note('A2 closed day still refused', pg_temp.expect_error(format(
    'insert into public.kg_learning_lessons (tenant_id, class_id, program_id, membership_id, title, kind, starts_at, ends_at) values (%L, %L, null, %L, ''Accueil'', ''care'', %L, %L)',
    f.tenant, f.creche, f.educator, ('2026-09-11'::timestamp + time '11:00') at time zone 'Africa/Algiers', ('2026-09-11'::timestamp + time '11:30') at time zone 'Africa/Algiers'),
    '23514', 'outside_opening_hours'));
  -- A programme of another class is refused as before.
  perform pg_temp.note('A2 foreign programme', pg_temp.expect_error(format(
    'insert into public.kg_learning_lessons (tenant_id, class_id, program_id, membership_id, title, kind, starts_at, ends_at) values (%L, %L, %L, %L, ''Lecture'', ''activity'', %L, %L)',
    f.tenant, f.creche, (select id from public.kg_learning_programs where tenant_id = f.tenant and class_id <> f.creche limit 1), f.educator,
    (f.day::timestamp + time '12:00') at time zone 'Africa/Algiers', (f.day::timestamp + time '12:30') at time zone 'Africa/Algiers'),
    '23514', 'invalid_program'));
end $$;

-- 3. The same block repeated over four weeks (the next slot, so the single
-- block above stays): no programme, so no programme dates to fit.
do $$
declare f fx; n int;
begin
  select * into f from fx;
  insert into public.kg_learning_lessons (tenant_id, class_id, program_id, membership_id, title, kind, starts_at, ends_at)
  select f.tenant, f.creche, null, f.educator, 'Éveil', 'care',
         ((f.day + w * 7)::timestamp + time '12:00') at time zone 'Africa/Algiers',
         ((f.day + w * 7)::timestamp + time '12:30') at time zone 'Africa/Algiers'
    from generate_series(0, 3) w;
  select count(*) into n from public.kg_learning_lessons
   where class_id = f.creche and title = 'Éveil' and program_id is null and starts_at >= f.day::timestamp at time zone 'Africa/Algiers';
  perform pg_temp.note('A3 four-week series', n || ' rows, dates ' || (select string_agg((starts_at at time zone 'Africa/Algiers')::date::text, ', ' order by starts_at)
    from public.kg_learning_lessons where class_id = f.creche and title = 'Éveil' and program_id is null));
  -- The staff-bookings ledger (0150) still follows every row, programme or not.
  perform pg_temp.note('A3 staff bookings', (select count(*) from kg_scheduler_private.staff_bookings b
    join public.kg_learning_lessons l on l.id = b.lesson_id
   where b.membership_id = f.educator and l.class_id = f.creche and l.title in ('Accueil', 'Éveil') and l.program_id is null)::text
    || ' bookings mirror the 5 rows');
end $$;

do $$
declare v text;
begin
  select string_agg(step || ' → ' || observed, E'\n' order by n) into v from rehearsal_log;
  raise exception E'REHEARSAL part A (0153) — everything below is rolled back\n%', v;
end $$;
rollback;
\endif
