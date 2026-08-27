-- 0041 — The staff clock reads the same credential table as the door.
--
-- kg_staff_clock_* matched staff_code or pin_code straight off kg_memberships,
-- so a proximity card issued to a staff member in 0040 would scan at the
-- children pad and do nothing at the staff pad. Both now resolve through
-- kg_credentials, which means one lookup, one namespace, and a card that works
-- the moment it is enrolled.

create or replace function kg_membership_for_code(p_tenant uuid, p_code text)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare v_id uuid; v_value text := kg_normalize_credential(p_code);
begin
  if v_value is null then return null; end if;

  -- The join re-checks the membership: a credential outliving a disabled
  -- account must not clock anybody in.
  select c.subject_id into v_id
    from kg_credentials c
    join kg_memberships m on m.id = c.subject_id
   where c.tenant_id = p_tenant and c.value = v_value and c.active
     and c.subject_type = 'staff'
     and m.tenant_id = p_tenant and m.status = 'active'
     and m.role in ('owner','admin','educator','staff','accountant');
  return v_id;
end $$;

create or replace function kg_staff_clock_state(p_tenant uuid, p_code text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_m kg_memberships; v_ts kg_timesheets; v_name text; v_allow int; v_id uuid;
begin
  if not kg_is_educator(p_tenant) then raise exception 'forbidden'; end if;
  v_id := kg_membership_for_code(p_tenant, p_code);
  if v_id is null then raise exception 'unknown_code'; end if;
  select * into v_m from kg_memberships where id = v_id;
  select full_name into v_name from kg_profiles where id = v_m.user_id;
  select lunch_allowance_minutes into v_allow from kg_tenants where id = p_tenant;

  select * into v_ts from kg_timesheets
   where membership_id = v_m.id and date = current_date and clock_out_at is null
   order by clock_in_at desc limit 1;

  return jsonb_build_object(
    'staff_name', v_name,
    'pay_type', v_m.pay_type,
    'lunch_allowance_minutes', v_allow,
    'state', case
      when v_ts.id is null then 'off'
      when v_ts.break_start_at is not null then 'on_break'
      else 'on_clock' end,
    'clock_in_at', v_ts.clock_in_at,
    'break_start_at', v_ts.break_start_at,
    'break_minutes', coalesce(v_ts.break_minutes, 0),
    'unpaid_break_minutes',
      kg_unpaid_break_minutes(v_m.pay_type, coalesce(v_ts.break_minutes, 0), v_allow)
  );
end $$;
grant execute on function kg_staff_clock_state(uuid, text) to authenticated;

create or replace function kg_staff_clock_by_code(p_tenant uuid, p_code text, p_direction text default 'in')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_m kg_memberships; v_name text; v_allow int; v_res jsonb; v_id uuid;
begin
  if not kg_is_educator(p_tenant) then raise exception 'forbidden'; end if;
  v_id := kg_membership_for_code(p_tenant, p_code);
  if v_id is null then raise exception 'unknown_code'; end if;
  select * into v_m from kg_memberships where id = v_id;
  select full_name into v_name from kg_profiles where id = v_m.user_id;
  select lunch_allowance_minutes into v_allow from kg_tenants where id = p_tenant;

  v_res := kg_apply_staff_clock(p_tenant, v_m.id, p_direction, 'kiosk');
  return v_res || jsonb_build_object(
    'staff_name', v_name,
    'pay_type', v_m.pay_type,
    'lunch_allowance_minutes', v_allow,
    'unpaid_break_minutes', kg_unpaid_break_minutes(
      v_m.pay_type, coalesce((v_res->>'break_minutes')::numeric, 0), v_allow)
  );
end $$;
