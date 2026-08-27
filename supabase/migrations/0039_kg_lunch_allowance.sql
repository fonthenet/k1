-- 0039 — Paid lunch allowance, and only the excess is unpaid.
--
-- 0038 deducted every break minute from everyone, which is wrong for salaried
-- staff: a lunch break is part of their day, not time they owe back. The rule
-- the crèche actually runs on:
--
--   * monthly staff — lunch is included and paid, up to an allowance. Only the
--     time BEYOND the allowance comes off.
--   * hourly staff  — paid for time on the clock, so every break minute is
--     unpaid. There is no allowance to give: an hour not worked is an hour not
--     billed to the crèche either.
--
-- The allowance is per-crèche because it is a house rule, not a law.

alter table kg_tenants
  add column if not exists lunch_allowance_minutes int not null default 60;

comment on column kg_tenants.lunch_allowance_minutes is
  'Paid lunch minutes for monthly staff. Break time beyond this is unpaid. Ignored for hourly staff, who are paid strictly for time on the clock.';

-- One definition of "unpaid", so the kiosk, the payslip, the staff page and
-- the reports cannot each round the same break differently.
create or replace function kg_unpaid_break_minutes(
  p_pay_type kg_pay_type, p_break_minutes numeric, p_allowance int
) returns numeric language sql immutable set search_path = public as $$
  select case
    when p_pay_type = 'hourly' then coalesce(p_break_minutes, 0)
    else greatest(coalesce(p_break_minutes, 0) - coalesce(p_allowance, 0), 0)
  end
$$;
grant execute on function kg_unpaid_break_minutes(kg_pay_type, numeric, int) to authenticated;

create or replace function kg_hours_worked(p_membership uuid, p_month date)
returns numeric language sql stable security definer set search_path = public as $$
  select round(coalesce(sum(
    greatest(
      extract(epoch from (ts.clock_out_at - ts.clock_in_at)) / 3600.0
        - kg_unpaid_break_minutes(m.pay_type, ts.break_minutes, t.lunch_allowance_minutes) / 60.0,
      0
    )
  ), 0), 2)
  from kg_timesheets ts
  join kg_memberships m on m.id = ts.membership_id
  join kg_tenants t on t.id = ts.tenant_id
  where ts.membership_id = p_membership
    and ts.clock_in_at is not null and ts.clock_out_at is not null
    and date_trunc('month', ts.date) = date_trunc('month', p_month)
$$;
grant execute on function kg_hours_worked(uuid, date) to authenticated;

-- The kiosk has to state the policy that applies to the person standing there,
-- so it needs their pay type and the house allowance alongside their state.
create or replace function kg_staff_clock_state(p_tenant uuid, p_code text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_m kg_memberships; v_ts kg_timesheets; v_name text; v_allow int;
begin
  if not kg_is_educator(p_tenant) then raise exception 'forbidden'; end if;
  select * into v_m from kg_memberships
    where tenant_id = p_tenant and status = 'active' and (staff_code = p_code or pin_code = p_code)
      and role in ('owner','admin','educator','staff','accountant');
  if v_m.id is null then raise exception 'unknown_code'; end if;
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

-- Same treatment on the way out, so the confirmation can name what was
-- actually deducted rather than the raw break total.
create or replace function kg_staff_clock_by_code(p_tenant uuid, p_code text, p_direction text default 'in')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_m kg_memberships; v_name text; v_allow int; v_res jsonb;
begin
  if not kg_is_educator(p_tenant) then raise exception 'forbidden'; end if;
  select * into v_m from kg_memberships
    where tenant_id = p_tenant and status = 'active' and (staff_code = p_code or pin_code = p_code)
      and role in ('owner','admin','educator','staff','accountant');
  if v_m.id is null then raise exception 'unknown_code'; end if;
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
