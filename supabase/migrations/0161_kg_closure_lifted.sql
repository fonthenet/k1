-- 0161 — a lifted closure speaks too.
--
-- 0159 taught a confirmed closure to announce itself ('created'), its moves
-- ('confirmed') and the eve of its first day ('reminder'). It said nothing on
-- the way out: the closure switch turned off (settings › setHolidayClosure)
-- or the row deleted (deleteHoliday) reopened the day silently for families
-- who had read "Fermeture — Journée pédagogique" and staff who had read
-- "Fermé demain". Events, sessions and leave each speak on the way out; the
-- closure was the one party in the chain that did not.
--
--   cancelled  a confirmed closure of a day not yet past is switched off or
--              deleted → the same audience hears 'cancelled' (fr "Réouverture
--              — {name}"), its earlier 'created' / 'confirmed' / 'reminder'
--              rows are marked read so the bell does not keep two marks for
--              one fact, and beyond 30 days it is the bell only (the rule
--              'created' and 'confirmed' already follow, and events follow for
--              their own 'cancelled').
--              A generated public date (kind 'public') never announced its
--              closure, so removing one — the duplicate 1 Nov of a re-run
--              generator — is not news either, UNLESS someone was already told
--              about that row (the eve reminder): then reopening is news.
--   re-set     the switch turned on again after a lift: the stale 'created'
--              rows are dropped first so kg_notifications_closure_once lets
--              the new ones in (what 0159 does for a re-added family), and the
--              'cancelled' rows are marked read.
--   cascade    a closure that disappears because its structure or tenant is
--              being deleted is not a reopening; the delete trigger stays
--              quiet when the structure is already gone.
-- Every trigger body stays wrapped as 0092 taught: a notification never aborts
-- the write that caused it. Templates: notifications.types.closure.kinds
-- .cancelled and .bodies.cancelled (fragment closure-cancelled.json).
begin;
set local lock_timeout = '5s';

-- ── 1. 'cancelled' is bell-only beyond 30 days, like created and confirmed ──
create or replace function public.kg_notify_closure(h public.kg_holidays, p_kind text) returns int
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_structure kg_structures; v_sent int;
begin
  select * into v_structure from kg_structures where id = h.structure_id;
  v_sent := kg_notify(h.tenant_id, kg_closure_recipients(h), 'closure',
    coalesce(h.name_ar, h.name), null,
    jsonb_build_object('holidayId', h.id, 'kind', p_kind, 'date', h.date, 'endDate', h.end_date,
                       'name', h.name, 'nameAr', coalesce(h.name_ar, ''),
                       'structureId', h.structure_id,
                       'structureName', coalesce(v_structure.name, ''), 'structureNameAr', coalesce(v_structure.name_ar, ''),
                       'tentative', h.tentative, 'holidayKind', h.kind,
                       'audience', 'both'),
    case when p_kind = 'reminder' then null else auth.uid() end);
  -- A director entering the year in September must not ring every phone:
  -- beyond 30 days it is the bell only, the rule events already follow —
  -- for a reopening as much as for a closure.
  if p_kind in ('created', 'confirmed', 'cancelled') and h.date > (now() at time zone 'Africa/Algiers')::date + 30 then
    update kg_notifications set pushed_at = now()
     where type = 'closure' and data->>'holidayId' = h.id::text and data->>'kind' = p_kind and pushed_at is null;
  end if;
  return v_sent;
end $$;
revoke all on function public.kg_notify_closure(public.kg_holidays, text) from public, anon, authenticated;

-- ── 2. The reopening itself, shared by the lift and the delete ─────────────
-- Speaks only for a confirmed closure whose last day is not past, and for a
-- public date only when someone was already told about it. Marks the earlier
-- rows of the holiday read and drops a stale 'cancelled' row (a second lift
-- of the same date would otherwise be silenced by the once-per-kind index).
create or replace function public.kg_closure_lifted(h public.kg_holidays) returns int
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_today date := (now() at time zone 'Africa/Algiers')::date; v_sent int;
begin
  if not h.closure or h.tentative or coalesce(h.end_date, h.date) < v_today then return 0; end if;
  if h.kind = 'public' and not exists (
       select 1 from kg_notifications where type = 'closure' and data->>'holidayId' = h.id::text) then
    return 0;
  end if;
  delete from kg_notifications
   where type = 'closure' and data->>'holidayId' = h.id::text and data->>'kind' = 'cancelled';
  v_sent := kg_notify_closure(h, 'cancelled');
  update kg_notifications set read_at = coalesce(read_at, now())
   where type = 'closure' and data->>'holidayId' = h.id::text
     and data->>'kind' in ('created', 'confirmed', 'reminder');
  return v_sent;
end $$;
revoke all on function public.kg_closure_lifted(public.kg_holidays) from public, anon, authenticated;

-- ── 3. The insert/update trigger learns the lift and the re-set ────────────
-- created:   a CONFIRMED closure appears (insert, or the closure switch turned
--            on, or a confirmed row that was not a closure) — kind public
--            excluded, the generated national dates are not news.
-- confirmed: tentative → confirmed, a confirmed closure's dates move, or its
--            scope changes (école-only → whole building tells the new audience).
-- cancelled: the closure switch turned off on a confirmed row not yet past.
-- Never for a past day, never for a tentative row.
create or replace function public.kg_holiday_notify_trg() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_today date := (now() at time zone 'Africa/Algiers')::date;
begin
  begin
    if tg_op = 'UPDATE' and old.closure and not new.closure then
      perform kg_closure_lifted(old);
      return new;
    end if;
    if not new.closure or new.tentative or coalesce(new.end_date, new.date) < v_today then return new; end if;
    if tg_op = 'INSERT' then
      if new.kind <> 'public' then perform kg_notify_closure(new, 'created'); end if;
    elsif old.tentative then
      perform kg_notify_closure(new, 'confirmed');
    elsif not old.closure then
      if new.kind <> 'public' then
        -- Switched on again after a lift: the stale 'created' rows go first so
        -- the once-per-kind index lets the new announcement in, and the
        -- reopening rows stop ringing.
        delete from kg_notifications
         where type = 'closure' and data->>'holidayId' = new.id::text and data->>'kind' = 'created';
        update kg_notifications set read_at = coalesce(read_at, now())
         where type = 'closure' and data->>'holidayId' = new.id::text and data->>'kind' = 'cancelled';
        perform kg_notify_closure(new, 'created');
      end if;
    elsif (old.date, old.end_date) is distinct from (new.date, new.end_date)
       or old.structure_id is distinct from new.structure_id then
      perform kg_notify_closure(new, 'confirmed');
    end if;
  exception when others then
    raise warning 'kg_holiday_notify_trg: %', sqlerrm;
  end;
  return new;
end $$;
revoke all on function public.kg_holiday_notify_trg() from public, anon, authenticated;
-- The trigger itself is unchanged (0159): after insert or update of date,
-- end_date, tentative, closure, structure_id.

-- ── 4. A deleted closure speaks like a lift ────────────────────────────────
-- BEFORE DELETE, as the session trigger: the row is still readable and the
-- notification rows are written in the same statement. A cascade from a
-- deleted structure is not a reopening — the structure's children are gone
-- with it — so the trigger stays quiet when the structure no longer exists.
create or replace function public.kg_holiday_delete_trg() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  begin
    if old.structure_id is null or exists (select 1 from kg_structures where id = old.structure_id) then
      perform kg_closure_lifted(old);
    end if;
  exception when others then
    raise warning 'kg_holiday_delete_trg: %', sqlerrm;
  end;
  return old;
end $$;
revoke all on function public.kg_holiday_delete_trg() from public, anon, authenticated;
drop trigger if exists kg_holiday_delete_notify on public.kg_holidays;
create trigger kg_holiday_delete_notify before delete on public.kg_holidays
  for each row execute function public.kg_holiday_delete_trg();

-- ── 5. Rehearsal (demo tenant; every row written here is deleted here) ─────
-- Dry run: keep the final `raise exception`. Apply: change it to `raise notice`.
-- The same block lives in supabase/tests/calendar_lifecycle.sql (section e2);
-- a change to one is a change to the other. Signed in as the owner (actor =
-- owner, so her own rows are never counted).
do $$
declare
  t uuid := '732bdf7d-775a-4ed7-875f-8c04ea4e4778';
  u_owner uuid := 'd9485859-48e8-4aad-85e7-d09e1cd16f4d';
  u_parent1 uuid := '22b11eb4-70ad-414c-9206-9adf41992bc8';
  ecole uuid := 'e1eadc36-2c75-4910-b35d-d3d116227097';
  creche uuid := '515ecf42-3a67-4304-86c6-66fafd6f7229';
  v_today date := (now() at time zone 'Africa/Algiers')::date;
  v_h uuid; h public.kg_holidays; n int; n2 int; v_t0 timestamptz := now();
begin
  if not exists (select 1 from public.kg_tenants where id = t) then
    raise notice '0161 rehearsal skipped: demo tenant absent'; return;
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);

  -- e2.1) an école-only break three months out: 'created' to the staff (bell-only), then the switch turned off
  insert into public.kg_holidays (tenant_id, date, end_date, name, name_ar, kind, structure_id, key)
  values (t, v_today + 100, v_today + 110, 'rehearsal break', 'عطلة تجريبية', 'school_break', ecole, 'school_break:rehearsal:0161')
  returning id into v_h;
  select count(*) into n from public.kg_notifications where type = 'closure' and data->>'holidayId' = v_h::text and data->>'kind' = 'created';
  if n = 0 then raise exception 'closure told nobody'; end if;
  update public.kg_holidays set closure = false where id = v_h;
  select count(*) into n from public.kg_notifications where type = 'closure' and data->>'holidayId' = v_h::text and data->>'kind' = 'cancelled';
  if n = 0 then raise exception 'a lifted closure told nobody'; end if;
  if exists (select 1 from public.kg_notifications where type = 'closure' and data->>'holidayId' = v_h::text and data->>'kind' = 'cancelled' and user_id = u_parent1) then raise exception 'an école reopening reached a crèche family'; end if;
  if exists (select 1 from public.kg_notifications where type = 'closure' and data->>'holidayId' = v_h::text and data->>'kind' = 'cancelled' and user_id = u_owner) then raise exception 'the actor was told about her own lift'; end if;
  if exists (select 1 from public.kg_notifications where type = 'closure' and data->>'holidayId' = v_h::text and data->>'kind' = 'cancelled' and pushed_at is null) then raise exception 'a reopening 3 months out must be bell-only'; end if;
  if exists (select 1 from public.kg_notifications where type = 'closure' and data->>'holidayId' = v_h::text and data->>'kind' = 'created' and read_at is null) then raise exception 'the created rows of a lifted closure must be read'; end if;
  -- e2.2) switched on again: 'created' lands again (the stale rows dropped), the reopening rows are read
  update public.kg_holidays set closure = true where id = v_h;
  select count(*) into n from public.kg_notifications where type = 'closure' and data->>'holidayId' = v_h::text and data->>'kind' = 'created' and read_at is null;
  if n = 0 then raise exception 'a re-set closure must announce itself again'; end if;
  if exists (select 1 from public.kg_notifications where type = 'closure' and data->>'holidayId' = v_h::text and data->>'kind' = 'cancelled' and read_at is null) then raise exception 'the cancelled rows of a re-set closure must be read'; end if;
  -- e2.3) lifted a second time on the same dates: the earlier 'cancelled' row is replaced, not silenced
  update public.kg_holidays set closure = false where id = v_h;
  select count(*) into n from public.kg_notifications where type = 'closure' and data->>'holidayId' = v_h::text and data->>'kind' = 'cancelled' and read_at is null;
  if n = 0 then raise exception 'a second lift must speak again'; end if;
  -- deleting the row while it is no longer a closure adds nothing: the reopening was already told
  delete from public.kg_holidays where id = v_h;
  select count(*) into n2 from public.kg_notifications where type = 'closure' and data->>'holidayId' = v_h::text and data->>'kind' = 'cancelled' and read_at is null;
  if n2 <> n then raise exception 'deleting a lifted row must not speak again (% → %)', n, n2; end if;
  delete from public.kg_notifications where type = 'closure' and data->>'holidayId' = v_h::text;

  -- e2.4) a whole-building closure next week, deleted: 'cancelled' reaches parent1 and rings (within 30 days)
  insert into public.kg_holidays (tenant_id, date, name, name_ar, kind)
  values (t, v_today + 7, 'rehearsal closure', 'غلق تجريبي', 'closure')
  returning id into v_h;
  delete from public.kg_holidays where id = v_h;
  if not exists (select 1 from public.kg_notifications where type = 'closure' and data->>'holidayId' = v_h::text and data->>'kind' = 'cancelled' and user_id = u_parent1) then raise exception 'a deleted building closure must tell the crèche families'; end if;
  if exists (select 1 from public.kg_notifications where type = 'closure' and data->>'holidayId' = v_h::text and data->>'kind' = 'cancelled' and pushed_at is not null) then raise exception 'a reopening next week must ring'; end if;
  if exists (select 1 from public.kg_notifications where type = 'closure' and data->>'holidayId' = v_h::text and data->>'kind' = 'cancelled' and data->>'date' <> (v_today + 7)::text) then raise exception 'the cancelled payload must carry the date the family was told'; end if;
  delete from public.kg_notifications where type = 'closure' and data->>'holidayId' = v_h::text;

  -- e2.5) a public date nobody was told about is deleted in silence; one whose eve was announced is not
  insert into public.kg_holidays (tenant_id, date, name, name_ar, kind)
  values (t, v_today + 8, 'rehearsal public', 'عطلة وطنية تجريبية', 'public')
  returning id into v_h;
  if exists (select 1 from public.kg_notifications where type = 'closure' and data->>'holidayId' = v_h::text) then raise exception 'a public date must not announce itself'; end if;
  delete from public.kg_holidays where id = v_h;
  if exists (select 1 from public.kg_notifications where type = 'closure' and data->>'holidayId' = v_h::text) then raise exception 'removing an unannounced public date must be silent'; end if;
  insert into public.kg_holidays (tenant_id, date, name, name_ar, kind)
  values (t, v_today + 8, 'rehearsal public', 'عطلة وطنية تجريبية', 'public')
  returning id into v_h;
  select * into h from public.kg_holidays where id = v_h;
  perform public.kg_notify_closure(h, 'reminder');
  delete from public.kg_holidays where id = v_h;
  if not exists (select 1 from public.kg_notifications where type = 'closure' and data->>'holidayId' = v_h::text and data->>'kind' = 'cancelled') then raise exception 'reopening on an announced public date must be told'; end if;
  if exists (select 1 from public.kg_notifications where type = 'closure' and data->>'holidayId' = v_h::text and data->>'kind' = 'reminder' and read_at is null) then raise exception 'the eve reminder of a reopened day must be read'; end if;
  delete from public.kg_notifications where type = 'closure' and data->>'holidayId' = v_h::text;

  -- e2.6) a past closure lifted or deleted is history, not news
  insert into public.kg_holidays (tenant_id, date, name, name_ar, kind, structure_id)
  values (t, v_today - 10, 'rehearsal past', 'غلق ماضٍ', 'closure', creche)
  returning id into v_h;
  update public.kg_holidays set closure = false where id = v_h;
  delete from public.kg_holidays where id = v_h;
  if exists (select 1 from public.kg_notifications where type = 'closure' and data->>'holidayId' = v_h::text) then raise exception 'a past closure must stay silent'; end if;

  -- e2.7) a tentative closure lifted is silent (it closed nothing)
  insert into public.kg_holidays (tenant_id, date, name, name_ar, kind, tentative)
  values (t, v_today + 9, 'rehearsal tentative', 'غلق مؤقت', 'religious', true)
  returning id into v_h;
  update public.kg_holidays set closure = false where id = v_h;
  delete from public.kg_holidays where id = v_h;
  if exists (select 1 from public.kg_notifications where type = 'closure' and data->>'holidayId' = v_h::text) then raise exception 'a tentative row must stay silent on the way out'; end if;

  -- e2.8) nothing of this block survives
  select count(*) into n from public.kg_notifications where tenant_id = t and created_at >= v_t0;
  if n <> 0 then raise exception '% notification rows left behind', n; end if;
  raise exception '0161 rehearsal ok — rolled back';
end $$;
notify pgrst, 'reload schema';
commit;
