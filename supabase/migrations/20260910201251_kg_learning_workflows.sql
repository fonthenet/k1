-- Class learning plans are distinct from individual therapeutic kg_programs.
create extension if not exists btree_gist;
alter table public.kg_classes add constraint kg_classes_learning_key unique (id, tenant_id);
alter table public.kg_memberships add constraint kg_memberships_learning_key unique (id, tenant_id);
alter table public.kg_children add constraint kg_children_learning_key unique (id, tenant_id);

create function public.kg_can_teach(t uuid, c uuid) returns boolean
language sql stable security invoker set search_path = public, pg_catalog as $$
  select kg_is_admin(t) or (kg_is_educator(t) and exists (
    select 1 from kg_class_staff cs join kg_memberships m on m.id = cs.membership_id
    join kg_classes cl on cl.id = cs.class_id
    where cs.class_id = c and cl.tenant_id = t and m.tenant_id = t
      and m.user_id = auth.uid() and m.status = 'active'
      and m.role in ('educator','staff')
  ));
$$;
revoke all on function public.kg_can_teach(uuid,uuid) from public, anon;
grant execute on function public.kg_can_teach(uuid,uuid) to authenticated;

create table public.kg_learning_programs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.kg_tenants(id),
  class_id uuid not null,
  title text not null check (length(trim(title)) between 1 and 200),
  objectives text not null default '' check (length(objectives) <= 4000),
  starts_on date not null,
  ends_on date not null check (ends_on >= starts_on),
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  foreign key (class_id,tenant_id) references public.kg_classes(id,tenant_id),
  unique (id,class_id,tenant_id)
);
create table public.kg_learning_lessons (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  class_id uuid not null,
  program_id uuid not null,
  membership_id uuid not null,
  title text not null check (length(trim(title)) between 1 and 200),
  kind text not null check (kind in ('lesson','activity','care','therapy')),
  starts_at timestamptz not null,
  ends_at timestamptz not null check (ends_at > starts_at and ends_at <= starts_at + interval '8 hours'),
  status text not null default 'scheduled' check (status in ('scheduled','completed','cancelled')),
  foreign key (program_id,class_id,tenant_id) references public.kg_learning_programs(id,class_id,tenant_id),
  foreign key (membership_id,tenant_id) references public.kg_memberships(id,tenant_id),
  exclude using gist (class_id with =, tstzrange(starts_at,ends_at,'[)') with &&) where (status <> 'cancelled'),
  exclude using gist (membership_id with =, tstzrange(starts_at,ends_at,'[)') with &&) where (status <> 'cancelled')
);
create table public.kg_learning_assessments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  class_id uuid not null,
  program_id uuid not null,
  title text not null check (length(trim(title)) between 1 and 200),
  kind text not null check (kind in ('observation','test','exam')),
  scheduled_on date not null,
  max_score numeric(6,2) not null default 20 check (max_score > 0 and max_score <= 1000),
  published boolean not null default false,
  foreign key (program_id,class_id,tenant_id) references public.kg_learning_programs(id,class_id,tenant_id),
  unique (id,tenant_id,max_score)
);
create table public.kg_learning_results (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  assessment_id uuid not null,
  child_id uuid not null,
  max_score numeric(6,2) not null,
  score numeric(6,2) check (score >= 0 and score <= max_score),
  outcome text not null check (outcome in ('emerging','developing','secure','absent','graded')),
  feedback text not null default '' check (length(feedback) <= 4000),
  updated_at timestamptz not null default now(),
  foreign key (assessment_id,tenant_id,max_score) references public.kg_learning_assessments(id,tenant_id,max_score),
  foreign key (child_id,tenant_id) references public.kg_children(id,tenant_id),
  unique (assessment_id,child_id),
  check ((outcome = 'graded' and score is not null) or (outcome <> 'graded' and score is null))
);
create index on public.kg_learning_programs(tenant_id,class_id);
create index on public.kg_learning_lessons(tenant_id,starts_at);
create index on public.kg_learning_lessons(program_id,class_id,tenant_id);
create index on public.kg_learning_lessons(membership_id,tenant_id);
create index on public.kg_learning_assessments(tenant_id,class_id,scheduled_on);
create index on public.kg_learning_assessments(program_id,class_id,tenant_id);
create index on public.kg_learning_results(child_id,tenant_id);
create index on public.kg_learning_results(assessment_id,tenant_id,max_score);

