-- 0153 — a class plans its week whether or not it teaches a programme.
--
-- kg_learning_lessons.program_id was NOT NULL and the only anchor of class_id
-- was the composite FK (program_id, class_id, tenant_id). So a crèche class
-- could not put "Accueil 08:00–09:00" on its week without first inventing a
-- programme, and three of the four crèche classes of the demo tenant hold
-- nothing. A programme is a course of study with objectives and dates; the
-- moments of a crèche day are not, and a routine dressed as a programme leaks
-- into every programme reader (the Programmes table, the class card, the
-- portal's "Programmes en cours" progress).
--
-- After this file: an école cours still belongs to a programme (the guard
-- says so first, with a token the editor maps; a CHECK says so last, as the
-- invariant); an activité, a moment of daily life (kind care) or a group
-- workshop may stand alone. Hours, closures, staff assignment, same-day, both
-- exclusion constraints and the staff-bookings ledger are untouched: a
-- routine block books the room and the educator exactly like a cours.
--
-- Rehearsed with supabase/tests/daily_journal_rehearsal.sql part A (rolled back).
begin;
set local lock_timeout = '5s';

alter table public.kg_learning_lessons alter column program_id drop not null;

-- The composite FK is MATCH SIMPLE: with program_id null it checks nothing,
-- so class_id needs an anchor of its own (kg_classes_learning_key, 0147).
alter table public.kg_learning_lessons
  drop constraint if exists kg_learning_lessons_class_id_tenant_id_fkey;
alter table public.kg_learning_lessons
  add constraint kg_learning_lessons_class_id_tenant_id_fkey
  foreign key (class_id, tenant_id) references public.kg_classes(id, tenant_id);

alter table public.kg_learning_lessons
  drop constraint if exists kg_learning_lessons_lesson_needs_program;
alter table public.kg_learning_lessons
  add constraint kg_learning_lessons_lesson_needs_program
  check (kind <> 'lesson' or program_id is not null);

-- Same guard as 0150; every programme branch now applies only when there is
-- a programme. `p` is a row variable, so p.id is null until the select fills
-- it. The guard is a BEFORE trigger, so its 'lesson_needs_program' is raised
-- before the CHECK above could, and the editor receives a token
-- (lesson-errors.ts) rather than a constraint name.
create or replace function public.kg_learning_lesson_schedule_guard() returns trigger
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
  if new.kind = 'lesson' and new.program_id is null then
    raise exception 'lesson_needs_program' using errcode = '23514';
  end if;
  if new.program_id is not null then
    select * into p from public.kg_learning_programs where id=new.program_id for share;
    if not found then raise exception 'invalid_program' using errcode = '23514'; end if;
    if p.class_id <> new.class_id then raise exception 'invalid_program' using errcode = '23514'; end if;
  end if;
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
    if p.id is not null and p.archived then
      raise exception 'archived_program' using errcode = '23514';
    end if;
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
  if p.id is not null and (local_day < p.starts_on or local_day > p.ends_on) then
    raise exception 'outside_program_dates' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function public.kg_learning_lesson_schedule_guard() from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';
commit;
