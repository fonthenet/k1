-- Runs against the connected schema. All fixture writes roll back.
begin;
create temporary table learning_fixture as
select gen_random_uuid() tenant, gen_random_uuid() other_tenant,
  gen_random_uuid() structure, gen_random_uuid() nursery,
  gen_random_uuid() class, gen_random_uuid() other_class, gen_random_uuid() nursery_class,
  gen_random_uuid() owner_member, gen_random_uuid() teacher_member,
  gen_random_uuid() child, gen_random_uuid() other_child, gen_random_uuid() guardian,
  gen_random_uuid() program, gen_random_uuid() nursery_program,
  gen_random_uuid() assessment,
  (select id from auth.users order by created_at limit 1) owner_user,
  (select id from auth.users order by created_at offset 1 limit 1) teacher_user,
  (select id from auth.users order by created_at offset 2 limit 1) parent_user;
grant select on learning_fixture to authenticated;
create function pg_temp.assert_true(value boolean, message text) returns void language plpgsql as $$
begin if value is distinct from true then raise exception 'FAILED: %', message; end if; end $$;
create function pg_temp.expect_error(statement text, expected text) returns void language plpgsql as $$
begin
  begin execute statement;
  exception when others then
    if sqlstate = expected then return; end if;
    raise exception 'Expected %, got %: %', expected, sqlstate, sqlerrm;
  end;
  raise exception 'Expected % but statement succeeded', expected;
