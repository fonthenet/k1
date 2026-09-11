-- Included inside a transaction by scheduler tests. No real tenant is modified.
create temporary table scheduler_fixture as
select gen_random_uuid() tenant,gen_random_uuid() structure,
  gen_random_uuid() class,gen_random_uuid() other_class,
  gen_random_uuid() member,gen_random_uuid() other_member,
  gen_random_uuid() program,gen_random_uuid() other_program,
  gen_random_uuid() archived_program,gen_random_uuid() short_program,
  gen_random_uuid() child,
  (select id from auth.users order by created_at,id limit 1) actor,
  (select id from auth.users order by created_at,id offset 1 limit 1) other_actor;
do $$ begin
  if exists(select 1 from scheduler_fixture where actor is null or other_actor is null) then
    raise exception 'scheduler tests require two existing auth identities';
  end if;
end $$;
grant select on scheduler_fixture to authenticated;
insert into public.kg_tenants(id,name,slug)
select tenant,'Scheduler QA '||tenant,'scheduler-qa-'||tenant from scheduler_fixture;
insert into public.kg_structures(id,tenant_id,name,center_type)
select structure,tenant,'Scheduler QA','private_primary' from scheduler_fixture;
insert into public.kg_classes(id,tenant_id,structure_id,name)
select class,tenant,structure,'Scheduler A' from scheduler_fixture
union all select other_class,tenant,structure,'Scheduler B' from scheduler_fixture;
insert into public.kg_memberships(id,tenant_id,user_id,role)
select member,tenant,actor,'owner'::public.kg_role from scheduler_fixture
union all select other_member,tenant,other_actor,'educator'::public.kg_role from scheduler_fixture;
insert into public.kg_class_staff(class_id,membership_id)
select class,member from scheduler_fixture union all select class,other_member from scheduler_fixture
union all select other_class,member from scheduler_fixture;
insert into public.kg_children(id,tenant_id,class_id,first_name,last_name,dob,gender,status)
select child,tenant,class,'Scheduler','QA','2018-01-01','female','enrolled' from scheduler_fixture;
insert into public.kg_learning_programs(id,tenant_id,class_id,title,starts_on,ends_on,archived)
select program,tenant,class,'Scheduler A','2026-09-01'::date,'2026-12-31'::date,false from scheduler_fixture
union all select other_program,tenant,class,'Scheduler B','2026-09-01','2026-12-31',false from scheduler_fixture
union all select archived_program,tenant,class,'Archived','2026-09-01','2026-12-31',true from scheduler_fixture
union all select short_program,tenant,class,'Short','2026-09-01','2026-09-02',false from scheduler_fixture;

create function pg_temp.assert_true(value boolean,message text) returns void language plpgsql as $$
begin if value is distinct from true then raise exception 'FAILED: %',message; end if; end $$;
create function pg_temp.expect_error(statement text,code text,message text default null)
returns void language plpgsql as $$
begin
  begin execute statement;
  exception when others then
    if sqlstate=code and (message is null or sqlerrm=message) then return; end if;
    raise exception 'Expected % %, got %: %',code,message,sqlstate,sqlerrm;
  end;
  raise exception 'Expected % %, statement succeeded: %',code,message,statement;
end $$;
create function pg_temp.lesson(at_time text, lesson_status text default 'scheduled', staff uuid default null)
returns uuid language plpgsql as $$
declare result uuid;
begin
  insert into public.kg_learning_lessons(tenant_id,class_id,program_id,membership_id,title,kind,starts_at,ends_at,status)
  select tenant,class,program,coalesce(staff,member),'Scheduler lesson','lesson',
    at_time::timestamptz,at_time::timestamptz+interval '1 hour',lesson_status from scheduler_fixture returning id into result;
  return result;
end $$;
create function pg_temp.session(at_time text, session_status text default 'scheduled', staff uuid default null)
returns uuid language plpgsql as $$
declare result uuid;
begin
  insert into public.kg_sessions(tenant_id,child_id,therapist_id,scheduled_at,duration_min,status)
  select tenant,child,coalesce(staff,member),at_time::timestamptz,60,session_status::public.kg_session_status
  from scheduler_fixture returning id into result;
  return result;
end $$;
