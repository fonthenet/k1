-- 0170 — a child can come back: the pass log, and a return is an arrival.
--
-- Real life has the doctor at ten and the return at eleven, the half-day
-- that turns into a full one, the grandmother who collects and brings back.
-- Until now a second arrival after a departure was the duplicate `returned`
-- — a decision card for the staff at the kiosk, a "talk to the team" for a
-- parent — and the register, one row per child per day with one arrival and
-- one departure, had nowhere to keep both departures anyway.
--
-- Two things change. (1) kg_attendance_passes: every recorded move, in
-- order — direction, moment, method, who, which guardian, forced or not —
-- appended by the one writer, kg_attendance_write, and backfilled from the
-- rows that exist. The day's row keeps what it always kept, the FIRST
-- arrival and the LAST departure (null while the child is in), so every
-- screen that reads check_in_at / check_out_at still reads true; the log
-- is where the morning's departure lives once the child is back. (2) An
-- 'in' after an 'out' is a RETURN: recorded by the writer like any arrival
-- (the hours apply; parents never force), the departure columns cleared,
-- `returned: true` in the answer. The only duplicate left on that path is
-- `just_left` — the mirror of just_arrived: a card read twice at the gate on
-- the way out, under two minutes, is not a child coming back. The parent's
-- 'auto' and the child's card infer 'in' for a child who has left instead of
-- answering already_out; an explicit 'out' for a child who is out is still
-- already_out. `returned` is no longer emitted; a client that still knows the
-- word is not wrong, only never asked.
--
-- Read access to the log: staff of the tenant and the child's family
-- (kg_is_parent_of), as the attendance row. No client writes it.
--
-- Rehearsed on production (qekibejzwpphzzyqigzo) on 2026-09-14 through
-- execute_sql: the first run stopped on the stage's own mistakes (a
-- departure straight after the arrival is just_arrived; the staged child's
-- moments, moved by hand, are not what the writer stamps — both fixed in
-- §5), then the whole file ended on the pass mark, verbatim
-- "ERROR:  P0001: 0170 rehearsal ok — rolled back"; afterwards no table,
-- the writer still 0169's, the demo tenant's settings, hours and the
-- child's day untouched. Applied the same day through apply_migration with
-- the pass-mark raise flipped to a notice.
begin;
set local lock_timeout = '5s';

-- ── 1. The pass log ───────────────────────────────────────────────────────
create table if not exists public.kg_attendance_passes (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.kg_tenants(id) on delete cascade,
  child_id     uuid not null references public.kg_children(id) on delete cascade,
  date         date not null,
  direction    text not null check (direction in ('in', 'out')),
  at           timestamptz not null default now(),
  method       kg_checkin_method,
  by_user      uuid,
  guardian_id  uuid references public.kg_guardians(id) on delete set null,
  picked_up_by text,
  forced       boolean not null default false,
  created_at   timestamptz not null default now()
);
create index if not exists kg_attendance_passes_tenant_date_idx on public.kg_attendance_passes (tenant_id, date);
create index if not exists kg_attendance_passes_child_day_idx on public.kg_attendance_passes (child_id, date, at);
alter table public.kg_attendance_passes enable row level security;
drop policy if exists ap_sel on public.kg_attendance_passes;
create policy ap_sel on public.kg_attendance_passes for select using (kg_is_staff(tenant_id) or kg_is_parent_of(child_id));

-- The days already on the books: their arrival and departure become the
-- first passes of the log, so a child's day reads the same before and after
-- 0170. Idempotent: a row already logged for that moment is not logged twice.
insert into public.kg_attendance_passes (tenant_id, child_id, date, direction, at, method, by_user, guardian_id, picked_up_by)
select a.tenant_id, a.child_id, a.date, 'in', a.check_in_at, a.check_in_method, a.checked_in_by, a.checked_in_guardian_id, null
  from public.kg_attendance a
 where a.check_in_at is not null
   and not exists (select 1 from public.kg_attendance_passes p where p.child_id = a.child_id and p.date = a.date and p.direction = 'in' and p.at = a.check_in_at);
insert into public.kg_attendance_passes (tenant_id, child_id, date, direction, at, method, by_user, guardian_id, picked_up_by)
select a.tenant_id, a.child_id, a.date, 'out', a.check_out_at, a.check_out_method, a.checked_out_by, a.checked_out_guardian_id, a.picked_up_by
  from public.kg_attendance a
 where a.check_out_at is not null
   and not exists (select 1 from public.kg_attendance_passes p where p.child_id = a.child_id and p.date = a.date and p.direction = 'out' and p.at = a.check_out_at);