end $$;
select pg_temp.assert_true(parent_user is not null, 'three test identities available') from learning_fixture;
insert into public.kg_tenants(id,name,slug) select tenant,'Learning QA '||tenant, 'learning-qa-'||tenant from learning_fixture;
insert into public.kg_tenants(id,name,slug) select other_tenant,'Learning QA '||other_tenant, 'learning-qa-'||other_tenant from learning_fixture;
insert into public.kg_structures(id,tenant_id,name,center_type) select structure,tenant,'School QA','private_primary' from learning_fixture;
insert into public.kg_structures(id,tenant_id,name,center_type) select nursery,tenant,'Nursery QA','nursery' from learning_fixture;
insert into public.kg_classes(id,tenant_id,structure_id,name) select class,tenant,structure,'Class QA' from learning_fixture;
insert into public.kg_classes(id,tenant_id,structure_id,name) select nursery_class,tenant,nursery,'Nursery QA' from learning_fixture;
insert into public.kg_classes(id,tenant_id,name) select other_class,other_tenant,'Other tenant QA' from learning_fixture;
insert into public.kg_memberships(id,tenant_id,user_id,role) select owner_member,tenant,owner_user,'owner' from learning_fixture;
insert into public.kg_memberships(id,tenant_id,user_id,role) select teacher_member,tenant,teacher_user,'educator' from learning_fixture;
insert into public.kg_memberships(tenant_id,user_id,role) select tenant,parent_user,'parent' from learning_fixture;
insert into public.kg_class_staff(class_id,membership_id) select class,teacher_member from learning_fixture;
insert into public.kg_children(id,tenant_id,class_id,first_name,last_name,dob,gender,status) select child,tenant,class,'Learning','QA','2018-01-01','female','enrolled' from learning_fixture;
insert into public.kg_children(id,tenant_id,class_id,first_name,last_name,dob,gender,status) select other_child,tenant,class,'Other','QA','2018-01-01','male','enrolled' from learning_fixture;
insert into public.kg_guardians(id,tenant_id,user_id,first_name,last_name,phone) select guardian,tenant,parent_user,'Guardian','QA','0550123456' from learning_fixture;
insert into public.kg_child_guardians(child_id,guardian_id) select child,guardian from learning_fixture;
select set_config('request.jwt.claim.sub',owner_user::text,true) from learning_fixture;
set local role authenticated;
insert into public.kg_learning_programs(id,tenant_id,class_id,title,starts_on,ends_on) select program,tenant,class,'Math QA','2026-09-01','2026-12-31' from learning_fixture;
insert into public.kg_learning_programs(id,tenant_id,class_id,title,starts_on,ends_on) select nursery_program,tenant,nursery_class,'Care QA','2026-09-01','2026-12-31' from learning_fixture;
select pg_temp.expect_error(format('insert into public.kg_learning_programs(tenant_id,class_id,title,starts_on,ends_on) values (%L,%L,''Cross tenant'',''2026-09-01'',''2026-12-31'')',tenant,other_class),'23503') from learning_fixture;
insert into public.kg_learning_lessons(tenant_id,class_id,program_id,membership_id,title,kind,starts_at,ends_at)
select tenant,class,program,teacher_member,'Math','lesson','2026-09-13 09:00+01','2026-09-13 10:00+01' from learning_fixture;
select pg_temp.expect_error(format('insert into public.kg_learning_lessons(tenant_id,class_id,program_id,membership_id,title,kind,starts_at,ends_at) values (%L,%L,%L,%L,''Conflict'',''lesson'',''2026-09-13 09:30+01'',''2026-09-13 10:30+01'')',tenant,class,program,teacher_member),'23P01') from learning_fixture;
select pg_temp.expect_error(format('insert into public.kg_learning_lessons(tenant_id,class_id,program_id,membership_id,title,kind,starts_at,ends_at) values (%L,%L,%L,%L,''Series first'',''lesson'',''2026-09-20 09:00+01'',''2026-09-20 10:00+01''),(%L,%L,%L,%L,''Series conflict'',''lesson'',''2026-09-13 09:00+01'',''2026-09-13 10:00+01'')',tenant,class,program,teacher_member,tenant,class,program,teacher_member),'23P01') from learning_fixture;
select pg_temp.assert_true((select count(*)=1 from public.kg_learning_lessons where tenant_id=(select tenant from learning_fixture)),'series insert is atomic');
select pg_temp.expect_error(format('insert into public.kg_learning_lessons(tenant_id,class_id,program_id,membership_id,title,kind,starts_at,ends_at) values (%L,%L,%L,%L,''Unassigned'',''lesson'',''2026-09-13 11:00+01'',''2026-09-13 12:00+01'')',tenant,class,program,owner_member),'23514') from learning_fixture;
select pg_temp.expect_error(format('insert into public.kg_learning_lessons(tenant_id,class_id,program_id,membership_id,title,kind,starts_at,ends_at) values (%L,%L,%L,%L,''Closed Friday'',''lesson'',''2026-09-11 09:00+01'',''2026-09-11 10:00+01'')',tenant,class,program,teacher_member),'23514') from learning_fixture;
select pg_temp.expect_error(format('insert into public.kg_learning_assessments(tenant_id,class_id,program_id,title,kind,scheduled_on) values (%L,%L,%L,''Nursery exam'',''exam'',''2026-09-13'')',tenant,nursery_class,nursery_program),'23514') from learning_fixture;
insert into public.kg_learning_assessments(id,tenant_id,class_id,program_id,title,kind,scheduled_on)
select assessment,tenant,class,program,'Test QA','test','2026-09-13' from learning_fixture;
select set_config('request.jwt.claim.sub',teacher_user::text,true) from learning_fixture;
select pg_temp.assert_true(public.kg_can_teach(tenant,class),'assigned educator authorized') from learning_fixture;
select pg_temp.assert_true(not public.kg_can_teach(tenant,nursery_class),'unassigned class forbidden') from learning_fixture;
insert into public.kg_learning_results(tenant_id,assessment_id,child_id,max_score,score,outcome)
select tenant,assessment,child,20,0,'graded' from learning_fixture;
insert into public.kg_learning_results(tenant_id,assessment_id,child_id,max_score,score,outcome)
select tenant,assessment,other_child,20,18,'graded' from learning_fixture;
select pg_temp.expect_error(format('update public.kg_learning_results set score=21 where child_id=%L',child),'23514') from learning_fixture;
select set_config('request.jwt.claim.sub',parent_user::text,true) from learning_fixture;
select pg_temp.assert_true((select count(*)=0 from public.kg_learning_results),'parent cannot read drafts');
select pg_temp.assert_true((select count(*)=1 from public.kg_learning_lessons),'parent reads own class timetable');
select pg_temp.expect_error(format('insert into public.kg_learning_programs(tenant_id,class_id,title,starts_on,ends_on) values (%L,%L,''Parent write'',''2026-09-01'',''2026-12-31'')',tenant,class),'42501') from learning_fixture;
select set_config('request.jwt.claim.sub',owner_user::text,true) from learning_fixture;
update public.kg_learning_assessments set published=true where id=(select assessment from learning_fixture);
select set_config('request.jwt.claim.sub',parent_user::text,true) from learning_fixture;
select pg_temp.assert_true((select count(*)=1 from public.kg_learning_results),'parent sees only own published result');
select pg_temp.assert_true((select score=0 from public.kg_learning_results),'zero mark preserved');
reset role;
update public.kg_children set class_id=null where id=(select child from learning_fixture);
set local role authenticated;
select pg_temp.assert_true((select count(*)=1 from public.kg_learning_results),'parent keeps published history after class transfer');
select set_config('request.jwt.claim.sub',teacher_user::text,true) from learning_fixture;
with changed as (update public.kg_learning_results set score=10 returning id)
select pg_temp.assert_true((select count(*)=0 from changed),'published results locked against edits');
reset role;
set local role anon;
select pg_temp.expect_error('select * from public.kg_learning_results','42501');
reset role;
rollback;
select 'PASS: isolated fixtures rolled back; booking, type, marks and role/parent access checks passed' as result;