-- Reads for families follow their children, never the other pupils in a class.
alter table public.kg_learning_programs enable row level security;
alter table public.kg_learning_lessons enable row level security;
alter table public.kg_learning_assessments enable row level security;
alter table public.kg_learning_results enable row level security;
revoke all on public.kg_learning_programs, public.kg_learning_lessons,
  public.kg_learning_assessments, public.kg_learning_results from public, anon, authenticated;
grant select,insert,update on public.kg_learning_programs, public.kg_learning_lessons,
  public.kg_learning_assessments, public.kg_learning_results to authenticated;

create policy learning_program_read on public.kg_learning_programs for select to authenticated using (
  kg_is_staff(tenant_id) or (kg_is_member(tenant_id) and exists (
    select 1 from kg_children c where c.class_id = kg_learning_programs.class_id and kg_is_parent_of(c.id)))
);
create policy learning_program_insert on public.kg_learning_programs for insert to authenticated with check (kg_can_teach(tenant_id,class_id));
create policy learning_program_update on public.kg_learning_programs for update to authenticated using (kg_can_teach(tenant_id,class_id)) with check (kg_can_teach(tenant_id,class_id));
create policy learning_lesson_read on public.kg_learning_lessons for select to authenticated using (
  kg_is_staff(tenant_id) or (kg_is_member(tenant_id) and exists (
    select 1 from kg_children c where c.class_id = kg_learning_lessons.class_id and kg_is_parent_of(c.id)))
);
create policy learning_lesson_insert on public.kg_learning_lessons for insert to authenticated with check (kg_can_teach(tenant_id,class_id));
create policy learning_lesson_update on public.kg_learning_lessons for update to authenticated using (kg_can_teach(tenant_id,class_id)) with check (kg_can_teach(tenant_id,class_id));
create policy learning_assessment_read on public.kg_learning_assessments for select to authenticated using (
  kg_can_teach(tenant_id,class_id) or (published and kg_is_member(tenant_id) and (
    exists (select 1 from kg_children c where c.class_id = kg_learning_assessments.class_id and kg_is_parent_of(c.id))
  ))
);
create policy learning_assessment_insert on public.kg_learning_assessments for insert to authenticated with check (kg_can_teach(tenant_id,class_id) and not published);
create policy learning_assessment_update on public.kg_learning_assessments for update to authenticated using (kg_can_teach(tenant_id,class_id)) with check (kg_can_teach(tenant_id,class_id));
create policy learning_result_read on public.kg_learning_results for select to authenticated using (
  exists (select 1 from kg_learning_assessments a where a.id = assessment_id and (
    kg_can_teach(a.tenant_id,a.class_id) or (a.published and kg_is_member(a.tenant_id) and kg_is_parent_of(child_id))))
);
create policy learning_result_insert on public.kg_learning_results for insert to authenticated with check (
  exists (select 1 from kg_learning_assessments a where a.id = assessment_id and not a.published and kg_can_teach(a.tenant_id,a.class_id))
);
create policy learning_result_update on public.kg_learning_results for update to authenticated using (
  exists (select 1 from kg_learning_assessments a where a.id = assessment_id and not a.published and kg_can_teach(a.tenant_id,a.class_id))
) with check (
  exists (select 1 from kg_learning_assessments a where a.id = assessment_id and not a.published and kg_can_teach(a.tenant_id,a.class_id))
);

