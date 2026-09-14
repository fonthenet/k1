-- 0168 — one scan for parents and staff: the door code, the parent's own
-- check-in, the supervised hand-over.
--
-- The door has ONE scan and the two roles are its two ends. A staff phone or
-- the door tablet scans a badge (0166's kiosk). A parent's phone scans the
-- DOOR: the kiosk's idle screen shows a code that changes every 30 seconds
-- and is worthless after 90; the parent opens it with the app or the plain
-- camera, sees their own children with today's state and records the
-- arrival themselves. A departure is different. With the default setting it
-- becomes a HAND-OVER REQUEST that a staff member confirms on the kiosk or
-- on their phone within 10 minutes — the child is handed to a person a
-- human has looked at, exactly as today — and the parent's screen says
-- "confirmed" the moment it happens. A small crèche that trusts its door
-- turns the confirmation off and the departure is recorded at once.
--
-- The database owns every rule, so the register cannot disagree with
-- itself: who may act on which child (a guardian row of the CODE's tenant,
-- linked to the child), how fresh the code must be, the opening hours, the
-- duplicate reasons, can_pickup. 0069's kg_checkin_by_tag is split in two:
-- its body from the opening-hours check down becomes kg_attendance_write,
-- the one writer of a pass — nobody calls it directly — and the tag RPC
-- keeps its signature, looks the child up and hands over. A parent's pass
-- goes through the same writer with the method `parent` (in the enum since
-- 0019), so the register, the journal and 0019's notification trigger say
-- who did it: a parent's arrival carries the parent's user in
-- checked_in_by, a confirmed hand-over the STAFF user in checked_out_by and
-- the GUARDIAN in checked_out_guardian_id / picked_up_by.
--
-- Two more switches in kg_tenants.settings->'kiosk' (0166's shape, 0167's
-- extension): `self_checkin` (off when absent — no door code anywhere) and
-- `self_pickup_confirm` (ON when absent — a departure waits for a human).
-- Two tables, both RPC-only: kg_door_codes (12 symbols of a 31-symbol
-- alphabet, ~59 bits, 90 s, single tenant, never handed to a parent) and
-- kg_handovers (one pending row per child, 10 min, expiry lazy and the same
-- for every reader). Parents never force: the parent paths have no p_force,
-- and a duplicate comes back as a fact, never as a button.
--
-- Rehearsed on production (qekibejzwpphzzyqigzo) on 2026-09-14 through
-- execute_sql, after the review (a parent's departure now meets not_arrived
-- with the confirmation off too; a null direction or decision is refused;
-- a hand-over is visible to the child's whole family, so a co-parent's
-- take-over does not lock the first parent out): every assertion of §8
-- held, sections a) to n), and the run ended on the pass mark, verbatim
-- "ERROR:  P0001: 0168 rehearsal ok — rolled back"; afterwards no table, no
-- new function, no policy, no key on the demo tenant, no staged guardian
-- link and no attendance row persisted, kg_checkin_by_tag still had 0069's
-- body and kg_valid_kiosk_settings 0167's. Run again the same day, after
-- the alphabet moved to 31 symbols (a byte of 248 or more thrown away) and
-- an unknown hand-over id became `unknown_handover`: the same pass mark,
-- the same empty aftermath. Not applied.
begin;
set local lock_timeout = '5s';

-- ── 1. The shape, with two more keys ──────────────────────────────────────
-- 0167 §1 plus `self_checkin` and `self_pickup_confirm`: every key optional
-- (the merge writes them one at a time), unknown keys refused, no JSON null
-- — a switch is on or off, and a missing key means the default: self
-- check-in OFF, the hand-over confirmation ON. The constraint
-- kg_tenants_kiosk_shape keeps pointing at the replaced function and the
-- writer kg_set_kiosk_settings merges whatever keys it is given, so neither
-- changes; the writer's comment lists the seven keys.
create or replace function public.kg_valid_kiosk_settings(v jsonb) returns boolean
language sql immutable set search_path = public as $$
  select v -> 'kiosk' is null
      or (jsonb_typeof(v -> 'kiosk') = 'object'
          and coalesce((select bool_and(k in ('auto_confirm', 'auto_confirm_seconds', 'door_mode', 'sound', 'floating_scan',
                                              'self_checkin', 'self_pickup_confirm'))
                          from jsonb_object_keys(v -> 'kiosk') k), true)
          and (v -> 'kiosk' -> 'auto_confirm' is null
               or jsonb_typeof(v -> 'kiosk' -> 'auto_confirm') = 'boolean')
          and (v -> 'kiosk' -> 'door_mode' is null
               or jsonb_typeof(v -> 'kiosk' -> 'door_mode') = 'boolean')
          and (v -> 'kiosk' -> 'sound' is null
               or jsonb_typeof(v -> 'kiosk' -> 'sound') = 'boolean')
          and (v -> 'kiosk' -> 'floating_scan' is null
               or jsonb_typeof(v -> 'kiosk' -> 'floating_scan') = 'boolean')
          and (v -> 'kiosk' -> 'self_checkin' is null
               or jsonb_typeof(v -> 'kiosk' -> 'self_checkin') = 'boolean')
          and (v -> 'kiosk' -> 'self_pickup_confirm' is null
               or jsonb_typeof(v -> 'kiosk' -> 'self_pickup_confirm') = 'boolean')
          and (v -> 'kiosk' -> 'auto_confirm_seconds' is null
               or (jsonb_typeof(v -> 'kiosk' -> 'auto_confirm_seconds') = 'number'
                   and (v -> 'kiosk' ->> 'auto_confirm_seconds') ~ '^[0-9]+$'
                   and (v -> 'kiosk' ->> 'auto_confirm_seconds')::int between 2 and 10)));
$$;

comment on function public.kg_set_kiosk_settings(uuid, jsonb) is
  'Merges p_kiosk into kg_tenants.settings->''kiosk'' (auto_confirm, auto_confirm_seconds, door_mode, sound, floating_scan, self_checkin, self_pickup_confirm). Admin-only; the shape is enforced by kg_tenants_kiosk_shape.';

