-- psql -v ON_ERROR_STOP=1 -f supabase/tests/room_bookings.sql
-- Run AFTER scheduler_local_harness.sql (0123, 0150, 0155 and 0156 replayed)
-- on a disposable database. Every fixture and test change is rolled back.
--
-- The two tiers under test, in one sentence: a room reserved explicitly for a
-- cours, an activity, a follow-up or an event cannot be reserved twice; a
-- cours in its class's own room is warned, never refused.
--
-- Fixture dates are September 2026 and the guards compare to now(): the
-- activity checks, the class move and the usage counts only look at bookings
-- that end after now(), so re-date the fixtures once the calendar passes them.
\set ON_ERROR_STOP on
begin;
-- Ranges are printed in DETAIL in the session's time zone; pin it so a dated
-- needle reads the same on every machine.
set local time zone 'Africa/Algiers';
\ir scheduler_fixture.sql

-- The fixture's expect_error compares sqlerrm exactly. A room refusal comes
-- from an exclusion constraint or a guard whose message merely CONTAINS
-- "room_booking" (that substring is what src/lib/db-clash.ts keys on), so
-- every refusal below is asserted with the needle, never with the code alone:
-- the lessons table carries its own class and staff exclusions, and a 23P01
-- from one of those would pass a code-only check for the wrong reason.
create function pg_temp.expect_room_refusal(statement text, detail_needle text default null)
returns void language plpgsql as $$
declare d text;
begin
  begin execute statement;
  exception when others then
    get stacked diagnostics d = pg_exception_detail;
    if sqlstate = '23P01' and position('room_booking' in sqlerrm) > 0
       and (detail_needle is null or position(detail_needle in coalesce(d, '')) > 0) then
      return;
    end if;
    raise exception 'Expected a room refusal (23P01, message containing room_booking, detail containing "%"), got %: % | DETAIL %',
      coalesce(detail_needle, ''), sqlstate, sqlerrm, coalesce(d, '');
  end;
  raise exception 'Expected a room refusal, statement succeeded: %', statement;
end $$;
-- 23503 / 23514 refusals name their rule in the message or in the constraint
-- name inside it; the needle is searched in the message and the DETAIL.
create function pg_temp.expect_code(statement text, code text, needle text)
returns void language plpgsql as $$
declare d text;
begin
  begin execute statement;
  exception when others then
    get stacked diagnostics d = pg_exception_detail;
    if sqlstate = code and position(needle in sqlerrm || coalesce(d, '')) > 0 then return; end if;
    raise exception 'Expected % containing "%", got %: %', code, needle, sqlstate, sqlerrm;
  end;
  raise exception 'Expected % containing "%", statement succeeded: %', code, needle, statement;
end $$;
-- A cours of any class, one hour, optionally pinned to a room. The fixture's
-- pg_temp.lesson() only writes the first class's cours, always inherited.
create function pg_temp.room_lesson(cls uuid, prog uuid, staff uuid, title text, at_time text, room uuid default null)
returns uuid language plpgsql as $$
declare result uuid;
begin
  insert into public.kg_learning_lessons(tenant_id,class_id,program_id,membership_id,title,kind,starts_at,ends_at,status,room_id)
  select tenant,cls,prog,staff,title,'lesson',at_time::timestamptz,at_time::timestamptz+interval '1 hour','scheduled',room
  from scheduler_fixture returning id into result;
  return result;
end $$;
-- A follow-up of the fixture child, explicitly in a room.
create function pg_temp.room_session(staff uuid, at_time text, minutes int, room uuid)
returns uuid language plpgsql as $$
declare result uuid;
begin
  insert into public.kg_sessions(tenant_id,child_id,therapist_id,scheduled_at,duration_min,status,room_id)
  select tenant,child,staff,at_time::timestamptz,minutes,'scheduled',room from scheduler_fixture returning id into result;
  return result;
end $$;

