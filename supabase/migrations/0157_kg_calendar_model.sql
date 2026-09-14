-- 0157 — the calendar's model: one closure rule, holidays with a kind and a
-- key, events with a whole day and a cancellation, sessions that respect a
-- closed door, and two shared helpers that stop handing NULL to the bell.
--
-- DECISIONS WRITTEN HERE SO NOBODY RE-OPENS THEM
--   * kg_holidays.closure is the ONLY way to say "the door is shut". kg_events
--     never closes a day and gets no kind column: the audience says who, the
--     room says where, the title says what.
--   * tentative = a proposal. Readers name it (dashed gold, "à confirmer");
--     nothing refuses on it. kg_structure_closed_on is confirmed-only from
--     here on, and every guard that calls it by name (0153 lessons, 0155
--     rooms and activities, 0151 menus, the session guard below) inherits it.
--   * a recurring event is an activity (kg_activities.schedule) or N events;
--     there is no rrule column and an activity occurrence is not editable on
--     its own.
--   * an all-day event is stored as [00:00 Algiers of its first day, 00:00
--     Algiers of the day after its last day), so the room ledger, the
--     reminder bucket and the month grid read it with no special case.
--   * an event that told people is cancelled (cancelled_at), never deleted;
--     delete stays for rows nobody was ever told about.
begin;
set local lock_timeout = '5s';

-- ── 0. Two shared helpers stop handing NULL to the bell ─────────────────────
-- kg_staff_user_ids (0012) returns m.user_id for every active staff
-- membership, local members (0044) included, whose user_id is NULL. Every
-- notifier so far survived only because `s.u <> p_actor` is null-safe when an
-- actor is passed; the reminders below pass NONE (the author must hear the
-- reminder too), and kg_notifications.user_id is NOT NULL. Same signatures,
-- same ACLs (CREATE OR REPLACE keeps them), one predicate each.
create or replace function public.kg_staff_user_ids(p_tenant uuid, p_roles kg_role[] default null)
returns setof uuid language sql stable security definer set search_path = public as $$
  select m.user_id from kg_memberships m
  where m.tenant_id = p_tenant and m.status = 'active'
    and m.role <> 'parent'
    and m.user_id is not null
    and (p_roles is null or m.role = any(p_roles))
$$;

create or replace function public.kg_notify(
  p_tenant uuid, p_recipients uuid[], p_type text, p_title text, p_body text,
  p_data jsonb default '{}'::jsonb, p_actor uuid default null
) returns integer
language plpgsql security definer set search_path to 'public' as $function$
declare v_count int;
begin
  if p_recipients is null or array_length(p_recipients, 1) is null then return 0; end if;
  -- created_at = clock_timestamp(), not the transaction's now(): two rows a
  -- person gets in one transaction ('created' then 'removed') must order, and
  -- kg_event_told / kg_event_reach read a person's LATEST row.
  with inserted as (
    insert into kg_notifications (tenant_id, user_id, type, title, body, data, actor_id, created_at)
    select p_tenant, s.u, p_type, p_title, p_body, coalesce(p_data, '{}'::jsonb), p_actor, clock_timestamp()
      from (select distinct u from unnest(p_recipients) as u) s
     where s.u is not null
       and (p_actor is null or s.u <> p_actor)
    on conflict do nothing
    returning 1
  )
  select count(*) into v_count from inserted;
  return v_count;
end $function$;

-- ── 1. kg_holidays: kind, key, hijri_year, confirmed_at, range, FK ─────────
alter table public.kg_holidays
  add column if not exists kind text not null default 'closure',
  add column if not exists key text,
  add column if not exists hijri_year int,
  add column if not exists confirmed_at timestamptz;
alter table public.kg_holidays drop constraint if exists kg_holidays_kind_ck;
alter table public.kg_holidays add constraint kg_holidays_kind_ck
  check (kind in ('public', 'religious', 'school_break', 'closure'));
comment on column public.kg_holidays.kind is
  'public = fixed national date (generated, confirmed); religious = lunar date (generated tentative, confirmed by the director); school_break = a ministry vacation range, usually per structure; closure = the establishment''s own. Data and filter vocabulary only: every kind draws the same neutral chip, and tentative is the only visible mark.';