-- ── 2. The two tables ─────────────────────────────────────────────────────
-- The door code: one row per code the kiosk asked for. Row level security
-- is on with NO policy — a client never reads or writes a code through the
-- table, only through the RPCs of §4, and a code never comes back to a
-- parent. Issuing sweeps the tenant's codes that expired more than an hour
-- ago, so the table stays the size of a morning.
create table if not exists public.kg_door_codes (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.kg_tenants(id) on delete cascade,
  code       text not null unique,
  issued_by  uuid not null,
  issued_at  timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists kg_door_codes_tenant_expires_idx on public.kg_door_codes (tenant_id, expires_at);
alter table public.kg_door_codes enable row level security;

-- The hand-over: a parent asked to collect a child, a staff member decides.
-- One PENDING row per child (the partial unique index; the request RPC
-- upserts against it). Staff of the tenant and the child's family read
-- the rows through the policy — scoped as an attendance row is
-- (kg_is_parent_of), because a co-parent may refresh the request and the
-- first parent's phone must keep reading it. The kiosk and the portal poll
-- RPCs, but a realtime subscription needs the select. Nobody inserts,
-- updates or deletes through the table: RPC only.
create table if not exists public.kg_handovers (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.kg_tenants(id) on delete cascade,
  child_id     uuid not null references public.kg_children(id) on delete cascade,
  guardian_id  uuid not null references public.kg_guardians(id) on delete cascade,
  door_code_id uuid references public.kg_door_codes(id) on delete set null,
  requested_by uuid not null,
  requested_at timestamptz not null default now(),
  expires_at   timestamptz not null,
  status       text not null check (status in ('pending', 'confirmed', 'refused', 'cancelled', 'expired')),
  decided_by   uuid,
  decided_at   timestamptz
);
create unique index if not exists kg_handovers_one_pending_idx on public.kg_handovers (child_id) where status = 'pending';
create index if not exists kg_handovers_tenant_pending_idx on public.kg_handovers (tenant_id, requested_at) where status = 'pending';
alter table public.kg_handovers enable row level security;
drop policy if exists ho_sel on public.kg_handovers;
create policy ho_sel on public.kg_handovers for select using (kg_is_staff(tenant_id) or kg_is_parent_of(child_id));

-- ── 3. The one writer of a pass, and the tag RPC on top of it ────────────
-- 0069's kg_checkin_by_tag from the comment "Arrivals only" to the end,
-- unchanged in logic — the opening hours for an arrival unless forced, the
-- guardian's can_pickup for a departure, the four duplicate reasons, the
-- upsert that never blanks an arrival and clears a departure only when
-- forced, the same return shapes with the same keys. The child is loaded
-- by id instead of by tag (of this tenant, enrolled — `unknown_child`
-- otherwise). No caller check here: every caller has done its own
-- (kg_is_educator on the tag path, the guardian link on the parent paths),
-- and §7 revokes execute from every client role, so the only way in is
-- through the RPCs. A null p_force reads as false — `not null` is null and
-- would skip the hours check — and a null direction is `invalid_direction`
-- like any other: `null not in (…)` is null, not true, and 0069 let it
-- through to an insert with neither moment (the same coalesce guards the
-- tag path, the parent's pass and the decision below).
create or replace function public.kg_attendance_write(
  p_tenant uuid, p_child uuid, p_direction text, p_method kg_checkin_method,
  p_picked_up_by text, p_guardian uuid, p_force boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_child kg_children; v_att kg_attendance; v_guardian kg_guardians;
  v_can_pickup boolean; v_existing kg_attendance; v_reason text;
  v_today date := kg_today(); v_now time := (now() at time zone 'Africa/Algiers')::time;
  v_hours jsonb; v_open time; v_close time;
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
end $$;

-- The tag path, same signature and defaults as 0069, same three refusals in
-- the same order, then the writer. Behaviourally identical for every
-- client that exists today.
create or replace function public.kg_checkin_by_tag(p_tenant uuid, p_tag text, p_direction text default 'in',
  p_method kg_checkin_method default 'tag', p_picked_up_by text default null,
  p_guardian uuid default null, p_force boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_child uuid;
begin
  if not kg_is_educator(p_tenant) then raise exception 'forbidden'; end if;
  if coalesce(p_direction, '') not in ('in', 'out') then raise exception 'invalid_direction'; end if;

  select id into v_child from kg_children
   where tenant_id = p_tenant and tag_code = upper(trim(p_tag)) and status = 'enrolled';
  if v_child is null then raise exception 'unknown_tag'; end if;

  return kg_attendance_write(p_tenant, v_child, p_direction, p_method, p_picked_up_by, p_guardian, p_force);
end $$;

-- ── 4. The door code ──────────────────────────────────────────────────────
-- Issued to the kiosk (staff of the tenant, self_checkin on), 12 symbols of
-- ABCDEFGHJKMNPQRSTUVWXYZ23456789 — no I, L, O, 0, 1, so a code read aloud
-- or typed cannot be misread — drawn from pgcrypto's random bytes by
-- rejection (a byte of 248 or more is thrown away — 248 = 8 × 31 — so every
-- symbol is exactly as likely as every other), 12 × log2(31) ≈ 59 bits. It lives 90 s; the kiosk
-- asks again every 30 s, so a code a parent has just scanned always has a
-- minute left. Issuing also sweeps the tenant's codes that expired more
-- than an hour ago. The code goes to the kiosk's screen and nowhere else:
-- no other RPC returns it, no notification carries it.
create or replace function public.kg_door_code_issue(p_tenant uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_bytes bytea; v_byte int; v_i int; v_code text; v_expires timestamptz := now() + interval '90 seconds';
begin
  if p_tenant is null or not kg_is_staff(p_tenant) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not coalesce((select (t.settings -> 'kiosk' ->> 'self_checkin')::boolean from kg_tenants t where t.id = p_tenant), false) then
    raise exception 'self_checkin_off';
  end if;

  delete from kg_door_codes where tenant_id = p_tenant and expires_at < now() - interval '1 hour';

  loop
    v_code := ''; v_bytes := extensions.gen_random_bytes(32); v_i := 0;
    while length(v_code) < 12 loop
      if v_i >= length(v_bytes) then v_bytes := extensions.gen_random_bytes(32); v_i := 0; end if;
      v_byte := get_byte(v_bytes, v_i); v_i := v_i + 1;
      if v_byte < 248 then v_code := v_code || substr(v_alphabet, v_byte % 31 + 1, 1); end if;
    end loop;
    -- 59 bits make a clash unthinkable; the loop makes it harmless.
    begin
      insert into kg_door_codes (tenant_id, code, issued_by, expires_at)
      values (p_tenant, v_code, auth.uid(), v_expires);
      exit;
    exception when unique_violation then null;
    end;
  end loop;

  return jsonb_build_object('code', v_code, 'expires_at', v_expires, 'ttl_seconds', 90);
end $$;

-- What a parent sees after scanning the door. The code is looked up as
-- typed (trimmed, upper-cased — the camera app may hand the URL over in
-- lower case), refused when unknown or past its time; the caller must own a
-- guardian row of the CODE's tenant — a guardian of another establishment
-- with a valid code of this one is told `not_a_parent`, and the children
-- listed are exactly the enrolled children linked to the caller's guardian
-- rows here, never another family's. Each child carries today's moments
-- (0166's kg_today, Africa/Algiers) and its pending hand-over, if any; the
-- lazy expiry runs first so "pending" here means pending.
create or replace function public.kg_door_peek(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_code kg_door_codes; v_name text; v_confirm boolean; v_children jsonb; v_today date := kg_today();
begin
  select * into v_code from kg_door_codes where code = upper(trim(coalesce(p_code, '')));
  if v_code.id is null then raise exception 'unknown_code'; end if;
  if v_code.expires_at < now() then raise exception 'expired_code'; end if;
  if auth.uid() is null or not exists (select 1 from kg_guardians g where g.tenant_id = v_code.tenant_id and g.user_id = auth.uid()) then
    raise exception 'not_a_parent';
  end if;

  select t.name, coalesce((t.settings -> 'kiosk' ->> 'self_pickup_confirm')::boolean, true)
    into v_name, v_confirm from kg_tenants t where t.id = v_code.tenant_id;
  perform kg_handovers_expire(v_code.tenant_id);

  with mine as (
    select cg.child_id, bool_or(cg.can_pickup) as can_pickup
      from kg_guardians g
      join kg_child_guardians cg on cg.guardian_id = g.id
     where g.tenant_id = v_code.tenant_id and g.user_id = auth.uid()
     group by cg.child_id)
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id, 'first_name', c.first_name, 'last_name', c.last_name, 'photo_path', c.photo_path,
           'can_pickup', m.can_pickup,
           'check_in_at', a.check_in_at, 'check_out_at', a.check_out_at,
           'handover', case when h.id is null then null
                            else jsonb_build_object('id', h.id, 'status', h.status, 'expires_at', h.expires_at) end)
         order by c.first_name, c.last_name), '[]'::jsonb)
    into v_children
    from mine m
    join kg_children c on c.id = m.child_id and c.tenant_id = v_code.tenant_id and c.status = 'enrolled'
    left join kg_attendance a on a.child_id = c.id and a.date = v_today
    left join kg_handovers h on h.child_id = c.id and h.status = 'pending';

  return jsonb_build_object(
    'tenant_id', v_code.tenant_id, 'tenant_name', v_name, 'expires_at', v_code.expires_at,
    'self_pickup_confirm', v_confirm, 'children', v_children);
end $$;

-- ── 5. The parent's pass and the hand-over ────────────────────────────────
-- Expiry is lazy and the same everywhere: every reader of kg_handovers
-- flips the tenant's pending rows past their time to `expired` before it
-- looks, so the parent's poll, the kiosk's list and the staff's decision
-- can never disagree about a request that is ten minutes old. Internal —
-- §7 revokes it from every client role.
create or replace function public.kg_handovers_expire(p_tenant uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update kg_handovers set status = 'expired'
   where tenant_id = p_tenant and status = 'pending' and expires_at < now();
end $$;

-- The parent records a move for one of their children. The same code
-- checks as the peek, then the guardian link: the caller's guardian row of
-- the code's tenant linked to THIS child, else `forbidden` — an unknown
-- child and another family's child are refused the same way. An arrival
-- goes straight to the writer with the method `parent` and the guardian
-- (the hours apply; a parent cannot force — there is no p_force here). A
-- departure meets three facts first, whatever the setting: can_pickup,
-- already out, not arrived — the writer would let a parent "collect" a
-- child who never came in and mark them present with no moment and no
-- method, so the rule lives here, once, before the two roads part. Then
-- the establishment that has turned the confirmation off gets the pass
-- recorded through the writer at once; the others get the child's pending
-- hand-over — a new row, or the existing pending one refreshed: its clock,
-- its requester and the code and guardian at the door, so the card the
-- staff see shows the person standing there. A co-parent may take over
-- the request that way; the first parent's phone keeps reading it, because
-- a hand-over is visible to the child's whole family (kg_is_parent_of, as
-- an attendance row is), not to one guardian row.
create or replace function public.kg_checkin_self(p_code text, p_child uuid, p_direction text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_code kg_door_codes; v_guardian uuid; v_can_pickup boolean; v_child kg_children;
  v_confirm boolean; v_existing kg_attendance; v_h kg_handovers;
begin
  select * into v_code from kg_door_codes where code = upper(trim(coalesce(p_code, '')));
  if v_code.id is null then raise exception 'unknown_code'; end if;
  if v_code.expires_at < now() then raise exception 'expired_code'; end if;
  if coalesce(p_direction, '') not in ('in', 'out') then raise exception 'invalid_direction'; end if;

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

  if p_direction = 'in' then
    return kg_attendance_write(v_code.tenant_id, p_child, 'in', 'parent', null, v_guardian, false);
  end if;

  if v_can_pickup is not true then
    return jsonb_build_object('refused', true, 'reason', 'pickup_not_allowed',
      'child_id', v_child.id, 'first_name', v_child.first_name,
      'last_name', v_child.last_name, 'photo_path', v_child.photo_path,
      'direction', 'out');
  end if;

  select * into v_existing from kg_attendance where child_id = p_child and date = kg_today();
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

-- The parent polls this every 3 s. The child's family (any guardian of the
-- child — the peek shows the pending request to all of them, and a
-- co-parent may have refreshed it) or staff of the tenant; anyone else is
-- refused. An id that matches no row answers unknown_handover — the parent's
-- screen turns it into "no longer waiting" rather than guessing. check_out_at
-- is today's moment once the hand-over is confirmed, null before.
create or replace function public.kg_handover_status(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_h kg_handovers; v_out timestamptz;
begin
  select * into v_h from kg_handovers where id = p_id;
  -- A row that is gone (the child's file deleted mid-request) is a fact the
  -- parent's screen can settle; a row they may not see stays 'forbidden'.
  if v_h.id is null then raise exception 'unknown_handover'; end if;
  if not (kg_is_staff(v_h.tenant_id) or kg_is_parent_of(v_h.child_id)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform kg_handovers_expire(v_h.tenant_id);
  select * into v_h from kg_handovers where id = p_id;
  if v_h.status = 'confirmed' then
    select a.check_out_at into v_out from kg_attendance a where a.child_id = v_h.child_id and a.date = kg_today();
  end if;
  return jsonb_build_object('id', v_h.id, 'status', v_h.status, 'requested_at', v_h.requested_at,
    'expires_at', v_h.expires_at, 'decided_at', v_h.decided_at, 'check_out_at', v_out);
end $$;

-- The parent changes their mind. The child's family only — the same people
-- who could have asked — never staff; a request that is no longer pending
-- (decided, expired, already cancelled) is `not_pending`.
create or replace function public.kg_handover_cancel(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_h kg_handovers;
begin
  select * into v_h from kg_handovers where id = p_id for update;
  if v_h.id is null or not kg_is_parent_of(v_h.child_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform kg_handovers_expire(v_h.tenant_id);
  select * into v_h from kg_handovers where id = p_id;
  if v_h.status <> 'pending' then raise exception 'not_pending'; end if;
  update kg_handovers set status = 'cancelled', decided_by = auth.uid(), decided_at = now() where id = p_id;
  return jsonb_build_object('id', p_id, 'status', 'cancelled');
end $$;

-- The staff's list, oldest first — the kiosk polls it every 5 s, the
-- attendance screens every 10 s. An ARRAY, empty when nothing waits. The
-- child with its class, the guardian with both names, the relationship,
-- the photo and the phone: what a person at the door needs to recognise
-- the person in front of them.
create or replace function public.kg_handovers_pending(p_tenant uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_out jsonb;
begin
  if p_tenant is null or not kg_is_staff(p_tenant) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform kg_handovers_expire(p_tenant);
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', h.id, 'requested_at', h.requested_at, 'expires_at', h.expires_at,
           'child', jsonb_build_object('id', c.id, 'first_name', c.first_name, 'last_name', c.last_name,
                                       'photo_path', c.photo_path, 'class_name', k.name),
           'guardian', jsonb_build_object('id', g.id, 'first_name', g.first_name, 'last_name', g.last_name,
                                          'first_name_ar', g.first_name_ar, 'last_name_ar', g.last_name_ar,
                                          'relationship', g.relationship, 'photo_path', g.photo_path, 'phone', g.phone))
         order by h.requested_at), '[]'::jsonb)
    into v_out
    from kg_handovers h
    join kg_children c on c.id = h.child_id
    left join kg_classes k on k.id = c.class_id
    join kg_guardians g on g.id = h.guardian_id
   where h.tenant_id = p_tenant and h.status = 'pending';
  return v_out;
end $$;

-- A staff member decides. Educators of the tenant (the same people who may
-- scan a badge); the row is locked so two tablets confirming at once agree
-- — the second is told `not_pending`. `refuse` closes the request and
-- writes nothing. `confirm` records the departure through the same writer
-- as a badge, with the method `parent` and the requesting guardian, and
-- the row follows what the writer said: recorded → confirmed; already out
-- → confirmed (the child IS out, whoever recorded it); just arrived → left
-- pending, the staff retry in a moment or refuse; refused (can_pickup
-- flipped meanwhile) → refused. The answer is the writer's JSON plus
-- `handover`, so the kiosk reuses the cards it already has.
create or replace function public.kg_handover_decide(p_id uuid, p_decision text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_h kg_handovers; r jsonb; v_status text;
begin
  select * into v_h from kg_handovers where id = p_id for update;
  if v_h.id is null or not kg_is_educator(v_h.tenant_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform kg_handovers_expire(v_h.tenant_id);
  select * into v_h from kg_handovers where id = p_id;
  if v_h.status <> 'pending' then raise exception 'not_pending'; end if;
  if coalesce(p_decision, '') not in ('confirm', 'refuse') then raise exception 'invalid_decision'; end if;

  if p_decision = 'refuse' then
    update kg_handovers set status = 'refused', decided_by = auth.uid(), decided_at = now() where id = p_id;
    return jsonb_build_object('handover', 'refused', 'id', p_id);
  end if;

  r := kg_attendance_write(v_h.tenant_id, v_h.child_id, 'out', 'parent', null, v_h.guardian_id, false);
  if coalesce((r ->> 'refused')::boolean, false) then
    v_status := 'refused';
  elsif coalesce((r ->> 'duplicate')::boolean, false) then
    v_status := case when r ->> 'reason' = 'already_out' then 'confirmed' else 'pending' end;
  else
    v_status := 'confirmed';
  end if;
  if v_status <> 'pending' then
    update kg_handovers set status = v_status, decided_by = auth.uid(), decided_at = now() where id = p_id;
  end if;
  return r || jsonb_build_object('handover', v_status);
end $$;

-- ── 6. The catalogue ──────────────────────────────────────────────────────
comment on table public.kg_door_codes is
  'The door''s code: what the kiosk shows and a parent''s phone scans. 12 symbols of ABCDEFGHJKMNPQRSTUVWXYZ23456789, 90 s, one tenant. RLS on with no policy — kg_door_code_issue / kg_door_peek / kg_checkin_self only. See 0168.';
comment on table public.kg_handovers is
  'A parent asked to collect a child through the door code; a staff member confirms or refuses within 10 minutes. One pending row per child; pending rows past expires_at are flipped to expired lazily by every reader. Select for staff of the tenant and the child''s family (kg_is_parent_of); writes through RPCs only. See 0168.';
comment on function public.kg_attendance_write(uuid, uuid, text, kg_checkin_method, text, uuid, boolean) is
  'The one writer of an attendance pass: 0069''s kg_checkin_by_tag body — opening hours for an arrival unless forced, can_pickup for a departure, the duplicate reasons, the upsert — with the child loaded by id. Internal: not executable by clients; called by kg_checkin_by_tag, kg_checkin_self and kg_handover_decide.';
comment on function public.kg_checkin_by_tag(uuid, text, text, kg_checkin_method, text, uuid, boolean) is
  'The kiosk''s badge pass: educators of the tenant, the child by tag (unknown_tag), then kg_attendance_write. Same signature, refusals and JSON as before 0168.';
comment on function public.kg_door_code_issue(uuid) is
  'A fresh door code for the kiosk: {code, expires_at, ttl_seconds: 90}. Staff of the tenant (forbidden, 42501), self_checkin on (self_checkin_off). Sweeps the tenant''s codes expired for over an hour.';
comment on function public.kg_door_peek(text) is
  'What a parent sees after scanning the door: the tenant, self_pickup_confirm and their enrolled children there with today''s moments, can_pickup and any pending hand-over. unknown_code / expired_code / not_a_parent (the caller has no guardian row in the code''s tenant).';
comment on function public.kg_checkin_self(text, uuid, text) is
  'The parent records a move for one of their children through a door code, method parent, never forced. in → kg_attendance_write; out → pickup_not_allowed / already_out / not_arrived as facts, then recorded through kg_attendance_write when self_pickup_confirm is off, else a pending kg_handovers row ({pending, handover_id, expires_at, ...}) — a co-parent''s request refreshes it. unknown_code / expired_code / invalid_direction / forbidden / unknown_child.';
comment on function public.kg_handover_status(uuid) is
  'One hand-over for the parent''s poll: {id, status, requested_at, expires_at, decided_at, check_out_at}. The child''s family (kg_is_parent_of) or staff of the tenant; expiry lazy.';
comment on function public.kg_handover_cancel(uuid) is
  'A guardian of the child withdraws a pending hand-over → {id, status: cancelled}; not_pending otherwise.';
comment on function public.kg_handovers_pending(uuid) is
  'The tenant''s pending hand-overs, oldest first, each with the child (and class) and the guardian at the door. Staff of the tenant; an array, empty when nothing waits; expiry lazy.';
comment on function public.kg_handover_decide(uuid, text) is
  'A staff member confirms or refuses a pending hand-over. confirm records the departure through kg_attendance_write (method parent, the requesting guardian, the staff user as checked_out_by) and returns its JSON plus handover: confirmed | pending (just arrived) | refused; refuse → {handover: refused, id}. Educators of the tenant; not_pending / invalid_decision.';
comment on function public.kg_handovers_expire(uuid) is
  'Flips the tenant''s pending hand-overs past expires_at to expired. Internal: every reader of kg_handovers calls it first.';

-- ── 7. Who may call what ──────────────────────────────────────────────────
-- The client RPCs to signed-in users only; the writer and the expiry helper
-- to nobody — has_function_privilege('authenticated', …) is false, and a
-- direct call from a client is 42501. The tables need no grant change: row
-- level security with no write policy already refuses a direct insert.
revoke all on function public.kg_attendance_write(uuid, uuid, text, kg_checkin_method, text, uuid, boolean) from public, anon, authenticated;
revoke all on function public.kg_handovers_expire(uuid) from public, anon, authenticated;
revoke all on function public.kg_door_code_issue(uuid) from public, anon;
grant execute on function public.kg_door_code_issue(uuid) to authenticated;
revoke all on function public.kg_door_peek(text) from public, anon;
grant execute on function public.kg_door_peek(text) to authenticated;
revoke all on function public.kg_checkin_self(text, uuid, text) from public, anon;
grant execute on function public.kg_checkin_self(text, uuid, text) to authenticated;
revoke all on function public.kg_handover_status(uuid) from public, anon;
grant execute on function public.kg_handover_status(uuid) to authenticated;
revoke all on function public.kg_handover_cancel(uuid) from public, anon;
grant execute on function public.kg_handover_cancel(uuid) to authenticated;
revoke all on function public.kg_handovers_pending(uuid) from public, anon;
grant execute on function public.kg_handovers_pending(uuid) to authenticated;
revoke all on function public.kg_handover_decide(uuid, text) from public, anon;
grant execute on function public.kg_handover_decide(uuid, text) to authenticated;

-- ── 8. Rehearsal, always rolled back ─────────────────────────────────────
-- Demo tenant only. The writes live in an inner block that ends by raising
-- P0168; the handler turns it into the pass mark, so the demo tenant's
-- settings, its opening hours for today, the child's day and every code
-- and hand-over staged here are undone as a subtransaction whatever
-- happens to the DDL above (the 0164 shape). Any failing assertion raises
-- something else and aborts the whole migration. As written the handler
-- raises, so the file REHEARSES: run through execute_sql, the DDL and the
-- writes roll back together and the error text "0168 rehearsal ok — rolled
-- back" is the pass mark. That is how it was rehearsed on production
-- (qekibejzwpphzzyqigzo, 2026-09-14: every assertion held, nothing
-- persisted). To apply, flip that one `raise exception` to `raise notice`.
--
-- Today's opening hours are widened to 00:00–23:59 for the stretch that
-- records arrivals (the rehearsal runs at any hour; the hours rule itself
-- is exercised on the tag path at the end), and the child's arrival is
-- moved back an hour before the first hand-over so `just_arrived` does not
-- fire — after it has been seen to fire once, on purpose.
do $$
declare
  t uuid := '732bdf7d-775a-4ed7-875f-8c04ea4e4778';
  u_owner uuid; u_educator uuid; u_parent uuid; u_parent2 uuid;
  c_id uuid; c_other uuid; g_id uuid; g_other uuid; g_parent2 uuid; g_name text; tag text; n_mine int; n_all int; n_family int;
  before jsonb; after jsonb; v jsonb; r jsonb; item jsonb; bad text; keys text[];
  code1 text; code2 text; h1 uuid; h2 uuid; h3 uuid; h4 uuid; h5 uuid; h6 uuid; h_other uuid;
  att kg_attendance; ho kg_handovers; today_key text; exp1 timestamptz;
  k_recorded text[] := array['at', 'child_id', 'direction', 'duplicate', 'first_name', 'guardian_name', 'last_name', 'photo_path'];
  k_duplicate text[] := array['check_in_at', 'check_out_at', 'child_id', 'direction', 'duplicate', 'first_name', 'last_name', 'photo_path', 'reason'];
  k_pickup text[] := array['child_id', 'direction', 'first_name', 'guardian_name', 'last_name', 'photo_path', 'reason', 'refused'];
  k_hours text[] := array['child_id', 'closes_at', 'direction', 'first_name', 'last_name', 'opens_at', 'photo_path', 'reason', 'refused'];
  k_closed text[] := array['child_id', 'direction', 'first_name', 'last_name', 'photo_path', 'reason', 'refused'];
begin
  if not exists (select 1 from public.kg_tenants where id = t) then
    raise notice '0168 rehearsal skipped: demo tenant absent'; return;
  end if;
  select user_id into u_owner from public.kg_memberships
   where tenant_id = t and role = 'owner' and status = 'active' and user_id is not null limit 1;
  select user_id into u_educator from public.kg_memberships
   where tenant_id = t and role = 'educator' and status = 'active' and user_id is not null limit 1;
  -- A parent with an account and no staff role, one of their enrolled
  -- children they may collect, that child's badge and their guardian row.
  select m.user_id, cg.child_id, g.id, trim(g.first_name || ' ' || g.last_name), c.tag_code
    into u_parent, c_id, g_id, g_name, tag
    from public.kg_memberships m
    join public.kg_guardians g on g.user_id = m.user_id and g.tenant_id = t
    join public.kg_child_guardians cg on cg.guardian_id = g.id and cg.can_pickup
    join public.kg_children c on c.id = cg.child_id and c.status = 'enrolled' and c.tag_code is not null
   where m.tenant_id = t and m.role = 'parent' and m.status = 'active'
     and not exists (select 1 from public.kg_memberships s
                      where s.tenant_id = t and s.user_id = m.user_id and s.status = 'active' and s.role <> 'parent')
   order by c.created_at limit 1;
  if u_owner is null or u_educator is null or u_parent is null or c_id is null then
    raise exception 'rehearsal: the demo tenant lacks an owner, an educator or a parent-only account allowed to collect a badged child';
  end if;
  if exists (select 1 from public.kg_guardians where tenant_id = t and user_id = u_owner) then
    raise exception 'rehearsal: the demo owner is also a guardian; the not_a_parent case needs a staff account without one';
  end if;
  -- What the parent may see: every enrolled child linked to any of their
  -- guardian rows here. And a child of another family, with one of its
  -- guardians, for the leaks that must not happen.
  select count(distinct cg.child_id) into n_mine
    from public.kg_guardians g
    join public.kg_child_guardians cg on cg.guardian_id = g.id
    join public.kg_children c on c.id = cg.child_id and c.status = 'enrolled'
   where g.tenant_id = t and g.user_id = u_parent;
  select c.id, cg.guardian_id into c_other, g_other
    from public.kg_children c
    join public.kg_child_guardians cg on cg.child_id = c.id
   where c.tenant_id = t and c.status = 'enrolled'
     and not exists (select 1 from public.kg_child_guardians x join public.kg_guardians g on g.id = x.guardian_id
                      where x.child_id = c.id and g.user_id = u_parent)
   order by c.created_at limit 1;
  if c_other is null then raise exception 'rehearsal: the demo tenant has no child outside the parent''s family'; end if;
  -- A second parent-only account, of another family: section i) links its
  -- guardian row to the child for a moment and makes it the co-parent.
  select m.user_id, g.id into u_parent2, g_parent2
    from public.kg_memberships m
    join public.kg_guardians g on g.user_id = m.user_id and g.tenant_id = t
   where m.tenant_id = t and m.role = 'parent' and m.status = 'active' and m.user_id <> u_parent
     and not exists (select 1 from public.kg_memberships s
                      where s.tenant_id = t and s.user_id = m.user_id and s.status = 'active' and s.role <> 'parent')
     and not exists (select 1 from public.kg_child_guardians cg where cg.guardian_id = g.id and cg.child_id = c_id)
   order by g.created_at limit 1;
  if u_parent2 is null then raise exception 'rehearsal: the demo tenant has no second parent-only account for the co-parent case'; end if;
  select settings into before from public.kg_tenants where id = t;
  if not public.kg_valid_kiosk_settings(before) then
    raise exception 'rehearsal: the demo tenant already fails the shape check';
  end if;
  -- A tenant born before 0168 passes the new shape unchanged.
  if not public.kg_valid_kiosk_settings('{}'::jsonb)
     or not public.kg_valid_kiosk_settings('{"kiosk": {"door_mode": true, "floating_scan": true}}'::jsonb) then
    raise exception 'rehearsal: a settings document without the keys fails the shape';
  end if;
  today_key := lower(to_char(kg_today(), 'Dy'));

  begin
    -- a) The owner turns self check-in on; the other kiosk keys and the
    --    rest of settings survive. The confirmation off and on again. Every
    --    wrong shape refused by the CHECK (23514), never stored.
    perform set_config('request.jwt.claims', json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v := public.kg_set_kiosk_settings(t, '{"self_checkin": true}'::jsonb);
    if (v ->> 'self_checkin')::boolean is distinct from true or (v - 'self_checkin') <> coalesce(before -> 'kiosk', '{}'::jsonb) then
      raise exception 'a) the writer returned %', v;
    end if;
    v := public.kg_set_kiosk_settings(t, '{"self_pickup_confirm": false}'::jsonb);
    if (v ->> 'self_pickup_confirm')::boolean is distinct from false or (v ->> 'self_checkin')::boolean is distinct from true then
      raise exception 'a) the merge lost a field: %', v;
    end if;
    v := public.kg_set_kiosk_settings(t, '{"self_pickup_confirm": true}'::jsonb);
    foreach bad in array array[
      '{"self_checkin": "yes"}', '{"self_checkin": 1}', '{"self_checkin": null}',
      '{"self_pickup_confirm": "no"}', '{"self_pickup_confirm": 0}', '{"self_pickup_confirm": null}',
      '{"self_check_in": true}', '{"self_checkin": true, "colour": "red"}'
    ] loop
      begin
        perform public.kg_set_kiosk_settings(t, bad::jsonb);
        raise exception 'a) % was accepted', bad;
      exception when check_violation then null;
      end;
    end loop;
    execute 'reset role';
    select settings into after from public.kg_tenants where id = t;
    if (after - 'kiosk') <> (before - 'kiosk') then
      raise exception 'a) another key of settings changed: % → %', before - 'kiosk', after - 'kiosk';
    end if;
    if (after -> 'kiosk' ->> 'self_checkin')::boolean is distinct from true
       or (after -> 'kiosk' ->> 'self_pickup_confirm')::boolean is distinct from true
       or after -> 'kiosk' ? 'self_check_in' or after -> 'kiosk' ? 'colour' then
      raise exception 'a) a refused write left a trace: %', after -> 'kiosk';
    end if;

    -- b) Codes. Two stale rows first: one expired two hours ago (swept by
    --    the next issue), one thirty minutes ago (kept). The owner and the
    --    educator each get 12 symbols of the alphabet, 90 s ahead, distinct;
    --    a parent, nobody, a null tenant and a tenant with the switch off
    --    get nothing.
    insert into public.kg_door_codes (tenant_id, code, issued_by, expires_at)
    values (t, 'REHEARSAL2222', u_owner, now() - interval '2 hours'),
           (t, 'REHEARSAL3333', u_owner, now() - interval '30 minutes');
    perform set_config('request.jwt.claims', json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v := public.kg_door_code_issue(t);
    execute 'reset role';
    code1 := v ->> 'code';
    if code1 !~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{12}$' or (v ->> 'ttl_seconds')::int is distinct from 90
       or abs(extract(epoch from ((v ->> 'expires_at')::timestamptz - (now() + interval '90 seconds')))) > 2 then
      raise exception 'b) the owner''s code: %', v;
    end if;
    perform set_config('request.jwt.claims', json_build_object('sub', u_educator, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v := public.kg_door_code_issue(t);
    execute 'reset role';
    code2 := v ->> 'code';
    if code2 !~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{12}$' or code2 = code1 then raise exception 'b) the educator''s code: %', v; end if;
    if exists (select 1 from public.kg_door_codes where code = 'REHEARSAL2222')
       or not exists (select 1 from public.kg_door_codes where code = 'REHEARSAL3333')
       or not exists (select 1 from public.kg_door_codes where code = code1 and tenant_id = t and issued_by = u_owner)
       or not exists (select 1 from public.kg_door_codes where code = code2 and tenant_id = t and issued_by = u_educator) then
      raise exception 'b) the sweep or the rows are wrong';
    end if;
    perform set_config('request.jwt.claims', json_build_object('sub', u_parent, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    begin
      perform public.kg_door_code_issue(t);
      raise exception 'b) a parent was issued a code';
    exception when insufficient_privilege then null;
    end;
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    execute 'set local role authenticated';
    begin
      perform public.kg_door_code_issue(t);
      raise exception 'b) an anonymous session was issued a code';
    exception when insufficient_privilege then null;
    end;
    execute 'reset role';
    perform set_config('request.jwt.claims', json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    begin
      perform public.kg_door_code_issue(null);
      raise exception 'b) a null tenant was issued a code';
    exception when insufficient_privilege then null;
    end;
    perform public.kg_set_kiosk_settings(t, '{"self_checkin": false}'::jsonb);
    perform set_config('request.jwt.claims', json_build_object('sub', u_educator, 'role', 'authenticated')::text, true);
    begin
      perform public.kg_door_code_issue(t);
      raise exception 'b) a code was issued with self check-in off';
    exception when others then if sqlerrm <> 'self_checkin_off' then raise; end if;
    end;
    perform set_config('request.jwt.claims', json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
    perform public.kg_set_kiosk_settings(t, '{"self_checkin": true}'::jsonb);
    execute 'reset role';

    -- c) The peek. The child's day is cleared and today's hours widened
    --    (both undone with the rest). The parent sees exactly their
    --    children, this one with today's nulls; lower case and blanks
    --    around the code are fine; the owner, who is nobody's guardian
    --    here, is `not_a_parent`; a tampered, empty or null code is
    --    `unknown_code`; a code past its time is `expired_code` for the
    --    peek and for a pass alike.
    delete from public.kg_attendance where child_id = c_id and date = kg_today();
    update public.kg_tenants
       set opening_hours = opening_hours || jsonb_build_object(today_key, '{"open": "00:00", "close": "23:59"}'::jsonb)
     where id = t;
    perform set_config('request.jwt.claims', json_build_object('sub', u_parent, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v := public.kg_door_peek(lower(' ' || code1 || ' '));
    execute 'reset role';
    if (v ->> 'tenant_id')::uuid is distinct from t
       or v ->> 'tenant_name' is distinct from (select name from public.kg_tenants where id = t)
       or (v ->> 'self_pickup_confirm')::boolean is distinct from true
       or (v ->> 'expires_at')::timestamptz is distinct from (select expires_at from public.kg_door_codes where code = code1)
       or jsonb_typeof(v -> 'children') is distinct from 'array' or jsonb_array_length(v -> 'children') is distinct from n_mine then
      raise exception 'c) the peek: %', v;
    end if;
    if exists (select 1 from jsonb_array_elements(v -> 'children') e
                where not exists (select 1 from public.kg_guardians g join public.kg_child_guardians cg on cg.guardian_id = g.id
                                   where g.tenant_id = t and g.user_id = u_parent and cg.child_id = (e ->> 'id')::uuid)) then
      raise exception 'c) the peek listed another family''s child: %', v -> 'children';
    end if;
    select e into item from jsonb_array_elements(v -> 'children') e where (e ->> 'id')::uuid = c_id;
    if item is null or jsonb_typeof(item -> 'check_in_at') is distinct from 'null' or jsonb_typeof(item -> 'check_out_at') is distinct from 'null'
       or jsonb_typeof(item -> 'handover') is distinct from 'null' or (item ->> 'can_pickup')::boolean is distinct from true
       or not (item ? 'first_name' and item ? 'last_name' and item ? 'photo_path') then
      raise exception 'c) the child before the day: %', item;
    end if;
    perform set_config('request.jwt.claims', json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    begin
      perform public.kg_door_peek(code1);
      raise exception 'c) the owner peeked as a parent';
    exception when others then if sqlerrm <> 'not_a_parent' then raise; end if;
    end;
    perform set_config('request.jwt.claims', '', true);
    begin
      perform public.kg_door_peek(code1);
      raise exception 'c) an anonymous session peeked';
    exception when others then if sqlerrm <> 'not_a_parent' then raise; end if;
    end;
    perform set_config('request.jwt.claims', json_build_object('sub', u_parent, 'role', 'authenticated')::text, true);
    foreach bad in array array[left(code1, 11) || case when right(code1, 1) = 'A' then 'B' else 'A' end, '', ' ', 'ABC'] loop
      begin
        perform public.kg_door_peek(bad);
        raise exception 'c) % was accepted as a code', bad;
      exception when others then if sqlerrm <> 'unknown_code' then raise; end if;
      end;
    end loop;
    begin
      perform public.kg_door_peek(null);
      raise exception 'c) a null code was accepted';
    exception when others then if sqlerrm <> 'unknown_code' then raise; end if;
    end;
    execute 'reset role';
    update public.kg_door_codes set expires_at = now() - interval '1 second' where code = code2;
    execute 'set local role authenticated';
    begin
      perform public.kg_door_peek(code2);
      raise exception 'c) an expired code was peeked';
    exception when others then if sqlerrm <> 'expired_code' then raise; end if;
    end;
    begin
      perform public.kg_checkin_self(code2, c_id, 'in');
      raise exception 'c) an expired code recorded a pass';
    exception when others then if sqlerrm <> 'expired_code' then raise; end if;
    end;

    -- d) The parent's arrival. A bad or null direction, another family's
    --    child and an unknown child are refused; the pass is recorded with
    --    the method `parent`, the parent's user and their guardian row; a
    --    second one is the fact `already_in`; the peek now shows the moment.
    begin
      perform public.kg_checkin_self(code1, c_id, 'up');
      raise exception 'd) a bad direction was accepted';
    exception when others then if sqlerrm <> 'invalid_direction' then raise; end if;
    end;
    begin
      perform public.kg_checkin_self(code1, c_id, null);
      raise exception 'd) a null direction was accepted';
    exception when others then if sqlerrm <> 'invalid_direction' then raise; end if;
    end;
    begin
      perform public.kg_checkin_self(code1, c_other, 'in');
      raise exception 'd) the parent recorded another family''s child';
    exception when insufficient_privilege then null;
    end;
    begin
      perform public.kg_checkin_self(code1, gen_random_uuid(), 'in');
      raise exception 'd) an unknown child was accepted';
    exception when insufficient_privilege then null;
    end;
    r := public.kg_checkin_self(code1, c_id, 'in');
    execute 'reset role';
    if (r ->> 'duplicate')::boolean is distinct from false or r ->> 'direction' is distinct from 'in'
       or (r ->> 'child_id')::uuid is distinct from c_id or r ->> 'at' is null then
      raise exception 'd) the arrival: %', r;
    end if;
    select * into att from public.kg_attendance where child_id = c_id and date = kg_today();
    if att.check_in_at is null or att.check_in_method is distinct from 'parent'::kg_checkin_method
       or att.checked_in_by is distinct from u_parent or att.checked_in_guardian_id is distinct from g_id
       or att.check_out_at is not null or att.status is distinct from 'present'::kg_attendance_status then
      raise exception 'd) the row after the arrival: %', to_jsonb(att);
    end if;
    execute 'set local role authenticated';
    r := public.kg_checkin_self(code1, c_id, 'in');
    if (r ->> 'duplicate')::boolean is distinct from true or r ->> 'reason' is distinct from 'already_in' then
      raise exception 'd) the second arrival: %', r;
    end if;
    v := public.kg_door_peek(code1);
    execute 'reset role';
    select e into item from jsonb_array_elements(v -> 'children') e where (e ->> 'id')::uuid = c_id;
    if (item ->> 'check_in_at')::timestamptz is distinct from att.check_in_at or jsonb_typeof(item -> 'check_out_at') is distinct from 'null' then
      raise exception 'd) the peek after the arrival: %', item;
    end if;

    -- e) The departure becomes a hand-over. Asked straight after the
    --    arrival, the staff's confirm meets `just_arrived` and the request
    --    stays pending; the arrival is then moved back an hour. Asking
    --    again refreshes the same row. The parent and the staff read it,
    --    the staff's list carries the child and the guardian, a parent
    --    cannot decide, a bad decision is refused, the confirm records the
    --    departure with the STAFF user and the GUARDIAN, and the row and
    --    the parent's poll both say confirmed.
    perform set_config('request.jwt.claims', json_build_object('sub', u_parent, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    r := public.kg_checkin_self(code1, c_id, 'out');
    if (r ->> 'pending')::boolean is distinct from true or r ->> 'handover_id' is null or r ->> 'direction' is distinct from 'out'
       or abs(extract(epoch from ((r ->> 'expires_at')::timestamptz - (now() + interval '10 minutes')))) > 2 then
      raise exception 'e) the first request: %', r;
    end if;
    h1 := (r ->> 'handover_id')::uuid; exp1 := (r ->> 'expires_at')::timestamptz;
    perform set_config('request.jwt.claims', json_build_object('sub', u_educator, 'role', 'authenticated')::text, true);
    r := public.kg_handover_decide(h1, 'confirm');
    execute 'reset role';
    if (r ->> 'duplicate')::boolean is distinct from true or r ->> 'reason' is distinct from 'just_arrived' or r ->> 'handover' is distinct from 'pending' then
      raise exception 'e) confirming a child who just arrived: %', r;
    end if;
    select * into ho from public.kg_handovers where id = h1;
    if ho.status is distinct from 'pending' or ho.decided_by is not null then raise exception 'e) the row after just_arrived: %', to_jsonb(ho); end if;
    update public.kg_attendance set check_in_at = check_in_at - interval '1 hour' where child_id = c_id and date = kg_today();
    perform set_config('request.jwt.claims', json_build_object('sub', u_parent, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    r := public.kg_checkin_self(code1, c_id, 'out');
    if (r ->> 'handover_id')::uuid is distinct from h1 or (r ->> 'expires_at')::timestamptz < exp1 then
      raise exception 'e) the second request did not refresh the first: %', r;
    end if;
    v := public.kg_handover_status(h1);
    if (v ->> 'id')::uuid is distinct from h1 or v ->> 'status' is distinct from 'pending'
       or jsonb_typeof(v -> 'check_out_at') is distinct from 'null' or jsonb_typeof(v -> 'decided_at') is distinct from 'null'
       or v ->> 'requested_at' is null or v ->> 'expires_at' is null then
      raise exception 'e) the parent''s status: %', v;
    end if;
    v := public.kg_door_peek(code1);
    select e into item from jsonb_array_elements(v -> 'children') e where (e ->> 'id')::uuid = c_id;
    if (item -> 'handover' ->> 'id')::uuid is distinct from h1 or item -> 'handover' ->> 'status' is distinct from 'pending' then
      raise exception 'e) the peek does not show the request: %', item;
    end if;
    begin
      perform public.kg_handovers_pending(t);
      raise exception 'e) a parent read the staff''s list';
    exception when insufficient_privilege then null;
    end;
    begin
      perform public.kg_handover_decide(h1, 'confirm');
      raise exception 'e) a parent confirmed a hand-over';
    exception when insufficient_privilege then null;
    end;
    perform set_config('request.jwt.claims', json_build_object('sub', u_educator, 'role', 'authenticated')::text, true);
    v := public.kg_handover_status(h1);
    if v ->> 'status' is distinct from 'pending' then raise exception 'e) the staff''s status: %', v; end if;
    v := public.kg_handovers_pending(t);
    if jsonb_typeof(v) is distinct from 'array' or jsonb_array_length(v) is distinct from 1 then
      raise exception 'e) the staff''s list: %', v;
    end if;
    item := v -> 0;
    if (item ->> 'id')::uuid is distinct from h1 or item ->> 'requested_at' is null or item ->> 'expires_at' is null
       or (item -> 'child' ->> 'id')::uuid is distinct from c_id
       or not (item -> 'child' ? 'first_name' and item -> 'child' ? 'last_name' and item -> 'child' ? 'photo_path' and item -> 'child' ? 'class_name')
       or (item -> 'guardian' ->> 'id')::uuid is distinct from g_id
       or not (item -> 'guardian' ? 'first_name' and item -> 'guardian' ? 'last_name' and item -> 'guardian' ? 'first_name_ar'
               and item -> 'guardian' ? 'last_name_ar' and item -> 'guardian' ? 'relationship' and item -> 'guardian' ? 'photo_path')
       or item -> 'guardian' ->> 'phone' is null then
      raise exception 'e) the card: %', item;
    end if;
    begin
      perform public.kg_handover_decide(h1, 'maybe');
      raise exception 'e) a bad decision was accepted';
    exception when others then if sqlerrm <> 'invalid_decision' then raise; end if;
    end;
    begin
      perform public.kg_handover_decide(h1, null);
      raise exception 'e) a null decision was accepted';
    exception when others then if sqlerrm <> 'invalid_decision' then raise; end if;
    end;
    select * into ho from public.kg_handovers where id = h1;
    if ho.status is distinct from 'pending' or ho.decided_by is not null
       or (select check_out_at from public.kg_attendance where child_id = c_id and date = kg_today()) is not null then
      raise exception 'e) a bad decision left a trace: %', to_jsonb(ho);
    end if;
    r := public.kg_handover_decide(h1, 'confirm');
    if (r ->> 'duplicate')::boolean is distinct from false or r ->> 'direction' is distinct from 'out'
       or r ->> 'handover' is distinct from 'confirmed' or r ->> 'at' is null or r ->> 'guardian_name' is distinct from g_name then
      raise exception 'e) the confirm: %', r;
    end if;
    begin
      perform public.kg_handover_decide(h1, 'confirm');
      raise exception 'e) a hand-over was confirmed twice';
    exception when others then if sqlerrm <> 'not_pending' then raise; end if;
    end;
    execute 'reset role';
    select * into att from public.kg_attendance where child_id = c_id and date = kg_today();
    if att.check_out_at is null or att.checked_out_by is distinct from u_educator or att.checked_out_guardian_id is distinct from g_id
       or att.check_out_method is distinct from 'parent'::kg_checkin_method or att.picked_up_by is distinct from g_name
       or att.check_in_method is distinct from 'parent'::kg_checkin_method or att.checked_in_by is distinct from u_parent then
      raise exception 'e) the row after the confirm: %', to_jsonb(att);
    end if;
    select * into ho from public.kg_handovers where id = h1;
    if ho.status is distinct from 'confirmed' or ho.decided_by is distinct from u_educator or ho.decided_at is null
       or ho.guardian_id is distinct from g_id or ho.requested_by is distinct from u_parent
       or ho.door_code_id is distinct from (select id from public.kg_door_codes where code = code1) then
      raise exception 'e) the row of the hand-over: %', to_jsonb(ho);
    end if;
    perform set_config('request.jwt.claims', json_build_object('sub', u_parent, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v := public.kg_handover_status(h1);
    if v ->> 'status' is distinct from 'confirmed' or (v ->> 'check_out_at')::timestamptz is distinct from att.check_out_at or v ->> 'decided_at' is null then
      raise exception 'e) the parent''s status after the confirm: %', v;
    end if;
    r := public.kg_checkin_self(code1, c_id, 'out');
    if (r ->> 'duplicate')::boolean is distinct from true or r ->> 'reason' is distinct from 'already_out'
       or (r ->> 'check_out_at')::timestamptz is distinct from att.check_out_at then
      raise exception 'e) asking again once out: %', r;
    end if;
    perform set_config('request.jwt.claims', json_build_object('sub', u_educator, 'role', 'authenticated')::text, true);
    v := public.kg_handovers_pending(t);
    execute 'reset role';
    if jsonb_array_length(v) is distinct from 0 then raise exception 'e) the list after the confirm: %', v; end if;

    -- f) Refused: the day reopened, a new request, the educator refuses;
    --    nothing is written, the parent reads `refused` and cannot cancel.
    update public.kg_attendance
       set check_out_at = null, check_out_method = null, checked_out_by = null, checked_out_guardian_id = null, picked_up_by = null
     where child_id = c_id and date = kg_today();
    perform set_config('request.jwt.claims', json_build_object('sub', u_parent, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    r := public.kg_checkin_self(code1, c_id, 'out');
    h2 := (r ->> 'handover_id')::uuid;
    if (r ->> 'pending')::boolean is distinct from true or h2 is null or h2 = h1 then raise exception 'f) the request: %', r; end if;
    perform set_config('request.jwt.claims', json_build_object('sub', u_educator, 'role', 'authenticated')::text, true);
    r := public.kg_handover_decide(h2, 'refuse');
    execute 'reset role';
    if r ->> 'handover' is distinct from 'refused' or (r ->> 'id')::uuid is distinct from h2 then raise exception 'f) the refuse: %', r; end if;
    select * into ho from public.kg_handovers where id = h2;
    if ho.status is distinct from 'refused' or ho.decided_by is distinct from u_educator then raise exception 'f) the row: %', to_jsonb(ho); end if;
    if (select check_out_at from public.kg_attendance where child_id = c_id and date = kg_today()) is not null then
      raise exception 'f) a refused hand-over wrote a departure';
    end if;
    perform set_config('request.jwt.claims', json_build_object('sub', u_parent, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v := public.kg_handover_status(h2);
    if v ->> 'status' is distinct from 'refused' then raise exception 'f) the parent''s status: %', v; end if;
    begin
      perform public.kg_handover_cancel(h2);
      raise exception 'f) a refused hand-over was cancelled';
    exception when others then if sqlerrm <> 'not_pending' then raise; end if;
    end;

    -- g) Expired: a request moved past its time is gone from the list,
    --    reads `expired` and cannot be decided.
    r := public.kg_checkin_self(code1, c_id, 'out');
    h3 := (r ->> 'handover_id')::uuid;
    if (r ->> 'pending')::boolean is distinct from true or h3 in (h1, h2) then raise exception 'g) the request: %', r; end if;
    execute 'reset role';
    update public.kg_handovers set expires_at = now() - interval '1 second' where id = h3;
    perform set_config('request.jwt.claims', json_build_object('sub', u_educator, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v := public.kg_handovers_pending(t);
    if jsonb_array_length(v) is distinct from 0 then raise exception 'g) the list still shows an expired request: %', v; end if;
    begin
      perform public.kg_handover_decide(h3, 'confirm');
      raise exception 'g) an expired hand-over was confirmed';
    exception when others then if sqlerrm <> 'not_pending' then raise; end if;
    end;
    perform set_config('request.jwt.claims', json_build_object('sub', u_parent, 'role', 'authenticated')::text, true);
    v := public.kg_handover_status(h3);
    if v ->> 'status' is distinct from 'expired' then raise exception 'g) the parent''s status: %', v; end if;
    execute 'reset role';
    if (select status from public.kg_handovers where id = h3) is distinct from 'expired' then raise exception 'g) the row was not flipped'; end if;

    -- h) Cancelled: the parent withdraws; twice is `not_pending`, and so is
    --    the staff's decision afterwards. Somebody else's request cannot be
    --    withdrawn by the owner, and an unknown id answers unknown_handover.
    perform set_config('request.jwt.claims', json_build_object('sub', u_parent, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    r := public.kg_checkin_self(code1, c_id, 'out');
    h4 := (r ->> 'handover_id')::uuid;
    if (r ->> 'pending')::boolean is distinct from true or h4 in (h1, h2, h3) then raise exception 'h) the request: %', r; end if;
    v := public.kg_handover_cancel(h4);
    if (v ->> 'id')::uuid is distinct from h4 or v ->> 'status' is distinct from 'cancelled' then raise exception 'h) the cancel: %', v; end if;
    v := public.kg_handover_status(h4);
    if v ->> 'status' is distinct from 'cancelled' then raise exception 'h) the status: %', v; end if;
    begin
      perform public.kg_handover_cancel(h4);
      raise exception 'h) a hand-over was cancelled twice';
    exception when others then if sqlerrm <> 'not_pending' then raise; end if;
    end;
    perform set_config('request.jwt.claims', json_build_object('sub', u_educator, 'role', 'authenticated')::text, true);
    begin
      perform public.kg_handover_decide(h4, 'refuse');
      raise exception 'h) a cancelled hand-over was decided';
    exception when others then if sqlerrm <> 'not_pending' then raise; end if;
    end;
    perform set_config('request.jwt.claims', json_build_object('sub', u_parent, 'role', 'authenticated')::text, true);
    r := public.kg_checkin_self(code1, c_id, 'out');
    h5 := (r ->> 'handover_id')::uuid;
    if (r ->> 'pending')::boolean is distinct from true or h5 in (h1, h2, h3, h4) then raise exception 'h) the fifth request: %', r; end if;
    perform set_config('request.jwt.claims', json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
    begin
      perform public.kg_handover_cancel(h5);
      raise exception 'h) the owner cancelled a parent''s request';
    exception when insufficient_privilege then null;
    end;
    begin
      perform public.kg_handover_status(gen_random_uuid());
      raise exception 'h) an unknown hand-over was read';
    exception when others then if sqlerrm <> 'unknown_handover' then raise; end if;
    end;
    v := public.kg_handover_status(h5);
    if v ->> 'status' is distinct from 'pending' then raise exception 'h) the owner''s status: %', v; end if;
    perform set_config('request.jwt.claims', json_build_object('sub', u_parent, 'role', 'authenticated')::text, true);
    v := public.kg_handover_cancel(h5);
    execute 'reset role';
    if v ->> 'status' is distinct from 'cancelled' then raise exception 'h) the parent''s cancel: %', v; end if;

    -- i) The co-parent. A parent of another family is nobody here: cannot
    --    read the request, cannot ask for the child, sees no row of it.
    --    Linked to the child (no demo child has two guardians who BOTH hold
    --    an account, so the link is staged), the same account asks at the
    --    door and takes the request over — same row, their guardian on the
    --    card — while the first parent's poll keeps answering and their
    --    cancel still lands; the co-parent then reads `cancelled`. The link
    --    is removed again.
    perform set_config('request.jwt.claims', json_build_object('sub', u_parent, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    r := public.kg_checkin_self(code1, c_id, 'out');
    h6 := (r ->> 'handover_id')::uuid;
    if (r ->> 'pending')::boolean is distinct from true or h6 in (h1, h2, h3, h4, h5) then raise exception 'i) the request: %', r; end if;
    perform set_config('request.jwt.claims', json_build_object('sub', u_parent2, 'role', 'authenticated')::text, true);
    begin
      perform public.kg_handover_status(h6);
      raise exception 'i) a stranger read the request';
    exception when insufficient_privilege then null;
    end;
    begin
      perform public.kg_handover_cancel(h6);
      raise exception 'i) a stranger cancelled the request';
    exception when insufficient_privilege then null;
    end;
    begin
      perform public.kg_checkin_self(code1, c_id, 'out');
      raise exception 'i) a stranger asked for the child';
    exception when insufficient_privilege then null;
    end;
    if (select count(*) from public.kg_handovers where child_id = c_id) <> 0 then raise exception 'i) a stranger reads the family''s hand-overs'; end if;
    execute 'reset role';
    insert into public.kg_child_guardians (child_id, guardian_id, can_pickup) values (c_id, g_parent2, true);
    execute 'set local role authenticated';
    r := public.kg_checkin_self(code1, c_id, 'out');
    if (r ->> 'pending')::boolean is distinct from true or (r ->> 'handover_id')::uuid is distinct from h6 then
      raise exception 'i) the co-parent''s request did not take over the first: %', r;
    end if;
    if (select count(*) from public.kg_handovers where child_id = c_id) = 0 then raise exception 'i) the co-parent reads none of the family''s hand-overs'; end if;
    execute 'reset role';
    select * into ho from public.kg_handovers where id = h6;
    if ho.status is distinct from 'pending' or ho.guardian_id is distinct from g_parent2 or ho.requested_by is distinct from u_parent2 then
      raise exception 'i) the row after the take-over: %', to_jsonb(ho);
    end if;
    perform set_config('request.jwt.claims', json_build_object('sub', u_educator, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v := public.kg_handovers_pending(t);
    if jsonb_array_length(v) is distinct from 1 or (v -> 0 -> 'guardian' ->> 'id')::uuid is distinct from g_parent2 then
      raise exception 'i) the card does not show the person at the door: %', v;
    end if;
    perform set_config('request.jwt.claims', json_build_object('sub', u_parent, 'role', 'authenticated')::text, true);
    v := public.kg_handover_status(h6);
    if v ->> 'status' is distinct from 'pending' then raise exception 'i) the first parent''s poll after the take-over: %', v; end if;
    v := public.kg_handover_cancel(h6);
    if v ->> 'status' is distinct from 'cancelled' then raise exception 'i) the first parent''s cancel after the take-over: %', v; end if;
    perform set_config('request.jwt.claims', json_build_object('sub', u_parent2, 'role', 'authenticated')::text, true);
    v := public.kg_handover_status(h6);
    if v ->> 'status' is distinct from 'cancelled' then raise exception 'i) the co-parent''s poll after the cancel: %', v; end if;
    execute 'reset role';
    delete from public.kg_child_guardians where child_id = c_id and guardian_id = g_parent2;

    -- j) The confirmation off: the departure is recorded at once, by the
    --    parent, with their guardian row.
    perform set_config('request.jwt.claims', json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    perform public.kg_set_kiosk_settings(t, '{"self_pickup_confirm": false}'::jsonb);
    perform set_config('request.jwt.claims', json_build_object('sub', u_parent, 'role', 'authenticated')::text, true);
    v := public.kg_door_peek(code1);
    if (v ->> 'self_pickup_confirm')::boolean is distinct from false then raise exception 'j) the peek does not say the confirmation is off: %', v ->> 'self_pickup_confirm'; end if;
    r := public.kg_checkin_self(code1, c_id, 'out');
    execute 'reset role';
    if (r ->> 'duplicate')::boolean is distinct from false or r ->> 'direction' is distinct from 'out' or r ? 'pending' or r ->> 'at' is null then
      raise exception 'j) the direct departure: %', r;
    end if;
    select * into att from public.kg_attendance where child_id = c_id and date = kg_today();
    if att.check_out_at is null or att.check_out_method is distinct from 'parent'::kg_checkin_method
       or att.checked_out_by is distinct from u_parent or att.checked_out_guardian_id is distinct from g_id or att.picked_up_by is distinct from g_name then
      raise exception 'j) the row after the direct departure: %', to_jsonb(att);
    end if;
    perform set_config('request.jwt.claims', json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    perform public.kg_set_kiosk_settings(t, '{"self_pickup_confirm": true}'::jsonb);
    execute 'reset role';

    -- k) can_pickup off: the departure is `pickup_not_allowed` with the
    --    confirmation on and off alike (one gate, before the roads part;
    --    the writer's own would refuse too), no request is created, the
    --    peek says so.
    update public.kg_attendance
       set check_out_at = null, check_out_method = null, checked_out_by = null, checked_out_guardian_id = null, picked_up_by = null
     where child_id = c_id and date = kg_today();
    update public.kg_child_guardians set can_pickup = false where child_id = c_id and guardian_id = g_id;
    perform set_config('request.jwt.claims', json_build_object('sub', u_parent, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    r := public.kg_checkin_self(code1, c_id, 'out');
    if (r ->> 'refused')::boolean is distinct from true or r ->> 'reason' is distinct from 'pickup_not_allowed'
       or (r ->> 'child_id')::uuid is distinct from c_id or r ->> 'direction' is distinct from 'out' then
      raise exception 'k) can_pickup off, confirmation on: %', r;
    end if;
    v := public.kg_door_peek(code1);
    select e into item from jsonb_array_elements(v -> 'children') e where (e ->> 'id')::uuid = c_id;
    if (item ->> 'can_pickup')::boolean is distinct from false then raise exception 'k) the peek: %', item; end if;
    perform set_config('request.jwt.claims', json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
    perform public.kg_set_kiosk_settings(t, '{"self_pickup_confirm": false}'::jsonb);
    perform set_config('request.jwt.claims', json_build_object('sub', u_parent, 'role', 'authenticated')::text, true);
    r := public.kg_checkin_self(code1, c_id, 'out');
    if (r ->> 'refused')::boolean is distinct from true or r ->> 'reason' is distinct from 'pickup_not_allowed' then
      raise exception 'k) can_pickup off, confirmation off: %', r;
    end if;
    perform set_config('request.jwt.claims', json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
    perform public.kg_set_kiosk_settings(t, '{"self_pickup_confirm": true}'::jsonb);
    execute 'reset role';
    if exists (select 1 from public.kg_handovers where child_id = c_id and status = 'pending')
       or (select check_out_at from public.kg_attendance where child_id = c_id and date = kg_today()) is not null then
      raise exception 'k) a refused departure left a trace';
    end if;
    update public.kg_child_guardians set can_pickup = true where child_id = c_id and guardian_id = g_id;

    -- l) Not arrived: no row today, a departure is refused as a fact — with
    --    the confirmation on and, above all, off, where the writer alone
    --    would have marked an absent child present on the parent's word;
    --    no row is created either way.
    delete from public.kg_attendance where child_id = c_id and date = kg_today();
    perform set_config('request.jwt.claims', json_build_object('sub', u_parent, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    r := public.kg_checkin_self(code1, c_id, 'out');
    if (r ->> 'refused')::boolean is distinct from true or r ->> 'reason' is distinct from 'not_arrived' or r ->> 'direction' is distinct from 'out' then
      raise exception 'l) not arrived, confirmation on: %', r;
    end if;
    perform set_config('request.jwt.claims', json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
    perform public.kg_set_kiosk_settings(t, '{"self_pickup_confirm": false}'::jsonb);
    perform set_config('request.jwt.claims', json_build_object('sub', u_parent, 'role', 'authenticated')::text, true);
    r := public.kg_checkin_self(code1, c_id, 'out');
    if (r ->> 'refused')::boolean is distinct from true or r ->> 'reason' is distinct from 'not_arrived' or r ? 'at' then
      raise exception 'l) not arrived, confirmation off: %', r;
    end if;
    perform set_config('request.jwt.claims', json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
    perform public.kg_set_kiosk_settings(t, '{"self_pickup_confirm": true}'::jsonb);
    execute 'reset role';
    if exists (select 1 from public.kg_attendance where child_id = c_id and date = kg_today())
       or exists (select 1 from public.kg_handovers where child_id = c_id and status = 'pending') then
      raise exception 'l) a refused departure wrote a row for a child who never arrived';
    end if;

    -- m) The tag path, key set by key set as before the rewrite: recorded,
    --    the four duplicates, the forced departure and the forced arrival
    --    that clears it, the custody refusal, the hours, the closed day,
    --    and its three exceptions.
    perform set_config('request.jwt.claims', json_build_object('sub', u_educator, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    r := public.kg_checkin_by_tag(t, tag, 'in', 'kiosk', null, null, false);
    keys := (select array_agg(k order by k collate "C") from jsonb_object_keys(r) k);
    if keys <> k_recorded or (r ->> 'duplicate')::boolean is distinct from false or r ->> 'direction' is distinct from 'in' then
      raise exception 'm) the recorded arrival: %', r;
    end if;
    execute 'reset role';
    select * into att from public.kg_attendance where child_id = c_id and date = kg_today();
    if att.check_in_method is distinct from 'kiosk'::kg_checkin_method or att.checked_in_by is distinct from u_educator or att.checked_in_guardian_id is not null then
      raise exception 'm) the row after the tag arrival: %', to_jsonb(att);
    end if;
    execute 'set local role authenticated';
    r := public.kg_checkin_by_tag(t, tag, 'in', 'kiosk');
    keys := (select array_agg(k order by k collate "C") from jsonb_object_keys(r) k);
    if keys <> k_duplicate or r ->> 'reason' is distinct from 'already_in' then raise exception 'm) already_in: %', r; end if;
    r := public.kg_checkin_by_tag(t, tag, 'out', 'kiosk');
    keys := (select array_agg(k order by k collate "C") from jsonb_object_keys(r) k);
    if keys <> k_duplicate or r ->> 'reason' is distinct from 'just_arrived' then raise exception 'm) just_arrived: %', r; end if;
    r := public.kg_checkin_by_tag(t, tag, 'out', 'kiosk', null, null, true);
    keys := (select array_agg(k order by k collate "C") from jsonb_object_keys(r) k);
    if keys <> k_recorded or r ->> 'direction' is distinct from 'out' then raise exception 'm) the forced departure: %', r; end if;
    r := public.kg_checkin_by_tag(t, tag, 'out', 'kiosk');
    if r ->> 'reason' is distinct from 'already_out' then raise exception 'm) already_out: %', r; end if;
    r := public.kg_checkin_by_tag(t, tag, 'in', 'kiosk');
    keys := (select array_agg(k order by k collate "C") from jsonb_object_keys(r) k);
    if keys <> k_duplicate or r ->> 'reason' is distinct from 'returned' then raise exception 'm) returned: %', r; end if;
    execute 'reset role';
    select * into att from public.kg_attendance where child_id = c_id and date = kg_today();
    if att.check_out_at is null or att.checked_out_by is distinct from u_educator or att.check_out_method is distinct from 'kiosk'::kg_checkin_method then
      raise exception 'm) the row after the forced departure: %', to_jsonb(att);
    end if;
    execute 'set local role authenticated';
    r := public.kg_checkin_by_tag(t, tag, 'in', 'kiosk', null, null, true);
    execute 'reset role';
    if (r ->> 'duplicate')::boolean is distinct from false then raise exception 'm) the forced arrival: %', r; end if;
    if (select check_out_at is null and check_out_method is null and checked_out_by is null and checked_out_guardian_id is null and picked_up_by is null
               and check_in_at = att.check_in_at
          from public.kg_attendance where child_id = c_id and date = kg_today()) is not true then
      raise exception 'm) the forced arrival did not clear the departure: %', (select to_jsonb(a) from public.kg_attendance a where a.child_id = c_id and a.date = kg_today());
    end if;
    -- An hour later (else the departure below is `just_arrived`): the
    -- custody refusal with the guardian, then the departure that names her.
    update public.kg_attendance set check_in_at = check_in_at - interval '1 hour' where child_id = c_id and date = kg_today();
    update public.kg_child_guardians set can_pickup = false where child_id = c_id and guardian_id = g_id;
    execute 'set local role authenticated';
    r := public.kg_checkin_by_tag(t, tag, 'out', 'kiosk', null, g_id, false);
    keys := (select array_agg(k order by k collate "C") from jsonb_object_keys(r) k);
    if keys <> k_pickup or r ->> 'reason' is distinct from 'pickup_not_allowed' or r ->> 'guardian_name' is distinct from g_name then
      raise exception 'm) pickup_not_allowed: %', r;
    end if;
    execute 'reset role';
    update public.kg_child_guardians set can_pickup = true where child_id = c_id and guardian_id = g_id;
    execute 'set local role authenticated';
    r := public.kg_checkin_by_tag(t, tag, 'out', 'kiosk', null, g_id, false);
    execute 'reset role';
    if (r ->> 'duplicate')::boolean is distinct from false or r ->> 'guardian_name' is distinct from g_name then
      raise exception 'm) the departure with the guardian: %', r;
    end if;
    select * into att from public.kg_attendance where child_id = c_id and date = kg_today();
    if att.checked_out_guardian_id is distinct from g_id or att.picked_up_by is distinct from g_name or att.check_out_method is distinct from 'kiosk'::kg_checkin_method then
      raise exception 'm) the row after the guardian''s departure: %', to_jsonb(att);
    end if;
    -- The hours: a window that excludes this very moment, then a closed day.
    delete from public.kg_attendance where child_id = c_id and date = kg_today();
    update public.kg_tenants
       set opening_hours = opening_hours || jsonb_build_object(today_key,
             case when extract(hour from (now() at time zone 'Africa/Algiers')) < 12
                  then '{"open": "20:00", "close": "21:00"}'::jsonb
                  else '{"open": "01:00", "close": "02:00"}'::jsonb end)
     where id = t;
    execute 'set local role authenticated';
    r := public.kg_checkin_by_tag(t, tag, 'in', 'kiosk');
    keys := (select array_agg(k order by k collate "C") from jsonb_object_keys(r) k);
    if keys <> k_hours or r ->> 'reason' is distinct from 'outside_hours' then raise exception 'm) outside_hours: %', r; end if;
    r := public.kg_checkin_by_tag(t, tag, 'out', 'kiosk');
    if (r ->> 'duplicate')::boolean is distinct from false then raise exception 'm) a departure was blocked by the hours: %', r; end if;
    execute 'reset role';
    delete from public.kg_attendance where child_id = c_id and date = kg_today();
    update public.kg_tenants set opening_hours = opening_hours || jsonb_build_object(today_key, 'null'::jsonb) where id = t;
    execute 'set local role authenticated';
    r := public.kg_checkin_by_tag(t, tag, 'in', 'kiosk');
    keys := (select array_agg(k order by k collate "C") from jsonb_object_keys(r) k);
    if keys <> k_closed or r ->> 'reason' is distinct from 'closed_day' then raise exception 'm) closed_day: %', r; end if;
    begin
      perform public.kg_checkin_by_tag(t, 'REHEARSAL-NO-TAG', 'in', 'kiosk');
      raise exception 'm) an unknown tag was accepted';
    exception when others then if sqlerrm <> 'unknown_tag' then raise; end if;
    end;
    begin
      perform public.kg_checkin_by_tag(t, tag, 'up', 'kiosk');
      raise exception 'm) a bad direction was accepted on the tag path';
    exception when others then if sqlerrm <> 'invalid_direction' then raise; end if;
    end;
    begin
      perform public.kg_checkin_by_tag(t, tag, null, 'kiosk');
      raise exception 'm) a null direction was accepted on the tag path';
    exception when others then if sqlerrm <> 'invalid_direction' then raise; end if;
    end;
    if exists (select 1 from public.kg_attendance where child_id = c_id and date = kg_today()) then
      raise exception 'm) a refused direction wrote a row';
    end if;
    perform set_config('request.jwt.claims', json_build_object('sub', u_parent, 'role', 'authenticated')::text, true);
    begin
      perform public.kg_checkin_by_tag(t, tag, 'in', 'kiosk');
      raise exception 'm) a parent scanned a badge';
    exception when others then if sqlerrm <> 'forbidden' then raise; end if;
    end;
    execute 'reset role';

    -- n) Who may do what: the writer and the helper are nobody's; the
    --    tables refuse a direct insert (42501) and an update lands on
    --    nothing; a parent reads only their family's hand-overs and no code
    --    at all, staff read every hand-over of the tenant.
    if has_function_privilege('authenticated', 'public.kg_attendance_write(uuid,uuid,text,kg_checkin_method,text,uuid,boolean)', 'execute')
       or has_function_privilege('anon', 'public.kg_attendance_write(uuid,uuid,text,kg_checkin_method,text,uuid,boolean)', 'execute')
       or has_function_privilege('authenticated', 'public.kg_handovers_expire(uuid)', 'execute')
       or has_function_privilege('anon', 'public.kg_handovers_expire(uuid)', 'execute') then
      raise exception 'n) a client role may call the writer or the helper';
    end if;
    if not has_function_privilege('authenticated', 'public.kg_door_peek(text)', 'execute')
       or has_function_privilege('anon', 'public.kg_door_peek(text)', 'execute') then
      raise exception 'n) the grants on the RPCs are off';
    end if;
    insert into public.kg_handovers (tenant_id, child_id, guardian_id, requested_by, expires_at, status)
    values (t, c_other, g_other, u_owner, now() + interval '10 minutes', 'pending') returning id into h_other;
    select count(*) into n_all from public.kg_handovers where tenant_id = t;
    select count(*) into n_family from public.kg_handovers where child_id = c_id;
    perform set_config('request.jwt.claims', json_build_object('sub', u_parent, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    begin
      perform public.kg_attendance_write(t, c_id, 'in', 'parent', null, g_id, false);
      raise exception 'n) a client called the writer';
    exception when insufficient_privilege then null;
    end;
    begin
      insert into public.kg_door_codes (tenant_id, code, issued_by, expires_at) values (t, 'REHEARSAL4444', u_parent, now() + interval '1 day');
      raise exception 'n) a client wrote a door code';
    exception when insufficient_privilege then null;
    end;
    begin
      insert into public.kg_handovers (tenant_id, child_id, guardian_id, requested_by, expires_at, status)
      values (t, c_id, g_id, u_parent, now() + interval '1 day', 'confirmed');
      raise exception 'n) a client wrote a hand-over';
    exception when insufficient_privilege then null;
    end;
    update public.kg_handovers set status = 'confirmed' where id = h_other;
    if (select count(*) from public.kg_door_codes) <> 0 then raise exception 'n) a parent read a door code'; end if;
    if (select count(*) from public.kg_handovers) <> n_family or n_family < 6
       or exists (select 1 from public.kg_handovers where id = h_other) then
      raise exception 'n) a parent read another family''s hand-over';
    end if;
    perform set_config('request.jwt.claims', json_build_object('sub', u_educator, 'role', 'authenticated')::text, true);
    if (select count(*) from public.kg_handovers where tenant_id = t) <> n_all then raise exception 'n) the staff do not read every hand-over'; end if;
    execute 'reset role';
    if (select status from public.kg_handovers where id = h_other) is distinct from 'pending' then
      raise exception 'n) a client''s update landed on a hand-over';
    end if;

    raise exception using errcode = 'P0168', message = 'rehearsal done';
  exception when sqlstate 'P0168' then
    raise exception '0168 rehearsal ok — rolled back';
  end;
  execute 'reset role';
end $$;

notify pgrst, 'reload schema';
commit;