-- The fixture has no rooms (0123 was not in its harness before this build):
-- four are created for the fixture tenant first. Everything runs as the
-- fixture's owner through RLS, as the product does.
select set_config('request.jwt.claim.sub',actor::text,true) from scheduler_fixture;
set local role authenticated;

do $$
declare
  f record; room_a uuid; room_b uuid; room_c uuid; room_d uuid; other_prog uuid;
  l1 uuid; l2 uuid; l2b uuid; l3 uuid; l4 uuid; e_lesson uuid; home uuid;
  s uuid; ev uuid; act uuid; act2 uuid; past uuid; n int; u record;
begin
  select * into f from scheduler_fixture;
  insert into public.kg_rooms(tenant_id,name,capacity) values (f.tenant,'QA Salle A',20) returning id into room_a;
  insert into public.kg_rooms(tenant_id,name,capacity) values (f.tenant,'QA Salle B',20) returning id into room_b;
  insert into public.kg_rooms(tenant_id,name,capacity) values (f.tenant,'QA Salle C',20) returning id into room_c;
  insert into public.kg_rooms(tenant_id,name,capacity) values (f.tenant,'QA Salle D',20) returning id into room_d;

  -- 1. INHERITED × INHERITED is tolerated. Both classes live in room A and
  --    teach at the same hour (the demo's Salle 6): both rows land, both are
  --    ledgered, both are visible to the reader, nothing is refused. The
  --    fixture puts only `member` on the second class's team and `member`
  --    teaches l1, so the overlapping l2 needs `other_member` on that team
  --    and a programme of that class (the fixture's all belong to `class`).
  update public.kg_classes set room_id=room_a where id in (f.class,f.other_class);
  insert into public.kg_class_staff(class_id,membership_id) values (f.other_class,f.other_member);
  insert into public.kg_learning_programs(tenant_id,class_id,title,starts_on,ends_on)
    values (f.tenant,f.other_class,'Scheduler B programme','2026-09-01','2026-12-31') returning id into other_prog;
  l1 := pg_temp.lesson('2026-09-13 09:00+01');
  l2 := pg_temp.room_lesson(f.other_class,other_prog,f.other_member,'B lesson','2026-09-13 09:30+01');
  perform pg_temp.assert_true(
    (select count(*)=2 from public.kg_bookings('2026-09-13 08:00+01','2026-09-13 12:00+01') b
      where b.room_id=room_a and not b.explicit and b.source_id in (l1,l2)),
    'two inherited bookings of one room overlap and are visible');
  l2b := pg_temp.room_lesson(f.other_class,other_prog,f.other_member,'B afternoon','2026-09-13 14:00+01');
  perform pg_temp.assert_true(
    (select room_id=room_a and not explicit from public.kg_bookings('2026-09-13 13:00+01','2026-09-13 16:00+01') b where b.source_id=l2b),
    'a cours with no room of its own is booked in its class''s room');

  -- 2. EXPLICIT × EXPLICIT is refused. l2 pins room B; a third cours pinning
  --    room B over it is refused on the ROOM (the class and staff exclusions
  --    are not in the way: another class, a free teacher) and nothing is
  --    written. Half-open bounds: 10:30, right after l2, is free.
  update public.kg_learning_lessons set room_id=room_b where id=l2;
  perform pg_temp.expect_room_refusal(format('select pg_temp.room_lesson(%L,%L,%L,%L,%L,%L)',
    f.class,f.program,f.member,'C lesson','2026-09-13 10:00+01',room_b));
  perform pg_temp.assert_true((select count(*)=3 from public.kg_learning_lessons where tenant_id=f.tenant),'refused cours was not written');
  l3 := pg_temp.room_lesson(f.class,f.program,f.member,'C lesson','2026-09-13 10:30+01',room_b);

  -- 3. EXPLICIT × INHERITED is tolerated. A follow-up explicitly in room A
  --    during the inherited l1 lands. Rescheduled to 10:45 in room B it meets
  --    l3 (explicit): refused on the room — other_member is free then, so
  --    the staff ledger cannot be the reason — and the row is untouched.
  --    At 11:30, right after l3, it lands.
  s := pg_temp.room_session(f.other_member,'2026-09-13 09:00+01',30,room_a);
  perform pg_temp.expect_room_refusal(format('update public.kg_sessions set scheduled_at=''2026-09-13 10:45+01'', room_id=%L where id=%L',room_b,s));
  perform pg_temp.assert_true((select room_id=room_a and scheduled_at='2026-09-13 09:00+01' from public.kg_sessions where id=s),'refused reschedule is atomic');
  update public.kg_sessions set scheduled_at='2026-09-13 11:30+01', room_id=room_b where id=s;

  -- 4. Cancelling frees the room; reviving over an occupant is refused, as
  --    0150 does for a person.
  update public.kg_sessions set status='cancelled' where id=s;
  update public.kg_learning_lessons set starts_at='2026-09-13 11:30+01', ends_at='2026-09-13 12:30+01' where id=l3;
  perform pg_temp.expect_room_refusal(format('update public.kg_sessions set status=''scheduled'' where id=%L',s));
  perform pg_temp.assert_true((select status='cancelled' from public.kg_sessions where id=s),'failed revival preserves the cancelled follow-up');
  update public.kg_learning_lessons set starts_at='2026-09-13 10:30+01', ends_at='2026-09-13 11:30+01' where id=l3;
  update public.kg_sessions set status='scheduled' where id=s;

  -- 5. An event with a room needs an end (23514); over the explicit follow-up
  --    in room B it is refused; over the inherited l1 in room A it lands and
  --    is a booking.
  perform pg_temp.expect_code(format('insert into public.kg_events(tenant_id,title,start_at,room_id) values (%L,''QA'',''2026-09-13 14:00+01'',%L)',f.tenant,room_b),
    '23514','room_needs_range');
  perform pg_temp.expect_room_refusal(format('insert into public.kg_events(tenant_id,title,start_at,end_at,room_id) values (%L,''QA'',''2026-09-13 11:30+01'',''2026-09-13 12:00+01'',%L)',f.tenant,room_b));
  insert into public.kg_events(tenant_id,title,start_at,end_at,room_id)
    values (f.tenant,'QA','2026-09-13 09:00+01','2026-09-13 09:30+01',room_a) returning id into ev;
  perform pg_temp.assert_true(
    (select count(*)=1 from public.kg_bookings('2026-09-13 08:00+01','2026-09-13 12:00+01') b where b.source='event' and b.source_id=ev and b.room_id=room_a and b.explicit),
    'the event is a booking');

  -- 6. Weekly activity slots (2026-09-13 is a Sunday). Over the explicit l3
  --    in room B: refused. On Monday: lands. An explicit cours next Monday at
  --    that hour in room B: refused, with the dated occurrence in DETAIL. An
  --    inherited cours of `class` (room A) at that hour: lands.
  perform pg_temp.expect_room_refusal(format('insert into public.kg_activities(tenant_id,name,room_id,schedule) values (%L,''QA act'',%L,''[{"day":"sun","start":"10:00","end":"11:00"}]'')',f.tenant,room_b));
  insert into public.kg_activities(tenant_id,name,room_id,schedule)
    values (f.tenant,'QA act',room_b,'[{"day":"mon","start":"09:00","end":"10:00"}]') returning id into act;
  perform pg_temp.expect_room_refusal(format('select pg_temp.room_lesson(%L,%L,%L,%L,%L,%L)',
    f.class,f.program,f.member,'D lesson','2026-09-14 09:30+01',room_b), '["2026-09-14 09:00:00+01","2026-09-14 10:00:00+01")');
  perform pg_temp.lesson('2026-09-14 09:30+01');
  -- Activity × activity: same room, same weekday, overlapping clock times
  -- is refused (the DETAIL carries a weekday, not a date); another weekday lands.
  perform pg_temp.expect_room_refusal(format('insert into public.kg_activities(tenant_id,name,room_id,schedule) values (%L,''QA act 2'',%L,''[{"day":"mon","start":"09:30","end":"10:30"}]'')',f.tenant,room_b),
    'Key (room_id, weekday)');
  insert into public.kg_activities(tenant_id,name,room_id,schedule)
    values (f.tenant,'QA act 2',room_b,'[{"day":"tue","start":"09:30","end":"10:30"}]') returning id into act2;
  -- The legacy shape is still accepted at the door and stored in the one
  -- shape (0156). The same Tuesday slot in the other spelling is not a change
  -- for the guard; then the spec's Monday slot — act holds Monday 09:00 in
  -- room B, so act2 leaves the room in the same statement: the point of this
  -- write is the shape, and kg_activity_slots must expand the written value
  -- either way.
  update public.kg_activities set schedule='[{"day":"tue","time":"09:30"}]' where id=act2;
  perform pg_temp.assert_true((select schedule='[{"day":"tue","start":"09:30","end":"10:30"}]'::jsonb from public.kg_activities where id=act2),
    'a legacy slot re-saved in the other spelling reads back canonical and unchanged');
  update public.kg_activities set schedule='[{"day":"mon","time":"09:00"}]', room_id=null where id=act2;
  perform pg_temp.assert_true((select schedule='[{"day":"mon","start":"09:00","end":"10:00"}]'::jsonb from public.kg_activities where id=act2),
    'the legacy {day,time} shape is stored as {day,start,end} with a one-hour end');
  perform pg_temp.assert_true(
    (select count(*)=1 from public.kg_activity_slots('[{"day":"mon","time":"09:00"}]'::jsonb) where dow=1 and starts='09:00' and ends='10:00')
    and (select count(*)=1 from public.kg_activity_slots('[{"day":1,"start":"09:00","end":"10:00"}]'::jsonb) where dow=1 and starts='09:00' and ends='10:00'),
    'kg_activity_slots expands the legacy and the integer-day shapes alike');
  perform pg_temp.expect_error(format('update public.kg_activities set schedule=''[{"day":"xx","time":"09:00"}]'' where id=%L',act2),'23514','activity_schedule_invalid');
  perform pg_temp.expect_code(format('update public.kg_activities set schedule=''[{"day":"sun","start":"09:00","end":"09:00"}]'' where id=%L',act2),
    '23514','kg_activities_schedule_shape');
  -- Deactivating frees the weekday; reactivating over a cours pinned there
  -- meanwhile is refused; once the cours has moved, it lands.
  update public.kg_activities set active=false where id=act;
  e_lesson := pg_temp.room_lesson(f.class,f.program,f.member,'E lesson','2026-09-21 09:00+01',room_b);
  perform pg_temp.expect_room_refusal(format('update public.kg_activities set active=true where id=%L',act));
  perform pg_temp.assert_true((select not active from public.kg_activities where id=act),'failed reactivation leaves the activity inactive');
  update public.kg_learning_lessons set starts_at='2026-09-21 11:00+01', ends_at='2026-09-21 12:00+01' where id=e_lesson;
  update public.kg_activities set active=true where id=act;
  -- The reader expands the weekly slot into dated occurrences for a window.
  perform pg_temp.assert_true(
    (select count(*)=1 from public.kg_bookings('2026-09-20 00:00+01','2026-09-27 00:00+01') o
      where o.source='activity' and o.source_id=act and o.room_id=room_b and o.explicit
        and o.starts_at='2026-09-21 09:00+01' and o.ends_at='2026-09-21 10:00+01'),
    'kg_bookings expands the weekly slot over a week');

  -- 7. The past-update path. History is never checked against an activity
  --    placed since, and an edit that changes nothing about where or when
  --    re-checks nothing: the follow-up of last month in room B (the activity
  --    meets Mondays 09:00 there) lands, its outcome lands, its duration
  --    lands because it is still in the past; the same follow-up ahead is
  --    refused; a title-only edit of a cours and a published flip land.
  past := pg_temp.room_session(f.other_member,'2026-08-03 09:00+01',30,room_b);
  update public.kg_sessions set status='completed', notes='Séance tenue, bon contact.' where id=past;
  update public.kg_sessions set duration_min=45 where id=past;
  perform pg_temp.assert_true((select status='completed' and duration_min=45 from public.kg_sessions where id=past),'past follow-up edits land');
  perform pg_temp.expect_room_refusal(format('select pg_temp.room_session(%L,%L,30,%L)',f.other_member,'2026-09-28 09:15+01',room_b));
  update public.kg_learning_lessons set title='E lesson, retitled' where id=e_lesson;
  update public.kg_sessions set published=true where id=past;

  -- 8. A class that moves room takes its inherited cours with it, history
  --    included, and never refuses: l1 follows into room B although it now
  --    overlaps the explicit l2 there (tolerated). A cours of the class that
  --    had pinned room B itself (l4, a Wednesday the activity does not hold)
  --    is unpinned by the move — the column says "the class's room" again —
  --    as l3 and E are, their bookings staying in room B; another class's
  --    explicit cours (l2) is untouched. A class with no room books nothing;
  --    given a room again, its cours are booked again (the insert path).
  l4 := pg_temp.room_lesson(f.class,f.program,f.member,'F lesson','2026-09-16 09:00+01',room_b);
  update public.kg_classes set room_id=room_b where id=f.class;
  perform pg_temp.assert_true((select room_id=room_b and not explicit from public.kg_bookings('2026-09-13 08:00+01','2026-09-13 12:00+01') b where b.source_id=l1),'inherited cours followed the class into room B');
  perform pg_temp.assert_true((select room_id is null from public.kg_learning_lessons where id=l4),'a cours pinned to the room the class moved into is unpinned');
  perform pg_temp.assert_true((select room_id is null from public.kg_learning_lessons where id=l3)
    and (select room_id=room_b and not explicit from public.kg_bookings('2026-09-13 08:00+01','2026-09-13 12:00+01') b where b.source_id=l3),
    'l3 stays booked in room B, now as the class''s room');
  perform pg_temp.assert_true((select room_id=room_b from public.kg_learning_lessons where id=l2)
    and (select room_id=room_b and explicit from public.kg_bookings('2026-09-13 08:00+01','2026-09-13 12:00+01') b where b.source_id=l2),
    'another class''s explicit cours keeps its room through the move');
  update public.kg_classes set room_id=null where id=f.other_class;
  perform pg_temp.assert_true((select room_id is null from public.kg_bookings('2026-09-13 13:00+01','2026-09-13 16:00+01') b where b.source_id=l2b),'a class without a room books nothing');
  update public.kg_classes set room_id=room_a where id=f.other_class;
  perform pg_temp.assert_true((select room_id=room_a and not explicit from public.kg_bookings('2026-09-13 13:00+01','2026-09-13 16:00+01') b where b.source_id=l2b),'a room given back re-books the class''s cours');
  -- A cours written with its class's own home room is stored as NULL.
  home := pg_temp.room_lesson(f.class,f.program,f.member,'G lesson','2026-09-17 09:00+01',room_b);
  perform pg_temp.assert_true((select room_id is null from public.kg_learning_lessons where id=home),'the home room written explicitly is stored as NULL');

  -- 9. What still uses a room: four counts, the delete guard's sentence, and
  --    retiring as the way to keep history.
  select * into u from public.kg_room_usage(f.tenant) where room_id=room_b;
  perform pg_temp.assert_true(u.class_count=1 and u.activity_count>=1 and u.upcoming_count>=1 and u.history_count>=1,
    format('kg_room_usage counts for room B: %s class, %s activities, %s upcoming, %s past',u.class_count,u.activity_count,u.upcoming_count,u.history_count));
  perform pg_temp.expect_code(format('delete from public.kg_rooms where id=%L',room_b),'23503','room_in_use');
  perform pg_temp.room_session(f.other_member,'2026-08-10 09:00+01',30,room_c);
  select * into u from public.kg_room_usage(f.tenant) where room_id=room_c;
  perform pg_temp.assert_true(u.class_count=0 and u.activity_count=0 and u.upcoming_count=0 and u.history_count=1,'a room only history names counts one past booking');
  perform pg_temp.expect_code(format('delete from public.kg_rooms where id=%L',room_c),'23503','room_in_use');
  update public.kg_rooms set active=false where id=room_c;
  perform pg_temp.assert_true((select not active from public.kg_rooms where id=room_c),'retiring a room in history lands');
  delete from public.kg_rooms where id=room_d;
  perform pg_temp.assert_true(not exists (select 1 from public.kg_rooms where id=room_d),'a room nothing names deletes');

  -- 10. The ledger is invisible from the browser role.
  perform pg_temp.expect_error('select * from kg_scheduler_private.room_bookings','42501');
  perform pg_temp.expect_error('select kg_scheduler_private.room_usage(null)','42501');
end $$;
reset role;

-- Derived state equals source state after every successful and refused write:
-- one booking per non-cancelled cours with a room (its own or its class's),
-- per non-cancelled roomed follow-up, per roomed event with a range; nothing
-- stale, nothing explicit that the row does not name itself.
select pg_temp.assert_true(not exists (
  (select l.id source_id, coalesce(l.room_id,c.room_id) room_id, tstzrange(l.starts_at,l.ends_at,'[)') during, l.room_id is not null explicit
   from public.kg_learning_lessons l join public.kg_classes c on c.id=l.class_id
   where l.status<>'cancelled' and coalesce(l.room_id,c.room_id) is not null
   union all select s.id, s.room_id, tstzrange(s.scheduled_at,s.scheduled_at+s.duration_min*interval '1 minute','[)'), true
   from public.kg_sessions s where s.status<>'cancelled' and s.room_id is not null
   union all select e.id, e.room_id, tstzrange(e.start_at,e.end_at,'[)'), true
   from public.kg_events e where e.room_id is not null and e.end_at > e.start_at)
  except select source_id, room_id, during, explicit from kg_scheduler_private.room_bookings
),'all source bookings present');
select pg_temp.assert_true(not exists (
  select source_id, room_id, during, explicit from kg_scheduler_private.room_bookings
  except (select l.id, coalesce(l.room_id,c.room_id), tstzrange(l.starts_at,l.ends_at,'[)'), l.room_id is not null
   from public.kg_learning_lessons l join public.kg_classes c on c.id=l.class_id
   where l.status<>'cancelled' and coalesce(l.room_id,c.room_id) is not null
   union all select s.id, s.room_id, tstzrange(s.scheduled_at,s.scheduled_at+s.duration_min*interval '1 minute','[)'), true
   from public.kg_sessions s where s.status<>'cancelled' and s.room_id is not null
   union all select e.id, e.room_id, tstzrange(e.start_at,e.end_at,'[)'), true
   from public.kg_events e where e.room_id is not null and e.end_at > e.start_at)
),'no stale or phantom bookings');
select pg_temp.assert_true(not exists (
  select 1 from kg_scheduler_private.room_bookings a join kg_scheduler_private.room_bookings b
    on a.room_id=b.room_id and a.source_id<b.source_id and a.during && b.during
  where a.explicit and b.explicit
),'no two explicit bookings overlap');
set local role anon;
select pg_temp.expect_error('select * from kg_scheduler_private.room_bookings','42501');
select pg_temp.expect_error('select * from public.kg_bookings(''2026-09-13 00:00+01'',''2026-09-14 00:00+01'')','42501');
reset role;
rollback;
select 'PASS: room ledger — both tiers, every refusal on the room needle, the past-update and no-op paths, class moves, the delete guard, ACL; all fixtures rolled back' result;