-- ── 2. The writer: a return is an arrival, every move is logged ───────────
-- 0169's kg_attendance_write with three changes, each marked in the body:
-- the duplicate `returned` becomes `just_left` and holds for two minutes
-- only; an arrival of any kind clears the departure columns (a return
-- re-opens the day); every recorded move appends a pass. `returned` is in
-- the answer so a card can say "retour" rather than "arrivée".
create or replace function public.kg_attendance_write(
  p_tenant uuid, p_child uuid, p_direction text, p_method kg_checkin_method,
  p_picked_up_by text, p_guardian uuid, p_force boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_child kg_children; v_att kg_attendance; v_guardian kg_guardians;
  v_can_pickup boolean; v_existing kg_attendance; v_reason text;
  v_today date := kg_today(); v_now time := (now() at time zone 'Africa/Algiers')::time;
  v_hours jsonb; v_open time; v_close time; v_return boolean := false;
begin
  p_force := coalesce(p_force, false);
  if coalesce(p_direction, '') not in ('in', 'out') then raise exception 'invalid_direction'; end if;

  select * into v_child from kg_children
   where id = p_child and tenant_id = p_tenant and status = 'enrolled';
  if v_child.id is null then raise exception 'unknown_child'; end if;

  -- Arrivals only, and never when staff have deliberately forced it.
  --
  -- A departure is NEVER blocked: a child collected late is still leaving, and
  -- refusing to record it would leave them marked present in the building
  -- overnight — the register would say a child is here who went home hours ago.
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
    elsif p_direction = 'in' and v_existing.check_out_at is not null
       and now() - v_existing.check_out_at < interval '2 minutes' then
      -- The mirror of just_arrived: a card read twice at the gate on the
      -- way out is not a child coming back. Past two minutes an 'in' after
      -- an 'out' IS a return, recorded below like any arrival.
      v_reason := 'just_left';
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

  -- A return: the child left today and is arriving again. The day is
  -- re-opened — the departure columns are cleared, the FIRST arrival is
  -- kept as the day's arrival — and the departure that was there is not
  -- lost: it is already in kg_attendance_passes (0170), with every other
  -- move of the day.
  v_return := p_direction = 'in' and v_existing.check_out_at is not null;

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
      -- An arrival — first, forced, or a return — leaves no departure on the
      -- row: the child is in. (0169 cleared it only when forced; since 0170
      -- a return clears it too, and the pass log keeps the departure.)
      check_out_at = case when p_direction = 'out' then now() else null end,
      check_out_method = case when p_direction = 'out' then p_method else null end,
      checked_out_by = case when p_direction = 'out' then auth.uid() else null end,
      checked_out_guardian_id = case
        when p_direction = 'out' then coalesce(v_guardian.id, kg_attendance.checked_out_guardian_id)
        else null end,
      picked_up_by = case
        when p_direction = 'out'
          then coalesce(
                 nullif(trim(coalesce(v_guardian.first_name,'') || ' ' || coalesce(v_guardian.last_name,'')), ''),
                 p_picked_up_by, kg_attendance.picked_up_by)
        else null end
    returning * into v_att;

  -- Every recorded move, in order: the log the day's row summarises. The
  -- row keeps the first arrival and the last departure; a child who went to
  -- the doctor at ten and came back at eleven has four passes here and, on
  -- the row, an arrival at eight and no departure until they leave again.
  insert into kg_attendance_passes (tenant_id, child_id, date, direction, at, method, by_user, guardian_id, picked_up_by, forced)
  values (p_tenant, v_child.id, v_today, p_direction, now(), p_method, auth.uid(), v_guardian.id,
          case when p_direction = 'out' then v_att.picked_up_by end, p_force);

  -- A departure written by anyone — a badge at the kiosk, a child's card, a
  -- parent's pass with the confirmation off, the staff's own decision —
  -- settles the child's pending hand-over: the human who let the child go
  -- IS the decision (0169). Without this a parent who asked from their
  -- phone and then handed the badge to the educator kept waiting ten
  -- minutes to be told the team never answered, and the kiosk kept asking
  -- staff to hand over a child who had left. Expired first, as every
  -- reader does, so only a request still within its ten minutes is met.
  if p_direction = 'out' then
    perform kg_handovers_expire(p_tenant);
    update kg_handovers set status = 'confirmed', decided_by = auth.uid(), decided_at = now()
     where tenant_id = p_tenant and child_id = v_child.id and status = 'pending';
  end if;

  return jsonb_build_object('duplicate', false, 'child_id', v_child.id,
    'first_name', v_child.first_name, 'last_name', v_child.last_name,
    'photo_path', v_child.photo_path, 'direction', p_direction,
    -- The moment of THIS move: on a return the row's check_in_at is the
    -- morning's, so the pass's time is what the card shows.
    'at', case when p_direction = 'in' then now() else v_att.check_out_at end,
    'returned', v_return,
    'guardian_name', nullif(trim(coalesce(v_guardian.first_name,'') || ' ' || coalesce(v_guardian.last_name,'')), ''));
end $$;

-- ── 3. The parent's pass and the child's card infer a return ─────────────
-- kg_checkin_self on 'auto' and kg_kiosk_pair used to answer already_out for
-- a child who had left; both now infer 'in' — the writer records the return
-- — with 0170's just_left for a departure under two minutes old. Nothing
-- else in either body changes.
create or replace function public.kg_checkin_self(p_code text, p_child uuid, p_direction text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_code kg_door_codes; v_guardian uuid; v_can_pickup boolean; v_child kg_children;
  v_confirm boolean; v_existing kg_attendance; v_h kg_handovers; v_dir text := p_direction;
begin
  select * into v_code from kg_door_codes where code = upper(trim(coalesce(p_code, '')));
  if v_code.id is null then raise exception 'unknown_code'; end if;
  if v_code.expires_at < now() then raise exception 'expired_code'; end if;
  if coalesce(p_direction, '') not in ('in', 'out', 'auto') then raise exception 'invalid_direction'; end if;

  -- The caller's guardian row for this child in this tenant; when they hold
  -- several (rare), the one allowed to collect.
  select g.id, cg.can_pickup into v_guardian, v_can_pickup
    from kg_guardians g
    join kg_child_guardians cg on cg.guardian_id = g.id
   where g.tenant_id = v_code.tenant_id and g.user_id = auth.uid() and cg.child_id = p_child
   order by cg.can_pickup desc, g.created_at limit 1;
  if v_guardian is null then raise exception 'forbidden' using errcode = '42501'; end if;

  select * into v_child from kg_children
   where id = p_child and tenant_id = v_code.tenant_id and status = 'enrolled';
  if v_child.id is null then raise exception 'unknown_child'; end if;

  select * into v_existing from kg_attendance where child_id = p_child and date = kg_today();

  if v_dir = 'auto' then
    if v_existing.check_out_at is not null then
      -- Already left today: coming back is a RETURN (0170), an arrival the
      -- writer records like the morning's — unless the departure is under
      -- two minutes old, which is a card read twice on the way out.
      if now() - v_existing.check_out_at < interval '2 minutes' then
        return jsonb_build_object('duplicate', true, 'reason', 'just_left',
          'child_id', v_child.id, 'first_name', v_child.first_name,
          'last_name', v_child.last_name, 'photo_path', v_child.photo_path,
          'check_in_at', v_existing.check_in_at, 'check_out_at', v_existing.check_out_at,
          'direction', 'in');
      end if;
      return kg_attendance_write(v_code.tenant_id, p_child, 'in', 'parent', null, v_guardian, false);
    end if;
    -- The double tap is answered HERE, in the writer's own duplicate shape,
    -- and not by sending an 'in' through the writer: the writer checks the
    -- hours before the duplicates, so a stale screen tapping 'auto' a
    -- minute after an arrival recorded at the very end of the grace period
    -- would hear `outside_hours` (or `closed_day` after a forced arrival on
    -- a day with no hours) about a child who is in. The fact is what comes
    -- back, whatever the hour.
    if v_existing.check_in_at is not null and now() - v_existing.check_in_at < interval '2 minutes' then
      return jsonb_build_object('duplicate', true, 'reason', 'already_in',
        'child_id', v_child.id, 'first_name', v_child.first_name,
        'last_name', v_child.last_name, 'photo_path', v_child.photo_path,
        'check_in_at', v_existing.check_in_at, 'check_out_at', v_existing.check_out_at,
        'direction', 'in');
    end if;
    v_dir := case when v_existing.check_in_at is null then 'in' else 'out' end;
  end if;

  if v_dir = 'in' then
    return kg_attendance_write(v_code.tenant_id, p_child, 'in', 'parent', null, v_guardian, false);
  end if;

  if v_can_pickup is not true then
    return jsonb_build_object('refused', true, 'reason', 'pickup_not_allowed',
      'child_id', v_child.id, 'first_name', v_child.first_name,
      'last_name', v_child.last_name, 'photo_path', v_child.photo_path,
      'direction', 'out');
  end if;

  if v_existing.check_out_at is not null then
    return jsonb_build_object('duplicate', true, 'reason', 'already_out',
      'child_id', v_child.id, 'first_name', v_child.first_name,
      'last_name', v_child.last_name, 'photo_path', v_child.photo_path,
      'check_in_at', v_existing.check_in_at, 'check_out_at', v_existing.check_out_at,
      'direction', 'out');
  end if;
  if v_existing.check_in_at is null then
    return jsonb_build_object('refused', true, 'reason', 'not_arrived',
      'child_id', v_child.id, 'first_name', v_child.first_name,
      'last_name', v_child.last_name, 'photo_path', v_child.photo_path,
      'direction', 'out');
  end if;

  select coalesce((t.settings -> 'kiosk' ->> 'self_pickup_confirm')::boolean, true)
    into v_confirm from kg_tenants t where t.id = v_code.tenant_id;
  if not v_confirm then
    return kg_attendance_write(v_code.tenant_id, p_child, 'out', 'parent', null, v_guardian, false);
  end if;

  perform kg_handovers_expire(v_code.tenant_id);
  insert into kg_handovers (tenant_id, child_id, guardian_id, door_code_id, requested_by, expires_at, status)
  values (v_code.tenant_id, p_child, v_guardian, v_code.id, auth.uid(), now() + interval '10 minutes', 'pending')
  on conflict (child_id) where status = 'pending' do update set
    guardian_id = excluded.guardian_id, door_code_id = excluded.door_code_id,
    requested_by = excluded.requested_by, requested_at = now(), expires_at = excluded.expires_at
  returning * into v_h;

  return jsonb_build_object('pending', true, 'handover_id', v_h.id, 'expires_at', v_h.expires_at,
    'child_id', v_child.id, 'first_name', v_child.first_name,
    'last_name', v_child.last_name, 'photo_path', v_child.photo_path,
    'direction', 'out');
end $$;

create or replace function public.kg_kiosk_pair(p_tenant uuid, p_pair text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_pair text := upper(trim(coalesce(p_pair, ''))); v_cred kg_credentials; v_guardian kg_guardians;
  v_child kg_children; v_existing kg_attendance; v_dir text; v_gname text; r jsonb;
begin
  if p_tenant is null or not kg_is_educator(p_tenant) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_pair !~ '^[A-Z0-9-]{1,32}\+[A-Z0-9-]{1,32}$' then raise exception 'invalid_pair'; end if;

  select c.* into v_cred from kg_credentials c
   where c.tenant_id = p_tenant and c.value = split_part(v_pair, '+', 1) and c.active
     and c.subject_type = 'guardian' and c.kind in ('qr', 'rfid');
  if v_cred.id is null or not kg_credential_subject_live(p_tenant, 'guardian', v_cred.subject_id) then
    raise exception 'unknown_code';
  end if;
  select g.* into v_guardian from kg_guardians g where g.id = v_cred.subject_id and g.tenant_id = p_tenant;
  v_gname := nullif(trim(coalesce(v_guardian.first_name, '') || ' ' || coalesce(v_guardian.last_name, '')), '');

  select c.* into v_child from kg_children c
   where c.tenant_id = p_tenant and c.tag_code = split_part(v_pair, '+', 2) and c.status = 'enrolled';
  if v_child.id is null then raise exception 'unknown_code'; end if;

  -- The card was read whole: its history, as a badge's (a raise above would
  -- have undone this anyway).
  update kg_credentials set last_used_at = now() where id = v_cred.id;

  if not exists (select 1 from kg_child_guardians cg where cg.guardian_id = v_guardian.id and cg.child_id = v_child.id) then
    return jsonb_build_object('refused', true, 'reason', 'not_linked',
      'child_id', v_child.id, 'first_name', v_child.first_name,
      'last_name', v_child.last_name, 'photo_path', v_child.photo_path,
      'guardian_name', v_gname, 'direction', null);
  end if;

  select * into v_existing from kg_attendance where child_id = v_child.id and date = kg_today();
  if v_existing.check_out_at is not null and now() - v_existing.check_out_at < interval '2 minutes' then
    -- The card read twice on the way out (0170's just_left); past two
    -- minutes a child who left is coming back, and the writer records
    -- the return.
    r := jsonb_build_object('duplicate', true, 'reason', 'just_left',
      'child_id', v_child.id, 'first_name', v_child.first_name,
      'last_name', v_child.last_name, 'photo_path', v_child.photo_path,
      'check_in_at', v_existing.check_in_at, 'check_out_at', v_existing.check_out_at,
      'direction', 'in');
  elsif v_existing.check_in_at is not null and v_existing.check_out_at is null
        and now() - v_existing.check_in_at < interval '2 minutes' then
    -- The double scan, as §2 answers the double tap: the fact, not an 'in'
    -- through the writer's hours gate.
    r := jsonb_build_object('duplicate', true, 'reason', 'already_in',
      'child_id', v_child.id, 'first_name', v_child.first_name,
      'last_name', v_child.last_name, 'photo_path', v_child.photo_path,
      'check_in_at', v_existing.check_in_at, 'check_out_at', v_existing.check_out_at,
      'direction', 'in');
  else
    v_dir := case when v_existing.check_in_at is null or v_existing.check_out_at is not null then 'in' else 'out' end;
    r := kg_attendance_write(p_tenant, v_child.id, v_dir, 'kiosk', null, v_guardian.id, false);
    -- A departure the card recorded is the hand-over a parent may have
    -- asked for from their phone a moment earlier; the writer (§3b) settles
    -- it, as it does for a badge and for the staff's own decision.
  end if;

  return r || jsonb_build_object('guardian_id', v_guardian.id, 'guardian_name', v_gname,
    'guardian_photo_path', v_guardian.photo_path, 'tag_code', v_child.tag_code, 'pair', true);
end $$;

-- ── 4. The catalogue, and who may call what ───────────────────────────────
comment on table public.kg_attendance_passes is
  'Every recorded move of a child''s day, in order: direction, moment, method, the staff user, the guardian, the collector''s name, forced or not. Appended by kg_attendance_write; kg_attendance keeps the first arrival and the last departure. Select for staff of the tenant and the child''s family; no client writes. See 0170.';
comment on function public.kg_attendance_write(uuid, uuid, text, kg_checkin_method, text, uuid, boolean) is
  'The one writer of an attendance pass: opening hours for an arrival unless forced, can_pickup for a departure, the duplicate reasons (already_in, already_out, just_arrived, just_left), the upsert — an arrival after a departure is a return that re-opens the day (returned: true) — the pass log, and the hand-over settled on a departure. Internal: called by kg_checkin_by_tag, kg_checkin_self, kg_kiosk_pair and kg_handover_decide.';
comment on function public.kg_checkin_self(text, uuid, text) is
  'The parent records a move for one of their children through a door code, method parent, never forced. ''auto'' reads the move off today''s row: not arrived → in; in → out; left → in again (a return; just_left under two minutes). in → kg_attendance_write; out → pickup_not_allowed / already_out / not_arrived as facts, then recorded when self_pickup_confirm is off, else a pending kg_handovers row. unknown_code / expired_code / invalid_direction / forbidden / unknown_child.';
comment on function public.kg_kiosk_pair(uuid, text) is
  'A child''s card at the kiosk — <guardian tag>+<child tag>: the adult verified for that child, the move read off the day (a child who left is coming back), recorded through kg_attendance_write with method kiosk; just_left / already_in as facts; not_linked when the adult is not this child''s; unknown_code / invalid_pair. Educators of the tenant.';
revoke all on function public.kg_attendance_write(uuid, uuid, text, kg_checkin_method, text, uuid, boolean) from public, anon, authenticated;
revoke all on function public.kg_checkin_self(text, uuid, text) from public, anon;
grant execute on function public.kg_checkin_self(text, uuid, text) to authenticated;
revoke all on function public.kg_kiosk_pair(uuid, text) from public, anon;
grant execute on function public.kg_kiosk_pair(uuid, text) to authenticated;

-- ── 5. Rehearsal, always rolled back ─────────────────────────────────────
-- Demo tenant only, the 0168/0169 shape: the writes live in an inner block
-- that ends by raising P0170; the handler turns it into the pass mark and
-- undoes everything of the demo tenant's while the DDL persists. Any failed
-- assertion aborts the whole migration. As written the handler RAISES, so
-- the file rehearses; to apply, flip that one `raise exception` to `raise
-- notice`. Today's hours are widened for the stretch that records arrivals.
do $$
declare
  t uuid := '732bdf7d-775a-4ed7-875f-8c04ea4e4778';
  u_owner uuid; u_educator uuid; u_parent uuid; u_other uuid;
  c_id uuid; g_id uuid; tag text; gtag text; today_key text; before jsonb;
  r jsonb; v jsonb; keys text[]; first_in timestamptz; n int; code1 text;
  k_recorded text[] := array['at', 'child_id', 'direction', 'duplicate', 'first_name', 'guardian_name', 'last_name', 'photo_path', 'returned'];
  k_duplicate text[] := array['check_in_at', 'check_out_at', 'child_id', 'direction', 'duplicate', 'first_name', 'last_name', 'photo_path', 'reason'];
begin
  if not exists (select 1 from public.kg_tenants where id = t) then
    raise notice '0170 rehearsal skipped: demo tenant absent'; return;
  end if;
  select user_id into u_owner from public.kg_memberships where tenant_id = t and role = 'owner' and status = 'active' and user_id is not null limit 1;
  select user_id into u_educator from public.kg_memberships where tenant_id = t and role = 'educator' and status = 'active' and user_id is not null limit 1;
  select m.user_id, cg.child_id, g.id, c.tag_code, g.tag_code
    into u_parent, c_id, g_id, tag, gtag
    from public.kg_memberships m
    join public.kg_guardians g on g.user_id = m.user_id and g.tenant_id = t and g.tag_code is not null
    join public.kg_child_guardians cg on cg.guardian_id = g.id and cg.can_pickup
    join public.kg_children c on c.id = cg.child_id and c.status = 'enrolled' and c.tag_code is not null
   where m.tenant_id = t and m.role = 'parent' and m.status = 'active'
     and not exists (select 1 from public.kg_memberships s where s.tenant_id = t and s.user_id = m.user_id and s.status = 'active' and s.role <> 'parent')
   order by c.created_at limit 1;
  select m.user_id into u_other from public.kg_memberships m
    join public.kg_guardians g on g.user_id = m.user_id and g.tenant_id = t
   where m.tenant_id = t and m.role = 'parent' and m.status = 'active' and m.user_id <> u_parent
     and not exists (select 1 from public.kg_child_guardians cg where cg.guardian_id = g.id and cg.child_id = c_id)
   limit 1;
  if u_owner is null or u_educator is null or u_parent is null or c_id is null or u_other is null then
    raise exception 'rehearsal: the demo tenant lacks an owner, an educator, a badged parent with a badged child, or a second family';
  end if;
  today_key := lower(to_char(kg_today(), 'Dy'));
  select settings into before from public.kg_tenants where id = t;

  begin
    -- The stage: a clean day for the child, today's hours wide open, self
    -- check-in on with the confirmation off (a parent's return must be an
    -- arrival, not a request).
    delete from public.kg_attendance_passes where child_id = c_id and date = kg_today();
    delete from public.kg_attendance where child_id = c_id and date = kg_today();
    update public.kg_tenants set opening_hours = jsonb_set(opening_hours, array[today_key], '{"open": "00:00", "close": "23:59"}'::jsonb) where id = t;
    perform set_config('request.jwt.claims', json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    perform public.kg_set_kiosk_settings(t, '{"self_checkin": true, "self_pickup_confirm": false}'::jsonb);
    v := public.kg_door_code_issue(t);
    code1 := v ->> 'code';
    execute 'reset role';

    -- a) The badge: in, out, the double read on the way out, the return.
    perform set_config('request.jwt.claims', json_build_object('sub', u_educator, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    r := public.kg_checkin_by_tag(t, tag, 'in', 'kiosk', null, g_id, false);
    keys := (select array_agg(k order by k collate "C") from jsonb_object_keys(r) k);
    if keys <> k_recorded or (r ->> 'returned')::boolean is distinct from false then raise exception 'a) the first arrival: %', r; end if;
    -- The arrival moved back an hour, so the departure is not just_arrived.
    execute 'reset role';
    update public.kg_attendance set check_in_at = check_in_at - interval '1 hour' where child_id = c_id and date = kg_today();
    select check_in_at into first_in from public.kg_attendance where child_id = c_id and date = kg_today();
    execute 'set local role authenticated';
    r := public.kg_checkin_by_tag(t, tag, 'out', 'kiosk', null, g_id, false);
    if (r ->> 'duplicate')::boolean is distinct from false or r ->> 'direction' is distinct from 'out' then raise exception 'a) the departure: %', r; end if;
    r := public.kg_checkin_by_tag(t, tag, 'in', 'kiosk', null, g_id, false);
    keys := (select array_agg(k order by k collate "C") from jsonb_object_keys(r) k);
    if keys <> k_duplicate or r ->> 'reason' is distinct from 'just_left' or r ->> 'direction' is distinct from 'in' then raise exception 'a) the double read on the way out: %', r; end if;
    if exists (select 1 from public.kg_attendance where child_id = c_id and date = kg_today() and check_out_at is null) then raise exception 'a) just_left wrote'; end if;
    select count(*) into n from public.kg_attendance_passes where child_id = c_id and date = kg_today();
    if n <> 2 then raise exception 'a) passes after in+out: %', n; end if;
    -- Three minutes later the child is back.
    update public.kg_attendance set check_out_at = check_out_at - interval '3 minutes' where child_id = c_id and date = kg_today();
    r := public.kg_checkin_by_tag(t, tag, 'in', 'kiosk', null, g_id, false);
    keys := (select array_agg(k order by k collate "C") from jsonb_object_keys(r) k);
    if keys <> k_recorded or (r ->> 'returned')::boolean is distinct from true or r ->> 'direction' is distinct from 'in' then raise exception 'a) the return: %', r; end if;
    if not exists (select 1 from public.kg_attendance a where a.child_id = c_id and a.date = kg_today()
                    and a.check_in_at = first_in and a.check_out_at is null and a.check_out_method is null
                    and a.checked_out_by is null and a.checked_out_guardian_id is null and a.picked_up_by is null and a.status = 'present') then
      raise exception 'a) the return did not re-open the day on the first arrival';
    end if;
    select count(*) into n from public.kg_attendance_passes where child_id = c_id and date = kg_today();
    if n <> 3 then raise exception 'a) passes after the return: %', n; end if;
    if (select string_agg(direction, ',' order by at) from public.kg_attendance_passes where child_id = c_id and date = kg_today()) <> 'in,out,in' then
      raise exception 'a) the log is out of order';
    end if;
    -- In again → already_in; a second departure, logged with the collector.
    r := public.kg_checkin_by_tag(t, tag, 'in', 'kiosk', null, g_id, false);
    if r ->> 'reason' is distinct from 'already_in' then raise exception 'a) in while in: %', r; end if;
    r := public.kg_checkin_by_tag(t, tag, 'out', 'kiosk', null, g_id, false);
    if (r ->> 'duplicate')::boolean is distinct from false then raise exception 'a) the second departure: %', r; end if;
    if not exists (select 1 from public.kg_attendance_passes p where p.child_id = c_id and p.date = kg_today() and p.direction = 'out'
                    and p.guardian_id = g_id and p.picked_up_by is not null and p.by_user = u_educator and p.method = 'kiosk' and not p.forced
                   order by p.at desc limit 1) then
      raise exception 'a) the second departure''s pass lacks its facts';
    end if;
    -- Out while out is still the fact.
    r := public.kg_checkin_by_tag(t, tag, 'out', 'kiosk', null, g_id, false);
    if r ->> 'reason' is distinct from 'already_out' then raise exception 'a) out while out: %', r; end if;
    execute 'reset role';

    -- b) The parent's 'auto' three minutes after a departure is a return,
    --    method parent; under two minutes it is just_left and writes nothing.
    perform set_config('request.jwt.claims', json_build_object('sub', u_parent, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    r := public.kg_checkin_self(code1, c_id, 'auto');
    if r ->> 'reason' is distinct from 'just_left' then raise exception 'b) auto right after the departure: %', r; end if;
    execute 'reset role';
    update public.kg_attendance set check_out_at = check_out_at - interval '3 minutes' where child_id = c_id and date = kg_today();
    execute 'set local role authenticated';
    r := public.kg_checkin_self(code1, c_id, 'auto');
    if (r ->> 'duplicate')::boolean is distinct from false or r ->> 'direction' is distinct from 'in' or (r ->> 'returned')::boolean is distinct from true then
      raise exception 'b) the parent''s return: %', r;
    end if;
    if not exists (select 1 from public.kg_attendance_passes p where p.child_id = c_id and p.date = kg_today() and p.direction = 'in' and p.method = 'parent' and p.by_user = u_parent and p.guardian_id = g_id) then
      raise exception 'b) the parent''s return is not in the log as theirs';
    end if;
    if not exists (select 1 from public.kg_attendance where child_id = c_id and date = kg_today() and check_out_at is null and check_in_at = first_in) then
      raise exception 'b) the parent''s return did not re-open the day';
    end if;
    -- The family reads the child's log; another family reads nothing.
    select count(*) into n from public.kg_attendance_passes where child_id = c_id and date = kg_today();
    if n < 5 then raise exception 'b) the parent sees % passes', n; end if;
    execute 'reset role';
    perform set_config('request.jwt.claims', json_build_object('sub', u_other, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    select count(*) into n from public.kg_attendance_passes where child_id = c_id and date = kg_today();
    if n <> 0 then raise exception 'b) another family sees % passes', n; end if;
    begin
      insert into public.kg_attendance_passes (tenant_id, child_id, date, direction) values (t, c_id, kg_today(), 'in');
      raise exception 'b) a parent inserted a pass';
    exception when insufficient_privilege then null;
    end;
    execute 'reset role';

    -- c) The child's card after a departure records the return (method kiosk).
    perform set_config('request.jwt.claims', json_build_object('sub', u_educator, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    r := public.kg_checkin_by_tag(t, tag, 'out', 'kiosk', null, g_id, false);
    execute 'reset role';
    update public.kg_attendance set check_out_at = check_out_at - interval '3 minutes' where child_id = c_id and date = kg_today();
    execute 'set local role authenticated';
    r := public.kg_kiosk_pair(t, gtag || '+' || tag);
    if (r ->> 'duplicate')::boolean is distinct from false or r ->> 'direction' is distinct from 'in' or (r ->> 'returned')::boolean is distinct from true or (r ->> 'pair')::boolean is distinct from true then
      raise exception 'c) the card''s return: %', r;
    end if;
    -- The card read twice on the way out.
    r := public.kg_checkin_by_tag(t, tag, 'out', 'kiosk', null, g_id, false);
    r := public.kg_kiosk_pair(t, gtag || '+' || tag);
    if r ->> 'reason' is distinct from 'just_left' then raise exception 'c) the card right after the departure: %', r; end if;
    execute 'reset role';

    -- d) The backfill is idempotent: running it again adds nothing. The
    --    staged child is left out — the stage moved their moments by hand,
    --    which the real writer never does (its row and its pass carry the
    --    same now()).
    select count(*) into n from public.kg_attendance_passes where tenant_id = t and child_id <> c_id;
    insert into public.kg_attendance_passes (tenant_id, child_id, date, direction, at, method, by_user, guardian_id, picked_up_by)
    select a.tenant_id, a.child_id, a.date, 'in', a.check_in_at, a.check_in_method, a.checked_in_by, a.checked_in_guardian_id, null
      from public.kg_attendance a
     where a.tenant_id = t and a.child_id <> c_id and a.check_in_at is not null
       and not exists (select 1 from public.kg_attendance_passes p where p.child_id = a.child_id and p.date = a.date and p.direction = 'in' and p.at = a.check_in_at);
    if (select count(*) from public.kg_attendance_passes where tenant_id = t and child_id <> c_id) <> n then raise exception 'd) the backfill is not idempotent'; end if;

    -- e) Who may call what, unchanged.
    if has_function_privilege('authenticated', 'public.kg_attendance_write(uuid,uuid,text,kg_checkin_method,text,uuid,boolean)', 'execute')
       or has_function_privilege('anon', 'public.kg_kiosk_pair(uuid,text)', 'execute')
       or not has_function_privilege('authenticated', 'public.kg_checkin_self(text,uuid,text)', 'execute') then
      raise exception 'e) the grants are off';
    end if;

    raise exception using errcode = 'P0170', message = 'rehearsal done';
  exception when sqlstate 'P0170' then
    raise exception '0170 rehearsal ok — rolled back';
  end;
end $$;

notify pgrst, 'reload schema';
commit;