create function public.kg_learning_guard() returns trigger
language plpgsql security invoker set search_path = public, pg_catalog as $$
declare p kg_learning_programs; a kg_learning_assessments; local_day date; school_type text; structure uuid; hours jsonb;
begin
  if tg_op = 'UPDATE' and (new.id <> old.id or new.tenant_id <> old.tenant_id) then
    raise exception 'immutable_identity' using errcode='23514';
  end if;
  if tg_table_name <> 'kg_learning_results' then
    if tg_op = 'UPDATE' and new.class_id <> old.class_id then
      raise exception 'immutable_class' using errcode='23514';
    end if;
  end if;
  if tg_table_name in ('kg_learning_lessons','kg_learning_assessments') then
    select * into p from kg_learning_programs where id = new.program_id for share;
    if not found then raise exception 'invalid_program' using errcode='23514'; end if;
    if tg_table_name = 'kg_learning_lessons' then
      local_day := (new.starts_at at time zone 'Africa/Algiers')::date;
      if tg_op = 'INSERT' or (new.starts_at,new.ends_at,new.membership_id) is distinct from (old.starts_at,old.ends_at,old.membership_id) or (old.status='cancelled' and new.status='scheduled') then
        if p.archived then raise exception 'archived_program' using errcode='23514'; end if;
        if not exists (select 1 from kg_class_staff cs join kg_memberships m on m.id=cs.membership_id
          where cs.class_id=new.class_id and m.id=new.membership_id and m.tenant_id=new.tenant_id
          and m.status='active' and m.role in ('owner','admin','educator','staff')) then
          raise exception 'assign_staff_first' using errcode='23514';
        end if;
        select c.structure_id into structure from kg_classes c where c.id=new.class_id;
        hours := kg_structure_hours(structure,new.tenant_id) -> (array['sun','mon','tue','wed','thu','fri','sat'])[extract(dow from local_day)::int + 1];
        if hours is null or hours='null'::jsonb or kg_structure_closed_on(structure,new.tenant_id,local_day)
          or (new.starts_at at time zone 'Africa/Algiers')::time < (hours->>'open')::time
          or (new.ends_at at time zone 'Africa/Algiers')::time > (hours->>'close')::time then
          raise exception 'outside_opening_hours' using errcode='23514';
        end if;
      end if;
      if local_day <> (new.ends_at at time zone 'Africa/Algiers')::date then
        raise exception 'same_day_required' using errcode='23514';
      end if;
    else
      local_day := new.scheduled_on;
      select s.center_type::text into school_type from kg_classes c join kg_structures s on s.id=c.structure_id where c.id=new.class_id;
      if new.kind <> 'observation' and coalesce(school_type,'') not in ('edu_center','private_primary','private_middle','private_secondary') then
        raise exception 'observations_only' using errcode='23514';
      end if;
      if tg_op='INSERT' and p.archived then raise exception 'archived_program' using errcode='23514'; end if;
      if tg_op='UPDATE' and (new.program_id,new.kind,new.max_score) is distinct from (old.program_id,old.kind,old.max_score) then
        raise exception 'immutable_assessment_definition' using errcode='23514';
      end if;
    end if;
    if local_day < p.starts_on or local_day > p.ends_on then
      raise exception 'outside_program_dates' using errcode='23514';
    end if;
  elsif tg_table_name = 'kg_learning_results' then
    select * into a from kg_learning_assessments where id=new.assessment_id for share;
    if not found or a.published then raise exception 'unpublish_first' using errcode='23514'; end if;
    if tg_op='UPDATE' and (new.assessment_id,new.child_id) is distinct from (old.assessment_id,old.child_id) then
      raise exception 'immutable_result_owner' using errcode='23514';
    end if;
    if tg_op='INSERT' and not exists (select 1 from kg_children c where c.id=new.child_id and c.class_id=a.class_id and c.tenant_id=new.tenant_id and c.status='enrolled') then
      raise exception 'student_not_enrolled' using errcode='23514';
    end if;
    if (a.kind='observation' and new.outcome='graded') or (a.kind<>'observation' and new.outcome not in ('graded','absent')) then
      raise exception 'invalid_outcome' using errcode='23514';
    end if;
    new.updated_at := now();
  elsif tg_op='UPDATE' and (new.starts_on,new.ends_on) is distinct from (old.starts_on,old.ends_on) then
    raise exception 'immutable_program_dates' using errcode='23514';
  end if;
  return new;
end $$;
revoke all on function public.kg_learning_guard() from public, anon, authenticated;
create trigger learning_program_guard before update on public.kg_learning_programs for each row execute function public.kg_learning_guard();
create trigger learning_lesson_guard before insert or update on public.kg_learning_lessons for each row execute function public.kg_learning_guard();
create trigger learning_assessment_guard before insert or update on public.kg_learning_assessments for each row execute function public.kg_learning_guard();
create trigger learning_result_guard before insert or update on public.kg_learning_results for each row execute function public.kg_learning_guard();
notify pgrst, 'reload schema';
