-- Apply atomically. Existing bookings are never cancelled, moved or deleted.
-- Preflight runs under write locks so a concurrent booking cannot slip between
-- the audit, ledger backfill and trigger installation. Busy deployments retry.
begin;
set local lock_timeout = '5s';
lock table public.kg_learning_lessons, public.kg_sessions in share row exclusive mode;

do $$
declare bad record;
begin
  select id into bad from public.kg_sessions
  where duration_min <= 0 or not isfinite(scheduled_at) limit 1;
  if found then
    raise exception 'scheduler_invalid_session: %', bad.id
      using errcode = '23514', hint = 'Correct the duration/timestamp explicitly, then retry. No data was changed.';
  end if;
  select id into bad from public.kg_learning_lessons
  where not isfinite(starts_at) or not isfinite(ends_at) limit 1;
  if found then
    raise exception 'scheduler_invalid_lesson: %', bad.id using errcode = '23514';
  end if;
  with bookings as (
    select 'lesson' source, id, membership_id, starts_at, ends_at
    from public.kg_learning_lessons where status <> 'cancelled'
    union all
    select 'session', id, therapist_id, scheduled_at,
      scheduled_at + duration_min * interval '1 minute'
    from public.kg_sessions where status <> 'cancelled' and therapist_id is not null
  )
  select a.source a_source, a.id a_id, b.source b_source, b.id b_id, a.membership_id
  into bad from bookings a join bookings b
    on a.membership_id = b.membership_id and (a.source,a.id) < (b.source,b.id)
    and a.starts_at < b.ends_at and b.starts_at < a.ends_at
  limit 1;
  if found then
    raise exception 'scheduler_existing_overlap: % % conflicts with % % for staff %',
      bad.a_source, bad.a_id, bad.b_source, bad.b_id, bad.membership_id
      using errcode = '23P01',
        hint = 'Run supabase/tests/scheduler_preflight.sql. Resolve overlaps explicitly with the scheduling team, then retry. No data was changed.';
  end if;
end $$;

-- btree_gist already belongs to the learning-workflows migration. Include its
-- actual installation schema when creating the UUID GiST exclusion constraint.
create schema kg_scheduler_private;
revoke all on schema kg_scheduler_private from public, anon, authenticated, service_role;

create table kg_scheduler_private.staff_bookings (
  lesson_id uuid unique references public.kg_learning_lessons(id) on update cascade on delete cascade,
  session_id uuid unique references public.kg_sessions(id) on update cascade on delete cascade,
  membership_id uuid not null,
  during tstzrange not null,
  constraint staff_booking_source check (num_nonnulls(lesson_id,session_id) = 1),
  constraint staff_booking_range check (
    not isempty(during) and not lower_inf(during) and not upper_inf(during)
    and isfinite(lower(during)) and isfinite(upper(during))
    and lower_inc(during) and not upper_inc(during)
  )
);
do $$
declare extension_schema text;
begin
  select n.nspname into strict extension_schema from pg_extension e
  join pg_namespace n on n.oid=e.extnamespace where e.extname='btree_gist';
  perform set_config('search_path', format('pg_catalog, %I', extension_schema), true);
  alter table kg_scheduler_private.staff_bookings add constraint staff_booking_no_overlap
    exclude using gist (membership_id with =, during with &&);
end $$;
set local search_path = pg_catalog, public;
alter table kg_scheduler_private.staff_bookings enable row level security;
revoke all on kg_scheduler_private.staff_bookings from public, anon, authenticated, service_role;

alter table public.kg_sessions add constraint kg_sessions_valid_booking_time
  check (duration_min > 0 and isfinite(scheduled_at));
alter table public.kg_learning_lessons add constraint kg_learning_lessons_finite_time
  check (isfinite(starts_at) and isfinite(ends_at));

-- This is derived occupancy, not business history. Only cancellation, removal
-- of a session's therapist, or deletion of its source releases a booking.
-- A trigger-only definer is necessary to maintain the inaccessible ledger;
-- source-table RLS still authorizes the original write. No callable RPC exists.
create function kg_scheduler_private.sync_staff_booking() returns trigger
language plpgsql security definer set search_path = pg_catalog as $$
begin
  if tg_table_schema <> 'public' then
    raise exception 'invalid_booking_source';
  end if;
  if tg_table_name = 'kg_learning_lessons' then
    if new.status = 'cancelled' then
      delete from kg_scheduler_private.staff_bookings where lesson_id = new.id;
    else
      insert into kg_scheduler_private.staff_bookings(lesson_id,membership_id,during)
      values (new.id,new.membership_id,tstzrange(new.starts_at,new.ends_at,'[)'))
      on conflict (lesson_id) do update
        set membership_id=excluded.membership_id, during=excluded.during;
    end if;
  elsif tg_table_name = 'kg_sessions' then
    if new.status = 'cancelled' or new.therapist_id is null then
      delete from kg_scheduler_private.staff_bookings where session_id = new.id;
    else
      insert into kg_scheduler_private.staff_bookings(session_id,membership_id,during)
      values (new.id,new.therapist_id,
        tstzrange(new.scheduled_at,new.scheduled_at + new.duration_min * interval '1 minute','[)'))
      on conflict (session_id) do update
        set membership_id=excluded.membership_id, during=excluded.during;
    end if;
  else
    raise exception 'invalid_booking_source';
  end if;
  return new;
