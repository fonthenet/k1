-- 0166 — the door kiosk: its settings, and the card it shows.
--
-- A parent scans the QR from the portal and the kiosk offers the pick list;
-- until now a hand still had to confirm, and the screen said nothing beyond
-- "recorded at 08:12". The tablet at the door is a staff device that a
-- parent looks at, so it can say more: who dropped the child off and who
-- usually collects them and when; at pick-up, how long the child stayed,
-- what the journal holds so far (draft included — the evening sender will
-- publish it) and whether something happened. kg_door_card composes that
-- in one call. Whether the kiosk confirms a scan on its own, after how many
-- seconds, whether it is a parents-only door and whether it beeps is the
-- establishment's choice, kept in kg_tenants.settings->'kiosk'.
--
-- Same shape as 0165's badges: a shape CHECK on kg_tenants.settings and one
-- SECURITY DEFINER writer that appends with `||` and merges INSIDE the key,
-- so the settings card writes one switch at a time and never clobbers the
-- others. The composer follows 0152's kg_child_day_compose: today is the
-- Algiers day, a moment is a timestamptz, the journal's meals and nap pass
-- through as the jsonb the two clients wrote (portal-types.ts reads both
-- historical shapes).
--
-- Rehearsed on production (qekibejzwpphzzyqigzo) on 2026-09-13 through
-- execute_sql: every assertion of §4 held, the run ended on the pass mark
-- "0166 rehearsal ok — rolled back", and afterwards no function, no
-- constraint and no kiosk key on the demo tenant persisted. Not applied.
begin;
set local lock_timeout = '5s';

-- ── 1. The shape ──────────────────────────────────────────────────────────
-- Every key optional (the merge writes them one at a time), unknown keys
-- refused, no JSON null: a switch is on or off, and a missing key means the
-- default (kiosk-settings.ts: auto-confirm on after 3 s, door mode off,
-- sound on). The countdown is bounded so a mis-typed 30 does not leave a
-- parent staring at a frozen button, nor a 1 fire before the list is read.
create or replace function public.kg_valid_kiosk_settings(v jsonb) returns boolean
language sql immutable set search_path = public as $$
  select v -> 'kiosk' is null
      or (jsonb_typeof(v -> 'kiosk') = 'object'
          and coalesce((select bool_and(k in ('auto_confirm', 'auto_confirm_seconds', 'door_mode', 'sound'))
                          from jsonb_object_keys(v -> 'kiosk') k), true)
          and (v -> 'kiosk' -> 'auto_confirm' is null
               or jsonb_typeof(v -> 'kiosk' -> 'auto_confirm') = 'boolean')
          and (v -> 'kiosk' -> 'door_mode' is null
               or jsonb_typeof(v -> 'kiosk' -> 'door_mode') = 'boolean')
          and (v -> 'kiosk' -> 'sound' is null
               or jsonb_typeof(v -> 'kiosk' -> 'sound') = 'boolean')
          and (v -> 'kiosk' -> 'auto_confirm_seconds' is null
               or (jsonb_typeof(v -> 'kiosk' -> 'auto_confirm_seconds') = 'number'
                   and (v -> 'kiosk' ->> 'auto_confirm_seconds') ~ '^[0-9]+$'
                   and (v -> 'kiosk' ->> 'auto_confirm_seconds')::int between 2 and 10)));
$$;
alter table public.kg_tenants drop constraint if exists kg_tenants_kiosk_shape;
alter table public.kg_tenants add constraint kg_tenants_kiosk_shape
  check (public.kg_valid_kiosk_settings(settings));

