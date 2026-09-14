-- 0169 — the door's code is the DAY's code, the direction is never asked,
-- one card per child.
--
-- The owner, after a day with 0168's door: a new code every 30 seconds is
-- a screen that never sits still, a parent who scans it and looks up has
-- to scan again, and the phone of a parent of three shows one card and a
-- pick list where the child in their arms should be. Three changes, all
-- in the database, so the kiosk, the portal and the two apps read the
-- same facts.
--
-- A. One code per establishment per day (Africa/Algiers), minted on the
--    first request of the morning and dead at midnight — the kiosk shows
--    it all day and a phone that read it at 08:00 reads the same at 16:30.
--    The trade-off is the owner's: a photo of today's code works until
--    midnight and not a second longer; departures still wait for a staff
--    decision, and every pass carries the parent's name. kg_door_code_issue
--    keeps its signature; the answer gains `day`, and `ttl_seconds` is the
--    time to midnight — ten seconds at 23:59:50, which is fine. 0168's
--    table, alphabet and sampling are untouched.
-- B. The direction is the child's state, not a switch: not arrived → an
--    arrival; arrived → a departure; already left → the day is over, a
--    fact, never a choice (a return is the team's call, at the kiosk); an
--    arrival under two minutes old is the fact `already_in` — a double
--    tap, the writer's own `just_arrived` window — answered before the
--    writer, so it is the fact whatever the hour. kg_checkin_self accepts
--    p_direction = 'auto' and infers it at write time, so a parent's
--    screen that went stale in a pocket cannot record the wrong move;
--    'in' and 'out' keep working exactly as in 0168.
-- C. A child's card on the parent's phone carries BOTH people in one code,
--    `<GUARDIAN_TAG>+<CHILD_TAG>` — `+` is outside the badge alphabet
--    [A-Z0-9-], so a pair can never be mistaken for a badge. The new
--    kg_kiosk_pair reads it at the kiosk: the adult through their live
--    CARD credential (qr or rfid, as kg_resolve_credential does — never a
--    keypad PIN, which fits the alphabet too), the child through the tag,
--    the link between them, the direction from the child's day, and the
--    pass through 0168's one writer with the method `kiosk` and the
--    guardian — no pick list, no countdown; a departure it records also
--    confirms the hand-over a parent may have asked for from their phone
--    a moment before, so neither screen waits on a child who has left.
--    The family card (the adult alone) keeps 0168's behaviour.
--
-- 3b. kg_attendance_write settles the child's pending hand-over on ANY
--     recorded departure (badge, card, parent's pass, staff decision) — the
--     0168 gap the reviewers carried forward.
--
-- Rehearsed on production (qekibejzwpphzzyqigzo) on 2026-09-14 through
-- execute_sql. The first two runs stopped on assertions of §6 that were
-- wrong about the functions, not the other way round (a second 'auto'
-- straight after an arrival must be `already_in`, not a hand-over — hence
-- the two-minute reading above; and an explicit 'out' straight after an
-- arrival still asks the team, as 0168 proved). After the review, three
-- fixes (the two-minute fact answered before the writer's hours gate, the
-- adult half a card and never a PIN, the card's departure confirming the
-- parent's pending hand-over) and their assertions; one more run stopped
-- on the rehearsal's own mistake (a closed day is the key set to null,
-- not removed — kg_tenants_opening_hours_shape wants seven keys). Then
-- the whole file, as it stands: every assertion of §6 held, sections a)
-- to e), and the run ended on the pass mark, verbatim "ERROR:  P0001:
-- 0169 rehearsal ok — rolled back"; afterwards kg_kiosk_pair was absent,
-- kg_door_code_issue still carried 0168's body ('90 seconds'),
-- kg_checkin_self refused 'auto', the table comment still said 90 s, and
-- no code, no attendance row, no setting, no opening hour, no hand-over,
-- no can_pickup flip, no PIN and no credential flip or touch of the demo
-- tenant persisted. The file as amended after that review — the writer
-- settles the hand-over (§3b), the card no longer does it itself, §5
-- restates the writer's revoke, d) asserts the badge's departure — was
-- run again, whole, on 2026-09-14 and ended on the same pass mark, with
-- the writer's body still free of kg_handovers afterwards and, again,
-- nothing of the demo tenant persisted. Not applied.
begin;
set local lock_timeout = '5s';