comment on column public.kg_holidays.key is
  'Idempotency key of a generated row: public:<slug>:<year> or religious:<slug>:<hijri_year>. Null on hand-typed rows.';
-- NOT VALID first, then VALIDATE: a bad row on a tenant this workflow cannot
-- inspect names itself in the validate step rather than aborting the file
-- anonymously. The lead's pre-check (SPEC5 §13.0) counts such rows first.
alter table public.kg_holidays drop constraint if exists kg_holidays_range_ck;
alter table public.kg_holidays add constraint kg_holidays_range_ck
  check (end_date is null or end_date >= date) not valid;
alter table public.kg_holidays validate constraint kg_holidays_range_ck;
create unique index if not exists kg_holidays_tenant_key_uq
  on public.kg_holidays (tenant_id, key) where key is not null;
-- Deleting the école must not turn its break into a closure of the crèche.
alter table public.kg_holidays drop constraint if exists kg_holidays_structure_id_fkey;
alter table public.kg_holidays add constraint kg_holidays_structure_id_fkey
  foreign key (structure_id) references public.kg_structures(id) on delete cascade;

-- confirmed_at is stamped by the database, never by the action.
create or replace function public.kg_holiday_stamp_confirmed() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  if (tg_op = 'INSERT' and not new.tentative)
     or (tg_op = 'UPDATE' and old.tentative and not new.tentative) then
    new.confirmed_at := now();
  end if;
  return new;
end $$;
revoke all on function public.kg_holiday_stamp_confirmed() from public, anon, authenticated;
drop trigger if exists kg_holiday_stamp_confirmed on public.kg_holidays;
create trigger kg_holiday_stamp_confirmed
  before insert or update of tentative on public.kg_holidays
  for each row execute function public.kg_holiday_stamp_confirmed();

-- Exact twins first (same tenant, scope, range, and the same French or the
-- same Arabic name), keeping the older row — the demo's doubled 1 Nov 2026.
delete from public.kg_holidays h
 using public.kg_holidays o
 where o.tenant_id = h.tenant_id and o.id <> h.id
   and o.date = h.date
   and coalesce(o.end_date, o.date) = coalesce(h.end_date, h.date)
   and o.structure_id is not distinct from h.structure_id
   and (o.name = h.name or (o.name_ar is not null and o.name_ar = h.name_ar))
   and o.created_at < h.created_at;
-- Then kind/key on the seeded civil dates, so the generator is idempotent
-- against them; and confirmed_at on every row that is already confirmed.
with civil(m, d, slug) as (values (1, 1, '1jan'), (1, 12, '12jan'), (5, 1, '1may'), (7, 5, '5jul'), (11, 1, '1nov'))
update public.kg_holidays h
   set kind = 'public',
       key  = format('public:%s:%s', c.slug, extract(year from h.date)::int)
  from civil c
 where h.key is null and h.structure_id is null and h.end_date is null
   and extract(month from h.date) = c.m and extract(day from h.date) = c.d
   and h.name in ('Jour de l''an', 'Yennayer', 'Fête du travail', 'Fête de l''indépendance', 'Anniversaire de la Révolution')
   and not exists (select 1 from public.kg_holidays o
                    where o.tenant_id = h.tenant_id and o.id <> h.id
                      and o.key = format('public:%s:%s', c.slug, extract(year from h.date)::int));
update public.kg_holidays set confirmed_at = created_at where not tentative and confirmed_at is null;

-- ── 2. One rule for "closed" ───────────────────────────────────────────────
-- Same signature as 0134: replaced in place, grants and every caller kept.
create or replace function public.kg_structure_closed_on(p_structure uuid, p_tenant uuid, p_date date)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from kg_holidays h
     where h.tenant_id = p_tenant and h.closure and not h.tentative
       and p_date between h.date and coalesce(h.end_date, h.date)
       and (h.structure_id is null or h.structure_id = p_structure))
$$;
comment on function public.kg_structure_closed_on(uuid, uuid, date) is
  'Is this structure''s door shut on this date: a CONFIRMED closure (closure = true, tentative = false) of the whole building or of this structure. The one rule the scheduler guards (0153 lessons, 0155 rooms and activities, 0151 menus, the session guard of 0157), kg_is_open_on, attendance/closure.ts, lib/closures.ts, portal/day-data.ts and the journal share. A tentative closure is a proposal: readers name it, nothing refuses on it.';

