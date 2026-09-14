-- Demo tenant only: the twelve école pupils (1re / 2e année) came from the
-- learning seed without a family, so the register's check-out dialog had no
-- one to offer for them — a text box under a sentence that promised a list.
-- Every pupil gets a father and a mother who may collect (the father is the
-- primary and pays), and two of them a grandmother the parents authorised.
--
-- Idempotent: ids are derived from the child id and a pupil who already has
-- a family is skipped, so running it twice adds nothing. No user_id — these families have no login, exactly like a family
-- the office typed in at enrolment. Teardown at the bottom.
begin;
do $$
declare
  v_tenant constant uuid := '732bdf7d-775a-4ed7-875f-8c04ea4e4778';
  r record;
  n int := 0;
  -- Distinct first names so the chips read as people, not as "Father · Mother".
  fathers text[] := array['Karim','Mourad','Sofiane','Nabil','Yacine','Farid','Samir','Rachid','Lotfi','Hakim','Djamel','Fouad'];
  fathers_ar text[] := array['كريم','مراد','سفيان','نبيل','ياسين','فريد','سمير','رشيد','لطفي','حكيم','جمال','فؤاد'];
  mothers text[] := array['Nadia','Samia','Houria','Fatiha','Lamia','Souad','Warda','Hayet','Naima','Djamila','Karima','Zohra'];
  mothers_ar text[] := array['نادية','سامية','حورية','فتيحة','لمياء','سعاد','وردة','حياة','نعيمة','جميلة','كريمة','زهرة'];
begin
  if not exists (select 1 from kg_tenants where id = v_tenant and settings->>'demo' = 'true') then
    raise exception 'not the demo tenant';
  end if;
  for r in
    select c.id, c.last_name, c.last_name_ar
    from kg_children c join kg_classes cl on cl.id = c.class_id
    where c.tenant_id = v_tenant and c.status = 'enrolled'
      and cl.name in ('1re année', '2e année')
      -- Zakaria Merzouki already has his; the twelve names above are for
      -- the twelve without.
      and not exists (select 1 from kg_child_guardians cg where cg.child_id = c.id)
    order by cl.name, c.last_name
  loop
    n := n + 1;
    insert into kg_guardians (id, tenant_id, first_name, last_name, first_name_ar, last_name_ar, relationship, phone)
    values
      (md5('demo-guardian:' || r.id || ':father')::uuid, v_tenant, fathers[n], r.last_name, fathers_ar[n], r.last_name_ar, 'father', '0550 ' || lpad((10 + n)::text, 2, '0') || ' 41 ' || lpad((20 + n)::text, 2, '0')),
      (md5('demo-guardian:' || r.id || ':mother')::uuid, v_tenant, mothers[n], r.last_name, mothers_ar[n], r.last_name_ar, 'mother', '0660 ' || lpad((30 + n)::text, 2, '0') || ' 72 ' || lpad((40 + n)::text, 2, '0'))
    on conflict (id) do nothing;
    insert into kg_child_guardians (child_id, guardian_id, is_primary, can_pickup, is_financial) values
      (r.id, md5('demo-guardian:' || r.id || ':father')::uuid, true, true, true),
      (r.id, md5('demo-guardian:' || r.id || ':mother')::uuid, false, true, false)
    on conflict do nothing;
  end loop;
  raise notice 'école pupils with a family: %', n;

  -- Two grandmothers the parents named: the case the chips exist for.
  insert into kg_authorized_pickups (id, tenant_id, child_id, name, relationship, phone)
  select md5('demo-pickup:' || c.id)::uuid, v_tenant, c.id,
         case when c.last_name = 'Boukhalfa' then 'Zineb Boukhalfa' else 'Aïcha Mansouri' end,
         'grandparent', '0770 22 01 0' || (row_number() over ())::text
  from kg_children c
  where c.tenant_id = v_tenant and c.last_name in ('Boukhalfa', 'Mansouri')
  on conflict (id) do nothing;
end $$;
commit;

-- Teardown (run by hand when the demo family is no longer wanted):
-- delete from kg_authorized_pickups where tenant_id = '732bdf7d-775a-4ed7-875f-8c04ea4e4778' and id in (select md5('demo-pickup:' || id)::uuid from kg_children);
-- delete from kg_guardians where tenant_id = '732bdf7d-775a-4ed7-875f-8c04ea4e4778' and id in (select md5('demo-guardian:' || id || ':' || side)::uuid from kg_children, unnest(array['father','mother']) side);
