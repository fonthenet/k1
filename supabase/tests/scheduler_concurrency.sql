-- LOCAL DISPOSABLE DATABASE ONLY, after the migration. Uses two actual backend
-- connections, not sequential simulations. Fixture parents must be committed
-- so both connections can see them; all test bookings are rolled back/deleted
-- and fixture parents explicitly removed before the final preservation check.
\set ON_ERROR_STOP on
create extension if not exists dblink;
create temporary table scheduler_before_concurrency as
select 'lesson' source,id,to_jsonb(l) data from public.kg_learning_lessons l
union all select 'session',id,to_jsonb(s) from public.kg_sessions s;
begin;
\ir scheduler_fixture.sql
commit;

do $$
declare
  f record; connection text; isolation text; direction text; winner_commits boolean;
  lesson_sql text; session_sql text; first_sql text; second_sql text;
  pid_a integer; pid_b integer; blocked boolean; rejected boolean; n integer;
begin
  select * into f from scheduler_fixture;
  connection := format('host=%L port=%L dbname=%L user=%L',
    split_part(current_setting('unix_socket_directories'),',',1),
    current_setting('port'),current_database(),current_user);
  perform dblink_connect('scheduler_a',connection);
  perform dblink_connect('scheduler_b',connection);
  select pid into pid_a from dblink('scheduler_a','select pg_backend_pid()') as t(pid integer);
  select pid into pid_b from dblink('scheduler_b','select pg_backend_pid()') as t(pid integer);
  lesson_sql := format($q$insert into public.kg_learning_lessons
    (tenant_id,class_id,program_id,membership_id,title,kind,starts_at,ends_at)
    values (%L,%L,%L,%L,'Concurrent lesson','lesson','2026-09-15 09:00+01','2026-09-15 10:00+01')$q$,
    f.tenant,f.class,f.program,f.member);
  session_sql := format($q$insert into public.kg_sessions
    (tenant_id,child_id,therapist_id,scheduled_at,duration_min)
    values (%L,%L,%L,'2026-09-15 09:30+01',60)$q$,f.tenant,f.child,f.member);
  foreach isolation in array array['read committed','repeatable read'] loop
    foreach direction in array array['lesson first','session first'] loop
      foreach winner_commits in array array[true,false] loop
        first_sql := case when direction='lesson first' then lesson_sql else session_sql end;
        second_sql := case when direction='lesson first' then session_sql else lesson_sql end;
        perform dblink_exec('scheduler_a','begin isolation level '||isolation);
        perform dblink_exec('scheduler_b','begin isolation level '||isolation);
        perform dblink_exec('scheduler_a',format('set local request.jwt.claim.sub=%L',f.actor));
        perform dblink_exec('scheduler_b',format('set local request.jwt.claim.sub=%L',f.actor));
        perform dblink_exec('scheduler_a','set local role authenticated');
        perform dblink_exec('scheduler_b','set local role authenticated');
        perform dblink_exec('scheduler_a','set local statement_timeout=''10s''');
        perform dblink_exec('scheduler_b','set local statement_timeout=''10s''');
        -- Establish B's snapshot BEFORE A's new booking is even inserted.
        perform * from dblink('scheduler_b','select count(*) from public.kg_sessions') as t(n bigint);
        perform dblink_exec('scheduler_a',first_sql);
        perform dblink_send_query('scheduler_b',second_sql||' returning id');
        blocked := false;
        for n in 1..100 loop
          blocked := pid_a = any(pg_blocking_pids(pid_b));
          exit when blocked;
          perform pg_sleep(0.01);
        end loop;
        perform pg_temp.assert_true(blocked,'second writer waits on uncommitted exclusion entry: '||direction||' / '||isolation);
        perform dblink_exec('scheduler_a',case when winner_commits then 'commit' else 'rollback' end);
        rejected := false;
        begin
          perform * from dblink_get_result('scheduler_b') as t(id uuid);
        exception when exclusion_violation then rejected := true;
        end;
        perform pg_temp.assert_true(rejected=winner_commits,
          'committed winner rejects with 23P01; rolled-back winner releases slot: '||direction||' / '||isolation);
        -- Drain the async command before issuing another command on B.
        perform * from dblink_get_result('scheduler_b') as t(id uuid);
        perform dblink_exec('scheduler_b','rollback');
        -- Cleanup in a separate committed transaction, not this DO's snapshot:
        -- an uncommitted local delete would itself block the next race's A.
        perform dblink_exec('scheduler_a',format('delete from public.kg_learning_lessons where tenant_id=%L',f.tenant));
        perform dblink_exec('scheduler_a',format('delete from public.kg_sessions where tenant_id=%L',f.tenant));
        raise notice 'PASS: %, %, winner commits=%',direction,isolation,winner_commits;
      end loop;
    end loop;
  end loop;
  perform dblink_disconnect('scheduler_a');
  perform dblink_disconnect('scheduler_b');
end $$;
delete from public.kg_learning_programs where tenant_id=(select tenant from scheduler_fixture);
delete from public.kg_tenants where id=(select tenant from scheduler_fixture);
select pg_temp.assert_true(not exists (
  (select 'lesson',id,to_jsonb(l) from public.kg_learning_lessons l
   union all select 'session',id,to_jsonb(s) from public.kg_sessions s)
  except select * from scheduler_before_concurrency
),'concurrency tests do not change historical rows');
select pg_temp.assert_true((select count(*) from scheduler_before_concurrency)=
  (select count(*) from public.kg_learning_lessons)+(select count(*) from public.kg_sessions),
  'concurrency tests leave no source fixtures behind');
select 'PASS: 8 two-connection races, both directions, READ COMMITTED / REPEATABLE READ, commit / rollback; fixtures removed' result;