-- The row that closes (or proposes to close) a day, so no reader re-types the
-- predicate. Invoker: h_sel lets every member read holidays.
create or replace function public.kg_closure_on(p_structure uuid, p_tenant uuid, p_date date)
returns table (holiday_id uuid, name text, name_ar text, tentative boolean, kind text, date date, end_date date, structure_id uuid)
language sql stable security invoker set search_path = public as $$
  select h.id, h.name, h.name_ar, h.tentative, h.kind, h.date, h.end_date, h.structure_id
    from kg_holidays h
   where h.tenant_id = p_tenant and h.closure
     and p_date between h.date and coalesce(h.end_date, h.date)
     and (h.structure_id is null or h.structure_id = p_structure)
   order by h.tentative, (h.structure_id is null) desc, h.date
$$;
revoke all on function public.kg_closure_on(uuid, uuid, date) from public, anon;
grant execute on function public.kg_closure_on(uuid, uuid, date) to authenticated;

-- When was the appointment last SET (insert, or scheduled_at moved)? The
-- day-before reminder measures its 36-hour suppression from here, never from
-- updated_at: an outcome typed the afternoon before must not silence the
-- family's reminder (trg_kg_sessions_touch bumps updated_at on every edit).
-- Nullable, no default, no backfill: null = never moved since creation and the
-- reader falls back to created_at (a backfill UPDATE would fire the touch and
-- booking triggers on every session row of every tenant for nothing).
alter table public.kg_sessions add column if not exists scheduled_changed_at timestamptz;
comment on column public.kg_sessions.scheduled_changed_at is
  'Stamped by kg_session_stamp_schedule on insert and whenever scheduled_at moves; null = untouched since creation (read coalesce(scheduled_changed_at, created_at)).';
create or replace function public.kg_session_stamp_schedule() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  if tg_op = 'INSERT' or new.scheduled_at is distinct from old.scheduled_at then
    new.scheduled_changed_at := now();
  end if;
  return new;
end $$;
revoke all on function public.kg_session_stamp_schedule() from public, anon, authenticated;
drop trigger if exists kg_session_stamp_schedule on public.kg_sessions;
create trigger kg_session_stamp_schedule before insert or update of scheduled_at on public.kg_sessions
  for each row execute function public.kg_session_stamp_schedule();

-- Therapy respects the door too. Mirrors the lesson guard: checked on insert
-- and when the schedule columns move or a cancelled row is put back; outcome
-- and note edits on a session already sitting on a closed day still save.
create or replace function public.kg_session_closure_guard() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_day date; v_structure uuid; v_check boolean;
begin
  if new.status = 'cancelled' then return new; end if;
  if tg_op = 'INSERT' then
    v_check := true;
  else
    v_check := (new.scheduled_at, new.duration_min, new.child_id)
                 is distinct from (old.scheduled_at, old.duration_min, old.child_id)
               or (old.status = 'cancelled' and new.status <> 'cancelled');
  end if;
  if not v_check then return new; end if;
  v_day := (new.scheduled_at at time zone 'Africa/Algiers')::date;
  select c.structure_id into v_structure from public.kg_children c where c.id = new.child_id;
  if public.kg_structure_closed_on(v_structure, new.tenant_id, v_day) then
    raise exception 'outside_opening_hours' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function public.kg_session_closure_guard() from public, anon, authenticated;
drop trigger if exists kg_session_closure on public.kg_sessions;
create trigger kg_session_closure before insert or update on public.kg_sessions
  for each row execute function public.kg_session_closure_guard();