-- ── 2. The only writer of the key ─────────────────────────────────────────
-- p_kiosk carries only the fields the caller means to change; the rest of
-- the key and the rest of settings survive the `||`. A shape the CHECK
-- refuses comes back as 23514 (the action's 'invalid'); a non-admin as 42501.
create or replace function public.kg_set_kiosk_settings(p_tenant uuid, p_kiosk jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_out jsonb;
begin
  if p_tenant is null or not kg_is_admin(p_tenant) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_kiosk is null or jsonb_typeof(p_kiosk) <> 'object' then
    raise exception 'invalid' using errcode = '22023';
  end if;
  update public.kg_tenants
     set settings = coalesce(settings, '{}'::jsonb)
                    || jsonb_build_object('kiosk', coalesce(settings -> 'kiosk', '{}'::jsonb) || p_kiosk)
   where id = p_tenant
   returning settings -> 'kiosk' into v_out;
  return v_out;
end $$;
revoke all on function public.kg_set_kiosk_settings(uuid, jsonb) from public, anon;
grant execute on function public.kg_set_kiosk_settings(uuid, jsonb) to authenticated;

comment on function public.kg_set_kiosk_settings(uuid, jsonb) is
  'Merges p_kiosk into kg_tenants.settings->''kiosk'' (auto_confirm, auto_confirm_seconds, door_mode, sound). Admin-only; the shape is enforced by kg_tenants_kiosk_shape.';

-- ── 3. The door card ──────────────────────────────────────────────────────
-- What the kiosk shows once a move is recorded, for one child, today
-- (Africa/Algiers). Staff of the child's tenant only — the door is a staff
-- device, which is also why the journal is read draft included, unlike
-- kg_child_day: a parent reading over the educator's shoulder sees what the
-- family will receive at 17:00, never another family's child. A parent
-- session, a departed teacher and an unknown child are all refused the
-- same way (42501), so nothing here says whether a child exists.
--
--   attendance    today's row: the moments, the NAMES of the guardians who
--                 dropped off / collected (0019's *_guardian_id — the
--                 *_by columns of the table hold the staff account, which
--                 the door has no use for), and picked_up_by as typed.
--   minutes_present  since check-in, until check-out or now; null before.
--   journal       today's kg_daily_reports row, draft included, or null.
--   incidents     today's count and the worst severity (the enum orders).
--   usual_pickup  the guardian who collected the child most often over the
--                 last 30 school days and the median collection time on
--                 those days, rounded to 5 min; null with fewer than 3
--                 collections that name a guardian. School days are the
--                 establishment's open days (kg_is_open_on, the one rule),
--                 read back at most 70 calendar days; today is excluded.
--   allergies     the allergens, worst first — the card's one gold mark.
create or replace function public.kg_door_card(p_child uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_tenant uuid; v_today date := (now() at time zone 'Africa/Algiers')::date;
  v_from timestamptz; v_to timestamptz;
  v_att jsonb; v_minutes int; v_journal jsonb; v_incidents jsonb; v_usual jsonb; v_allergies jsonb;
begin
  select tenant_id into v_tenant from public.kg_children where id = p_child;
  if v_tenant is null or not kg_is_staff(v_tenant) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  v_from := (v_today::timestamp) at time zone 'Africa/Algiers';
  v_to := ((v_today + 1)::timestamp) at time zone 'Africa/Algiers';

  select jsonb_build_object(
           'check_in_at', a.check_in_at, 'check_out_at', a.check_out_at,
           'checked_in_by', nullif(trim(coalesce(gi.first_name, '') || ' ' || coalesce(gi.last_name, '')), ''),
           'checked_out_by', nullif(trim(coalesce(go.first_name, '') || ' ' || coalesce(go.last_name, '')), ''),
           'picked_up_by', a.picked_up_by),
         case when a.check_in_at is null then null
              else floor(extract(epoch from (coalesce(a.check_out_at, now()) - a.check_in_at)) / 60)::int end
    into v_att, v_minutes
    from public.kg_attendance a
    left join public.kg_guardians gi on gi.id = a.checked_in_guardian_id
    left join public.kg_guardians go on go.id = a.checked_out_guardian_id
   where a.child_id = p_child and a.date = v_today;
  if v_att is null then
    v_att := jsonb_build_object('check_in_at', null, 'check_out_at', null,
               'checked_in_by', null, 'checked_out_by', null, 'picked_up_by', null);
  end if;

  select jsonb_build_object('mood', r.mood, 'meals', r.meals, 'nap', r.nap, 'published', r.published)
    into v_journal from public.kg_daily_reports r
   where r.child_id = p_child and r.date = v_today;

  select jsonb_build_object('count', count(*), 'worst', max(i.severity)::text)
    into v_incidents from public.kg_incidents i
   where i.child_id = p_child and i.occurred_at >= v_from and i.occurred_at < v_to;

  -- The window first (the most recent 30 open days before today), then the
  -- collections on those days that name a guardian. The most frequent
  -- guardian wins; a tie goes to the one seen most recently. The median is
  -- over every collection in the window, in local minutes of the day.
  with days as (
    select d::date as d
      from generate_series(v_today - 70, v_today - 1, interval '1 day') d
     where public.kg_is_open_on(v_tenant, d::date)
     order by d desc limit 30
  ), samples as (
    select a.checked_out_guardian_id as guardian_id,
           extract(hour from (a.check_out_at at time zone 'Africa/Algiers'))::int * 60
             + extract(minute from (a.check_out_at at time zone 'Africa/Algiers'))::int as minute_of_day,
           a.check_out_at
      from public.kg_attendance a
      join days on days.d = a.date
     where a.child_id = p_child and a.check_out_at is not null and a.checked_out_guardian_id is not null
  ), usual as (
    select s.guardian_id from samples s
     group by s.guardian_id order by count(*) desc, max(s.check_out_at) desc limit 1
  ), median as (
    select (round(percentile_cont(0.5) within group (order by s.minute_of_day) / 5) * 5)::int % 1440 as m,
           count(*) as n
      from samples s
  )
  select case when median.n < 3 then null
         else jsonb_build_object(
           'name', nullif(trim(coalesce(g.first_name, '') || ' ' || coalesce(g.last_name, '')), ''),
           'name_ar', nullif(trim(coalesce(g.first_name_ar, '') || ' ' || coalesce(g.last_name_ar, '')), ''),
           'time', lpad((median.m / 60)::text, 2, '0') || ':' || lpad((median.m % 60)::text, 2, '0')) end
    into v_usual
    from median, usual
    join public.kg_guardians g on g.id = usual.guardian_id;

  select coalesce(jsonb_agg(al.allergen order by al.severity desc, al.allergen), '[]'::jsonb)
    into v_allergies from public.kg_child_allergies al where al.child_id = p_child;

  return jsonb_build_object(
    'attendance', v_att,
    'minutes_present', v_minutes,
    'journal', v_journal,
    'incidents', v_incidents,
    'usual_pickup', v_usual,
    'allergies', v_allergies);
end $$;
revoke all on function public.kg_door_card(uuid) from public, anon;
grant execute on function public.kg_door_card(uuid) to authenticated;

comment on function public.kg_door_card(uuid) is
  'What the door kiosk shows for one child today (Africa/Algiers): today''s attendance with the guardians'' names, minutes present, the journal draft included, incident count and worst severity, the usual collector and time over the last 30 school days, the allergens. Staff of the child''s tenant only (42501 otherwise).';

-- ── 4. Rehearsal, always rolled back ─────────────────────────────────────
-- Demo tenant only. The writes live in an inner block that ends by raising
-- P0166; the handler turns it into the pass mark, so the demo tenant's
-- settings and the day it stages are undone as a subtransaction whatever
-- happens to the DDL above (the 0164 shape). Any failing assertion raises
-- something else and aborts the whole migration. As written the handler
-- raises, so the file REHEARSES: run through execute_sql, the DDL and the
-- writes roll back together and the error text "0166 rehearsal ok — rolled
-- back" is the pass mark. That is how it was rehearsed on production
-- (qekibejzwpphzzyqigzo, 2026-09-13: every assertion held, nothing
-- persisted — no function, no constraint, no kiosk key on the demo tenant
-- afterwards). To apply, flip that one `raise exception` to `raise notice`.
do $$
declare
  t uuid := '732bdf7d-775a-4ed7-875f-8c04ea4e4778';
  u_owner uuid; u_educator uuid; u_parent uuid;
  c_id uuid; c_other uuid; g_in uuid; g_out uuid; g_in_name text; g_out_name text; g_out_name_ar text;
  before jsonb; after jsonb; v jsonb; bad text;
  open_days date[]; closed_days date[]; v_day date; v_in timestamptz; v_out timestamptz; n int;
begin
  if not exists (select 1 from public.kg_tenants where id = t) then
    raise notice '0166 rehearsal skipped: demo tenant absent'; return;
  end if;
  select user_id into u_owner from public.kg_memberships
   where tenant_id = t and role = 'owner' and status = 'active' and user_id is not null limit 1;
  select user_id into u_educator from public.kg_memberships
   where tenant_id = t and role = 'educator' and status = 'active' and user_id is not null limit 1;
  -- A parent with an account and no staff role, and one of their enrolled
  -- children who has a second guardian: the child the card is staged for.
  select m.user_id, cg.child_id into u_parent, c_id
    from public.kg_memberships m
    join public.kg_guardians g on g.user_id = m.user_id and g.tenant_id = t
    join public.kg_child_guardians cg on cg.guardian_id = g.id
    join public.kg_children c on c.id = cg.child_id and c.status = 'enrolled'
   where m.tenant_id = t and m.role = 'parent' and m.status = 'active'
     and not exists (select 1 from public.kg_memberships s
                      where s.tenant_id = t and s.user_id = m.user_id and s.status = 'active' and s.role <> 'parent')
     and (select count(*) from public.kg_child_guardians x where x.child_id = cg.child_id) >= 2
   order by c.created_at limit 1;
  if u_owner is null or u_educator is null or u_parent is null or c_id is null then
    raise exception 'rehearsal: the demo tenant lacks an owner, an educator or a parent-only account with a two-guardian child';
  end if;
  select cg.guardian_id, trim(g.first_name || ' ' || g.last_name) into g_in, g_in_name
    from public.kg_child_guardians cg join public.kg_guardians g on g.id = cg.guardian_id
   where cg.child_id = c_id order by cg.is_primary desc, g.created_at limit 1;
  select cg.guardian_id, trim(g.first_name || ' ' || g.last_name),
         nullif(trim(coalesce(g.first_name_ar, '') || ' ' || coalesce(g.last_name_ar, '')), '')
    into g_out, g_out_name, g_out_name_ar
    from public.kg_child_guardians cg join public.kg_guardians g on g.id = cg.guardian_id
   where cg.child_id = c_id and cg.guardian_id <> g_in order by g.created_at limit 1;
  select settings into before from public.kg_tenants where id = t;
  if not public.kg_valid_kiosk_settings(before) then
    raise exception 'rehearsal: the demo tenant already fails the shape check';
  end if;

  begin
    -- a) The owner turns auto-confirm off and lengthens the countdown;
    --    nothing else in settings moves.
    perform set_config('request.jwt.claims', json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v := public.kg_set_kiosk_settings(t, '{"auto_confirm": false, "auto_confirm_seconds": 5}'::jsonb);
    if (v ->> 'auto_confirm')::boolean is distinct from false or (v ->> 'auto_confirm_seconds')::int is distinct from 5 then
      raise exception 'a) the writer returned %', v;
    end if;
    execute 'reset role';
    select settings into after from public.kg_tenants where id = t;
    if (after - 'kiosk') <> (before - 'kiosk') then
      raise exception 'a) another key of settings changed: % → %', before - 'kiosk', after - 'kiosk';
    end if;

    -- b) Door mode and the sound, one switch at a time; the first two
    --    fields survive each merge.
    execute 'set local role authenticated';
    v := public.kg_set_kiosk_settings(t, '{"door_mode": true}'::jsonb);
    v := public.kg_set_kiosk_settings(t, '{"sound": false}'::jsonb);
    if (v ->> 'auto_confirm')::boolean is distinct from false or (v ->> 'auto_confirm_seconds')::int is distinct from 5
       or (v ->> 'door_mode')::boolean is distinct from true or (v ->> 'sound')::boolean is distinct from false then
      raise exception 'b) the merge lost a field: %', v;
    end if;
    -- The bounds of the countdown are inclusive.
    v := public.kg_set_kiosk_settings(t, '{"auto_confirm_seconds": 2}'::jsonb);
    v := public.kg_set_kiosk_settings(t, '{"auto_confirm_seconds": 10}'::jsonb);
    if (v ->> 'auto_confirm_seconds')::int is distinct from 10 then raise exception 'b) the bound was not stored: %', v; end if;

    -- c) Every wrong shape is refused by the CHECK (23514), never stored.
    foreach bad in array array[
      '{"auto_confirm": "yes"}', '{"auto_confirm": null}', '{"auto_confirm": 1}',
      '{"auto_confirm_seconds": 1}', '{"auto_confirm_seconds": 11}', '{"auto_confirm_seconds": "3"}',
      '{"auto_confirm_seconds": 2.5}', '{"auto_confirm_seconds": null}',
      '{"door_mode": "on"}', '{"sound": 0}',
      '{"colour": "red"}'
    ] loop
      begin
        perform public.kg_set_kiosk_settings(t, bad::jsonb);
        raise exception 'c) % was accepted', bad;
      exception when check_violation then null;
      end;
    end loop;
    select settings -> 'kiosk' into v from public.kg_tenants where id = t;
    if (v ->> 'auto_confirm')::boolean is distinct from false or (v ->> 'auto_confirm_seconds')::int is distinct from 10
       or (v ->> 'door_mode')::boolean is distinct from true or (v ->> 'sound')::boolean is distinct from false
       or v ? 'colour' then
      raise exception 'c) a refused write left a trace: %', v;
    end if;

    -- d) A scalar or an array is not a settings object.
    foreach bad in array array['true', '[1, 2]', 'null'] loop
      begin
        perform public.kg_set_kiosk_settings(t, bad::jsonb);
        raise exception 'd) % was accepted', bad;
      exception when invalid_parameter_value then null;
      end;
    end loop;
    execute 'reset role';

    -- e) An educator is refused, and changes nothing.
    perform set_config('request.jwt.claims', json_build_object('sub', u_educator, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    begin
      perform public.kg_set_kiosk_settings(t, '{"door_mode": false}'::jsonb);
      raise exception 'e) an educator wrote the setting';
    exception when insufficient_privilege then null;
    end;
    execute 'reset role';
    select settings -> 'kiosk' ->> 'door_mode' into bad from public.kg_tenants where id = t;
    if bad is distinct from 'true' then raise exception 'e) the educator''s write landed: %', bad; end if;

    -- f) Nobody signed in: refused as well.
    perform set_config('request.jwt.claims', '', true);
    execute 'set local role authenticated';
    begin
      perform public.kg_set_kiosk_settings(t, '{"door_mode": false}'::jsonb);
      raise exception 'f) an anonymous session wrote the setting';
    exception when insufficient_privilege then null;
    end;
    execute 'reset role';

    -- g) Stage the child's day and history, as the definer. Today: dropped
    --    off by the first guardian 3 h 17 min ago, a draft journal, one
    --    moderate incident, a severe allergy. History, on the last open
    --    days: five collections naming a guardian (the second guardian
    --    three times, at 16:27 / 16:31 / 16:33; the first twice, at 17:02 /
    --    17:04 — median 16:33, rounded 16:35), one by staff with no
    --    guardian (not a sample), and decoys that must NOT count: the first
    --    guardian on two closed days and on two open days older than the
    --    window — either counted would make the first guardian the usual.
    select array_agg(d order by d desc) into open_days from (
      select d::date as d from generate_series(kg_today() - 70, kg_today() - 1, interval '1 day') d
       where public.kg_is_open_on(t, d::date) order by d desc limit 32) x;
    select array_agg(d order by d desc) into closed_days from (
      select d::date as d from generate_series(kg_today() - 70, kg_today() - 1, interval '1 day') d
       where not public.kg_is_open_on(t, d::date) order by d desc limit 2) x;
    if coalesce(array_length(open_days, 1), 0) < 32 or coalesce(array_length(closed_days, 1), 0) < 2 then
      raise exception 'g) the demo tenant''s week does not give 32 open and 2 closed days in 70';
    end if;
    update public.kg_attendance set checked_out_guardian_id = null where child_id = c_id and date < kg_today();
    v_in := now() - interval '3 hours 17 minutes';
    insert into public.kg_attendance (tenant_id, child_id, date, status, check_in_at, check_in_method, checked_in_guardian_id)
    values (t, c_id, kg_today(), 'present', v_in, 'tag', g_in)
    on conflict (child_id, date) do update set status = 'present', check_in_at = v_in, check_in_method = 'tag',
      checked_in_guardian_id = g_in, check_out_at = null, check_out_method = null,
      checked_out_by = null, checked_out_guardian_id = null, picked_up_by = null;
    insert into public.kg_daily_reports (tenant_id, child_id, date, mood, meals, nap, published)
    values (t, c_id, kg_today(), 'happy', '[{"meal": "lunch", "eaten": "tout"}]'::jsonb, '{"slept": true, "minutes": 80}'::jsonb, false)
    on conflict (child_id, date) do update set mood = 'happy', meals = excluded.meals, nap = excluded.nap, published = false;
    delete from public.kg_incidents where child_id = c_id and occurred_at >= (kg_today()::timestamp at time zone 'Africa/Algiers');
    insert into public.kg_incidents (tenant_id, child_id, occurred_at, severity, description)
    values (t, c_id, now() - interval '1 hour', 'moderate', 'rehearsal');
    insert into public.kg_child_allergies (tenant_id, child_id, allergen, severity)
    values (t, c_id, 'rehearsal-arachides', 'severe');
    for n in 1..5 loop
      v_day := open_days[n];
      v_out := (v_day::timestamp + (array['16:27', '16:31', '16:33', '17:02', '17:04'])[n]::time) at time zone 'Africa/Algiers';
      insert into public.kg_attendance (tenant_id, child_id, date, status, check_in_at, check_out_at, checked_out_guardian_id)
      values (t, c_id, v_day, 'present', v_out - interval '8 hours', v_out, case when n <= 3 then g_out else g_in end)
      on conflict (child_id, date) do update set status = 'present', check_in_at = excluded.check_in_at,
        check_out_at = excluded.check_out_at, checked_out_guardian_id = excluded.checked_out_guardian_id;
    end loop;
    v_day := open_days[6];
    v_out := (v_day::timestamp + time '15:00') at time zone 'Africa/Algiers';
    insert into public.kg_attendance (tenant_id, child_id, date, status, check_in_at, check_out_at, checked_out_guardian_id)
    values (t, c_id, v_day, 'present', v_out - interval '7 hours', v_out, null)
    on conflict (child_id, date) do update set status = 'present', check_in_at = excluded.check_in_at,
      check_out_at = excluded.check_out_at, checked_out_guardian_id = null;
    foreach v_day in array array[closed_days[1], closed_days[2], open_days[31], open_days[32]] loop
      v_out := (v_day::timestamp + time '17:00') at time zone 'Africa/Algiers';
      insert into public.kg_attendance (tenant_id, child_id, date, status, check_in_at, check_out_at, checked_out_guardian_id)
      values (t, c_id, v_day, 'present', v_out - interval '8 hours', v_out, g_in)
      on conflict (child_id, date) do update set status = 'present', check_in_at = excluded.check_in_at,
        check_out_at = excluded.check_out_at, checked_out_guardian_id = g_in;
    end loop;

    -- h) The educator at the door reads the card at drop-off.
    perform set_config('request.jwt.claims', json_build_object('sub', u_educator, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v := public.kg_door_card(c_id);
    execute 'reset role';
    if (v -> 'attendance' ->> 'check_in_at')::timestamptz is distinct from v_in
       or v -> 'attendance' ->> 'checked_in_by' is distinct from g_in_name
       or jsonb_typeof(v -> 'attendance' -> 'check_out_at') is distinct from 'null'
       or jsonb_typeof(v -> 'attendance' -> 'checked_out_by') is distinct from 'null'
       or jsonb_typeof(v -> 'attendance' -> 'picked_up_by') is distinct from 'null' then
      raise exception 'h) attendance at drop-off: %', v -> 'attendance';
    end if;
    if (v ->> 'minutes_present')::int is distinct from 197 then raise exception 'h) minutes_present: %', v ->> 'minutes_present'; end if;
    if v -> 'journal' ->> 'mood' is distinct from 'happy' or (v -> 'journal' ->> 'published')::boolean is distinct from false
       or jsonb_typeof(v -> 'journal' -> 'meals') is distinct from 'array'
       or (v -> 'journal' -> 'nap' ->> 'minutes')::int is distinct from 80 then
      raise exception 'h) the draft journal: %', v -> 'journal';
    end if;
    if (v -> 'incidents' ->> 'count')::int is distinct from 1 or v -> 'incidents' ->> 'worst' is distinct from 'moderate' then
      raise exception 'h) incidents: %', v -> 'incidents';
    end if;
    if v -> 'usual_pickup' ->> 'name' is distinct from g_out_name or v -> 'usual_pickup' ->> 'time' is distinct from '16:35'
       or (v -> 'usual_pickup' ->> 'name_ar') is distinct from g_out_name_ar then
      raise exception 'h) usual_pickup: % (expected % at 16:35)', v -> 'usual_pickup', g_out_name;
    end if;
    if jsonb_typeof(v -> 'allergies') is distinct from 'array' or v -> 'allergies' ->> 0 is distinct from 'rehearsal-arachides'
       or jsonb_array_length(v -> 'allergies') is distinct from (select count(*)::int from public.kg_child_allergies where child_id = c_id) then
      raise exception 'h) allergies: %', v -> 'allergies';
    end if;

    -- i) Collected by the second guardian 2 h 5 min after arriving: the card
    --    names her and the stay closes at 125 min.
    update public.kg_attendance
       set check_out_at = v_in + interval '2 hours 5 minutes', check_out_method = 'tag',
           checked_out_guardian_id = g_out, picked_up_by = g_out_name
     where child_id = c_id and date = kg_today();
    perform set_config('request.jwt.claims', json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v := public.kg_door_card(c_id);
    execute 'reset role';
    if v -> 'attendance' ->> 'checked_out_by' is distinct from g_out_name
       or v -> 'attendance' ->> 'picked_up_by' is distinct from g_out_name
       or (v ->> 'minutes_present')::int is distinct from 125 then
      raise exception 'i) attendance at pick-up: % / %', v -> 'attendance', v ->> 'minutes_present';
    end if;

    -- j) A child with no collection history and nothing today: the shape
    --    holds, every part empty, usual_pickup null.
    select c.id into c_other from public.kg_children c
     where c.tenant_id = t and c.status = 'enrolled' and c.id <> c_id
       and not exists (select 1 from public.kg_attendance a where a.child_id = c.id
                        and (a.date = kg_today() or (a.checked_out_guardian_id is not null and a.date >= kg_today() - 70)))
       and not exists (select 1 from public.kg_daily_reports r where r.child_id = c.id and r.date = kg_today())
     order by c.created_at limit 1;
    if c_other is not null then
      execute 'set local role authenticated';
      v := public.kg_door_card(c_other);
      execute 'reset role';
      if jsonb_typeof(v -> 'attendance' -> 'check_in_at') is distinct from 'null'
         or jsonb_typeof(v -> 'minutes_present') is distinct from 'null'
         or jsonb_typeof(v -> 'journal') is distinct from 'null' or (v -> 'incidents' ->> 'count')::int is distinct from 0
         or jsonb_typeof(v -> 'incidents' -> 'worst') is distinct from 'null'
         or jsonb_typeof(v -> 'usual_pickup') is distinct from 'null'
         or jsonb_typeof(v -> 'allergies') is distinct from 'array' then
        raise exception 'j) an empty day: %', v;
      end if;
    end if;

    -- k) A parent-only session, an anonymous one and an unknown child are
    --    refused alike.
    perform set_config('request.jwt.claims', json_build_object('sub', u_parent, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    begin
      perform public.kg_door_card(c_id);
      raise exception 'k) a parent read the door card';
    exception when insufficient_privilege then null;
    end;
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    execute 'set local role authenticated';
    begin
      perform public.kg_door_card(c_id);
      raise exception 'k) an anonymous session read the door card';
    exception when insufficient_privilege then null;
    end;
    execute 'reset role';
    perform set_config('request.jwt.claims', json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    begin
      perform public.kg_door_card(gen_random_uuid());
      raise exception 'k) an unknown child was not refused';
    exception when insufficient_privilege then null;
    end;
    execute 'reset role';

    raise exception using errcode = 'P0166', message = 'rehearsal done';
  exception when sqlstate 'P0166' then
    raise exception '0166 rehearsal ok — rolled back';
  end;
  execute 'reset role';
end $$;

notify pgrst, 'reload schema';
commit;