-- ── 1. The day's code ─────────────────────────────────────────────────────
-- Same callers (staff of the tenant, self_checkin on), same alphabet of 31
-- symbols, same 12 symbols by rejection sampling, same table. What changes
-- is the life of a code: it ends at the NEXT Algiers midnight — computed
-- from kg_today() (0166, Africa/Algiers) and not from the server's UTC
-- clock, so at 00:30 UTC, which is 01:30 in Algiers, the code is still
-- today's and dies at the coming midnight, not the one just gone. A live
-- code of the day is found by that very moment (expires_at = the next
-- midnight): every code this function mints today has it, and the 90-s
-- codes 0168's kiosk was still asking for at the minute this is applied
-- do not — so the first request after the deploy mints the day's code at
-- once instead of handing back a code with a minute to live. Two tablets
-- asking at the same second are serialised by an advisory lock on the
-- tenant, so exactly one code is live per tenant per day. The sweep keeps
-- a code a whole day past its end (yesterday's stays until tomorrow, so an
-- evening's audit can still match a scan to it) and never touches today's,
-- whose end is in the future by construction.
create or replace function public.kg_door_code_issue(p_tenant uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_bytes bytea; v_byte int; v_i int; v_code text; v_today date := kg_today();
  v_expires timestamptz := ((kg_today() + 1)::timestamp) at time zone 'Africa/Algiers';
begin
  if p_tenant is null or not kg_is_staff(p_tenant) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not coalesce((select (t.settings -> 'kiosk' ->> 'self_checkin')::boolean from kg_tenants t where t.id = p_tenant), false) then
    raise exception 'self_checkin_off';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('kg_door_code_issue:' || p_tenant::text, 0));

  delete from kg_door_codes where tenant_id = p_tenant and expires_at < now() - interval '1 day';

  select d.code into v_code from kg_door_codes d
   where d.tenant_id = p_tenant and d.expires_at = v_expires
   order by d.issued_at desc limit 1;

  if v_code is null then
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
  end if;

  return jsonb_build_object('code', v_code, 'expires_at', v_expires,
    'ttl_seconds', greatest(0, floor(extract(epoch from (v_expires - now()))))::int,
    'day', to_char(v_today, 'YYYY-MM-DD'));
end $$;

-- ── 2. The parent's pass, direction inferred ──────────────────────────────
-- 0168's kg_checkin_self with one more accepted direction, 'auto': the
-- child's day decides. Already left → the fact `already_out`, before any
-- other rule, because the day is over whatever the setting or can_pickup
-- says; arrived → 'out'; not arrived → 'in'. One nuance: an arrival less
-- than two minutes old is the fact `already_in`, answered here in the
-- writer's duplicate shape — a parent who tapped twice, or scanned the
-- card twice, sees "already recorded" and never opens a departure request
-- for a child who walked in a moment ago. It is the same window the
-- writer calls `just_arrived` on an explicit 'out', and the one both
-- clients grey the departure out for; it is answered before the writer
-- and not through it because the writer hears the hours before the
-- duplicates (see the comment in the body). From there the path is 0168's
-- for the inferred direction, unchanged: the hours for an arrival (a
-- parent early at the door is still refused), can_pickup, the
-- confirmation setting, the pending hand-over. `not_arrived` cannot
-- happen on 'auto' — a child who is not in is arriving. Today's row is
-- now read once, before the roads part; 0168 read it after the can_pickup
-- gate, which changes nothing for 'in' and 'out'. Parents still never
-- force.
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
      return jsonb_build_object('duplicate', true, 'reason', 'already_out',
        'child_id', v_child.id, 'first_name', v_child.first_name,
        'last_name', v_child.last_name, 'photo_path', v_child.photo_path,
        'check_in_at', v_existing.check_in_at, 'check_out_at', v_existing.check_out_at,
        'direction', 'out');
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

-- ── 3. The child's card at the kiosk ──────────────────────────────────────
-- Educators of the tenant, like a badge. The value is read as a badge is
-- (trimmed, upper-cased — a phone may hand it over in lower case) and must
-- be two codes of the badge alphabet around one `+`, else `invalid_pair`.
-- The adult is the LEFT part, resolved the way kg_resolve_credential
-- resolves a badge: an active kg_credentials row of THIS tenant, subject
-- guardian, whose guardian still exists (kg_credential_subject_live) —
-- and of a CARD's kind, qr or rfid, never pin: a parent's four-digit
-- keypad PIN matches the alphabet too, and a card is a thing one prints
-- and photographs, so a PIN never becomes one; PIN holders keep the
-- keypad. A revoked card, another tenant's card, a card of nobody and a
-- PIN are all `unknown_code`, and the credential's last_used_at is
-- touched, so the card's history reads as a badge's does. The child is the RIGHT part, by
-- tag_code among THIS tenant's enrolled children — the child's own
-- credential plays no part here, on purpose: the parent's card names the
-- child, and a child's badge that has been revoked (lost in the sandpit)
-- takes nothing away from the parent's card. A guardian tag of tenant A
-- with a child tag of tenant B is `unknown_code` too, because both are
-- looked up in p_tenant. Then the link: the adult must be a guardian of
-- THAT child, else `not_linked` — a refusal with both names and no
-- direction, and nothing written. The direction is the child's day, as in
-- §2 (already left → the fact; an arrival under two minutes old → the
-- fact `already_in`, a second scan of the card, answered before the
-- writer for the reason §2 gives), and the pass goes through 0168's
-- writer with the method `kiosk`, the educator's user and the guardian —
-- an arrival carries checked_in_guardian_id, a departure picked_up_by;
-- the writer's own gates (hours, can_pickup, the duplicates) answer in
-- their usual shapes. A departure the card records also confirms the
-- child's pending hand-over, when a parent had asked for one from their
-- phone (see the body). The writer's JSON comes back with the adult and
-- the child's tag added and `pair: true`, so the kiosk renders it with
-- the cards it has, and a duplicate other than already_out (already_in)
-- is decided by the kiosk's DuplicateCard through kg_checkin_by_tag(p_tag
-- = tag_code, p_force = true, p_guardian = guardian_id), as for a badge.
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
  if v_existing.check_out_at is not null then
    r := jsonb_build_object('duplicate', true, 'reason', 'already_out',
      'child_id', v_child.id, 'first_name', v_child.first_name,
      'last_name', v_child.last_name, 'photo_path', v_child.photo_path,
      'check_in_at', v_existing.check_in_at, 'check_out_at', v_existing.check_out_at,
      'direction', 'out');
  elsif v_existing.check_in_at is not null and now() - v_existing.check_in_at < interval '2 minutes' then
    -- The double scan, as §2 answers the double tap: the fact, not an 'in'
    -- through the writer's hours gate.
    r := jsonb_build_object('duplicate', true, 'reason', 'already_in',
      'child_id', v_child.id, 'first_name', v_child.first_name,
      'last_name', v_child.last_name, 'photo_path', v_child.photo_path,
      'check_in_at', v_existing.check_in_at, 'check_out_at', v_existing.check_out_at,
      'direction', 'in');
  else
    v_dir := case when v_existing.check_in_at is null then 'in' else 'out' end;
    r := kg_attendance_write(p_tenant, v_child.id, v_dir, 'kiosk', null, v_guardian.id, false);
    -- A departure the card recorded is the hand-over a parent may have
    -- asked for from their phone a moment earlier; the writer (§3b) settles
    -- it, as it does for a badge and for the staff's own decision.
  end if;

  return r || jsonb_build_object('guardian_id', v_guardian.id, 'guardian_name', v_gname,
    'guardian_photo_path', v_guardian.photo_path, 'tag_code', v_child.tag_code, 'pair', true);
end $$;

