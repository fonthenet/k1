-- psql -v ON_ERROR_STOP=1 -f supabase/tests/scheduler_hardening.sql
-- Run AFTER the migration. Every fixture and test change is rolled back.
\set ON_ERROR_STOP on
begin;
\ir scheduler_fixture.sql
select set_config('request.jwt.claim.sub',actor::text,true) from scheduler_fixture;
set local role authenticated;

do $$
declare f record; l uuid; s uuid; spare uuid; before_row jsonb;
begin
  select * into f from scheduler_fixture;
  l := pg_temp.lesson('2026-09-13 09:00+01');
  -- Lesson first -> session conflict, including containment and exact equality.
  perform pg_temp.expect_error($q$select pg_temp.session('2026-09-13 09:30+01')$q$,'23P01');
  perform pg_temp.expect_error($q$select pg_temp.session('2026-09-13 09:00+01')$q$,'23P01');
  s := pg_temp.session('2026-09-13 10:00+01'); -- Half-open boundary is allowed.
  perform pg_temp.expect_error($q$select pg_temp.lesson('2026-09-13 10:30+01')$q$,'23P01');
  spare := pg_temp.session('2026-09-13 09:00+01','scheduled',f.other_member);
  perform pg_temp.expect_error(format('update public.kg_sessions set therapist_id=%L where id=%L',f.member,spare),'23P01');
  select to_jsonb(x) into before_row from public.kg_sessions x where id=s;
  perform pg_temp.expect_error(format('update public.kg_sessions set scheduled_at=''2026-09-13 09:30+01'' where id=%L',s),'23P01');
  perform pg_temp.assert_true((select to_jsonb(x)=before_row from public.kg_sessions x where id=s),'failed session reschedule is atomic');
  perform pg_temp.expect_error(format('update public.kg_learning_lessons set starts_at=''2026-09-13 10:00+01'',ends_at=''2026-09-13 11:00+01'' where id=%L',l),'23P01');

  -- Cancellation preserves the source and frees the slot; both revival paths fail.
  update public.kg_learning_lessons set status='cancelled' where id=l;
  s := pg_temp.session('2026-09-13 09:00+01');
  perform pg_temp.expect_error(format('update public.kg_learning_lessons set status=''scheduled'' where id=%L',l),'23P01');
  perform pg_temp.expect_error(format('update public.kg_learning_lessons set status=''completed'' where id=%L',l),'23P01');
  perform pg_temp.assert_true((select status='cancelled' from public.kg_learning_lessons where id=l),'failed revival preserves cancelled lesson');
  update public.kg_sessions set status='cancelled' where id=s;
  update public.kg_learning_lessons set status='completed' where id=l;
  update public.kg_learning_lessons set status='scheduled' where id=l;
  perform pg_temp.expect_error(format('update public.kg_sessions set status=''scheduled'' where id=%L',s),'23P01');
  perform pg_temp.expect_error(format('update public.kg_sessions set status=''completed'' where id=%L',s),'23P01');
  perform pg_temp.expect_error(format('update public.kg_sessions set status=''no_show'' where id=%L',s),'23P01');
  update public.kg_learning_lessons set status='cancelled' where id=l;
  update public.kg_sessions set status='no_show' where id=s;
  perform pg_temp.expect_error($q$select pg_temp.lesson('2026-09-13 09:00+01')$q$,'23P01');
  update public.kg_sessions set status='completed' where id=s;
  perform pg_temp.expect_error($q$select pg_temp.lesson('2026-09-13 09:00+01')$q$,'23P01');
  update public.kg_sessions set therapist_id=null where id=s;
  update public.kg_learning_lessons set status='scheduled' where id=l;
  perform pg_temp.expect_error(format('update public.kg_sessions set therapist_id=%L where id=%L',f.member,s),'23P01');
  update public.kg_learning_lessons set status='cancelled' where id=l;
  update public.kg_sessions set therapist_id=f.member where id=s;
  -- Source delete cascades only its derived booking, never another source.
  delete from public.kg_sessions where id=s;
  update public.kg_learning_lessons set status='scheduled' where id=l;
  perform pg_temp.assert_true((select count(*)=1 from public.kg_learning_lessons where id=l),'session deletion preserves lesson');
  perform pg_temp.expect_error(format('update public.kg_sessions set duration_min=0 where id=%L',spare),'23514');
  perform pg_temp.expect_error(format('update public.kg_sessions set duration_min=-1 where id=%L',spare),'23514');
  -- Same-module session collisions are covered by the same exclusion constraint.
  perform pg_temp.expect_error($q$select pg_temp.session('2026-09-13 10:15+01')$q$,'23P01');
  l := pg_temp.lesson('2026-09-16 09:00+01','scheduled',f.other_member);
  s := pg_temp.session('2026-09-16 09:00+01');
  perform pg_temp.expect_error(format('update public.kg_learning_lessons set membership_id=%L where id=%L',f.member,l),'23P01');
  spare := pg_temp.session('2026-09-16 08:00+01','scheduled',f.other_member);
  perform pg_temp.expect_error(format('update public.kg_sessions set duration_min=90 where id=%L',spare),'23P01');
  -- Keep the independent class exclusion even for a different staff member.
  perform pg_temp.expect_error($q$select pg_temp.lesson('2026-09-13 09:30+01','scheduled')$q$,'23P01');
end $$;
reset role;