-- ── 3. Algerian public holidays, per year, idempotent ──────────────────────
-- Fixed civil dates only: Postgres has no Umm al-Qura calendar, so the
-- religious dates are computed by the app (src/lib/hijri.ts, Intl
-- islamic-umalqura) and written through kg_add_generated_holidays, tentative.
create or replace function public.kg_seed_public_holidays(p_tenant uuid, p_year int) returns int
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_n int;
begin
  with civil(m, d, slug, name, name_ar) as (values
    (1, 1,  '1jan',  'Jour de l''an',                 'رأس السنة الميلادية'),
    (1, 12, '12jan', 'Yennayer',                      'رأس السنة الأمازيغية'),
    (5, 1,  '1may',  'Fête du travail',               'عيد العمال'),
    (7, 5,  '5jul',  'Fête de l''indépendance',       'عيد الاستقلال'),
    (11, 1, '1nov',  'Anniversaire de la Révolution', 'عيد الثورة')),
  ins as (
    insert into public.kg_holidays (tenant_id, date, name, name_ar, tentative, closure, kind, key)
    select p_tenant, make_date(p_year, c.m, c.d), c.name, c.name_ar, false, true, 'public',
           format('public:%s:%s', c.slug, p_year)
      from civil c
     -- A director who typed that date by hand already has it — under any name
     -- and whether or not she ticked "fermeture" (a same-name row on the
     -- same date under any scope would trip UNIQUE (tenant_id, date, name)).
     where not exists (select 1 from public.kg_holidays h
                        where h.tenant_id = p_tenant and h.date = make_date(p_year, c.m, c.d)
                          and (h.name = c.name or (h.structure_id is null and h.end_date is null)))
    on conflict (tenant_id, key) where key is not null do nothing
    returning 1)
  select count(*) into v_n from ins;
  return v_n;
end $$;
revoke all on function public.kg_seed_public_holidays(uuid, int) from public, anon, authenticated;

create or replace function public.kg_generate_public_holidays(p_tenant uuid, p_year int) returns int
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if not public.kg_is_admin(p_tenant) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_year < 2020 or p_year > 2100 then raise exception 'invalid_year' using errcode = '22023'; end if;
  return public.kg_seed_public_holidays(p_tenant, p_year);
end $$;
revoke all on function public.kg_generate_public_holidays(uuid, int) from public, anon;
grant execute on function public.kg_generate_public_holidays(uuid, int) to authenticated;

-- Religious dates from the app, as tentative rows. Client JSON is validated
-- before any cast (22023 'invalid_rows', never a raw 22P02). A hand-typed Aïd
-- within three days of the estimate is the same Aïd and is not added twice.
create or replace function public.kg_add_generated_holidays(p_tenant uuid, p_rows jsonb) returns int
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_n int;
begin
  if not public.kg_is_admin(p_tenant) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 40 then
    raise exception 'invalid_rows' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_rows) e
              where jsonb_typeof(e) <> 'object'
                 or coalesce(e->>'date', '') !~ '^\d{4}-\d{2}-\d{2}$'
                 or coalesce(nullif(e->>'endDate', ''), '2000-01-01') !~ '^\d{4}-\d{2}-\d{2}$'
                 or coalesce(e->>'hijriYear', '') !~ '^\d{4}$'
                 or coalesce(e->>'key', '') !~ '^religious:[a-z_]+:\d{4}$'
                 or nullif(btrim(coalesce(e->>'name', '')), '') is null
                 or nullif(btrim(coalesce(e->>'nameAr', '')), '') is null) then
    raise exception 'invalid_rows' using errcode = '22023';
  end if;
  with r as (
    select (e->>'date')::date as date, nullif(e->>'endDate', '')::date as end_date,
           btrim(e->>'name') as name, btrim(e->>'nameAr') as name_ar, e->>'key' as key, (e->>'hijriYear')::int as hijri_year
      from jsonb_array_elements(p_rows) e),
  ins as (
    insert into public.kg_holidays (tenant_id, date, end_date, name, name_ar, tentative, closure, kind, key, hijri_year)
    select p_tenant, r.date, r.end_date, r.name, r.name_ar, true, true, 'religious', r.key, r.hijri_year
      from r
     where (r.end_date is null or r.end_date >= r.date)
       and not exists (select 1 from public.kg_holidays h
                        where h.tenant_id = p_tenant and h.structure_id is null
                          and h.date between r.date - 3 and r.date + 3
                          and (h.kind = 'religious' or h.name = r.name
                               or (h.name_ar is not null and h.name_ar = r.name_ar)))
    on conflict (tenant_id, key) where key is not null do nothing
    returning 1)
  select count(*) into v_n from ins;
  return v_n;