-- ── 3b. The writer settles the hand-over ──────────────────────────────────
-- 0168's kg_attendance_write, verbatim but for one addition at the end: a
-- recorded departure confirms the child's pending hand-over, whoever wrote
-- it. Every path that records a departure — kg_checkin_by_tag, kg_checkin_self
-- with the confirmation off, kg_kiosk_pair, kg_handover_decide (which then
-- restates the same status on its own row) — goes through here, so the rule
-- lives once. Privileges are kept by CREATE OR REPLACE; §5 restates the
-- revoke regardless.
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
    'at', case when p_direction = 'in' then v_att.check_in_at else v_att.check_out_at end,
    'guardian_name', nullif(trim(coalesce(v_guardian.first_name,'') || ' ' || coalesce(v_guardian.last_name,'')), ''));
end $$;

-- ── 4. The catalogue ──────────────────────────────────────────────────────
comment on table public.kg_door_codes is
  'The door''s code: what the kiosk shows and a parent''s phone scans. One per tenant per day (Africa/Algiers), 12 symbols of ABCDEFGHJKMNPQRSTUVWXYZ23456789, dead at the next midnight. RLS on with no policy — kg_door_code_issue / kg_door_peek / kg_checkin_self only. See 0168, 0169.';
comment on function public.kg_door_code_issue(uuid) is
  'The day''s door code for the kiosk: {code, expires_at (the next Algiers midnight), ttl_seconds (to that midnight), day (YYYY-MM-DD)} — the same code for every request of the day, minted on the first. Staff of the tenant (forbidden, 42501), self_checkin on (self_checkin_off). Sweeps the tenant''s codes expired for over a day.';
comment on function public.kg_checkin_self(text, uuid, text) is
  'The parent records a move for one of their children through a door code, method parent, never forced. p_direction in | out | auto — auto follows the child''s day: not arrived → in, arrived → out, already left → the fact already_out, arrived under 2 minutes ago → the fact already_in (a double tap, answered before the writer). in → kg_attendance_write; out → pickup_not_allowed / already_out / not_arrived as facts, then recorded through kg_attendance_write when self_pickup_confirm is off, else a pending kg_handovers row ({pending, handover_id, expires_at, ...}) — a co-parent''s request refreshes it. unknown_code / expired_code / invalid_direction / forbidden / unknown_child.';
comment on function public.kg_kiosk_pair(uuid, text) is
  'The child''s card at the kiosk: <GUARDIAN_TAG>+<CHILD_TAG>. Educators of the tenant (forbidden). The adult by their active guardian credential of the tenant, kind qr or rfid — never a PIN (unknown_code, last_used_at touched), the child by tag_code among the tenant''s enrolled children (unknown_code); the adult must be a guardian of that child ({refused, reason: not_linked}). Direction from the child''s day: not arrived → in, arrived → out, already left → the fact already_out, arrived under 2 minutes ago → the fact already_in (a double scan); then kg_attendance_write with method kiosk and the guardian — a recorded departure also confirms the child''s pending hand-over; the writer''s JSON plus guardian_id, guardian_name, guardian_photo_path, tag_code, pair: true. invalid_pair for anything but two badge codes around one +.';

-- ── 5. Who may call what ──────────────────────────────────────────────────
-- The new RPC to signed-in users only, like the others; the privileges of
-- the three replaced functions are kept by create or replace, and restated
-- so the file says what is true — the writer stays out of every client's
-- reach.
revoke all on function public.kg_attendance_write(uuid, uuid, text, kg_checkin_method, text, uuid, boolean) from public, anon, authenticated;
revoke all on function public.kg_kiosk_pair(uuid, text) from public, anon;
grant execute on function public.kg_kiosk_pair(uuid, text) to authenticated;
revoke all on function public.kg_door_code_issue(uuid) from public, anon;
grant execute on function public.kg_door_code_issue(uuid) to authenticated;
revoke all on function public.kg_checkin_self(text, uuid, text) from public, anon;
grant execute on function public.kg_checkin_self(text, uuid, text) to authenticated;

-- ── 6. Rehearsal, always rolled back ─────────────────────────────────────
-- Demo tenant only, the 0168 shape: the writes live in an inner block that
-- ends by raising P0169; the handler turns it into the pass mark, so the
-- demo tenant's settings, today's opening hours, the child's day, every
-- code staged here, the hand-overs, the credential flips and the staged
-- PIN are undone as a subtransaction whatever happens to the DDL above. Any failing
-- assertion raises something else and aborts the whole migration. As
-- written the handler raises, so the file REHEARSES: run through
-- execute_sql, the DDL and the writes roll back together and the error
-- text "0169 rehearsal ok — rolled back" is the pass mark. To apply, flip
-- that one `raise exception` to `raise notice`.
--
-- Today's opening hours are widened to 00:00–23:59 for the run (the
-- rehearsal runs at any hour; the hours rule itself was proven in 0168 §8
-- m) and is not touched here) except for two moments where today is set
-- to null — a closed day — to prove the double tap and the double scan
-- are answered as facts and not through the writer's gate; and the child's
-- arrival is moved back an hour before each departure so `just_arrived`
-- does not fire.
do $$
declare
  t uuid := '732bdf7d-775a-4ed7-875f-8c04ea4e4778';
  u_owner uuid; u_educator uuid; u_parent uuid;
  c_id uuid; g_id uuid; g_name text; tag text; gtag text; cred_id uuid;
  c_other uuid; g_other uuid; tag_other text; gtag_other text; pin text;
  v jsonb; r jsonb; bad text; keys text[]; code1 text; midnight timestamptz; used_before timestamptz;
  att kg_attendance; other_before jsonb; today_key text; h1 uuid;
  k_recorded text[] := array['at', 'child_id', 'direction', 'duplicate', 'first_name', 'guardian_name', 'last_name', 'photo_path'];
  k_duplicate text[] := array['check_in_at', 'check_out_at', 'child_id', 'direction', 'duplicate', 'first_name', 'last_name', 'photo_path', 'reason'];
  k_pair_recorded text[] := array['at', 'child_id', 'direction', 'duplicate', 'first_name', 'guardian_id', 'guardian_name', 'guardian_photo_path', 'last_name', 'pair', 'photo_path', 'tag_code'];
  k_pair_duplicate text[] := array['check_in_at', 'check_out_at', 'child_id', 'direction', 'duplicate', 'first_name', 'guardian_id', 'guardian_name', 'guardian_photo_path', 'last_name', 'pair', 'photo_path', 'reason', 'tag_code'];
  k_pair_pickup text[] := array['child_id', 'direction', 'first_name', 'guardian_id', 'guardian_name', 'guardian_photo_path', 'last_name', 'pair', 'photo_path', 'reason', 'refused', 'tag_code'];
  k_not_linked text[] := array['child_id', 'direction', 'first_name', 'guardian_name', 'last_name', 'photo_path', 'reason', 'refused'];
