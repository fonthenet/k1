-- Guard against an accidental second scan.
--
-- kg_checkin_by_tag infers direction from today's row: already arrived → the
-- next scan is treated as a DEPARTURE. So a parent scanning twice at the door,
-- or a phone held up a moment too long, silently marked the child as collected
-- and gone. Nobody would notice until the roster said a child had left the
-- premises.
--
-- Rather than guess, the RPC now refuses to toggle and reports what it already
-- knows, so the surface can ask a human. Pass p_force := true to go ahead —
-- that is what the "record departure instead" confirmation sends.

create or replace function kg_checkin_by_tag(
  p_tenant uuid, p_tag text, p_direction text default 'in',
  p_method kg_checkin_method default 'tag', p_picked_up_by text default null,
  p_guardian uuid default null, p_force boolean default false
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_child kg_children; v_att kg_attendance; v_guardian kg_guardians;
  v_existing kg_attendance; v_reason text;
begin
  if not kg_is_educator(p_tenant) then raise exception 'forbidden'; end if;
  select * into v_child from kg_children
   where tenant_id = p_tenant and tag_code = upper(trim(p_tag)) and status = 'enrolled';
  if v_child.id is null then raise exception 'unknown_tag'; end if;

  select * into v_existing from kg_attendance
   where child_id = v_child.id and date = current_date;

  -- ── Duplicate detection ──────────────────────────────────────────────
  if not p_force and v_existing.id is not null then
    if p_direction = 'in' and v_existing.check_in_at is not null
       and v_existing.check_out_at is null then
      v_reason := 'already_in';
    elsif p_direction = 'out' and v_existing.check_out_at is not null then
      v_reason := 'already_out';
    elsif p_direction = 'out' and v_existing.check_in_at is not null
       and v_existing.check_out_at is null
       and now() - v_existing.check_in_at < interval '2 minutes' then
      -- Arrived seconds ago; a departure now is almost certainly a double scan.
      v_reason := 'just_arrived';
    end if;

    if v_reason is not null then
      return jsonb_build_object(
        'duplicate', true, 'reason', v_reason,
        'child_id', v_child.id, 'first_name', v_child.first_name,
        'last_name', v_child.last_name, 'photo_path', v_child.photo_path,
        'check_in_at', v_existing.check_in_at,
        'check_out_at', v_existing.check_out_at,
        'direction', p_direction
      );
    end if;
  end if;

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

  return jsonb_build_object('duplicate', false, 'child_id', v_child.id,
    'first_name', v_child.first_name, 'last_name', v_child.last_name,
    'photo_path', v_child.photo_path, 'direction', p_direction,
    'at', case when p_direction = 'in' then v_att.check_in_at else v_att.check_out_at end,
    'guardian_name', nullif(trim(coalesce(v_guardian.first_name,'') || ' ' || coalesce(v_guardian.last_name,'')), ''));
end $$;

-- ── Retire the older shapes ──────────────────────────────────────────────
--
-- `create or replace function` only replaces an EXACT signature match, so the
-- 5-arg (0004) and 6-arg (0019) versions were still sitting in the catalogue
-- alongside the 7-arg one above. Two things go wrong if they stay:
--
--   1. Ambiguity. Every parameter has a default, so a call naming only the
--      first five or six arguments matches all three candidates and Postgres
--      aborts with 42725 "function kg_checkin_by_tag is not unique".
--   2. The guard is bypassable. The 6-arg body has no duplicate detection at
--      all — reaching it would silently toggle a second scan into a departure,
--      which is the exact bug this migration exists to stop.
--
-- Drop them so the 7-arg version is the only way in.
drop function if exists kg_checkin_by_tag(uuid, text, text, kg_checkin_method, text);
drop function if exists kg_checkin_by_tag(uuid, text, text, kg_checkin_method, text, uuid);

-- 0006 revoked anon EXECUTE, but it named the 5-arg signature — a grant does
-- not carry across to a new overload, and a freshly created function is
-- EXECUTE-to-PUBLIC by default. Re-apply the hardening to the surviving shape.
-- (`kg_is_educator` already rejects anon inside the body; this is the
-- defense-in-depth layer 0006 established, restored.)
revoke execute on function
  kg_checkin_by_tag(uuid, text, text, kg_checkin_method, text, uuid, boolean) from anon;
grant execute on function
  kg_checkin_by_tag(uuid, text, text, kg_checkin_method, text, uuid, boolean) to authenticated;
