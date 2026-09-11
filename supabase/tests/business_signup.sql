begin;
select set_config('request.jwt.claim.sub',(select id::text from auth.users order by created_at limit 1),true);
set local role authenticated;
do $$
declare kind public.kg_center_type; tenant uuid; slug text;
begin
  foreach kind in array enum_range(null::public.kg_center_type) loop
    slug := 'qa-signup-' || gen_random_uuid();
    tenant := public.kg_create_tenant(p_name => slug, p_slug => slug,
      p_wilaya => 'Alger', p_center_types => array[kind]);
    if not exists(select 1 from public.kg_memberships m where m.tenant_id=tenant and m.user_id=auth.uid() and m.role='owner' and m.status='active') then
      raise exception 'Owner membership missing for %', kind;
    end if;
    if (select count(*) from public.kg_structures s where s.tenant_id=tenant and s.center_type=kind and s.active) <> 1 then
      raise exception 'Structure missing for %', kind;
    end if;
    if not exists(select 1 from public.kg_tenants t where t.id=tenant and t.currency='DZD' and t.opening_hours->'fri'='null'::jsonb) then
      raise exception 'Algerian defaults missing for %', kind;
    end if;
  end loop;
  slug := 'qa-signup-' || gen_random_uuid();
  tenant := public.kg_create_tenant(p_name => slug,p_slug => slug,
    p_center_types => array['private_primary','private_middle','private_secondary']::public.kg_center_type[]);
  if (select count(*) from public.kg_structures s where s.tenant_id=tenant) <> 3 then
    raise exception 'Multi-cycle school must have three structures';
  end if;
end $$;
reset role;
rollback;
select 'PASS: all ten business types and a three-cycle private school bootstrap correctly; fixtures rolled back' as result;
