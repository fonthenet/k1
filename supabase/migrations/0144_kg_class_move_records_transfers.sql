-- 0144 — moving a CLASS to another structure is a move for every child in it.
--
-- trg_kg_classes_structure_move (0133) drags a class's children to the new
-- structure by updating their structure_id and nothing else: no transfer row
-- for the register, the old structure's own tariff still running, the old
-- structure's own activities still open, the families told nothing. Exactly
-- the gaps kg_move_child (0140) closes for one child at a time.
--
-- The consequences of a structure change now live in ONE function that both
-- paths call: kg_move_child for a single child, and the class trigger for
-- every child of a moved class. Same closures, same record, same notice.

create or replace function kg_after_structure_change(
  p_child uuid, p_from_structure uuid, p_to_structure uuid,
  p_from_class uuid, p_to_class uuid, p_effective date,
  p_reason text, p_origin text
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_tenant uuid; v_transfer uuid; v_structure kg_structures; v_class kg_classes;
begin
  select tenant_id into v_tenant from kg_children where id = p_child;
  if p_to_structure is not null then
    select * into v_structure from kg_structures where id = p_to_structure;
  end if;
  if p_to_class is not null then
    select * into v_class from kg_classes where id = p_to_class;
  end if;

  if p_from_structure is distinct from p_to_structure then
    -- The old structure's OWN tariff stops the day before; a building-wide
    -- tariff carries on, because it was never the crèche's to begin with.
    update kg_child_fees f
       set end_date = p_effective - 1
      from kg_fee_plans p
     where f.child_id = p_child and f.fee_plan_id = p.id
       and p.period = 'monthly' and p.structure_id is not null
       and p.structure_id is distinct from p_to_structure
       and (f.end_date is null or f.end_date >= p_effective)
       and f.start_date < p_effective;
    delete from kg_child_fees f
     using kg_fee_plans p
     where f.child_id = p_child and f.fee_plan_id = p.id
       and p.period = 'monthly' and p.structure_id is not null
       and p.structure_id is distinct from p_to_structure
       and f.start_date >= p_effective;
    -- Likewise the old structure's own activities.
    update kg_activity_enrollments e
       set status = 'ended', end_date = p_effective - 1
      from kg_activities a
     where e.child_id = p_child and a.id = e.activity_id
       and a.structure_id is not null and a.structure_id is distinct from p_to_structure
       and e.status in ('active', 'requested');
  end if;

  insert into kg_child_transfers (tenant_id, child_id, from_structure_id, to_structure_id,
                                  from_class_id, to_class_id, effective_date, reason,
                                  origin, moved_by)
  values (v_tenant, p_child, p_from_structure, p_to_structure,
          p_from_class, p_to_class, p_effective, nullif(btrim(p_reason), ''),
          case when p_origin = 'parent_request' then 'parent_request' else 'staff' end,
          auth.uid())
  returning id into v_transfer;

  if p_from_structure is distinct from p_to_structure then
    perform kg_notify_family(v_tenant, p_child, 'structure_changed',
      jsonb_build_object(
        'structureName', v_structure.name, 'structureNameAr', v_structure.name_ar,
        'className', v_class.name, 'classNameAr', v_class.name_ar,
        'date', p_effective),
      coalesce(v_structure.name, ''));
  end if;
  return v_transfer;
end $$;
revoke all on function kg_after_structure_change(uuid, uuid, uuid, uuid, uuid, date, text, text)
  from public, anon, authenticated;

-- kg_move_child keeps its contract; only the tail is delegated.
create or replace function kg_move_child(
  p_child uuid,
  p_structure uuid,
  p_class uuid default null,
  p_effective date default null,
  p_fee_plan uuid default null,
  p_reason text default null,
  p_origin text default 'staff'
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_child kg_children; v_class kg_classes; v_target uuid; v_effective date;
  v_transfer uuid; v_structure kg_structures; v_plan kg_fee_plans;
begin
  select * into v_child from kg_children where id = p_child;
  if v_child.id is null then raise exception 'not_found'; end if;
  if not kg_is_admin(v_child.tenant_id) then raise exception 'forbidden'; end if;
  v_effective := coalesce(p_effective, kg_today());
  if p_class is not null then
    select * into v_class from kg_classes where id = p_class and tenant_id = v_child.tenant_id;
    if v_class.id is null then raise exception 'unknown_class'; end if;
    if v_class.structure_id is not null and p_structure is not null
       and v_class.structure_id <> p_structure then
      raise exception 'class_not_in_structure';
    end if;
    v_target := coalesce(v_class.structure_id, p_structure);
  else
    v_target := p_structure;
  end if;
  if v_target is not null then
    select * into v_structure from kg_structures
     where id = v_target and tenant_id = v_child.tenant_id and active;
    if v_structure.id is null then raise exception 'unknown_structure'; end if;
  end if;
  if v_target is not distinct from v_child.structure_id
     and p_class is not distinct from v_child.class_id then
    raise exception 'no_change';
  end if;
  if p_fee_plan is not null then
    select * into v_plan from kg_fee_plans
     where id = p_fee_plan and tenant_id = v_child.tenant_id and active and period = 'monthly'
       and (structure_id is null or structure_id = v_target);
    if v_plan.id is null then raise exception 'fee_plan_not_in_structure'; end if;
  end if;

  update kg_children set class_id = p_class, structure_id = v_target where id = p_child;

  v_transfer := kg_after_structure_change(p_child, v_child.structure_id, v_target,
                                          v_child.class_id, p_class, v_effective,
                                          p_reason, p_origin);
  if p_fee_plan is not null then
    insert into kg_child_fees (tenant_id, child_id, fee_plan_id, start_date)
    values (v_child.tenant_id, p_child, p_fee_plan, v_effective);
  end if;
  return v_transfer;
end $$;

-- The class trigger: drag the children, then give each the same treatment.
create or replace function kg_move_class_structure()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if new.structure_id is distinct from old.structure_id then
    for r in select id, structure_id from kg_children where class_id = new.id loop
      update kg_children set structure_id = new.structure_id where id = r.id;
      perform kg_after_structure_change(r.id, r.structure_id, new.structure_id,
                                        new.id, new.id, kg_today(),
                                        'class moved', 'staff');
    end loop;
  end if;
  return new;
end $$;
