-- LOCAL DISPOSABLE DATABASE ONLY, immediately after scheduler_local_harness.sql.
-- Tests fail-safe rejection, successful backfill, and byte-for-byte source
-- preservation. The one deleted row below is an explicitly created QA overlap.
\set ON_ERROR_STOP on
begin;
\ir scheduler_fixture.sql
select pg_temp.lesson('2026-09-13 08:00+01','completed');
select pg_temp.lesson('2026-09-13 09:00+01','cancelled');
select pg_temp.session('2026-09-13 10:00+01','completed');
select pg_temp.session('2026-09-13 11:00+01','no_show');
select pg_temp.session('2026-09-13 12:00+01','scheduled');
select pg_temp.session('2026-09-13 12:00+01','cancelled');
create temporary table scheduler_bad as select pg_temp.session('2026-09-13 12:30+01') id;
create temporary table source_snapshot as
select 'lesson' source,id,to_jsonb(l) data from public.kg_learning_lessons l
union all select 'session',id,to_jsonb(s) from public.kg_sessions s;
commit;
-- Expected 23P01 followed by aborted-transaction errors; COMMIT rolls it back.
\set ON_ERROR_STOP off
\ir ../migrations/0150_kg_scheduler_hardening.sql
\set ON_ERROR_STOP on
select pg_temp.assert_true(to_regnamespace('kg_scheduler_private') is null,'overlap prevents any schema installation');
select pg_temp.assert_true(not exists (
  (select 'lesson',id,to_jsonb(l) from public.kg_learning_lessons l
   union all select 'session',id,to_jsonb(s) from public.kg_sessions s)
  except select * from source_snapshot
),'failed migration does not change rows');
select pg_temp.assert_true((select count(*) from source_snapshot)=
  (select count(*) from public.kg_learning_lessons)+(select count(*) from public.kg_sessions),
  'failed migration does not delete rows');
delete from public.kg_sessions where id=(select id from scheduler_bad);
delete from source_snapshot where source='session' and id=(select id from scheduler_bad);
\ir ../migrations/0150_kg_scheduler_hardening.sql
select pg_temp.assert_true(not exists (
  (select 'lesson',id,to_jsonb(l) from public.kg_learning_lessons l
   union all select 'session',id,to_jsonb(s) from public.kg_sessions s)
  except select * from source_snapshot
),'successful migration preserves complete historical row contents');
select pg_temp.assert_true((select count(*) from source_snapshot)=
  (select count(*) from public.kg_learning_lessons)+(select count(*) from public.kg_sessions),
  'successful migration does not delete rows');
select pg_temp.assert_true((select count(*)=4 from kg_scheduler_private.staff_bookings),'only occupied sources backfilled');
-- Remove only this test's committed parents/history from the disposable DB.
delete from public.kg_learning_lessons where tenant_id=(select tenant from scheduler_fixture);
delete from public.kg_sessions where tenant_id=(select tenant from scheduler_fixture);
delete from public.kg_learning_programs where tenant_id=(select tenant from scheduler_fixture);
delete from public.kg_tenants where id=(select tenant from scheduler_fixture);
select 'PASS: existing overlap rejected atomically; successful backfill preserves every source row, including completed/cancelled/no_show history' result;