begin
  if not exists (select 1 from public.kg_tenants where id = t) then
    raise notice '0169 rehearsal skipped: demo tenant absent'; return;
  end if;
  select user_id into u_owner from public.kg_memberships
   where tenant_id = t and role = 'owner' and status = 'active' and user_id is not null limit 1;
  select user_id into u_educator from public.kg_memberships
   where tenant_id = t and role = 'educator' and status = 'active' and user_id is not null limit 1;
  -- A parent with an account and no staff role, one of their enrolled
  -- children they may collect, that child's badge, their guardian row and
  -- its tag — the value of their active guardian credential.
  select m.user_id, cg.child_id, g.id, trim(g.first_name || ' ' || g.last_name), c.tag_code, g.tag_code
    into u_parent, c_id, g_id, g_name, tag, gtag
    from public.kg_memberships m
    join public.kg_guardians g on g.user_id = m.user_id and g.tenant_id = t and g.tag_code is not null
    join public.kg_child_guardians cg on cg.guardian_id = g.id and cg.can_pickup
    join public.kg_children c on c.id = cg.child_id and c.status = 'enrolled' and c.tag_code is not null
   where m.tenant_id = t and m.role = 'parent' and m.status = 'active'
     and not exists (select 1 from public.kg_memberships s
                      where s.tenant_id = t and s.user_id = m.user_id and s.status = 'active' and s.role <> 'parent')
   order by c.created_at limit 1;
  if u_owner is null or u_educator is null or u_parent is null or c_id is null then
    raise exception 'rehearsal: the demo tenant lacks an owner, an educator or a parent-only account allowed to collect a badged child';
  end if;
  select id into cred_id from public.kg_credentials
   where tenant_id = t and subject_type = 'guardian' and subject_id = g_id and active and value = gtag;
  if cred_id is null then raise exception 'rehearsal: the demo parent''s tag has no active guardian credential'; end if;
  if tag !~ '^[A-Z0-9-]{1,32}$' or gtag !~ '^[A-Z0-9-]{1,32}$' then
    raise exception 'rehearsal: a demo tag is outside the badge alphabet: % %', tag, gtag;
  end if;
  -- A child of another family, with a guardian of theirs who holds a card,
  -- for the refusals that must write nothing.
  select c.id, c.tag_code, g.id, g.tag_code into c_other, tag_other, g_other, gtag_other
    from public.kg_children c
    join public.kg_child_guardians cg on cg.child_id = c.id
    join public.kg_guardians g on g.id = cg.guardian_id and g.tag_code is not null
    join public.kg_credentials k on k.tenant_id = t and k.subject_type = 'guardian' and k.subject_id = g.id and k.active and k.value = g.tag_code
   where c.tenant_id = t and c.status = 'enrolled' and c.tag_code is not null
     and not exists (select 1 from public.kg_child_guardians x where x.child_id = c.id and x.guardian_id = g_id)
     and not exists (select 1 from public.kg_child_guardians x where x.child_id = c_id and x.guardian_id = g.id)
   order by c.created_at limit 1;
  if c_other is null then raise exception 'rehearsal: the demo tenant has no other family with a card'; end if;
  today_key := lower(to_char(kg_today(), 'Dy'));
  midnight := ((kg_today() + 1)::timestamp) at time zone 'Africa/Algiers';

  begin
    -- a) The day's code. Self check-in on. Two stale rows first: the code
    --    of the day before yesterday (dead since yesterday's midnight —
    --    swept) and yesterday's (dead since last midnight — kept a day,
    --    but never handed out). The owner and the educator get the SAME
    --    code, 12 symbols of the alphabet, ending at the next Algiers
    --    midnight, with the seconds to it and today's date; a third ask
    --    still answers the same; a parent, nobody and a null tenant get
    --    nothing; the switch off is `self_checkin_off`.
    perform set_config('request.jwt.claims', json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    perform public.kg_set_kiosk_settings(t, '{"self_checkin": true, "self_pickup_confirm": true}'::jsonb);
    execute 'reset role';
    insert into public.kg_door_codes (tenant_id, code, issued_by, expires_at)
    values (t, 'REHEARSAL2222', u_owner, midnight - interval '2 days'),
           (t, 'REHEARSAL3333', u_owner, midnight - interval '1 day');
    execute 'set local role authenticated';
    v := public.kg_door_code_issue(t);
    execute 'reset role';
    code1 := v ->> 'code';
    if code1 !~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{12}$'
       or (v ->> 'expires_at')::timestamptz is distinct from midnight
       or v ->> 'day' is distinct from to_char(kg_today(), 'YYYY-MM-DD')
       or abs((v ->> 'ttl_seconds')::int - extract(epoch from (midnight - now()))) > 2
       or (v ->> 'ttl_seconds')::int > 86400 then
      raise exception 'a) the owner''s code: %', v;
    end if;
    perform set_config('request.jwt.claims', json_build_object('sub', u_educator, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v := public.kg_door_code_issue(t);
    if v ->> 'code' is distinct from code1 or (v ->> 'expires_at')::timestamptz is distinct from midnight then
      raise exception 'a) the educator got another code: %', v;
    end if;
    v := public.kg_door_code_issue(t);
    execute 'reset role';
    if v ->> 'code' is distinct from code1 then raise exception 'a) the third ask got another code: %', v; end if;
    if (select count(*) from public.kg_door_codes where tenant_id = t and expires_at = midnight) <> 1
       or not exists (select 1 from public.kg_door_codes where code = code1 and tenant_id = t and issued_by = u_owner and expires_at = midnight)
       or exists (select 1 from public.kg_door_codes where code = 'REHEARSAL2222')
       or not exists (select 1 from public.kg_door_codes where code = 'REHEARSAL3333') then
      raise exception 'a) the sweep or the rows are wrong';
    end if;
    perform set_config('request.jwt.claims', json_build_object('sub', u_parent, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    begin
      perform public.kg_door_code_issue(t);
      raise exception 'a) a parent was issued a code';
    exception when insufficient_privilege then null;
    end;
    perform set_config('request.jwt.claims', '', true);
    begin
      perform public.kg_door_code_issue(t);
      raise exception 'a) an anonymous session was issued a code';
    exception when insufficient_privilege then null;
    end;
    perform set_config('request.jwt.claims', json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
    begin
      perform public.kg_door_code_issue(null);
      raise exception 'a) a null tenant was issued a code';
    exception when insufficient_privilege then null;
    end;
    perform public.kg_set_kiosk_settings(t, '{"self_checkin": false}'::jsonb);
    begin
      perform public.kg_door_code_issue(t);
      raise exception 'a) a code was issued with self check-in off';
    exception when others then if sqlerrm <> 'self_checkin_off' then raise; end if;
    end;
    perform public.kg_set_kiosk_settings(t, '{"self_checkin": true}'::jsonb);
    execute 'reset role';

    -- b) The parent's pass on 'auto'. The child's day cleared and today's
    --    hours widened (both undone with the rest). A bad or null
    --    direction is still refused; 'auto' with no row is an arrival
    --    (method parent, the guardian), again a moment later is the fact
    --    `already_in` (a double tap, not a departure request — no
    --    hand-over row appears), and still `already_in` with today's hours
    --    gone, where an explicit 'in' hears the writer's `closed_day`; an
    --    hour later 'auto' is a departure — a pending hand-over with the
    --    confirmation on, recorded at once with it off — and once out,
    --    'auto' is the fact `already_out`. 'in' and 'out' keep answering
    --    as in 0168.
    delete from public.kg_attendance where child_id = c_id and date = kg_today();
    update public.kg_tenants
       set opening_hours = opening_hours || jsonb_build_object(today_key, '{"open": "00:00", "close": "23:59"}'::jsonb)
     where id = t;
    perform set_config('request.jwt.claims', json_build_object('sub', u_parent, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    foreach bad in array array['up', 'AUTO', ' auto'] loop
      begin
        perform public.kg_checkin_self(code1, c_id, bad);
        raise exception 'b) the direction % was accepted', bad;
      exception when others then if sqlerrm <> 'invalid_direction' then raise; end if;
      end;
    end loop;
    begin
      perform public.kg_checkin_self(code1, c_id, null);
      raise exception 'b) a null direction was accepted';
    exception when others then if sqlerrm <> 'invalid_direction' then raise; end if;
    end;
    r := public.kg_checkin_self(code1, c_id, 'auto');
    execute 'reset role';
    keys := (select array_agg(k order by k collate "C") from jsonb_object_keys(r) k);
    if keys <> k_recorded or (r ->> 'duplicate')::boolean is distinct from false or r ->> 'direction' is distinct from 'in'
       or (r ->> 'child_id')::uuid is distinct from c_id or r ->> 'at' is null then
      raise exception 'b) auto with no row: %', r;
    end if;
    select * into att from public.kg_attendance where child_id = c_id and date = kg_today();
    if att.check_in_at is null or att.check_in_method is distinct from 'parent'::kg_checkin_method
       or att.checked_in_by is distinct from u_parent or att.checked_in_guardian_id is distinct from g_id or att.check_out_at is not null then
      raise exception 'b) the row after the auto arrival: %', to_jsonb(att);
    end if;
    -- The fact whatever the hour: today set to null (the table's shape for
    -- a closed day — seven keys always), the double tap is still
    -- `already_in` and never `closed_day`, while an explicit 'in' meets
    -- the writer's gate as in 0168. Hours back before going on.
    update public.kg_tenants set opening_hours = opening_hours || jsonb_build_object(today_key, null) where id = t;
    execute 'set local role authenticated';
    r := public.kg_checkin_self(code1, c_id, 'auto');
    keys := (select array_agg(k order by k collate "C") from jsonb_object_keys(r) k);
    if keys <> k_duplicate or (r ->> 'duplicate')::boolean is distinct from true or r ->> 'reason' is distinct from 'already_in'
       or r ->> 'direction' is distinct from 'in' or (r ->> 'check_in_at')::timestamptz is distinct from att.check_in_at then
      raise exception 'b) auto once in, on a closed day: %', r;
    end if;
    r := public.kg_checkin_self(code1, c_id, 'in');
    if (r ->> 'refused')::boolean is distinct from true or r ->> 'reason' is distinct from 'closed_day' then
      raise exception 'b) an explicit in on a closed day: %', r;
    end if;
    execute 'reset role';
    update public.kg_tenants
       set opening_hours = opening_hours || jsonb_build_object(today_key, '{"open": "00:00", "close": "23:59"}'::jsonb)
     where id = t;
    execute 'set local role authenticated';
    r := public.kg_checkin_self(code1, c_id, 'auto');
    if (r ->> 'duplicate')::boolean is distinct from true or r ->> 'reason' is distinct from 'already_in' or r ->> 'direction' is distinct from 'in' then
      raise exception 'b) auto once in: %', r;
    end if;
    if exists (select 1 from public.kg_handovers where child_id = c_id and status = 'pending') then
      raise exception 'b) a double tap asked the team for a departure';
    end if;
    r := public.kg_checkin_self(code1, c_id, 'in');
    if (r ->> 'duplicate')::boolean is distinct from true or r ->> 'reason' is distinct from 'already_in' then
      raise exception 'b) an explicit in once in: %', r;
    end if;
    -- An explicit 'out' straight after the arrival still asks the team, as
    -- in 0168 (the staff's confirm is what meets `just_arrived`); withdrawn.
    r := public.kg_checkin_self(code1, c_id, 'out');
    if (r ->> 'pending')::boolean is distinct from true or r ->> 'handover_id' is null then
      raise exception 'b) an explicit out straight after the arrival: %', r;
    end if;
    v := public.kg_handover_cancel((r ->> 'handover_id')::uuid);
    if v ->> 'status' is distinct from 'cancelled' then raise exception 'b) the first cancel: %', v; end if;
    execute 'reset role';
    update public.kg_attendance set check_in_at = check_in_at - interval '1 hour' where child_id = c_id and date = kg_today();
    execute 'set local role authenticated';
    r := public.kg_checkin_self(code1, c_id, 'auto');
    if (r ->> 'pending')::boolean is distinct from true or r ->> 'handover_id' is null or r ->> 'direction' is distinct from 'out' then
      raise exception 'b) auto an hour in, confirmation on: %', r;
    end if;
    h1 := (r ->> 'handover_id')::uuid;
    v := public.kg_handover_cancel(h1);
    if v ->> 'status' is distinct from 'cancelled' then raise exception 'b) the cancel: %', v; end if;
    perform set_config('request.jwt.claims', json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
    perform public.kg_set_kiosk_settings(t, '{"self_pickup_confirm": false}'::jsonb);
    perform set_config('request.jwt.claims', json_build_object('sub', u_parent, 'role', 'authenticated')::text, true);
    r := public.kg_checkin_self(code1, c_id, 'auto');
    execute 'reset role';
    if (r ->> 'duplicate')::boolean is distinct from false or r ->> 'direction' is distinct from 'out' or r ? 'pending' or r ->> 'at' is null then
      raise exception 'b) auto an hour in, confirmation off: %', r;
    end if;
    select * into att from public.kg_attendance where child_id = c_id and date = kg_today();
    if att.check_out_at is null or att.check_out_method is distinct from 'parent'::kg_checkin_method
       or att.checked_out_by is distinct from u_parent or att.checked_out_guardian_id is distinct from g_id or att.picked_up_by is distinct from g_name then
      raise exception 'b) the row after the auto departure: %', to_jsonb(att);
    end if;
    execute 'set local role authenticated';
    r := public.kg_checkin_self(code1, c_id, 'auto');
    keys := (select array_agg(k order by k collate "C") from jsonb_object_keys(r) k);
    if keys <> k_duplicate or (r ->> 'duplicate')::boolean is distinct from true or r ->> 'reason' is distinct from 'already_out'
       or r ->> 'direction' is distinct from 'out'
       or (r ->> 'check_in_at')::timestamptz is distinct from att.check_in_at or (r ->> 'check_out_at')::timestamptz is distinct from att.check_out_at then
      raise exception 'b) auto once out: %', r;
    end if;
    r := public.kg_checkin_self(code1, c_id, 'in');
    if (r ->> 'duplicate')::boolean is distinct from true or r ->> 'reason' is distinct from 'returned' then
      raise exception 'b) an explicit in once out: %', r;
    end if;
    perform set_config('request.jwt.claims', json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
    perform public.kg_set_kiosk_settings(t, '{"self_pickup_confirm": true}'::jsonb);
    perform set_config('request.jwt.claims', json_build_object('sub', u_parent, 'role', 'authenticated')::text, true);
    r := public.kg_checkin_self(code1, c_id, 'auto');
    execute 'reset role';
    if r ->> 'reason' is distinct from 'already_out' or r ? 'pending' then
      raise exception 'b) auto once out, confirmation on: %', r;
    end if;
    if exists (select 1 from public.kg_handovers where child_id = c_id and status = 'pending') then
      raise exception 'b) a departure of a child already out asked the team';
    end if;

    -- c) The pair at the kiosk. The day cleared again. The educator
    --    presents the demo parent's card for their child, lower case and
    --    blank-padded: an arrival with the method kiosk, the educator's
    --    user and the GUARDIAN, `pair` true, the child's tag, the adult's
    --    credential touched. Again, with today's hours gone: the fact
    --    `already_in`, not `closed_day`. An hour later the parent asks for
    --    the departure from their phone, then the card is read: a
    --    departure that names the guardian AND the pending hand-over
    --    confirmed by the educator — the parent's poll says so with the
    --    check-out time. Again: `already_out`. The same card for another
    --    family's child: `not_linked`, that child's day untouched. A
    --    revoked card, a card of nobody, a tag of nobody, and the parent's
    --    keypad PIN in place of their card: `unknown_code`. The child's own
    --    badge revoked: the parent's card still works. Anything but two
    --    codes around one `+`: `invalid_pair`. can_pickup off:
    --    `pickup_not_allowed` in the pair shape. A parent, and a null
    --    tenant: `forbidden`.
    delete from public.kg_attendance where child_id = c_id and date = kg_today();
    select last_used_at into used_before from public.kg_credentials where id = cred_id;
    select to_jsonb(a) into other_before from public.kg_attendance a where a.child_id = c_other and a.date = kg_today();
    perform set_config('request.jwt.claims', json_build_object('sub', u_educator, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    r := public.kg_kiosk_pair(t, lower('  ' || gtag || '+' || tag || ' '));
    execute 'reset role';
    keys := (select array_agg(k order by k collate "C") from jsonb_object_keys(r) k);
    if keys <> k_pair_recorded or (r ->> 'duplicate')::boolean is distinct from false or r ->> 'direction' is distinct from 'in'
       or (r ->> 'child_id')::uuid is distinct from c_id or (r ->> 'guardian_id')::uuid is distinct from g_id
       or r ->> 'guardian_name' is distinct from g_name or r ->> 'tag_code' is distinct from tag
       or (r ->> 'pair')::boolean is distinct from true or r ->> 'at' is null then
      raise exception 'c) the pair''s arrival: %', r;
    end if;
    select * into att from public.kg_attendance where child_id = c_id and date = kg_today();
    if att.check_in_at is null or att.check_in_method is distinct from 'kiosk'::kg_checkin_method
       or att.checked_in_by is distinct from u_educator or att.checked_in_guardian_id is distinct from g_id or att.check_out_at is not null then
      raise exception 'c) the row after the pair''s arrival: %', to_jsonb(att);
    end if;
    if (select last_used_at from public.kg_credentials where id = cred_id) is not distinct from used_before
       or (select last_used_at from public.kg_credentials where id = cred_id) < now() - interval '5 seconds' then
      raise exception 'c) the guardian''s credential was not touched';
    end if;
    update public.kg_tenants set opening_hours = opening_hours || jsonb_build_object(today_key, null) where id = t;
    execute 'set local role authenticated';
    r := public.kg_kiosk_pair(t, gtag || '+' || tag);
    keys := (select array_agg(k order by k collate "C") from jsonb_object_keys(r) k);
    if keys <> k_pair_duplicate or (r ->> 'duplicate')::boolean is distinct from true or r ->> 'reason' is distinct from 'already_in'
       or r ->> 'direction' is distinct from 'in' or (r ->> 'pair')::boolean is distinct from true
       or (r ->> 'guardian_id')::uuid is distinct from g_id or r ->> 'tag_code' is distinct from tag
       or (r ->> 'check_in_at')::timestamptz is distinct from att.check_in_at then
      raise exception 'c) the pair once in, on a closed day: %', r;
    end if;
    execute 'reset role';
    update public.kg_tenants
       set opening_hours = opening_hours || jsonb_build_object(today_key, '{"open": "00:00", "close": "23:59"}'::jsonb)
     where id = t;
    update public.kg_attendance set check_in_at = check_in_at - interval '1 hour' where child_id = c_id and date = kg_today();
    -- The parent asks from their phone first (confirmation on), the
    -- educator reads the card a moment later.
    perform set_config('request.jwt.claims', json_build_object('sub', u_parent, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    r := public.kg_checkin_self(code1, c_id, 'auto');
    if (r ->> 'pending')::boolean is distinct from true or r ->> 'handover_id' is null then
      raise exception 'c) the parent''s request before the card: %', r;
    end if;
    h1 := (r ->> 'handover_id')::uuid;
    perform set_config('request.jwt.claims', json_build_object('sub', u_educator, 'role', 'authenticated')::text, true);
    r := public.kg_kiosk_pair(t, gtag || '+' || tag);
    execute 'reset role';
    keys := (select array_agg(k order by k collate "C") from jsonb_object_keys(r) k);
    if keys <> k_pair_recorded or (r ->> 'duplicate')::boolean is distinct from false or r ->> 'direction' is distinct from 'out'
       or r ->> 'guardian_name' is distinct from g_name or r ->> 'at' is null then
      raise exception 'c) the pair''s departure: %', r;
    end if;
    select * into att from public.kg_attendance where child_id = c_id and date = kg_today();
    if att.check_out_at is null or att.check_out_method is distinct from 'kiosk'::kg_checkin_method
       or att.checked_out_by is distinct from u_educator or att.checked_out_guardian_id is distinct from g_id or att.picked_up_by is distinct from g_name then
      raise exception 'c) the row after the pair''s departure: %', to_jsonb(att);
    end if;
    if not exists (select 1 from public.kg_handovers h
                    where h.id = h1 and h.status = 'confirmed' and h.decided_by = u_educator and h.decided_at is not null) then
      raise exception 'c) the pair''s departure left the hand-over: %', (select to_jsonb(h) from public.kg_handovers h where h.id = h1);
    end if;
    perform set_config('request.jwt.claims', json_build_object('sub', u_parent, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v := public.kg_handover_status(h1);
    execute 'reset role';
    if v ->> 'status' is distinct from 'confirmed' or (v ->> 'check_out_at')::timestamptz is distinct from att.check_out_at then
      raise exception 'c) the parent''s poll after the card: %', v;
    end if;
    perform set_config('request.jwt.claims', json_build_object('sub', u_educator, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    r := public.kg_kiosk_pair(t, gtag || '+' || tag);
    keys := (select array_agg(k order by k collate "C") from jsonb_object_keys(r) k);
    if keys <> k_pair_duplicate or r ->> 'reason' is distinct from 'already_out' or r ->> 'direction' is distinct from 'out'
       or (r ->> 'check_out_at')::timestamptz is distinct from att.check_out_at then
      raise exception 'c) the pair once out: %', r;
    end if;
    r := public.kg_kiosk_pair(t, gtag || '+' || tag_other);
    keys := (select array_agg(k order by k collate "C") from jsonb_object_keys(r) k);
    if keys <> k_not_linked or (r ->> 'refused')::boolean is distinct from true or r ->> 'reason' is distinct from 'not_linked'
       or (r ->> 'child_id')::uuid is distinct from c_other or r ->> 'guardian_name' is distinct from g_name
       or jsonb_typeof(r -> 'direction') is distinct from 'null' then
      raise exception 'c) another family''s child: %', r;
    end if;
    execute 'reset role';
    if (select to_jsonb(a) from public.kg_attendance a where a.child_id = c_other and a.date = kg_today()) is distinct from other_before then
      raise exception 'c) not_linked wrote the other child''s day';
    end if;
    update public.kg_credentials set active = false, revoked_at = now() where tenant_id = t and subject_type = 'guardian' and subject_id = g_other and active;
    -- The parent's keypad PIN is not a card: their own if they hold one,
    -- else four digits staged here (a guardian holds one active PIN, so
    -- only when they have none; and never somebody else's digits).
    select k.value into pin from public.kg_credentials k
     where k.tenant_id = t and k.subject_type = 'guardian' and k.subject_id = g_id and k.kind = 'pin' and k.active;
    if pin is null then
      pin := '0169';
      if exists (select 1 from public.kg_credentials where tenant_id = t and value = pin and active) then
        raise exception 'rehearsal: % is somebody''s PIN on the demo tenant', pin;
      end if;
      insert into public.kg_credentials (tenant_id, subject_type, subject_id, kind, value, issued_by)
      values (t, 'guardian', g_id, 'pin', pin, u_owner);
    end if;
    execute 'set local role authenticated';
    foreach bad in array array[gtag_other || '+' || tag_other, 'G-REHEARSAL+' || tag, gtag || '+REHEARSAL-NO-TAG', tag || '+' || gtag, pin || '+' || tag] loop
      begin
        perform public.kg_kiosk_pair(t, bad);
        raise exception 'c) % was accepted as a pair', bad;
      exception when others then if sqlerrm <> 'unknown_code' then raise; end if;
      end;
    end loop;
    execute 'reset role';
    -- The child's badge lost: the parent's card names the child by tag,
    -- so it still records.
    update public.kg_credentials set active = false, revoked_at = now() where tenant_id = t and subject_type = 'child' and subject_id = c_id and active;
    delete from public.kg_attendance where child_id = c_id and date = kg_today();
    execute 'set local role authenticated';
    r := public.kg_kiosk_pair(t, gtag || '+' || tag);
    if (r ->> 'duplicate')::boolean is distinct from false or r ->> 'direction' is distinct from 'in' then
      raise exception 'c) the parent''s card stopped with the child''s badge: %', r;
    end if;
    foreach bad in array array[tag, gtag, '', ' ', '+', gtag || '+', '+' || tag, gtag || '+' || tag || '+' || tag, 'G_1+' || tag, gtag || ' + ' || tag, repeat('A', 33) || '+' || tag] loop
      begin
        perform public.kg_kiosk_pair(t, bad);
        raise exception 'c) "%" was accepted as a pair', bad;
      exception when others then if sqlerrm <> 'invalid_pair' then raise; end if;
      end;
    end loop;
    begin
      perform public.kg_kiosk_pair(t, null);
      raise exception 'c) a null pair was accepted';
    exception when others then if sqlerrm <> 'invalid_pair' then raise; end if;
    end;
    execute 'reset role';
    update public.kg_attendance set check_in_at = check_in_at - interval '1 hour' where child_id = c_id and date = kg_today();
    update public.kg_child_guardians set can_pickup = false where child_id = c_id and guardian_id = g_id;
    execute 'set local role authenticated';
    r := public.kg_kiosk_pair(t, gtag || '+' || tag);
    keys := (select array_agg(k order by k collate "C") from jsonb_object_keys(r) k);
    if keys <> k_pair_pickup or (r ->> 'refused')::boolean is distinct from true or r ->> 'reason' is distinct from 'pickup_not_allowed'
       or r ->> 'direction' is distinct from 'out' or r ->> 'guardian_name' is distinct from g_name or (r ->> 'pair')::boolean is distinct from true then
      raise exception 'c) can_pickup off: %', r;
    end if;
    execute 'reset role';
    update public.kg_child_guardians set can_pickup = true where child_id = c_id and guardian_id = g_id;
    if (select check_out_at from public.kg_attendance where child_id = c_id and date = kg_today()) is not null then
      raise exception 'c) a refused departure was written';
    end if;
    perform set_config('request.jwt.claims', json_build_object('sub', u_parent, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    begin
      perform public.kg_kiosk_pair(t, gtag || '+' || tag);
      raise exception 'c) a parent used the kiosk''s pair';
    exception when insufficient_privilege then if sqlerrm <> 'forbidden' then raise; end if;
    end;
    perform set_config('request.jwt.claims', json_build_object('sub', u_educator, 'role', 'authenticated')::text, true);
    begin
      perform public.kg_kiosk_pair(null, gtag || '+' || tag);
      raise exception 'c) a null tenant was accepted';
    exception when insufficient_privilege then null;
    end;
    execute 'reset role';

    -- d) The tag path, untouched: the same key sets as 0168 for a recorded
    --    arrival and a duplicate.
    delete from public.kg_attendance where child_id = c_id and date = kg_today();
    execute 'set local role authenticated';
    r := public.kg_checkin_by_tag(t, tag, 'in', 'kiosk', null, null, false);
    keys := (select array_agg(k order by k collate "C") from jsonb_object_keys(r) k);
    if keys <> k_recorded or (r ->> 'duplicate')::boolean is distinct from false then raise exception 'd) the recorded arrival: %', r; end if;
    r := public.kg_checkin_by_tag(t, tag, 'in', 'kiosk');
    keys := (select array_agg(k order by k collate "C") from jsonb_object_keys(r) k);
    if keys <> k_duplicate or r ->> 'reason' is distinct from 'already_in' then raise exception 'd) already_in: %', r; end if;
    execute 'reset role';
    --    …and a departure through the badge settles the hand-over the parent
    --    asked for from their phone (the writer, §3b): the arrival moved back
    --    an hour, the parent's 'auto' opens the request, the educator's badge
    --    scan records the departure and the request reads confirmed by them.
    update public.kg_attendance set check_in_at = check_in_at - interval '1 hour' where child_id = c_id and date = kg_today();
    perform set_config('request.jwt.claims', json_build_object('sub', u_parent, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    r := public.kg_checkin_self(code1, c_id, 'auto');
    execute 'reset role';
    if (r ->> 'pending')::boolean is distinct from true then raise exception 'd) the parent''s request: %', r; end if;
    h1 := (r ->> 'handover_id')::uuid;
    perform set_config('request.jwt.claims', json_build_object('sub', u_educator, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    r := public.kg_checkin_by_tag(t, tag, 'out', 'kiosk', null, g_id, false);
    keys := (select array_agg(k order by k collate "C") from jsonb_object_keys(r) k);
    if keys <> k_recorded or (r ->> 'duplicate')::boolean is distinct from false or r ->> 'direction' is distinct from 'out' then raise exception 'd) the badge departure: %', r; end if;
    if not exists (select 1 from public.kg_handovers h where h.id = h1 and h.status = 'confirmed' and h.decided_by = u_educator and h.decided_at is not null) then
      raise exception 'd) the badge departure left the hand-over pending';
    end if;
    execute 'reset role';
    perform set_config('request.jwt.claims', json_build_object('sub', u_parent, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v := public.kg_handover_status(h1);
    execute 'reset role';
    if v ->> 'status' is distinct from 'confirmed' or v ->> 'check_out_at' is null then raise exception 'd) the parent''s poll after the badge: %', v; end if;

    -- e) Who may call what.
    if has_function_privilege('anon', 'public.kg_kiosk_pair(uuid,text)', 'execute')
       or not has_function_privilege('authenticated', 'public.kg_kiosk_pair(uuid,text)', 'execute')
       or has_function_privilege('anon', 'public.kg_door_code_issue(uuid)', 'execute')
       or not has_function_privilege('authenticated', 'public.kg_door_code_issue(uuid)', 'execute')
       or has_function_privilege('anon', 'public.kg_checkin_self(text,uuid,text)', 'execute')
       or not has_function_privilege('authenticated', 'public.kg_checkin_self(text,uuid,text)', 'execute') then
      raise exception 'e) the grants are off';
    end if;

    raise exception using errcode = 'P0169', message = 'rehearsal done';
  exception when sqlstate 'P0169' then
    raise exception '0169 rehearsal ok — rolled back';
  end;
  execute 'reset role';
end $$;

notify pgrst, 'reload schema';
commit;
