-- The door respects the opening hours.
--
-- Hours were stored but policed nowhere: a tag scanned at 19:00, or on a day
-- the crèche is shut, was recorded as a normal arrival.
--
-- Two deliberate exemptions, both about not making the register lie:
--
--   * DEPARTURES are never blocked. A child collected late is still leaving,
--     and refusing to record it would leave them marked present in the building
--     overnight — the register would say a child is here who went home hours
--     ago. A late timestamp is a smaller wrong than a false presence.
--   * p_force still goes through, so staff keep an override for the real
--     exception. The attendance register is a legal record of who is in the
--     building; a rule that stops staff recording a child who is physically
--     there would be worse than the problem it solves.
--
-- The staff register (setAttendanceStatus / setAttendanceTimes) is likewise
-- unpoliced on purpose: there a human is deliberately recording something they
-- can see. This guards the unattended door, which is where a wrong scan goes
-- unnoticed.
create or replace function kg_checkin_window_ok(p_now time, p_open time, p_close time)
returns boolean language sql immutable set search_path = public as $fn$
  -- Minutes since midnight, deliberately NOT `time` arithmetic: `00:00 - 30
  -- minutes` wraps to 23:30 on a time value, so a crèche opening at midnight
  -- refused every arrival of the day. Integers go negative instead, which is
  -- what "half an hour before we open" actually means.
  --
  -- The grace is asymmetric on purpose. Families arrive a few minutes early;
  -- they collect considerably late.
  select (extract(hour from p_now)::int * 60 + extract(minute from p_now)::int)
         between (extract(hour from p_open)::int * 60 + extract(minute from p_open)::int) - 30
             and (extract(hour from p_close)::int * 60 + extract(minute from p_close)::int) + 60;
$fn$;
grant execute on function kg_checkin_window_ok(time, time, time) to authenticated;