end $$;
revoke all on function public.kg_add_generated_holidays(uuid, jsonb) from public, anon;
grant execute on function public.kg_add_generated_holidays(uuid, jsonb) to authenticated;

-- A new establishment gets this year's and next year's civil dates at birth;
-- the app adds the religious ones right after (settings action). The live
-- kg_create_tenant (0137, six arguments) inserts no holidays itself, so the
-- trigger is the only seed and the UNIQUE (tenant_id, date, name) is safe.
create or replace function public.kg_tenant_seed_holidays() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_year int := extract(year from (now() at time zone 'Africa/Algiers'))::int;
begin
  perform public.kg_seed_public_holidays(new.id, v_year);
  perform public.kg_seed_public_holidays(new.id, v_year + 1);
  return new;
end $$;
revoke all on function public.kg_tenant_seed_holidays() from public, anon, authenticated;
drop trigger if exists kg_tenant_seed_holidays on public.kg_tenants;
create trigger kg_tenant_seed_holidays after insert on public.kg_tenants
  for each row execute function public.kg_tenant_seed_holidays();

-- ── 4. kg_events: all_day, cancelled_at, rsvp, updated_at ──────────────────
alter table public.kg_events
  add column if not exists all_day boolean not null default false,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references auth.users(id) on delete set null,
  add column if not exists rsvp boolean not null default false,
  add column if not exists updated_at timestamptz not null default now();
alter table public.kg_events drop constraint if exists kg_events_all_day_span;
alter table public.kg_events add constraint kg_events_all_day_span check (
  not all_day or (
    end_at is not null and end_at > start_at
    and (start_at at time zone 'Africa/Algiers')::time = time '00:00'
    and (end_at   at time zone 'Africa/Algiers')::time = time '00:00'));
comment on column public.kg_events.all_day is
  'Stored as [00:00 Algiers of the first day, 00:00 Algiers of the day after the last day). A three-day trip is one row.';
comment on column public.kg_events.cancelled_at is
  'Set instead of deleting once anyone was told: the row stays on every calendar struck through, the room is released, and everyone who held a notification is told it is off.';
create or replace function public.kg_events_touch() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin new.updated_at := now(); return new; end $$;
revoke all on function public.kg_events_touch() from public, anon, authenticated;
drop trigger if exists kg_events_touch on public.kg_events;
create trigger kg_events_touch before update on public.kg_events
  for each row execute function public.kg_events_touch();

-- The ledger releases a cancelled event's room (events branch only changed;
-- lessons and sessions exactly as 0155 — diffed against 0155 on 2026-09-12).
create or replace function kg_scheduler_private.sync_room_booking() returns trigger
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
      v_changed := (new.room_id, new.start_at, new.end_at, new.cancelled_at)
        is distinct from (old.room_id, old.start_at, old.end_at, old.cancelled_at);
    end if;
    if new.cancelled_at is null and new.room_id is not null
       and new.end_at is not null and new.end_at > new.start_at then
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

-- The occupancy sheet and the room usage counts stop showing a cancelled event.
create or replace function public.kg_bookings(p_from timestamptz, p_to timestamptz)
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
  where kg_is_staff(e.tenant_id) and e.cancelled_at is null
    and e.room_id is not null and e.end_at is not null and e.end_at > e.start_at
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

create or replace function kg_scheduler_private.room_usage(p_room uuid)
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
        union all select e.id from kg_events e where e.room_id = p_room and e.cancelled_at is null
      ) x
      where not exists (select 1 from kg_scheduler_private.room_bookings b
                        where b.source_id = x.id and upper(b.during) > now()))
$$;

-- ── 5. Rehearsal (demo tenant only; skipped where it is absent) ────────────
-- Dry run: keep the final `raise exception`. Apply: change it to `raise notice`.
-- Hygiene in apply mode: every row written here is deleted here — the source
-- row first, then the notification rows the LIVE 0091 triggers wrote for it.
do $$
declare
  t uuid := '732bdf7d-775a-4ed7-875f-8c04ea4e4778';
  ecole uuid := 'e1eadc36-2c75-4910-b35d-d3d116227097';
  creche uuid := '515ecf42-3a67-4304-86c6-66fafd6f7229';
  u_owner uuid := 'd9485859-48e8-4aad-85e7-d09e1cd16f4d';
  n int; v_lesson uuid; v_event uuid; v_session uuid; v_hand uuid; v_stamp timestamptz;
