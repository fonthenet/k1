-- 0156 — one schedule shape, kept by a CHECK.
--
-- 0155 taught every reader both spellings of an activity slot and refused
-- only the unreadable. Now that the only writer left is a dialog that reads
-- both and writes {day:"tue", start:"14:00", end:"15:30"}, the rows are
-- rewritten once (each rewrite printed: tenant, activity, before, after — the
-- deploy log says which activities a director may want to open and confirm;
-- on the demo all five change, four because a number becomes a name and
-- Anglais because its end is derived), the BEFORE trigger stores the
-- canonical form from here on, and a CHECK keeps it that way.
begin;
set local lock_timeout = '5s';
lock table public.kg_activities in share row exclusive mode;

do $$
declare bad record; r record; v_n int;
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
  for r in
    select tenant_id, id, name, schedule, public.kg_activity_schedule_normalise(schedule) normalised
    from public.kg_activities
    where schedule <> public.kg_activity_schedule_normalise(schedule)
    order by tenant_id, name
  loop
    raise notice 'activity schedule normalised: tenant % · % (%) · % → %',
      r.tenant_id, r.name, r.id, r.schedule, r.normalised;
  end loop;
  update public.kg_activities set schedule = public.kg_activity_schedule_normalise(schedule)
   where schedule <> public.kg_activity_schedule_normalise(schedule);
  get diagnostics v_n = row_count;
  raise notice 'activity schedules normalised: %', v_n;
end $$;

-- The same checks as 0155's, plus: store the one shape.
create or replace function kg_scheduler_private.activity_schedule_shape() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_norm jsonb;
begin
  if jsonb_typeof(new.schedule) <> 'array' then
    raise exception 'activity_schedule_invalid' using errcode = '23514',
      hint = 'The schedule is a list of slots {day, start, end}.';
  end if;
  v_norm := public.kg_activity_schedule_normalise(new.schedule);
  if jsonb_array_length(v_norm) <> jsonb_array_length(new.schedule) then
    raise exception 'activity_schedule_invalid' using errcode = '23514',
      hint = 'Each slot needs a weekday and a start (and end) inside the day.';
  end if;
  new.schedule := v_norm;
  return new;
end $$;

alter table public.kg_activities add constraint kg_activities_schedule_shape
  check (public.kg_activity_schedule_valid(schedule));

do $$
begin
  if exists (select 1 from public.kg_activities where not public.kg_activity_schedule_valid(schedule)) then
    raise exception 'rehearsal: an activity schedule escaped normalisation';
  end if;
  if exists (select 1 from public.kg_activities where schedule <> public.kg_activity_schedule_normalise(schedule)) then
    raise exception 'rehearsal: a stored schedule is not in the one shape';
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
