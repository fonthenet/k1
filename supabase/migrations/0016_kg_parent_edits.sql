-- Parents may maintain their own child's safety data. Nothing changes silently.
--
-- Policy decision (owner, 2026-08-27): a parent's edit applies IMMEDIATELY —
-- a newly diagnosed allergy must protect the child tonight, not after an
-- approval queue clears tomorrow. The safety net is visibility, not friction:
-- every parent-made change notifies staff and writes an audit row.
--
-- Note who may edit what is unchanged; it was already correct in 0003. Parents
-- can write kg_child_health, kg_child_allergies, kg_authorized_pickups,
-- kg_consents and their own kg_guardians row, and are blocked from
-- kg_children entirely — name and date of birth come from the birth
-- certificate and feed the décret 19-253 registers.

-- True when the current user is a parent (and not staff) in this tenant.
create or replace function kg_actor_is_parent(p_tenant uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null
     and not exists (
       select 1 from kg_memberships m
       where m.tenant_id = p_tenant and m.user_id = auth.uid()
         and m.status = 'active' and m.role <> 'parent'
     )
$$;

create or replace function kg_notify_parent_edit(
  p_tenant uuid, p_child uuid, p_field text, p_detail text
) returns void language plpgsql security definer set search_path = public as $$
declare v_recipients uuid[]; v_child kg_children;
begin
  if not kg_actor_is_parent(p_tenant) then return; end if;

  select * into v_child from kg_children where id = p_child;
  select array_agg(u) into v_recipients
    from kg_staff_user_ids(p_tenant, array['owner','admin','educator']::kg_role[]) u;

  perform kg_notify(p_tenant, v_recipients, 'parent_update',
    coalesce(v_child.first_name || ' ' || v_child.last_name, ''),
    p_detail,
    jsonb_build_object('childId', p_child,
      'childName', coalesce(v_child.first_name || ' ' || v_child.last_name, ''),
      'field', p_field, 'audience', 'staff'),
    auth.uid());

  insert into kg_audit_log (tenant_id, user_id, action, entity, entity_id, data)
  values (p_tenant, auth.uid(), 'parent_update', p_field, p_child::text,
          jsonb_build_object('detail', p_detail));
end $$;
revoke execute on function kg_notify_parent_edit(uuid, uuid, text, text) from anon, authenticated;

-- Allergies — the highest-stakes field a parent can touch.
create or replace function kg_on_allergy_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record; v_detail text;
begin
  r := case when tg_op = 'DELETE' then old else new end;
  v_detail := case tg_op
    when 'INSERT' then 'added: '   || coalesce(r.allergen, '')
    when 'UPDATE' then 'updated: ' || coalesce(r.allergen, '')
    else 'removed: ' || coalesce(r.allergen, '')
  end;
  perform kg_notify_parent_edit(r.tenant_id, r.child_id, 'allergies', v_detail);
  return r;
end $$;
drop trigger if exists trg_kg_allergy_parent_edit on kg_child_allergies;
create trigger trg_kg_allergy_parent_edit
  after insert or update or delete on kg_child_allergies
  for each row execute function kg_on_allergy_change();

-- Health record (conditions, medications, doctor, dietary needs).
create or replace function kg_on_health_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_tenant uuid;
begin
  select tenant_id into v_tenant from kg_children where id = new.child_id;
  if v_tenant is null then return new; end if;
  perform kg_notify_parent_edit(v_tenant, new.child_id, 'health', null);
  return new;
end $$;
drop trigger if exists trg_kg_health_parent_edit on kg_child_health;
create trigger trg_kg_health_parent_edit
  after insert or update on kg_child_health
  for each row execute function kg_on_health_change();

-- Authorized pickup list — who may collect the child.
create or replace function kg_on_pickup_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record; v_detail text;
begin
  r := case when tg_op = 'DELETE' then old else new end;
  v_detail := case tg_op
    when 'INSERT' then 'added: '   || coalesce(r.name, '')
    when 'UPDATE' then 'updated: ' || coalesce(r.name, '')
    else 'removed: ' || coalesce(r.name, '')
  end;
  perform kg_notify_parent_edit(r.tenant_id, r.child_id, 'pickup', v_detail);
  return r;
end $$;
drop trigger if exists trg_kg_pickup_parent_edit on kg_authorized_pickups;
create trigger trg_kg_pickup_parent_edit
  after insert or update or delete on kg_authorized_pickups
  for each row execute function kg_on_pickup_change();