end $$;
revoke all on function kg_scheduler_private.sync_staff_booking() from public, anon, authenticated, service_role;

insert into kg_scheduler_private.staff_bookings(lesson_id,membership_id,during)
select id,membership_id,tstzrange(starts_at,ends_at,'[)')
from public.kg_learning_lessons where status <> 'cancelled';
insert into kg_scheduler_private.staff_bookings(session_id,membership_id,during)
select id,therapist_id,tstzrange(scheduled_at,scheduled_at + duration_min * interval '1 minute','[)')
from public.kg_sessions where status <> 'cancelled' and therapist_id is not null;

create trigger scheduler_lesson_booking after insert or update on public.kg_learning_lessons
  for each row execute function kg_scheduler_private.sync_staff_booking();
create trigger scheduler_session_booking after insert or update on public.kg_sessions
  for each row execute function kg_scheduler_private.sync_staff_booking();

-- Specialize the lesson guard without changing assessment/result/program rules.
-- Historical completion/title edits remain possible after archiving; creating,
-- moving, reparenting, reactivating or returning to scheduled must revalidate.
create function public.kg_learning_lesson_schedule_guard() returns trigger
language plpgsql security invoker set search_path = pg_catalog, public as $$
declare
  p public.kg_learning_programs;
  local_day date;
  structure uuid;
  hours jsonb;
  validate_schedule boolean;
begin
  if tg_op = 'UPDATE' then
    if (new.id,new.tenant_id) is distinct from (old.id,old.tenant_id) then
      raise exception 'immutable_identity' using errcode = '23514';
    end if;
    if new.class_id is distinct from old.class_id then
      raise exception 'immutable_class' using errcode = '23514';
    end if;
  end if;
  select * into p from public.kg_learning_programs where id=new.program_id for share;
  if not found then raise exception 'invalid_program' using errcode = '23514'; end if;
  local_day := (new.starts_at at time zone 'Africa/Algiers')::date;
  if tg_op = 'INSERT' then
    validate_schedule := true;
  else
    validate_schedule :=
      (new.program_id,new.starts_at,new.ends_at,new.membership_id)
        is distinct from (old.program_id,old.starts_at,old.ends_at,old.membership_id)
      or (old.status='cancelled' and new.status<>'cancelled')
      or (old.status<>'scheduled' and new.status='scheduled');
  end if;
  if validate_schedule then
    if p.archived then raise exception 'archived_program' using errcode = '23514'; end if;
    if not exists (
      select 1 from public.kg_class_staff cs join public.kg_memberships m on m.id=cs.membership_id
      where cs.class_id=new.class_id and m.id=new.membership_id and m.tenant_id=new.tenant_id
        and m.status='active' and m.role in ('owner','admin','educator','staff')
    ) then raise exception 'assign_staff_first' using errcode = '23514'; end if;
    select c.structure_id into structure from public.kg_classes c where c.id=new.class_id;
    hours := public.kg_structure_hours(structure,new.tenant_id)
      -> (array['sun','mon','tue','wed','thu','fri','sat'])[extract(dow from local_day)::int + 1];
    if hours is null or hours='null'::jsonb
      or public.kg_structure_closed_on(structure,new.tenant_id,local_day)
      or (new.starts_at at time zone 'Africa/Algiers')::time < (hours->>'open')::time
      or (new.ends_at at time zone 'Africa/Algiers')::time > (hours->>'close')::time then
      raise exception 'outside_opening_hours' using errcode = '23514';
    end if;
  end if;
  if local_day <> (new.ends_at at time zone 'Africa/Algiers')::date then
    raise exception 'same_day_required' using errcode = '23514';
  end if;
  if local_day < p.starts_on or local_day > p.ends_on then
    raise exception 'outside_program_dates' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function public.kg_learning_lesson_schedule_guard() from public, anon, authenticated, service_role;
drop trigger learning_lesson_guard on public.kg_learning_lessons;
create trigger learning_lesson_guard before insert or update on public.kg_learning_lessons
  for each row execute function public.kg_learning_lesson_schedule_guard();
notify pgrst, 'reload schema';
commit;