-- Exercise each schedule-validation bypass and retain exact frontend error keys.
do $$
declare f record; l uuid; before_row jsonb;
begin
  select * into f from scheduler_fixture;
  l := pg_temp.lesson('2026-09-14 09:00+01','cancelled');
  update public.kg_learning_programs set archived=true where id=f.program;
  perform pg_temp.expect_error(format('update public.kg_learning_lessons set status=''completed'' where id=%L',l),'23514','archived_program');
  perform pg_temp.expect_error(format('update public.kg_learning_lessons set status=''scheduled'' where id=%L',l),'23514','archived_program');
  update public.kg_learning_programs set archived=false where id=f.program;
  update public.kg_learning_lessons set status='completed' where id=l;
  update public.kg_learning_programs set archived=true where id=f.program;
  perform pg_temp.expect_error(format('update public.kg_learning_lessons set status=''scheduled'' where id=%L',l),'23514','archived_program');
  update public.kg_learning_lessons set title='Historical title correction' where id=l;
  update public.kg_learning_programs set archived=false where id=f.program;
  select to_jsonb(x) into before_row from public.kg_learning_lessons x where id=l;
  perform pg_temp.expect_error(format('update public.kg_learning_lessons set program_id=%L where id=%L',f.archived_program,l),'23514','archived_program');
  perform pg_temp.assert_true((select to_jsonb(x)=before_row from public.kg_learning_lessons x where id=l),'failed program reassignment preserves history');
  perform pg_temp.expect_error(format('update public.kg_learning_lessons set program_id=%L where id=%L',f.short_program,l),'23514','outside_program_dates');
  update public.kg_memberships set status='disabled' where id=f.member;
  perform pg_temp.expect_error(format('update public.kg_learning_lessons set program_id=%L where id=%L',f.other_program,l),'23514','assign_staff_first');
  perform pg_temp.expect_error(format('update public.kg_learning_lessons set status=''scheduled'' where id=%L',l),'23514','assign_staff_first');
  update public.kg_learning_lessons set status='cancelled' where id=l;
  perform pg_temp.expect_error(format('update public.kg_learning_lessons set status=''completed'' where id=%L',l),'23514','assign_staff_first');
  update public.kg_memberships set status='active' where id=f.member;
  delete from public.kg_class_staff where class_id=f.class and membership_id=f.member;
  perform pg_temp.expect_error(format('update public.kg_learning_lessons set status=''completed'' where id=%L',l),'23514','assign_staff_first');
  insert into public.kg_class_staff(class_id,membership_id) values(f.class,f.member);
  update public.kg_structures set opening_hours='{"mon":null}' where id=f.structure;
  perform pg_temp.expect_error(format('update public.kg_learning_lessons set status=''completed'' where id=%L',l),'23514','outside_opening_hours');
  perform pg_temp.expect_error(format('update public.kg_learning_lessons set program_id=%L where id=%L',f.other_program,l),'23514','outside_opening_hours');
  update public.kg_structures set opening_hours=null where id=f.structure;
  update public.kg_learning_lessons set status='completed' where id=l;
  update public.kg_structures set opening_hours='{"mon":null}' where id=f.structure;
  perform pg_temp.expect_error(format('update public.kg_learning_lessons set status=''scheduled'' where id=%L',l),'23514','outside_opening_hours');
  update public.kg_structures set opening_hours=null where id=f.structure;
  update public.kg_learning_lessons set program_id=f.other_program,status='scheduled' where id=l;
  -- Completing an already scheduled historical lesson is not rescheduling.
  update public.kg_learning_programs set archived=true where id=f.other_program;
  update public.kg_learning_lessons set status='completed' where id=l;
  perform pg_temp.assert_true((select status='completed' from public.kg_learning_lessons where id=l),'historical completion still works');
end $$;

-- Derived state equals source state after all successful and rejected writes.
select pg_temp.assert_true(not exists (
  (select l.id lesson_id,null::uuid session_id,l.membership_id,tstzrange(l.starts_at,l.ends_at,'[)') during
   from public.kg_learning_lessons l where l.status<>'cancelled'
   union all select null,s.id,s.therapist_id,tstzrange(s.scheduled_at,s.scheduled_at+s.duration_min*interval '1 minute','[)')
   from public.kg_sessions s where s.status<>'cancelled' and s.therapist_id is not null)
  except select lesson_id,session_id,membership_id,during from kg_scheduler_private.staff_bookings
),'all source bookings present');
select pg_temp.assert_true(not exists (
  select lesson_id,session_id,membership_id,during from kg_scheduler_private.staff_bookings
  except (select l.id,null::uuid,l.membership_id,tstzrange(l.starts_at,l.ends_at,'[)') from public.kg_learning_lessons l where l.status<>'cancelled'
   union all select null,s.id,s.therapist_id,tstzrange(s.scheduled_at,s.scheduled_at+s.duration_min*interval '1 minute','[)')
   from public.kg_sessions s where s.status<>'cancelled' and s.therapist_id is not null)
),'no stale or phantom bookings');
set local role authenticated;
select pg_temp.expect_error('select * from kg_scheduler_private.staff_bookings','42501');
select pg_temp.expect_error('delete from kg_scheduler_private.staff_bookings','42501');
select pg_temp.expect_error('select kg_scheduler_private.sync_staff_booking()','42501');
reset role;
set local role anon;
select pg_temp.expect_error('select * from kg_scheduler_private.staff_bookings','42501');
reset role;
rollback;
select 'PASS: scheduler guards, both conflict directions, lifecycle, atomicity, ledger and ACL checks; all fixtures rolled back' result;
