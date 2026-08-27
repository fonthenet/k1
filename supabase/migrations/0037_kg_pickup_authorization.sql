-- 0037 — The pickup list is enforced at the door, not just printed on it.
--
-- Three defects, all found by auditing the kiosk flow end to end:
--
-- 1. can_pickup was decorative. The printed guardian badge filters children by
--    can_pickup = true (badge page), but neither the kiosk query nor
--    kg_checkin_by_tag ever read the flag — an adult explicitly flagged as not
--    allowed to collect a child could still check them OUT, and their name was
--    written into picked_up_by as the person who took them. can_pickup=false
--    is the flag a crèche sets for a custody restriction; the door is the one
--    place it must hold. Drop-off stays allowed (any linked adult may bring a
--    child in); departure is refused, and p_force does NOT bypass it — force
--    answers duplicate-scan questions, never authorization.
--
-- 2. Re-entry was silently swallowed. A child checked out (doctor, lunch at
--    home) and scanned back in matched no duplicate-guard case: the function
--    "succeeded", coalesce kept the morning check_in, the checkout stayed, and
--    the kiosk showed a success card while the register still said departed.
--    Now direction='in' on a completed row returns {duplicate, reason:
--    'returned'}; forcing it re-opens the day by clearing the departure —
--    which the confirmation copy states out loud.
--
-- 3. A child-tag scan at departure erased attribution. checked_out_guardian_id
--    was overwritten unconditionally on 'out' — including to NULL when no
--    guardian was identified — so a stray child-badge scan after a proper
--    guardian pickup wiped WHO took the child. Attribution now only ever
--    strengthens: a verified guardian can replace NULL, nothing replaces a
--    verified guardian with NULL.
--
-- Also: p_direction is validated ('in'/'out' only — anything else used to be
-- treated as a departure), and child tag codes may no longer be hand-set into
-- the guardian namespace ('G-…') or to bare digits, both of which would shadow
-- guardian tags / PINs at the kiosk's single input.

create or replace function kg_checkin_by_tag(
  p_tenant uuid,
  p_tag text,
  p_direction text default 'in',
  p_method kg_checkin_method default 'tag',
  p_picked_up_by text default null,
  p_guardian uuid default null,
  p_force boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_child kg_children; v_att kg_attendance; v_guardian kg_guardians;
  v_can_pickup boolean; v_existing kg_attendance; v_reason text;
begin
  if not kg_is_educator(p_tenant) then raise exception 'forbidden'; end if;
  if p_direction not in ('in', 'out') then raise exception 'invalid_direction'; end if;

  select * into v_child from kg_children
   where tenant_id = p_tenant and tag_code = upper(trim(p_tag)) and status = 'enrolled';
  if v_child.id is null then raise exception 'unknown_tag'; end if;

  -- Resolve the guardian BEFORE anything is written: the authorization gate
  -- needs the link row, not just the identity.
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

  -- Custody gate. Refused means refused: no write, and no p_force override.
  -- The kiosk blocks the tile too; this is the layer a direct API call meets.
  if p_direction = 'out' and v_guardian.id is not null and v_can_pickup is not true then
    return jsonb_build_object(
      'refused', true, 'reason', 'pickup_not_allowed',
      'child_id', v_child.id, 'first_name', v_child.first_name,
      'last_name', v_child.last_name, 'photo_path', v_child.photo_path,
      'guardian_name', nullif(trim(coalesce(v_guardian.first_name,'') || ' ' || coalesce(v_guardian.last_name,'')), ''),
      'direction', p_direction
    );
  end if;

  select * into v_existing from kg_attendance
   where child_id = v_child.id and date = current_date;

  if not p_force and v_existing.id is not null then
    if p_direction = 'in' and v_existing.check_in_at is not null
       and v_existing.check_out_at is null then
      v_reason := 'already_in';
    elsif p_direction = 'in' and v_existing.check_out_at is not null then
      -- Checked out earlier today, now at the door again.
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
        'direction', p_direction
      );
    end if;
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
      -- A forced 'in' on a completed row is a RETURN: the earlier departure is
      -- cleared so the child reads as present again. The kiosk's confirm copy
      -- says exactly this before the staff member taps it.
      check_out_at = case when p_direction = 'out' then now()
                          when p_force then null
                          else kg_attendance.check_out_at end,
      check_out_method = case when p_direction = 'out' then p_method
                              when p_force then null
                              else kg_attendance.check_out_method end,
      checked_out_by = case when p_direction = 'out' then auth.uid()
                            when p_force then null
                            else kg_attendance.checked_out_by end,
      -- Attribution only ever strengthens: a verified guardian may fill a NULL,
      -- a NULL never erases a verified guardian.
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
end $$;

revoke execute on function kg_checkin_by_tag(uuid, text, text, kg_checkin_method, text, uuid, boolean) from anon;
grant execute on function kg_checkin_by_tag(uuid, text, text, kg_checkin_method, text, uuid, boolean) to authenticated;

-- ── Child tag namespace guard ────────────────────────────────────────────
-- The kiosk has ONE input for child tags, guardian tags and guardian PINs,
-- and it queries children first. A child hand-tagged 'G-…' would shadow a
-- guardian's badge; one tagged with bare digits would shadow a PIN. Reject
-- both, on insert AND update (the edit dialog updates tag_code directly and
-- previously bypassed this trigger entirely).
create or replace function kg_assign_child_tag() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_tag text; v_try int := 0;
begin
  if new.tag_code is not null and new.tag_code <> '' then
    new.tag_code := upper(trim(new.tag_code));
    if new.tag_code ~ '^G-' or new.tag_code ~ '^[0-9]+$' then
      raise exception 'tag_reserved';
    end if;
    return new;
  end if;

  loop
    v_try := v_try + 1;
    v_tag := kg_next_child_tag(new.tenant_id);
    exit when not exists (
      select 1 from kg_children
       where tenant_id = new.tenant_id and tag_code = v_tag
    );
    if v_try >= 5 then
      v_tag := 'K-' || upper(encode(extensions.gen_random_bytes(4), 'hex'));
      exit;
    end if;
  end loop;

  new.tag_code := v_tag;
  return new;
end $$;

drop trigger if exists trg_kg_children_auto_tag on kg_children;
create trigger trg_kg_children_auto_tag
  before insert or update of tag_code on kg_children
  for each row execute function kg_assign_child_tag();