create or replace function kg_checkin_by_tag(p_tenant uuid, p_tag text, p_direction text default 'in',
  p_method kg_checkin_method default 'tag', p_picked_up_by text default null,
  p_guardian uuid default null, p_force boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  v_child kg_children; v_att kg_attendance; v_guardian kg_guardians;
  v_can_pickup boolean; v_existing kg_attendance; v_reason text;
  v_today date := kg_today(); v_now time := (now() at time zone 'Africa/Algiers')::time;
  v_hours jsonb; v_open time; v_close time;
begin
  if not kg_is_educator(p_tenant) then raise exception 'forbidden'; end if;
  if p_direction not in ('in', 'out') then raise exception 'invalid_direction'; end if;

  select * into v_child from kg_children
   where tenant_id = p_tenant and tag_code = upper(trim(p_tag)) and status = 'enrolled';
  if v_child.id is null then raise exception 'unknown_tag'; end if;

  -- Arrivals only, and never when staff have deliberately forced it.
  if p_direction = 'in' and not p_force then
    select t.opening_hours -> lower(to_char(v_today, 'Dy')) into v_hours
      from kg_tenants t where t.id = p_tenant;

    if v_hours is null or v_hours = 'null'::jsonb then
      return jsonb_build_object('refused', true, 'reason', 'closed_day',
        'child_id', v_child.id, 'first_name', v_child.first_name,
        'last_name', v_child.last_name, 'photo_path', v_child.photo_path,
        'direction', p_direction);
    end if;

    v_open  := (v_hours->>'open')::time;
    v_close := (v_hours->>'close')::time;
    if not kg_checkin_window_ok(v_now, v_open, v_close) then
      return jsonb_build_object('refused', true, 'reason', 'outside_hours',
        'child_id', v_child.id, 'first_name', v_child.first_name,
        'last_name', v_child.last_name, 'photo_path', v_child.photo_path,
        'opens_at', to_char(v_open, 'HH24:MI'), 'closes_at', to_char(v_close, 'HH24:MI'),
        'direction', p_direction);
    end if;
  end if;

  if p_guardian is not null then
    select g.* into v_guardian
      from kg_guardians g
      join kg_child_guardians cg on cg.guardian_id = g.id
     where g.id = p_guardian and g.tenant_id = p_tenant and cg.child_id = v_child.id;
    if v_guardian.id is not null then
      select cg.can_pickup into v_can_pickup from kg_child_guardians cg
       where cg.guardian_id = v_guardian.id and cg.child_id = v_child.id;
    end if;
  end if;

  if p_direction = 'out' and v_guardian.id is not null and v_can_pickup is not true then
    return jsonb_build_object(
      'refused', true, 'reason', 'pickup_not_allowed',
      'child_id', v_child.id, 'first_name', v_child.first_name,
      'last_name', v_child.last_name, 'photo_path', v_child.photo_path,
      'guardian_name', nullif(trim(coalesce(v_guardian.first_name,'') || ' ' || coalesce(v_guardian.last_name,'')), ''),
      'direction', p_direction);
  end if;

  select * into v_existing from kg_attendance
   where child_id = v_child.id and date = v_today;

  if not p_force and v_existing.id is not null then
    if p_direction = 'in' and v_existing.check_in_at is not null
       and v_existing.check_out_at is null then
      v_reason := 'already_in';
    elsif p_direction = 'in' and v_existing.check_out_at is not null then
      v_reason := 'returned';
    elsif p_direction = 'out' and v_existing.check_out_at is not null then
      v_reason := 'already_out';
    elsif p_direction = 'out' and v_existing.check_in_at is not null
       and v_existing.check_out_at is null
       and now() - v_existing.check_in_at < interval '2 minutes' then
      v_reason := 'just_arrived';
    end if;

    if v_reason is not null then
      return jsonb_build_object(
        'duplicate', true, 'reason', v_reason,
        'child_id', v_child.id, 'first_name', v_child.first_name,
        'last_name', v_child.last_name, 'photo_path', v_child.photo_path,
        'check_in_at', v_existing.check_in_at,
        'check_out_at', v_existing.check_out_at,
        'direction', p_direction);
    end if;
  end if;

  insert into kg_attendance (tenant_id, child_id, date, status, check_in_at, check_in_method, checked_in_by, checked_in_guardian_id)
    values (p_tenant, v_child.id, v_today, 'present',
      case when p_direction = 'in' then now() end, case when p_direction = 'in' then p_method end,
      case when p_direction = 'in' then auth.uid() end,
      case when p_direction = 'in' then v_guardian.id end)
    on conflict (child_id, date) do update set
      status = 'present',
      check_in_at = coalesce(kg_attendance.check_in_at, excluded.check_in_at),
      check_in_method = coalesce(kg_attendance.check_in_method, excluded.check_in_method),
      checked_in_by = coalesce(kg_attendance.checked_in_by, excluded.checked_in_by),
      checked_in_guardian_id = coalesce(kg_attendance.checked_in_guardian_id, excluded.checked_in_guardian_id),
      check_out_at = case when p_direction = 'out' then now()
                          when p_force then null
                          else kg_attendance.check_out_at end,
      check_out_method = case when p_direction = 'out' then p_method
                              when p_force then null
                              else kg_attendance.check_out_method end,
      checked_out_by = case when p_direction = 'out' then auth.uid()
                            when p_force then null
                            else kg_attendance.checked_out_by end,
      checked_out_guardian_id = case
        when p_direction = 'out' then coalesce(v_guardian.id, kg_attendance.checked_out_guardian_id)
        when p_force then null
        else kg_attendance.checked_out_guardian_id end,
      picked_up_by = case
        when p_direction = 'out'
          then coalesce(
                 nullif(trim(coalesce(v_guardian.first_name,'') || ' ' || coalesce(v_guardian.last_name,'')), ''),
                 p_picked_up_by, kg_attendance.picked_up_by)
        when p_force then null
        else kg_attendance.picked_up_by end
    returning * into v_att;

  return jsonb_build_object('duplicate', false, 'child_id', v_child.id,
    'first_name', v_child.first_name, 'last_name', v_child.last_name,
    'photo_path', v_child.photo_path, 'direction', p_direction,
    'at', case when p_direction = 'in' then v_att.check_in_at else v_att.check_out_at end,
    'guardian_name', nullif(trim(coalesce(v_guardian.first_name,'') || ' ' || coalesce(v_guardian.last_name,'')), ''));
end $fn$;