begin
  if not exists (select 1 from public.kg_tenants where id = t) then
    raise notice '0157 rehearsal skipped: demo tenant absent';
    return;
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);

  -- §0: the shared helpers hand no NULL to the bell
  if exists (select 1 from public.kg_staff_user_ids(t) u where u is null) then raise exception 'kg_staff_user_ids still returns NULL'; end if;
  if public.kg_notify(t, array[null::uuid], 'event', 'x', null, '{}'::jsonb, null) <> 0 then raise exception 'kg_notify wrote a NULL user'; end if;

  -- the tentative 15 Sept no longer closes the door; 1 Nov still does; both are named
  if public.kg_structure_closed_on(ecole, t, date '2026-09-15') then raise exception 'tentative must not close'; end if;
  if not public.kg_structure_closed_on(creche, t, date '2026-11-01') then raise exception '1 Nov must close'; end if;
  if not exists (select 1 from public.kg_closure_on(ecole, t, date '2026-09-15') where tentative) then raise exception 'tentative must be named'; end if;
  -- the duplicate 1 Nov is gone, the survivor is the older row and carries its key; confirmed rows are stamped
  select count(*) into n from public.kg_holidays where tenant_id = t and date = date '2026-11-01';
  if n <> 1 then raise exception '1 Nov rows: %', n; end if;
  if not exists (select 1 from public.kg_holidays where tenant_id = t and key = 'public:1nov:2026' and name = 'Anniversaire de la Révolution') then raise exception '1 Nov key or survivor wrong'; end if;
  if exists (select 1 from public.kg_holidays where tenant_id = t and not tentative and confirmed_at is null) then raise exception 'confirmed_at not backfilled'; end if;
  -- a lesson on the tentative day is now accepted by the 0153 guard (deleted at once)
  insert into public.kg_learning_lessons (tenant_id, class_id, program_id, membership_id, title, kind, starts_at, ends_at, status)
  values (t, '91453bbe-c35c-4f81-8c77-96459a15762b', 'a957137b-e111-4f0a-b780-8d584600d820',
          '98b14d98-a898-4c62-8f90-b5607ae281c8', 'rehearsal', 'lesson',
          '2026-09-15 08:30+01', '2026-09-15 09:30+01', 'scheduled')
  returning id into v_lesson;
  delete from public.kg_learning_lessons where id = v_lesson;
  -- a lesson on 1 Nov (confirmed) is still refused
  begin
    insert into public.kg_learning_lessons (tenant_id, class_id, program_id, membership_id, title, kind, starts_at, ends_at, status)
    values (t, '91453bbe-c35c-4f81-8c77-96459a15762b', 'a957137b-e111-4f0a-b780-8d584600d820',
            '98b14d98-a898-4c62-8f90-b5607ae281c8', 'rehearsal', 'lesson',
            '2026-11-01 08:30+01', '2026-11-01 09:30+01', 'scheduled');
    raise exception 'confirmed closure must refuse a lesson';
  exception when check_violation then null; end;
  -- activities run on the tentative Tuesday 15 Sept (Natation has no room: the
  -- slot table decides, never the room ledger) and not on the confirmed 1 Nov
  select count(*) into n from public.kg_activities a cross join lateral public.kg_activity_slots(a.schedule) s
   where a.tenant_id = t and a.active and s.dow = extract(dow from date '2026-09-15')::int
     and not public.kg_structure_closed_on(a.structure_id, t, date '2026-09-15');
  if n = 0 then raise exception 'activities must run on a tentative day'; end if;
  select count(*) into n from public.kg_activities a cross join lateral public.kg_activity_slots(a.schedule) s
   where a.tenant_id = t and a.active and s.dow = extract(dow from date '2026-11-01')::int
     and not public.kg_structure_closed_on(a.structure_id, t, date '2026-11-01');
  if n <> 0 then raise exception 'no activity may run on a confirmed closure'; end if;
  -- a session on 1 Nov is refused; one on 15 Sept is accepted and stamps scheduled_changed_at
  begin
    insert into public.kg_sessions (tenant_id, child_id, session_type, therapist_id, scheduled_at, duration_min, status)
    values (t, '3bca7a8c-d91f-4f7c-a443-b4705b42b4ca', 'speech', '791ee0f0-6451-47e3-8b3a-1b064fb81333', '2026-11-01 10:00+01', 45, 'scheduled');
    raise exception 'session on a confirmed closure must be refused';
  exception when check_violation then null; end;
  begin
    insert into public.kg_sessions (tenant_id, child_id, session_type, therapist_id, scheduled_at, duration_min, status, created_by)
    values (t, '3bca7a8c-d91f-4f7c-a443-b4705b42b4ca', 'speech', '791ee0f0-6451-47e3-8b3a-1b064fb81333', '2026-09-15 18:15+01', 30, 'scheduled', u_owner)
    returning id, scheduled_changed_at into v_session, v_stamp;
    if v_stamp is null then raise exception 'scheduled_changed_at not stamped'; end if;
    update public.kg_sessions set notes = 'outcome' where id = v_session;
    if (select scheduled_changed_at from public.kg_sessions where id = v_session) <> v_stamp then raise exception 'a note must not restamp the schedule'; end if;
    delete from public.kg_sessions where id = v_session;
  exception when exclusion_violation then
    raise notice '0157 rehearsal: 15 Sept session skipped (therapist busy at that time)';
  end;
  -- the generator is idempotent and skips a hand-typed twin without tripping UNIQUE
  if public.kg_seed_public_holidays(t, 2028) <> 5 then raise exception 'expected 5 new rows for 2028'; end if;
  if public.kg_seed_public_holidays(t, 2028) <> 0 then raise exception 'second run must add nothing'; end if;
  delete from public.kg_holidays where tenant_id = t and key like 'public:%:2028';
  insert into public.kg_holidays (tenant_id, date, name, name_ar, tentative, closure, kind)
  values (t, '2028-01-01', 'Jour de l''an', 'رأس السنة', false, false, 'closure') returning id into v_hand;
  if public.kg_seed_public_holidays(t, 2028) <> 4 then raise exception 'a hand-typed twin must be skipped, not duplicated'; end if;
  delete from public.kg_holidays where tenant_id = t and (key like 'public:%:2028' or id = v_hand);
  -- generated rows are validated before any cast
  begin
    perform public.kg_add_generated_holidays(t, '[{"date":"tomorrow","name":"x","nameAr":"x","key":"religious:x:1448","hijriYear":"1448"}]'::jsonb);
    raise exception 'malformed generated rows were accepted';
  exception when sqlstate '22023' then null; end;
  -- an all-day row with a clock is refused; a two-day all-day row is accepted
  begin
    insert into public.kg_events (tenant_id, title, start_at, end_at, all_day, audience, created_by)
    values (t, 'x', '2026-10-19 09:00+01', '2026-10-19 10:00+01', true, 'all', u_owner);
    raise exception 'all_day with a clock was accepted';
  exception when check_violation then null; end;
  insert into public.kg_events (tenant_id, title, start_at, end_at, all_day, audience, created_by)
  values (t, 'rehearsal all day', '2026-10-19 00:00+01', '2026-10-21 00:00+01', true, 'staff', u_owner)
  returning id into v_event;
  -- hygiene: the source row first, then whatever the live 0091 triggers wrote
  delete from public.kg_events where id = v_event;
  delete from public.kg_notifications where type = 'event' and data->>'eventId' = v_event::text;
  -- the check binds all-day rows only: a timed row whose end equals its start
  -- (a visit logged as an instant, which the first client has) stays valid on
  -- every tenant — ADD CONSTRAINT without NOT VALID scanned them all, and the
  -- count is printed so the deploy log names how many rows the file left alone.
  if not exists (select 1 from pg_constraint
                  where conname = 'kg_events_all_day_span' and conrelid = 'public.kg_events'::regclass and convalidated) then
    raise exception 'kg_events_all_day_span is not validated';
  end if;
  select count(*) into n from public.kg_events where not all_day and end_at = start_at;
  raise notice '0157 rehearsal: % timed rows with end_at = start_at kept valid by the all-day check', n;
  raise exception '0157 rehearsal ok — rolled back';
end $$;
notify pgrst, 'reload schema';
commit;
