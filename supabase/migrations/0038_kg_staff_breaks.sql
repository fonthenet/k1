-- 0038 — Lunch breaks on the staff clock, and out of the paid hours.
--
-- Staff clocked in and out once a day, so a two-hour unpaid lunch was paid
-- time. That was harmless while everyone was on a fixed monthly salary; it
-- stopped being harmless the moment hourly contracts landed (0030/0034), where
-- kg_expected_pay multiplies a rate by exactly these hours.
--
-- Shape: an accumulator plus one open-break marker, rather than a break_out /
-- break_in pair. A person may step out twice in a day — the pair silently
-- overwrites the first break, the accumulator adds it up.

alter table kg_timesheets
  add column if not exists break_start_at timestamptz,
  add column if not exists break_minutes numeric(6,2) not null default 0;

comment on column kg_timesheets.break_start_at is
  'Set while a break is running, cleared when it ends. Non-null = person is out on break right now.';
comment on column kg_timesheets.break_minutes is
  'Completed unpaid break time for this shift, accumulated across every break taken.';

-- Paid hours = time on the clock minus completed breaks, never below zero.
create or replace function kg_hours_worked(p_membership uuid, p_month date)
returns numeric language sql stable security definer set search_path = public as $$
  select round(coalesce(sum(
    greatest(
      extract(epoch from (clock_out_at - clock_in_at)) / 3600.0
        - coalesce(break_minutes, 0) / 60.0,
      0
    )
  ), 0), 2)
  from kg_timesheets
  where membership_id = p_membership
    and clock_in_at is not null and clock_out_at is not null
    and date_trunc('month', date) = date_trunc('month', p_month)
$$;
grant execute on function kg_hours_worked(uuid, date) to authenticated;

-- Shared state machine for both clock entry points. Returns the timesheet row
-- plus `action`, so the kiosk can name what just happened instead of guessing
-- from the columns.
create or replace function kg_apply_staff_clock(
  p_tenant uuid, p_membership uuid, p_direction text, p_method kg_checkin_method
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_ts kg_timesheets;
begin
  if p_direction not in ('in', 'out', 'break_start', 'break_end') then
    raise exception 'invalid_direction';
  end if;

  -- The shift this action applies to: today's still-open one.
  select * into v_ts from kg_timesheets
   where membership_id = p_membership and date = current_date and clock_out_at is null
   order by clock_in_at desc limit 1;

  if p_direction = 'in' then
    if v_ts.id is not null then raise exception 'already_clocked_in'; end if;
    insert into kg_timesheets (tenant_id, membership_id, date, clock_in_at, method)
      values (p_tenant, p_membership, current_date, now(), p_method)
      returning * into v_ts;
    return to_jsonb(v_ts) || jsonb_build_object('action', 'in');
  end if;

  if v_ts.id is null then raise exception 'not_clocked_in'; end if;

  if p_direction = 'break_start' then
    if v_ts.break_start_at is not null then raise exception 'already_on_break'; end if;
    update kg_timesheets set break_start_at = now()
     where id = v_ts.id returning * into v_ts;
    return to_jsonb(v_ts) || jsonb_build_object('action', 'break_start');
  end if;

  if p_direction = 'break_end' then
    if v_ts.break_start_at is null then raise exception 'not_on_break'; end if;
    update kg_timesheets
       set break_minutes = break_minutes
             + extract(epoch from (now() - break_start_at)) / 60.0,
           break_start_at = null
     where id = v_ts.id returning * into v_ts;
    return to_jsonb(v_ts) || jsonb_build_object('action', 'break_end');
  end if;

  -- 'out'. Someone who walks out without ending their break is not an error
  -- case: close the break at the same instant, so the shift cannot be left
  -- with an open break that never stops accruing.
  update kg_timesheets
     set clock_out_at = now(),
         break_minutes = break_minutes + case
           when break_start_at is not null
             then extract(epoch from (now() - break_start_at)) / 60.0
           else 0 end,
         break_start_at = null
   where id = v_ts.id returning * into v_ts;
  return to_jsonb(v_ts) || jsonb_build_object('action', 'out');
end $$;
revoke execute on function kg_apply_staff_clock(uuid, uuid, text, kg_checkin_method) from anon, authenticated;

create or replace function kg_staff_clock_by_code(p_tenant uuid, p_code text, p_direction text default 'in')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_m kg_memberships; v_name text;
begin
  if not kg_is_educator(p_tenant) then raise exception 'forbidden'; end if;
  select * into v_m from kg_memberships
    where tenant_id = p_tenant and status = 'active' and (staff_code = p_code or pin_code = p_code)
      and role in ('owner','admin','educator','staff','accountant');
  if v_m.id is null then raise exception 'unknown_code'; end if;
  select full_name into v_name from kg_profiles where id = v_m.user_id;

  return kg_apply_staff_clock(p_tenant, v_m.id, p_direction, 'kiosk')
         || jsonb_build_object('staff_name', v_name);
end $$;

create or replace function kg_staff_clock(p_tenant uuid, p_direction text default 'in', p_method kg_checkin_method default 'manual')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_m kg_memberships;
begin
  select * into v_m from kg_memberships
    where tenant_id = p_tenant and user_id = auth.uid() and status = 'active'
      and role in ('owner','admin','educator','staff','accountant');
  if v_m.id is null then raise exception 'forbidden'; end if;
  return kg_apply_staff_clock(p_tenant, v_m.id, p_direction, p_method);
end $$;

-- What the kiosk needs before it can offer the right buttons: is this person
-- off, on the clock, or out on a break right now.
create or replace function kg_staff_clock_state(p_tenant uuid, p_code text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_m kg_memberships; v_ts kg_timesheets; v_name text;
begin
  if not kg_is_educator(p_tenant) then raise exception 'forbidden'; end if;
  select * into v_m from kg_memberships
    where tenant_id = p_tenant and status = 'active' and (staff_code = p_code or pin_code = p_code)
      and role in ('owner','admin','educator','staff','accountant');
  if v_m.id is null then raise exception 'unknown_code'; end if;
  select full_name into v_name from kg_profiles where id = v_m.user_id;

  select * into v_ts from kg_timesheets
   where membership_id = v_m.id and date = current_date and clock_out_at is null
   order by clock_in_at desc limit 1;

  return jsonb_build_object(
    'staff_name', v_name,
    'state', case
      when v_ts.id is null then 'off'
      when v_ts.break_start_at is not null then 'on_break'
      else 'on_clock' end,
    'clock_in_at', v_ts.clock_in_at,
    'break_start_at', v_ts.break_start_at,
    'break_minutes', coalesce(v_ts.break_minutes, 0)
  );
end $$;
grant execute on function kg_staff_clock_state(uuid, text) to authenticated;
