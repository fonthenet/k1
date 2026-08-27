-- Who actually dropped off / collected the child.
--
-- Until now attendance answered this badly: checked_in_by is the STAFF account
-- operating the kiosk, and picked_up_by is free text somebody may or may not
-- have typed. A tag identifies the CHILD, not the adult holding it, so a
-- family could never be told more than "recorded at 09:07".
--
-- The kiosk already resolves the guardian when a PIN or guardian tag is entered
-- and then discards that identity. Record it instead: it is the honest answer
-- to "who brought them", and it turns the décret 19-253 pickup register into a
-- real reference rather than a typed name.

alter table kg_attendance
  add column if not exists checked_in_guardian_id uuid references kg_guardians(id) on delete set null,
  add column if not exists checked_out_guardian_id uuid references kg_guardians(id) on delete set null;

-- Parents may read these columns already (policy att_sel covers the row).

create or replace function kg_checkin_by_tag(
  p_tenant uuid, p_tag text, p_direction text default 'in',
  p_method kg_checkin_method default 'tag', p_picked_up_by text default null,
  p_guardian uuid default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_child kg_children; v_att kg_attendance; v_guardian kg_guardians;
begin
  if not kg_is_educator(p_tenant) then raise exception 'forbidden'; end if;
  select * into v_child from kg_children where tenant_id = p_tenant and tag_code = p_tag and status = 'enrolled';
  if v_child.id is null then raise exception 'unknown_tag'; end if;

  -- A guardian id is only trusted when that guardian really is linked to this
  -- child; a kiosk is a shared device and must not be able to assert otherwise.
  if p_guardian is not null then
    select g.* into v_guardian from kg_guardians g
      join kg_child_guardians cg on cg.guardian_id = g.id
     where g.id = p_guardian and g.tenant_id = p_tenant and cg.child_id = v_child.id;
  end if;

  insert into kg_attendance (tenant_id, child_id, date, status, check_in_at, check_in_method, checked_in_by, checked_in_guardian_id)
    values (p_tenant, v_child.id, current_date, 'present',
      case when p_direction = 'in' then now() end, case when p_direction = 'in' then p_method end,
      case when p_direction = 'in' then auth.uid() end,
      case when p_direction = 'in' then v_guardian.id end)
    on conflict (child_id, date) do update set
      status = 'present',
      check_in_at = coalesce(kg_attendance.check_in_at, excluded.check_in_at),
      check_in_method = coalesce(kg_attendance.check_in_method, excluded.check_in_method),
      checked_in_by = coalesce(kg_attendance.checked_in_by, excluded.checked_in_by),
      checked_in_guardian_id = coalesce(kg_attendance.checked_in_guardian_id, excluded.checked_in_guardian_id),
      check_out_at = case when p_direction = 'out' then now() else kg_attendance.check_out_at end,
      check_out_method = case when p_direction = 'out' then p_method else kg_attendance.check_out_method end,
      checked_out_by = case when p_direction = 'out' then auth.uid() else kg_attendance.checked_out_by end,
      checked_out_guardian_id = case when p_direction = 'out' then v_guardian.id else kg_attendance.checked_out_guardian_id end,
      picked_up_by = case
        when p_direction = 'out'
          then coalesce(
                 nullif(trim(coalesce(v_guardian.first_name,'') || ' ' || coalesce(v_guardian.last_name,'')), ''),
                 p_picked_up_by, kg_attendance.picked_up_by)
        else kg_attendance.picked_up_by end
    returning * into v_att;

  return jsonb_build_object('child_id', v_child.id,
    'first_name', v_child.first_name, 'last_name', v_child.last_name, 'photo_path', v_child.photo_path,
    'direction', p_direction, 'at', case when p_direction = 'in' then v_att.check_in_at else v_att.check_out_at end,
    'guardian_name', nullif(trim(coalesce(v_guardian.first_name,'') || ' ' || coalesce(v_guardian.last_name,'')), ''));
end $$;
