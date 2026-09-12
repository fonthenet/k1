-- 0155 — a room is booked, not merely named.
--
-- Since 0123 a class has a home room, and that is the only place the schema
-- knows a room at all. A cours on the timetable, a paid activity's weekly
-- slot, an individual follow-up and a calendar event all happen somewhere,
-- and nothing records where — so nothing can say "Salle 6 is taken at
-- 08:30". Staff double-booking was solved in 0150 with a private ledger and a
-- GiST exclusion fed by triggers; this file gives rooms the same ledger, with
-- one difference that the building imposes and a person does not:
--
--   A PERSON cannot be in two places. A ROOM can hold two groups — the demo
--   itself runs 1re année and 2e année in Salle 6 (13 children in a room for
--   24), which is how a small Algerian école works, not a data error. So the
--   rule is in two tiers, and it must be sayable in one sentence:
--
--     "Une salle réservée pour un cours, une activité, un suivi ou un
--      évènement ne peut pas être réservée deux fois. Un cours donné dans la
--      salle de sa classe est signalé, jamais refusé."
--
--   EXPLICIT: the row names its own room (lesson.room_id, session.room_id,
--     event.room_id, activity.room_id). Two explicit reservations of one room
--     at one time are refused (23P01), like two bookings of one teacher.
--   INHERITED: a cours with room_id NULL happens in its class's home room
--     (kg_classes.room_id). It is ledgered — so the occupancy sheet and every
--     picker can see it and say "1re année is here at 08:30" — but it is
--     OUTSIDE the exclusion. It is warned in the product, never refused, and
--     it follows the class when the class moves room, history included: the
--     ledger is derived data, and kg_bookings reads the class's CURRENT room,
--     so the two never disagree.
--
-- A cours that names its class's own home room IS a cours in its class's
-- room: a BEFORE trigger stores it as NULL, whoever wrote the row (the
-- editor, an import, a hand-written SQL), so the column, the ledger and the
-- editor tell one story.
--
-- Because inherited bookings refuse nothing, the 14 overlapping pairs on the
-- demo install without surgery, and the first client (a crèche whose rooms
-- are its classes) is never told its own rooms are double-booked.
--
-- What this file adds
--   room_id on lessons, sessions, events, activities — composite FKs so a
--                                room can never be borrowed across tenants;
--                                ON DELETE RESTRICT, because retiring a room
--                                (active = false) is how history keeps its
--                                room, and the delete guard says so.
--   kg_classes                   the same composite FK (0123's was single-
--                                column: a class could point at another
--                                tenant's room).
--   kg_scheduler_private.room_bookings
--                                one row per concrete occupation of a room,
--                                exclusion on (room_id, during) WHERE explicit.
--                                Fed by AFTER triggers on lessons, sessions,
--                                events; a class changing home room moves its
--                                inherited bookings with it.
--   activity slots               are checked on demand, never materialised:
--                                the ledger trigger asks "does an active
--                                activity occupy this room on this weekday at
--                                this time" for explicit bookings still ahead,
--                                and the activity guard asks the ledger the
--                                reverse, from now on. A per-room advisory
--                                lock closes the race.
--   schedule shapes              two jsonb shapes exist on production
--                                ([{"day":"sun","time":"09:00"}] from the
--                                dialog, [{"day":2,"start":..,"end":..}] by
--                                hand). THIS FILE CHANGES NO ACTIVITY ROW and
--                                adds no CHECK: every reader here
--                                (kg_activity_slots, kg_bookings, both
--                                guards) normalises on the fly, and the
--                                activity BEFORE trigger only REFUSES a slot
--                                that fits neither shape. So the build
--                                deployed before this release — which writes
--                                {day,time} and cannot read {day,start,end}
--                                — keeps working exactly as today while this
--                                file is live and the app is not yet. The
--                                rewrite to one shape and its CHECK are 0156,
--                                applied once the new dialog is the only
--                                writer left. Two files, zero deploy window.
--   kg_bookings(from, to)        the read side: every booking of the
--                                establishment in a window, with the room it
--                                occupies when it has one — the one source
--                                for every picker, pre-check line and the
--                                occupancy sheet.
--   kg_room_usage(tenant)        what still uses a room (classes, activities,
--                                upcoming bookings, past bookings) — the
--                                delete guard's sentence and the rooms table.
--
-- Apply atomically, through psql (the NOTICEs below are the deploy log; the
-- MCP apply path swallows them), after the owner has seen the output of
-- supabase/tests/room_preflight.sql and said go. Busy deployments retry on
-- lock_timeout. Runs on PostgreSQL 14+ (nothing here needs the PG15 form of
-- ON DELETE SET NULL); production is 17.6.
begin;
set local lock_timeout = '5s';
lock table public.kg_rooms, public.kg_classes, public.kg_learning_lessons,
  public.kg_sessions, public.kg_events, public.kg_activities
  in share row exclusive mode;

-- ── 1. The key every room reference will point at ─────────────────────────
-- (id, tenant_id) so a composite FK can refuse a room id from another tenant
-- at the database, not in a policy.
alter table public.kg_rooms add constraint kg_rooms_booking_key unique (id, tenant_id);

-- 0123's kg_classes.room_id references kg_rooms(id) alone. Preflight, then
-- the composite key beside it (the single-column FK stays; both agree).
do $$
declare bad record;
begin
  select c.id, c.tenant_id, c.room_id into bad
  from public.kg_classes c join public.kg_rooms r on r.id = c.room_id
  where r.tenant_id <> c.tenant_id limit 1;
  if found then
    raise exception 'room_cross_tenant: class % (tenant %) points at room % of another tenant',
      bad.id, bad.tenant_id, bad.room_id
      using errcode = '23503',
        hint = 'Clear kg_classes.room_id on that class explicitly, then retry. No data was changed.';
  end if;
end $$;
alter table public.kg_classes add constraint kg_classes_room_tenant_fkey
  foreign key (room_id, tenant_id) references public.kg_rooms(id, tenant_id) on delete restrict;

-- ── 2. Where each thing happens ─────────────────────────────────────────────
-- RESTRICT, not SET NULL: a room that history still names is retired, never
-- deleted, and the guard in §9 says so with the counts. Nothing is ever
-- blanked behind the director's back.
alter table public.kg_learning_lessons add column room_id uuid;
alter table public.kg_learning_lessons add constraint kg_learning_lessons_room_fkey
  foreign key (room_id, tenant_id) references public.kg_rooms(id, tenant_id) on delete restrict;
create index kg_learning_lessons_room_idx on public.kg_learning_lessons (room_id) where room_id is not null;
comment on column public.kg_learning_lessons.room_id is
  'Where this cours happens when NOT in the class''s home room (the gym, the '
  'yard). NULL = the class''s kg_classes.room_id, followed when the class '
  'moves; a value equal to the home room is stored as NULL by trigger. The '
  'booking is in kg_scheduler_private.room_bookings. See 0155.';

alter table public.kg_sessions add column room_id uuid;
alter table public.kg_sessions add constraint kg_sessions_room_fkey
  foreign key (room_id, tenant_id) references public.kg_rooms(id, tenant_id) on delete restrict;
create index kg_sessions_room_idx on public.kg_sessions (room_id) where room_id is not null;
comment on column public.kg_sessions.room_id is
  'The room the follow-up is held in; NULL for a home visit or an outdoor '
  'session, which book nothing. See 0155.';

alter table public.kg_events add column room_id uuid;
alter table public.kg_events add constraint kg_events_room_fkey
  foreign key (room_id, tenant_id) references public.kg_rooms(id, tenant_id) on delete restrict;
create index kg_events_room_idx on public.kg_events (room_id) where room_id is not null;
-- An event without an end cannot occupy a room: there is no range to book.
-- Scoped to rows with a room, because one existing event on production ends
-- before it starts and this file changes no event.
alter table public.kg_events add constraint kg_events_room_needs_range
  check (room_id is null or (end_at is not null and end_at > start_at));

-- One room per activity. A slot-level room was considered and rejected: an
-- activity is sold to families as "Coran, Salle 2, le jeudi"; a slot that
-- wanders between rooms is two activities. If a client ever needs it, it is
-- a kg_activity_slots table, never room ids inside the jsonb.
alter table public.kg_activities add column room_id uuid;
alter table public.kg_activities add constraint kg_activities_room_fkey
  foreign key (room_id, tenant_id) references public.kg_rooms(id, tenant_id) on delete restrict;
create index kg_activities_room_idx on public.kg_activities (room_id) where room_id is not null;

-- ── 3. One schedule shape — read, not yet written ───────────────────────────
-- Two shapes exist: [{"day":"sun","time":"09:00"}] (the dialog's, no end) and
-- [{"day":2,"start":"14:00","end":"15:30"}] (seeded by hand; the current
-- app's asScheduleSlots drops these because `day` is not a string, so four
-- demo activities render as "no schedule" today). Both read as
-- {"day":"tue","start":"14:00","end":"15:30"}. Integer days follow the
-- Sunday-first index the app uses everywhere (src/lib/week.ts DAY_KEYS,
-- Date.getDay()); 7 is accepted as Sunday too, anything else falls through
-- to the preflight. A slot with no end gets one hour — the activity dialog's
-- default. Times are cut to HH:MM so "09:00:00" is not a different time.
create function public.kg_activity_schedule_normalise(p jsonb) returns jsonb
language sql immutable strict set search_path = pg_catalog as $$
  select coalesce((
    select jsonb_agg(jsonb_build_object(
      'day', d.key,
      'start', s.t,
      'end', coalesce(
        left(nullif(btrim(e->>'end'), ''), 5),
        to_char((s.t::time + interval '60 minutes'), 'HH24:MI'))
    ) order by d.ord, s.t)
    from jsonb_array_elements(case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end) e
    cross join lateral (
      select left(coalesce(nullif(btrim(e->>'start'), ''), nullif(btrim(e->>'time'), '')), 5) t
    ) s
    join lateral (
      select key, ord from (values
        ('sun',0),('mon',1),('tue',2),('wed',3),('thu',4),('fri',5),('sat',6)) v(key, ord)
      where (jsonb_typeof(e->'day') = 'string' and v.key = lower(btrim(e->>'day')))
         or (jsonb_typeof(e->'day') = 'number' and (e->>'day') ~ '^[0-7]$'
             and v.ord = ((e->>'day')::int % 7))
    ) d on true
    where jsonb_typeof(e) = 'object' and s.t ~ '^([01]\d|2[0-3]):[0-5]\d$'
  ), '[]'::jsonb)
$$;

-- True for the canonical shape only: 0156's CHECK. Defined here so the
-- preflight below and room_preflight.sql use the one predicate.
create function public.kg_activity_schedule_valid(p jsonb) returns boolean
language sql immutable strict set search_path = pg_catalog as $$
  -- CASEs, never bare AND/OR: SQL does not promise short-circuit evaluation,
  -- jsonb_array_length raises on anything that is not an array and
  -- jsonb_object_keys on anything that is not an object.
  select case when jsonb_typeof(p) <> 'array' then false
              when jsonb_array_length(p) > 14 then false
              else not exists (
    select 1 from jsonb_array_elements(p) e
    where case when jsonb_typeof(e) <> 'object' then true
          else (e->>'day') is null
            or (e->>'day') not in ('sun','mon','tue','wed','thu','fri','sat')
            or coalesce(e->>'start', '') !~ '^([01]\d|2[0-3]):[0-5]\d$'
            or coalesce(e->>'end', '')   !~ '^([01]\d|2[0-3]):[0-5]\d$'
            or (case when coalesce(e->>'start', '') ~ '^([01]\d|2[0-3]):[0-5]\d$'
                      and coalesce(e->>'end', '')   ~ '^([01]\d|2[0-3]):[0-5]\d$'
                     then (e->>'end')::time <= (e->>'start')::time else true end)
            or (select count(*) from jsonb_object_keys(e)) <> 3
          end
  ) end
$$;

-- Preflight: a slot that fits neither shape would be dropped by the reader,
-- and a schedule that loses a slot is a room left unguarded. Refuse instead,
-- naming the activity; nothing has been changed. The same predicate is in
-- supabase/tests/room_preflight.sql as a SELECT, for every tenant, so the
-- owner sees it before this file runs. No row is rewritten here: 0156 does
-- that, once the only writer is the dialog that reads both shapes.
do $$
declare bad record; v_n int;
begin
  select id, name, schedule into bad from public.kg_activities
  where case when jsonb_typeof(schedule) <> 'array' then true
             else jsonb_array_length(schedule) <> jsonb_array_length(public.kg_activity_schedule_normalise(schedule))
               or not public.kg_activity_schedule_valid(public.kg_activity_schedule_normalise(schedule)) end
  limit 1;
  if found then
    raise exception 'activity_schedule_unnormalisable: % (%) %', bad.id, bad.name, bad.schedule
      using errcode = '23514',
        hint = 'A slot has a day or time outside both known shapes. Correct it explicitly, then retry. No data was changed.';
  end if;
  select count(*) into v_n from public.kg_activities
   where schedule <> public.kg_activity_schedule_normalise(schedule);
  raise notice 'activity schedules that 0156 will rewrite to one shape: %', v_n;
end $$;

-- The slots as rows: weekday (0 = Sunday), local start, local end — from
-- EITHER shape, because the rows are not rewritten until 0156. Public and
-- callable, because kg_bookings expands slots as the reader and the private
-- schema is closed to browsers; it reveals nothing but arithmetic.
create function public.kg_activity_slots(p jsonb)
returns table (dow int, starts time, ends time)
language sql immutable strict set search_path = pg_catalog, public as $$
  select array_position(array['sun','mon','tue','wed','thu','fri','sat'], e->>'day') - 1,
         (e->>'start')::time, (e->>'end')::time
  from jsonb_array_elements(public.kg_activity_schedule_normalise(p)) e
$$;
revoke all on function public.kg_activity_slots(jsonb) from public, anon;
grant execute on function public.kg_activity_slots(jsonb) to authenticated;

-- ── 4. The ledger ───────────────────────────────────────────────────────────
-- Derived occupancy, exactly like staff_bookings: never read by a browser,
-- never written by an RPC, maintained only by the triggers below. Three FK
-- columns so a deleted source takes its booking with it; `source_id` is the
-- one of them that is set, so the upsert has a single target.
create table kg_scheduler_private.room_bookings (
  lesson_id  uuid unique references public.kg_learning_lessons(id) on update cascade on delete cascade,
  session_id uuid unique references public.kg_sessions(id) on update cascade on delete cascade,
  event_id   uuid unique references public.kg_events(id) on update cascade on delete cascade,
  source_id  uuid generated always as (coalesce(lesson_id, session_id, event_id)) stored unique,
  tenant_id  uuid not null,
  room_id    uuid not null references public.kg_rooms(id) on update cascade on delete cascade,
  during     tstzrange not null,
  -- True when the row named its room itself; false when a cours inherits its
  -- class's home room. Only explicit rows are in the exclusion.
  explicit   boolean not null,
  constraint room_booking_source check (num_nonnulls(lesson_id, session_id, event_id) = 1),
  constraint room_booking_range check (
    not isempty(during) and not lower_inf(during) and not upper_inf(during)
    and isfinite(lower(during)) and isfinite(upper(during))
    and lower_inc(during) and not upper_inc(during)
  )
);
do $$
declare extension_schema text;
begin
  select n.nspname into strict extension_schema from pg_extension e
  join pg_namespace n on n.oid = e.extnamespace where e.extname = 'btree_gist';
  perform set_config('search_path', format('pg_catalog, %I', extension_schema), true);
  alter table kg_scheduler_private.room_bookings add constraint room_booking_no_overlap
    exclude using gist (room_id with =, during with &&) where (explicit);
end $$;
set local search_path = pg_catalog, public;
-- The exclusion's partial GiST serves every explicit lookup; the counts per
-- room (usage, delete guard, class move) want a plain btree. No second GiST.
create index room_bookings_room_idx on kg_scheduler_private.room_bookings (room_id);
alter table kg_scheduler_private.room_bookings enable row level security;
revoke all on kg_scheduler_private.room_bookings from public, anon, authenticated, service_role;

-- ── 5. The weekly pattern, answered on demand ───────────────────────────────
-- "Which active activity occupies this room during this range?" — expanded
-- day by day (an event may span days), skipping closure days, because an
-- activity does not meet on a holiday and must not block the room that day.
-- Returns the first offender with its concrete occurrence.
create function kg_scheduler_private.activity_occupant(
  p_room uuid, p_during tstzrange, p_skip_activity uuid default null
) returns table (activity_id uuid, title text, occurrence tstzrange)
language sql stable set search_path = pg_catalog, public as $$
  with days as (
    select d::date as day
    from generate_series(
      (lower(p_during) at time zone 'Africa/Algiers')::date,
      ((upper(p_during) - interval '1 microsecond') at time zone 'Africa/Algiers')::date,
      interval '1 day') d
  )
  select a.id, a.name,
         tstzrange((days.day + s.starts) at time zone 'Africa/Algiers',
                   (days.day + s.ends)   at time zone 'Africa/Algiers', '[)')
  from public.kg_activities a
  cross join lateral public.kg_activity_slots(a.schedule) s
  cross join days
  where a.room_id = p_room and a.active
    and (p_skip_activity is null or a.id <> p_skip_activity)
    and s.dow = extract(dow from days.day)::int
    and tstzrange((days.day + s.starts) at time zone 'Africa/Algiers',
                  (days.day + s.ends)   at time zone 'Africa/Algiers', '[)') && p_during
    and not public.kg_structure_closed_on(a.structure_id, a.tenant_id, days.day)
  order by 3
  limit 1
$$;
revoke all on function kg_scheduler_private.activity_occupant(uuid, tstzrange, uuid) from public, anon, authenticated, service_role;

-- One lock per room per transaction. The GiST exclusion serialises concrete
-- bookings against each other; this serialises them against an activity edit
-- landing in the same instant, which no constraint can see.
create function kg_scheduler_private.lock_room(p_room uuid) returns void
language sql set search_path = pg_catalog as $$
  select pg_advisory_xact_lock(hashtextextended('kg_room:' || p_room::text, 0))
$$;
revoke all on function kg_scheduler_private.lock_room(uuid) from public, anon, authenticated, service_role;

-- The refusal, shaped like the exclusion constraint's so src/lib/db-clash.ts
-- reads the occupant's range from DETAIL with the parser it already has:
-- the LAST `["a","b")` in the line is the row that was there first. Every
-- room refusal's message starts with `room_booking`, which is what the
-- error mapping keys on.
create function kg_scheduler_private.refuse_activity_overlap(
  p_room uuid, p_during tstzrange, p_activity uuid, p_title text, p_occurrence tstzrange
) returns void language plpgsql set search_path = pg_catalog as $$
begin
  raise exception 'room_booking_activity_overlap: room % is taken by activity %', p_room, p_activity
    using errcode = '23P01',
      detail = format('Key (room_id, during)=(%s, %s) conflicts with activity %s (%s) at (%s, %s)',
                      p_room, p_during, p_activity, p_title, p_room, p_occurrence),
      hint = 'Pick another room or another time; the activity''s slot is fixed weekly.';
end $$;
revoke all on function kg_scheduler_private.refuse_activity_overlap(uuid, tstzrange, uuid, text, tstzrange) from public, anon, authenticated, service_role;

-- ── 6. Feeding the ledger ───────────────────────────────────────────────────
-- Trigger-only definer, as in 0150: source-table RLS authorised the write;
-- this only records where it lands. A row without a room (a session with no
-- room chosen, a cours whose class has no home room, an event with no end)
-- occupies nothing and is simply absent from the ledger.
--
-- Two gates, both mirrored by the activity guard in §7 so that history can
-- never refuse itself:
--   · nothing about WHERE or WHEN changed → nothing is re-ledgered and
--     nothing is re-checked (a title, a note, an outcome, an attendance mark
--     on last month's follow-up must land even if an activity has since been
--     placed on its room);
--   · only an EXPLICIT booking still AHEAD is checked against the weekly
--     activity slots. A cours in its own class room over an activity is the
--     warned case, not the refused one.
create function kg_scheduler_private.sync_room_booking() returns trigger
language plpgsql security definer set search_path = pg_catalog as $$
declare
  v_room uuid; v_during tstzrange; v_explicit boolean := true; v_hit record;
  v_changed boolean := true;
begin
  if tg_table_schema <> 'public' then raise exception 'invalid_booking_source'; end if;

  if tg_table_name = 'kg_learning_lessons' then
    if tg_op = 'UPDATE' then
      v_changed := (new.room_id, new.starts_at, new.ends_at, new.status)
        is distinct from (old.room_id, old.starts_at, old.ends_at, old.status);
    end if;
    if new.status <> 'cancelled' then
      if new.room_id is not null then
        v_room := new.room_id;
      else
        select c.room_id into v_room from public.kg_classes c where c.id = new.class_id;
        v_explicit := false;
      end if;
      v_during := tstzrange(new.starts_at, new.ends_at, '[)');
    end if;
  elsif tg_table_name = 'kg_sessions' then
    if tg_op = 'UPDATE' then
      v_changed := (new.room_id, new.scheduled_at, new.duration_min, new.status)
        is distinct from (old.room_id, old.scheduled_at, old.duration_min, old.status);
    end if;
    if new.status <> 'cancelled' and new.room_id is not null then
      v_room := new.room_id;
      v_during := tstzrange(new.scheduled_at, new.scheduled_at + new.duration_min * interval '1 minute', '[)');
    end if;
  elsif tg_table_name = 'kg_events' then
    if tg_op = 'UPDATE' then
      v_changed := (new.room_id, new.start_at, new.end_at)
        is distinct from (old.room_id, old.start_at, old.end_at);
    end if;
    if new.room_id is not null and new.end_at is not null and new.end_at > new.start_at then
      v_room := new.room_id;
      v_during := tstzrange(new.start_at, new.end_at, '[)');
    end if;
  else
    raise exception 'invalid_booking_source';
  end if;

  if not v_changed then return new; end if;

  if v_room is null then
    delete from kg_scheduler_private.room_bookings where source_id = new.id;
    return new;
  end if;

  perform kg_scheduler_private.lock_room(v_room);
  insert into kg_scheduler_private.room_bookings
    (lesson_id, session_id, event_id, tenant_id, room_id, during, explicit)
  values (
    case when tg_table_name = 'kg_learning_lessons' then new.id end,
    case when tg_table_name = 'kg_sessions' then new.id end,
    case when tg_table_name = 'kg_events' then new.id end,
    new.tenant_id, v_room, v_during, v_explicit)
  on conflict (source_id) do update
    set room_id = excluded.room_id, during = excluded.during, explicit = excluded.explicit;

  if v_explicit and upper(v_during) > now() then
    select * into v_hit from kg_scheduler_private.activity_occupant(v_room, v_during);
    if found then
      perform kg_scheduler_private.refuse_activity_overlap(v_room, v_during, v_hit.activity_id, v_hit.title, v_hit.occurrence);
    end if;
  end if;
  return new;
end $$;
revoke all on function kg_scheduler_private.sync_room_booking() from public, anon, authenticated, service_role;

-- A cours that names its class's own home room is a cours in its class's
-- room: stored as NULL, so the column says what the ledger and the editor
-- say, whoever wrote the row. BEFORE, because an AFTER trigger cannot change
-- the row; runs only when room_id is written.
create function kg_scheduler_private.lesson_room_default() returns trigger
language plpgsql security definer set search_path = pg_catalog as $$
begin
  if new.room_id is not null
     and new.room_id = (select c.room_id from public.kg_classes c where c.id = new.class_id) then
    new.room_id := null;
  end if;
  return new;
end $$;
revoke all on function kg_scheduler_private.lesson_room_default() from public, anon, authenticated, service_role;

-- ── 7. Activities: the shape, then the reverse check ────────────────────────
-- Two BEFORE triggers, in this order (alphabetical by trigger name):
--
--   activity_schedule_shape   refuses a schedule that is not a list of slots
--                             readable in one of the two shapes. It stores
--                             the row AS WRITTEN — the build deployed before
--                             this release still writes {day,time} and can
--                             only read {day,time}; rewriting its rows under
--                             it would make its dialog show an empty
--                             schedule and re-save an empty one. 0156
--                             replaces this function with the one that also
--                             canonicalises, once that build is gone.
--   scheduler_activity_room   editing an activity's room, slots or active
--                             flag must not land it on a room somebody
--                             explicitly booked, nor on another activity's
--                             weekly slot in the same room. Explicit bookings
--                             are compared from now on: history is not
--                             rewritten because a slot moved this term.
--                             Inherited bookings (a class in its own room)
--                             are not in the way: that is the warned case.
create function kg_scheduler_private.activity_schedule_shape() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if jsonb_typeof(new.schedule) <> 'array' then
    raise exception 'activity_schedule_invalid' using errcode = '23514',
      hint = 'The schedule is a list of slots {day, start, end}.';
  end if;
  if jsonb_array_length(public.kg_activity_schedule_normalise(new.schedule)) <> jsonb_array_length(new.schedule) then
    raise exception 'activity_schedule_invalid' using errcode = '23514',
      hint = 'Each slot needs a weekday and a start (and end) inside the day.';
  end if;
  return new;
end $$;
revoke all on function kg_scheduler_private.activity_schedule_shape() from public, anon, authenticated, service_role;

create function kg_scheduler_private.activity_room_guard() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare hit record; other record;
begin
  if new.room_id is null or not new.active or jsonb_array_length(new.schedule) = 0 then
    return new;
  end if;
  -- Compared in the one shape, so a re-save of the same slots in the other
  -- spelling is not a change.
  if tg_op = 'UPDATE'
     and (new.room_id, public.kg_activity_schedule_normalise(new.schedule), new.active)
         is not distinct from
         (old.room_id, public.kg_activity_schedule_normalise(old.schedule), old.active) then
    return new;
  end if;
  perform kg_scheduler_private.lock_room(new.room_id);

  -- Against another activity's pattern: same room, same weekday, overlapping
  -- clock times. Weekly patterns compare without a calendar, so the DETAIL
  -- carries the weekday and the clock range, not a dated range.
  select o.id, o.name, os.dow, os.starts, os.ends into other
  from kg_activities o
  cross join lateral public.kg_activity_slots(o.schedule) os
  cross join lateral public.kg_activity_slots(new.schedule) ns
  where o.room_id = new.room_id and o.active and o.id <> new.id
    and os.dow = ns.dow and os.starts < ns.ends and ns.starts < os.ends
  limit 1;
  if found then
    raise exception 'room_booking_activity_overlap: activity % already meets in room % on that weekday', other.id, new.room_id
      using errcode = '23P01',
        detail = format('Key (room_id, weekday)=(%s, %s) conflicts with activity %s (%s) at (%s – %s)',
                        new.room_id, other.dow, other.id, other.name, other.starts, other.ends),
        hint = 'Another activity holds this room on that weekday at that time.';
  end if;

  -- Against explicit bookings from now on: the first future occurrence of any
  -- slot that lands on one refuses the edit. The occupant is named in DETAIL
  -- after the dated range, so the toast can say what is there.
  select b.room_id, b.during,
         case when b.lesson_id is not null then 'lesson'
              when b.session_id is not null then 'session'
              else 'event' end as source,
         coalesce(l.title, e.title, '') occupant into hit
  from kg_scheduler_private.room_bookings b
  left join kg_learning_lessons l on l.id = b.lesson_id
  left join kg_events e on e.id = b.event_id
  cross join lateral public.kg_activity_slots(new.schedule) ns
  where b.room_id = new.room_id and b.explicit
    and upper(b.during) > now()
    and extract(dow from (lower(b.during) at time zone 'Africa/Algiers')::date)::int = ns.dow
    and (lower(b.during) at time zone 'Africa/Algiers')::time < ns.ends
    and ns.starts < (upper(b.during) at time zone 'Africa/Algiers')::time
    and not public.kg_structure_closed_on(new.structure_id, new.tenant_id,
          (lower(b.during) at time zone 'Africa/Algiers')::date)
  order by lower(b.during) limit 1;
  if found then
    raise exception 'room_booking_activity_overlap: room % is booked when this activity meets', new.room_id
      using errcode = '23P01',
        detail = format('Key (room_id, during)=(%s, weekly) conflicts with existing key (room_id, during)=(%s, %s) %s %s',
                        new.room_id, hit.room_id, hit.during, hit.source, hit.occupant),
        hint = 'Pick another room or another slot; the existing booking stays.';
  end if;
  return new;
end $$;
revoke all on function kg_scheduler_private.activity_room_guard() from public, anon, authenticated, service_role;

-- ── 8. A class that moves room takes its cours with it ──────────────────────
-- Only the cours that had no room of their own (inherited) — history
-- included, because the ledger is derived data and kg_bookings reads the
-- class's current room: the two must never disagree. A cours that had pinned
-- the room the class now lives in is unpinned (a room_id-only update passes
-- the lesson guard: programme dates are immutable since 0147, so every
-- existing cours is inside them). Inherited bookings are outside the
-- exclusion, so a move never refuses; the occupancy sheet, the class dialog's
-- count and the pickers say what now overlaps, in gold.
create function kg_scheduler_private.follow_class_room() returns trigger
language plpgsql security definer set search_path = pg_catalog as $$
begin
  if new.room_id is not distinct from old.room_id then return new; end if;
  if new.room_id is null then
    delete from kg_scheduler_private.room_bookings b
     using public.kg_learning_lessons l
     where b.lesson_id = l.id and l.class_id = new.id and not b.explicit;
    return new;
  end if;
  perform kg_scheduler_private.lock_room(new.room_id);
  update public.kg_learning_lessons
     set room_id = null
   where class_id = new.id and room_id = new.room_id;
  update kg_scheduler_private.room_bookings b
     set room_id = new.room_id
    from public.kg_learning_lessons l
   where b.lesson_id = l.id and l.class_id = new.id and not b.explicit;
  -- Cours of this class that had no booking because the class had no room
  -- until now: give them one.
  insert into kg_scheduler_private.room_bookings (lesson_id, tenant_id, room_id, during, explicit)
  select l.id, l.tenant_id, new.room_id, tstzrange(l.starts_at, l.ends_at, '[)'), false
  from public.kg_learning_lessons l
  where l.class_id = new.id and l.room_id is null and l.status <> 'cancelled'
    and not exists (select 1 from kg_scheduler_private.room_bookings b where b.lesson_id = l.id);
  return new;
end $$;
revoke all on function kg_scheduler_private.follow_class_room() from public, anon, authenticated, service_role;

-- ── 9. Deleting a room that is still used ───────────────────────────────────
-- 0135's guard counted classes. A room with an activity on it, a cours next
-- Tuesday, or a follow-up held there last spring is just as in use; say so
-- with the counts instead of letting a FK say "violates constraint". Out of
-- service (active = false) is the way to retire a room and keep its history;
-- delete is for a room nothing ever named. One private function gives the
-- four counts to the guard, to kg_room_usage and to nobody else.
create function kg_scheduler_private.room_usage(p_room uuid)
returns table (class_count int, activity_count int, upcoming_count int, history_count int)
language sql stable set search_path = pg_catalog, public as $$
  select
    (select count(*)::int from kg_classes c where c.room_id = p_room),
    (select count(*)::int from kg_activities a where a.room_id = p_room),
    (select count(*)::int from kg_scheduler_private.room_bookings b
      where b.room_id = p_room and upper(b.during) > now()),
    (select count(*)::int from (
        select l.id from kg_learning_lessons l where l.room_id = p_room
        union all select s.id from kg_sessions s where s.room_id = p_room
        union all select e.id from kg_events e where e.room_id = p_room
      ) x
      where not exists (select 1 from kg_scheduler_private.room_bookings b
                        where b.source_id = x.id and upper(b.during) > now()))
$$;
revoke all on function kg_scheduler_private.room_usage(uuid) from public, anon, authenticated, service_role;

create or replace function public.kg_room_refuse_orphaning()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare u record;
begin
  select * into u from kg_scheduler_private.room_usage(old.id);
  if u.class_count > 0 or u.activity_count > 0 or u.upcoming_count > 0 or u.history_count > 0 then
    raise exception 'room_in_use: % class(es), % activit(ies), % upcoming booking(s), % past booking(s) still use this room',
      u.class_count, u.activity_count, u.upcoming_count, u.history_count
      using errcode = 'foreign_key_violation',
            hint = 'Move what is upcoming, or set the room out of service: history keeps its room that way.';
  end if;
  return old;
end $$;
drop trigger if exists trg_kg_rooms_no_orphan on public.kg_rooms;
create trigger trg_kg_rooms_no_orphan before delete on public.kg_rooms
  for each row execute function public.kg_room_refuse_orphaning();
revoke all on function public.kg_room_refuse_orphaning() from public, anon, authenticated;

-- ── 10. Backfill: every cours in its class's room, and the overlaps printed ─
-- Nothing here is explicit, so nothing can be refused: the ledger simply
-- learns where every non-cancelled cours already happens. The inherited
-- overlaps that exist today (14 pairs on the demo, all Salle 6 at 08:30) are
-- listed in the deploy log in the same shape the product will print them.
insert into kg_scheduler_private.room_bookings (lesson_id, tenant_id, room_id, during, explicit)
select l.id, l.tenant_id, c.room_id, tstzrange(l.starts_at, l.ends_at, '[)'), false
from public.kg_learning_lessons l join public.kg_classes c on c.id = l.class_id
where l.status <> 'cancelled' and c.room_id is not null;
do $$
declare r record; v_total int; v_pairs int := 0;
begin
  select count(*) into v_total from kg_scheduler_private.room_bookings;
  for r in
    select rm.tenant_id, rm.name room, to_char(lower(a.during) at time zone 'Africa/Algiers', 'YYYY-MM-DD') as day,
           to_char(lower(a.during) at time zone 'Africa/Algiers', 'HH24:MI') s,
           to_char(upper(a.during) at time zone 'Africa/Algiers', 'HH24:MI') e,
           ca.name a_class, la.title a_title, cb.name b_class, lb.title b_title
    from kg_scheduler_private.room_bookings a
    join kg_scheduler_private.room_bookings b
      on a.room_id = b.room_id and a.lesson_id < b.lesson_id and a.during && b.during
    join public.kg_rooms rm on rm.id = a.room_id
    join public.kg_learning_lessons la on la.id = a.lesson_id join public.kg_classes ca on ca.id = la.class_id
    join public.kg_learning_lessons lb on lb.id = b.lesson_id join public.kg_classes cb on cb.id = lb.class_id
    order by rm.tenant_id, rm.name, lower(a.during)
  loop
    v_pairs := v_pairs + 1;
    raise notice 'room overlap (tolerated): tenant % · % · % · %–% · % (%) ↔ % (%)',
      r.tenant_id, r.room, r.day, r.s, r.e, r.a_class, r.a_title, r.b_class, r.b_title;
  end loop;
  raise notice 'room_bookings backfill: % inherited bookings, % overlapping pairs (warned, not refused)', v_total, v_pairs;
end $$;
-- Sessions, events and activities carry no room yet, so there is nothing of
-- theirs to backfill; the columns are new and NULL everywhere.

-- ── 11. Triggers ────────────────────────────────────────────────────────────
create trigger scheduler_lesson_room_default before insert or update of room_id on public.kg_learning_lessons
  for each row execute function kg_scheduler_private.lesson_room_default();
create trigger scheduler_lesson_room after insert or update on public.kg_learning_lessons
  for each row execute function kg_scheduler_private.sync_room_booking();
create trigger scheduler_session_room after insert or update on public.kg_sessions
  for each row execute function kg_scheduler_private.sync_room_booking();
create trigger scheduler_event_room after insert or update on public.kg_events
  for each row execute function kg_scheduler_private.sync_room_booking();
-- "activity_schedule_shape" sorts before "scheduler_activity_room": the shape
-- is checked first, so the guard always expands a readable schedule.
create trigger activity_schedule_shape before insert or update on public.kg_activities
  for each row execute function kg_scheduler_private.activity_schedule_shape();
create trigger scheduler_activity_room before insert or update on public.kg_activities
  for each row execute function kg_scheduler_private.activity_room_guard();
create trigger scheduler_class_room after update of room_id on public.kg_classes
  for each row execute function kg_scheduler_private.follow_class_room();

-- ── 12. The read side ───────────────────────────────────────────────────────
-- Every booking of the establishment in a window, with the room it occupies
-- when it has one. Security INVOKER over the source tables under their own
-- RLS, and staff only: a parent may read their child's cours, but where the
-- building is busy is the establishment's business. The ledger itself stays
-- private. A cours whose class has no room is still a booking of its teacher
-- and its class, so it is returned with room_id null. Activity slots are
-- expanded for the window, from either shape. Sessions carry no title (the
-- product prints "Suivi individuel", never the child). Not granted to
-- service_role: the reader is always the signed-in staff member's client
-- (kg_is_staff needs auth.uid()). 120 days covers the longest thing any
-- editor checks at once, a 16-week series.
create function public.kg_bookings(p_from timestamptz, p_to timestamptz)
returns table (
  source text, source_id uuid, room_id uuid, explicit boolean,
  starts_at timestamptz, ends_at timestamptz,
  class_id uuid, membership_id uuid, title text
)
language plpgsql stable security invoker set search_path = pg_catalog, public as $$
begin
  if p_to <= p_from or p_to - p_from > interval '120 days' then
    raise exception 'kg_bookings: window must be positive and at most 120 days' using errcode = '22023';
  end if;
  return query
  select 'lesson'::text, l.id, coalesce(l.room_id, c.room_id), l.room_id is not null,
         l.starts_at, l.ends_at, l.class_id, l.membership_id, l.title
  from kg_learning_lessons l join kg_classes c on c.id = l.class_id
  where kg_is_staff(l.tenant_id) and l.status <> 'cancelled'
    and l.starts_at < p_to and l.ends_at > p_from
  union all
  select 'session', s.id, s.room_id, true,
         s.scheduled_at, s.scheduled_at + s.duration_min * interval '1 minute',
         null::uuid, s.therapist_id, ''::text
  from kg_sessions s
  where kg_is_staff(s.tenant_id) and s.status <> 'cancelled'
    and s.scheduled_at < p_to and s.scheduled_at + s.duration_min * interval '1 minute' > p_from
  union all
  select 'event', e.id, e.room_id, true, e.start_at, e.end_at, e.class_id, null::uuid, e.title
  from kg_events e
  where kg_is_staff(e.tenant_id) and e.room_id is not null and e.end_at is not null and e.end_at > e.start_at
    and e.start_at < p_to and e.end_at > p_from
  union all
  select 'activity', a.id, a.room_id, true, occ.starts, occ.ends, null::uuid, null::uuid, a.name
  from kg_activities a
  cross join lateral kg_activity_slots(a.schedule) s
  cross join lateral (
    select d::date as day from generate_series(
      (p_from at time zone 'Africa/Algiers')::date,
      ((p_to - interval '1 microsecond') at time zone 'Africa/Algiers')::date, interval '1 day') d
  ) days
  cross join lateral (
    select (days.day + s.starts) at time zone 'Africa/Algiers' starts,
           (days.day + s.ends)   at time zone 'Africa/Algiers' ends
  ) occ
  where kg_is_staff(a.tenant_id) and a.active and a.room_id is not null
    and s.dow = extract(dow from days.day)::int
    and occ.starts < p_to and occ.ends > p_from
    and not kg_structure_closed_on(a.structure_id, a.tenant_id, days.day)
  order by 5;
end $$;
revoke all on function public.kg_bookings(timestamptz, timestamptz) from public, anon;
grant execute on function public.kg_bookings(timestamptz, timestamptz) to authenticated;

-- What still uses each room of a tenant: the rooms table's "Utilisée par",
-- the delete guard's sentence and the retire warning read this once. A
-- definer, because upcoming bookings live in the private ledger; it gives a
-- staff member four counts per room and nothing else.
create function public.kg_room_usage(p_tenant uuid)
returns table (room_id uuid, class_count int, activity_count int, upcoming_count int, history_count int)
language sql stable security definer set search_path = pg_catalog, public as $$
  select r.id, u.class_count, u.activity_count, u.upcoming_count, u.history_count
  from kg_rooms r
  cross join lateral kg_scheduler_private.room_usage(r.id) u
  where r.tenant_id = p_tenant and kg_is_staff(p_tenant)
$$;
revoke all on function public.kg_room_usage(uuid) from public, anon;
grant execute on function public.kg_room_usage(uuid) to authenticated;

-- Members read a room like every other room column (rm_sel); the four new
-- room_id columns ride their tables' existing policies. RLS stays the only
-- permission layer: nothing here grants a new read.

-- ── 13. Rehearsal — runs inside this transaction on every deploy ───────────
-- Only what needs no fixture: the shape functions, the slot expansion from
-- both shapes and the ledger's invariants over the backfill. Behavioural
-- tests (refusals, the warned tier, the no-op and past-update paths, class
-- move, delete guard) live in supabase/tests/room_bookings.sql in the 0150
-- style and run against a disposable database.
do $$
begin
  if public.kg_activity_schedule_normalise('[{"day":2,"start":"14:00","end":"15:30"},{"day":"sun","time":"09:00"},{"day":7,"start":"08:00:00","end":"08:30:00"}]'::jsonb)
     <> '[{"day":"sun","start":"08:00","end":"08:30"},{"day":"sun","start":"09:00","end":"10:00"},{"day":"tue","start":"14:00","end":"15:30"}]'::jsonb then
    raise exception 'rehearsal: schedule normalisation';
  end if;
  if jsonb_array_length(public.kg_activity_schedule_normalise('[{"day":9,"start":"08:00","end":"08:30"}]'::jsonb)) <> 0 then
    raise exception 'rehearsal: an out-of-range day must fall through to the preflight';
  end if;
  if jsonb_array_length(public.kg_activity_schedule_normalise('[1, "x"]'::jsonb)) <> 0 then
    raise exception 'rehearsal: a non-object slot must fall through to the preflight';
  end if;
  if public.kg_activity_schedule_valid('[{"day":"sun","start":"09:00","end":"09:00"}]'::jsonb) then
    raise exception 'rehearsal: zero-length slot accepted';
  end if;
  if public.kg_activity_schedule_valid('[{"day":"sun","time":"09:00"}]'::jsonb) then
    raise exception 'rehearsal: legacy shape accepted as canonical';
  end if;
  if public.kg_activity_schedule_valid('[1]'::jsonb) or public.kg_activity_schedule_valid('{"day":"sun"}'::jsonb) then
    raise exception 'rehearsal: a non-object slot or a non-array schedule must be false, not an error';
  end if;
  if public.kg_activity_schedule_valid('[{"day":"sun","start":"09:00","end":"10:00","time":"09:00"}]'::jsonb) then
    raise exception 'rehearsal: a fourth key accepted';
  end if;
  if (select count(*) from public.kg_activity_slots('[{"day":"thu","start":"09:00","end":"10:00"}]'::jsonb) where dow = 4) <> 1 then
    raise exception 'rehearsal: thursday is 4';
  end if;
  if (select count(*) from public.kg_activity_slots('[{"day":"sun","time":"09:00"},{"day":4,"start":"09:00","end":"10:00"}]'::jsonb) where ends = '10:00') <> 2 then
    raise exception 'rehearsal: both stored shapes must expand to slots';
  end if;
  if exists (
    select 1 from kg_scheduler_private.room_bookings a
    join kg_scheduler_private.room_bookings b
      on a.room_id = b.room_id and a.source_id < b.source_id and a.during && b.during
    where a.explicit and b.explicit
  ) then
    raise exception 'rehearsal: two explicit bookings overlap';
  end if;
  if exists (
    select 1 from public.kg_learning_lessons l join public.kg_classes c on c.id = l.class_id
    where l.status <> 'cancelled' and c.room_id is not null
      and not exists (select 1 from kg_scheduler_private.room_bookings b where b.lesson_id = l.id)
  ) then
    raise exception 'rehearsal: a cours with a home room has no booking';
  end if;
  if exists (select 1 from kg_scheduler_private.room_bookings where explicit) then
    raise exception 'rehearsal: nothing was explicit before this file';
  end if;
  if exists (
    select 1 from public.kg_activities
    where jsonb_array_length(schedule) <> jsonb_array_length(public.kg_activity_schedule_normalise(schedule))
  ) then
    raise exception 'rehearsal: a stored schedule does not read whole';
  end if;
  if exists (
    select 1 from public.kg_classes c join public.kg_rooms r on r.id = c.room_id where r.tenant_id <> c.tenant_id
  ) then
    raise exception 'rehearsal: a class points at another tenant''s room';
  end if;
end $$;

notify pgrst, 'reload schema';
commit;


