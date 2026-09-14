-- psql -v ON_ERROR_STOP=1 -f supabase/tests/calendar_lifecycle.sql
-- The notification lifecycle of the calendar (0159), run against the
-- connected database AFTER 0157–0159 are applied and after every later
-- migration: one transaction, the demo tenant only, rolled back at the end so
-- nothing persists even when the file is pasted whole into the SQL editor.
--
-- These are the rehearsal blocks of 0159 and 0161 verbatim (each migration
-- ends its block with a `raise exception` for its dry run; here each ends
-- with a notice and the ROLLBACK below does the undoing). Keep them in step:
-- a change to one is a change to the other.
--
-- Signed in as the owner (actor = owner, so her own rows are never counted):
--   a) a crèche structure event moved to the préscolaire and back — 'removed'
--      to the crèche families, 'created' to the préscolaire's, 'created' AGAIN
--      to the re-added family with its stale row dropped and its 'removed'
--      row read; kg_event_reach counts one family and no staff after the
--      move; the payload's `time` keeps the ISO 8601 shape;
--   b) a room change is 'changed' with the room in the payload, a
--      description-only edit is silent;
--   c) cancelling tells everyone still told (parent3, last told 'removed',
--      hears nothing; parent1 hears it), marks the created rows read and
--      releases the room;
--   d) a far-future all-day staff event is bell-only, carries no clock and
--      buckets on its first day; deleted, its 'cancelled' rows are swept;
--   e) an école-only closure tells the staff and no crèche family, bell-only
--      three months out, leaves the crèche open; moving its dates announces
--      'confirmed'; widening it to the building reaches parent1;
--   f) a tentative row is silent;
--   g) Adam's session: created / rescheduled / changed / (note silent) /
--      cancelled / put back = rescheduled / hard delete = cancelled; no note
--      leaks; ISO times;
--   h) both push functions carry is_staff and anon keeps execute;
--   i) an exam on 2e année with parent3 temporarily linked to Amira: created,
--      changed on a date move, silent on a title edit; the link and the rows
--      its trigger wrote are swept with it;
--   j) zero notification rows of the block survive.
-- Then the rehearsal block of 0161, the same way (section e2):
--   e2) a lifted closure (switch off, or the row deleted) says 'cancelled' to
--       the same audience, bell-only three months out, ringing next week;
--       its earlier rows are read; switched on again it says 'created' again
--       and reads the reopening; a second lift speaks again; a public date
--       nobody was told about goes in silence, one whose eve was announced
--       does not; a past or tentative row stays silent on the way out.
-- Every source row is deleted before its notification rows are swept, so the
-- live delete triggers speak inside the block and are swept too.
\set ON_ERROR_STOP on
begin;
-- ── 8. Rehearsal (demo tenant; every row written here is deleted here) ─────
-- Signed in as the owner (actor = owner, so her own rows are not counted).
-- The crèche (3 guardian accounts) and the préscolaire (1) are the two
-- structures whose families can be told; the école has none.
do $$
declare
  t uuid := '732bdf7d-775a-4ed7-875f-8c04ea4e4778';
  u_owner uuid := 'd9485859-48e8-4aad-85e7-d09e1cd16f4d';
  u_parent1 uuid := '22b11eb4-70ad-414c-9206-9adf41992bc8';
  u_parent3 uuid := '75bf1c60-28a5-4dc3-848d-080fa168045f';
  g_parent3 uuid := '2f4c5af0-23aa-443a-8b0a-8f924b1429c5';
  ecole uuid := 'e1eadc36-2c75-4910-b35d-d3d116227097';
  creche uuid := '515ecf42-3a67-4304-86c6-66fafd6f7229';
  presco uuid := '6c54e142-2174-4e1a-af3f-69cedaa788c6';
  adam uuid := '809202b0-ab41-4523-8f4c-298aae11fa5e';
  amira uuid := '57349c3f-6b95-482b-9b11-42065bd4b367';
  cls_2e uuid := '067fe76f-3fee-4f29-a80d-f86c5f2e1adb';
  prog_2e uuid := '2d335b53-8e5c-46b8-a171-cc087200a958';
  -- now() = this transaction's start: every row this block writes (kg_notify
  -- stamps clock_timestamp()) is >= v_t0, and nothing older is.
  v_e uuid; v_h uuid; v_s uuid; v_x uuid; n int; n2 int; v_t0 timestamptz := now();
begin
  if not exists (select 1 from public.kg_tenants where id = t) then
    raise notice '0159 rehearsal skipped: demo tenant absent'; return;
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);

  -- a) a structure event moved from the crèche to the préscolaire: crèche families 'removed', préscolaire families 'created'
  insert into public.kg_events (tenant_id, title, start_at, end_at, audience, structure_id, created_by)
  values (t, 'rehearsal structure', now() + interval '3 days', now() + interval '3 days 2 hours', 'structure', creche, u_owner)
  returning id into v_e;
  select count(*) into n from public.kg_notifications where data->>'eventId' = v_e::text and data->>'kind' = 'created';
  if n = 0 then raise exception 'structure event notified nobody'; end if;
  if exists (select 1 from public.kg_notifications where data->>'eventId' = v_e::text and user_id = u_owner) then raise exception 'the actor was told about her own write'; end if;
  if exists (select 1 from public.kg_notifications where data->>'eventId' = v_e::text and jsonb_typeof(data->'time') <> 'string') then raise exception 'time must be an ISO string'; end if;
  if exists (select 1 from public.kg_notifications where data->>'eventId' = v_e::text and data->>'time' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}') then raise exception 'time must keep the 0097 ISO 8601 shape, got %', (select data->>'time' from public.kg_notifications where data->>'eventId' = v_e::text limit 1); end if;
  update public.kg_events set structure_id = presco where id = v_e;
  select count(*) into n from public.kg_notifications where data->>'eventId' = v_e::text and data->>'kind' = 'removed' and user_id = u_parent1;
  select count(*) into n2 from public.kg_notifications where data->>'eventId' = v_e::text and data->>'kind' = 'created' and user_id = u_parent3;
  if n = 0 then raise exception 'crèche families were not told the event no longer concerns them'; end if;
  if n2 = 0 then raise exception 'préscolaire families were not told'; end if;
  -- reach counts by the latest row: the three crèche accounts (removed) are out, parent3 is in, no staff
  select r.families, r.staff into n, n2 from public.kg_event_reach(t, array[v_e]) r;
  if coalesce(n, -1) <> 1 or coalesce(n2, -1) <> 0 then raise exception 'kg_event_reach must count the latest row per person (families %, staff %)', n, n2; end if;
  -- moved back to the crèche: parent1 hears 'created' again (her stale created row was dropped, her removed row read)
  update public.kg_events set structure_id = creche where id = v_e;
  select count(*) into n from public.kg_notifications where data->>'eventId' = v_e::text and data->>'kind' = 'created' and user_id = u_parent1 and created_at >= v_t0;
  if n <> 1 then raise exception 'a re-added family must hear created again, got %', n; end if;
  if exists (select 1 from public.kg_notifications where data->>'eventId' = v_e::text and data->>'kind' = 'removed' and user_id = u_parent1 and read_at is null) then raise exception 'the removed row of a re-added family must be read'; end if;
  -- b) a room change notifies 'changed'; a description-only change is silent
  update public.kg_events set room_id = '8fb6d13d-6e27-4fe1-bd48-3f039b97a269' where id = v_e;
  select count(*) into n from public.kg_notifications where data->>'eventId' = v_e::text and data->>'kind' = 'changed';
  if n = 0 then raise exception 'room change notified nobody'; end if;
  if not exists (select 1 from public.kg_notifications where data->>'eventId' = v_e::text and data->>'kind' = 'changed' and data->>'roomName' = 'Cour') then raise exception 'changed payload must carry the room'; end if;
  update public.kg_events set description = 'typo fixed' where id = v_e;
  select count(*) into n2 from public.kg_notifications where data->>'eventId' = v_e::text and data->>'kind' = 'changed';
  if n2 <> n then raise exception 'description-only edit must be silent'; end if;
  -- c) cancelling tells everyone still told (parent3 heard 'removed' last: not told), marks rows read, releases the room
  update public.kg_events set cancelled_at = now(), cancelled_by = u_owner where id = v_e;
  select count(*) into n from public.kg_notifications where data->>'eventId' = v_e::text and data->>'kind' = 'cancelled';
  if n = 0 then raise exception 'cancellation told nobody'; end if;
  if exists (select 1 from public.kg_notifications where data->>'eventId' = v_e::text and data->>'kind' = 'cancelled' and user_id = u_parent3) then raise exception 'a family whose last word was removed must not hear the cancellation'; end if;
  if not exists (select 1 from public.kg_notifications where data->>'eventId' = v_e::text and data->>'kind' = 'cancelled' and user_id = u_parent1) then raise exception 'the re-added family must hear the cancellation'; end if;
  select count(*) into n from public.kg_notifications where data->>'eventId' = v_e::text and data->>'kind' = 'created' and read_at is null;
  if n <> 0 then raise exception 'created rows of a cancelled event must be read'; end if;
  if exists (select 1 from kg_scheduler_private.room_bookings where source_id = v_e) then raise exception 'cancelled event still books its room'; end if;
  delete from public.kg_events where id = v_e;
  delete from public.kg_notifications where type = 'event' and data->>'eventId' = v_e::text;
  -- d) a far-future all-day staff event is bell-only, carries no clock and buckets on its first day
  insert into public.kg_events (tenant_id, title, start_at, end_at, all_day, audience, created_by)
  values (t, 'rehearsal all day', '2027-03-08 00:00+01', '2027-03-09 00:00+01', true, 'staff', u_owner)
  returning id into v_e;
  if not exists (select 1 from public.kg_notifications where data->>'eventId' = v_e::text) then raise exception 'staff event told no staff'; end if;
  if exists (select 1 from public.kg_notifications where data->>'eventId' = v_e::text and pushed_at is null) then raise exception 'far-future event must be bell-only'; end if;
  if exists (select 1 from public.kg_notifications where data->>'eventId' = v_e::text and data->>'time' <> '') then raise exception 'all-day payload must carry no time'; end if;
  if not exists (select 1 from public.kg_notifications where data->>'eventId' = v_e::text and data->>'date' = '2027-03-08') then raise exception 'all-day event buckets on the wrong day'; end if;
  -- hygiene: the source row first (the delete trigger writes 'cancelled' rows for a future event), then the sweep
  delete from public.kg_events where id = v_e;
  delete from public.kg_notifications where type = 'event' and data->>'eventId' = v_e::text;
  -- e) a per-structure confirmed closure tells the école's families (none) and the staff; the crèche stays open
  insert into public.kg_holidays (tenant_id, date, end_date, name, name_ar, kind, structure_id, key)
  values (t, '2026-12-17', '2027-01-03', 'Vacances d''hiver', 'عطلة الشتاء', 'school_break', ecole, 'school_break:winter:2026')
  returning id into v_h;
  select count(*) into n from public.kg_notifications where type = 'closure' and data->>'holidayId' = v_h::text and data->>'kind' = 'created';
  if n = 0 then raise exception 'closure told nobody'; end if;
  if exists (select 1 from public.kg_notifications where type = 'closure' and data->>'holidayId' = v_h::text and user_id = u_parent1) then raise exception 'an école closure reached a crèche family'; end if;
  if exists (select 1 from public.kg_notifications where type = 'closure' and data->>'holidayId' = v_h::text and pushed_at is null) then raise exception 'a closure 3 months out must be bell-only'; end if;
  if public.kg_structure_closed_on(creche, t, date '2026-12-20') then raise exception 'crèche must stay open'; end if;
  -- moving a confirmed closure notifies again (per-date key); widening it to the building tells the crèche families
  update public.kg_holidays set end_date = '2027-01-04' where id = v_h;
  select count(*) into n from public.kg_notifications where type = 'closure' and data->>'holidayId' = v_h::text and data->>'kind' = 'confirmed';
  if n = 0 then raise exception 'a moved closure must be announced'; end if;
  update public.kg_holidays set structure_id = null where id = v_h;
  if not exists (select 1 from public.kg_notifications where type = 'closure' and data->>'holidayId' = v_h::text and data->>'kind' = 'confirmed' and user_id = u_parent1) then raise exception 'widening a closure to the building must tell the new families'; end if;
  delete from public.kg_holidays where id = v_h;
  delete from public.kg_notifications where type = 'closure' and data->>'holidayId' = v_h::text;
  -- f) a tentative insert is silent
  insert into public.kg_holidays (tenant_id, date, name, name_ar, kind, tentative, key)
  values (t, '2027-03-09', 'Aïd el-Fitr', 'عيد الفطر', 'religious', true, 'religious:eid_fitr:1448') returning id into v_h;
  if exists (select 1 from public.kg_notifications where type = 'closure' and data->>'holidayId' = v_h::text) then raise exception 'a tentative row must be silent'; end if;
  delete from public.kg_holidays where id = v_h;
  -- g) a session for parent1's child: created, rescheduled, changed, cancelled — one row each, no notes, ISO times
  insert into public.kg_sessions (tenant_id, child_id, session_type, therapist_id, scheduled_at, duration_min, status, notes, created_by)
  values (t, adam, 'speech', '791ee0f0-6451-47e3-8b3a-1b064fb81333', '2026-09-22 18:30+01', 30, 'scheduled', 'CLINICAL', u_owner)
  returning id into v_s;
  select count(*) into n from public.kg_notifications where type = 'session_scheduled' and data->>'sessionId' = v_s::text and data->>'kind' = 'created';
  if n <> 1 then raise exception 'session created must reach parent1 once, got %', n; end if;
  if exists (select 1 from public.kg_notifications where type = 'session_scheduled' and data->>'sessionId' = v_s::text and data::text like '%CLINICAL%') then raise exception 'notes leaked'; end if;
  if exists (select 1 from public.kg_notifications where type = 'session_scheduled' and data->>'sessionId' = v_s::text and data->>'time' !~ '^\d{4}-\d{2}-\d{2}T') then raise exception 'session time must be ISO 8601'; end if;
  update public.kg_sessions set scheduled_at = '2026-09-22 19:00+01' where id = v_s;
  if not exists (select 1 from public.kg_notifications where type = 'session_scheduled' and data->>'sessionId' = v_s::text and data->>'kind' = 'rescheduled') then raise exception 'reschedule told nobody'; end if;
  update public.kg_sessions set room_id = '76b4acc9-08b8-4381-a507-cfe2e1923f60' where id = v_s;
  if not exists (select 1 from public.kg_notifications where type = 'session_scheduled' and data->>'sessionId' = v_s::text and data->>'kind' = 'changed') then raise exception 'room change told nobody'; end if;
  update public.kg_sessions set notes = 'outcome typed' where id = v_s;
  select count(*) into n from public.kg_notifications where type = 'session_scheduled' and data->>'sessionId' = v_s::text;
  if n <> 3 then raise exception 'an outcome edit must be silent (rows: %)', n; end if;
  update public.kg_sessions set status = 'cancelled' where id = v_s;
  if not exists (select 1 from public.kg_notifications where type = 'session_scheduled' and data->>'sessionId' = v_s::text and data->>'kind' = 'cancelled') then raise exception 'cancel told nobody'; end if;
  update public.kg_sessions set status = 'scheduled' where id = v_s;
  select count(*) into n from public.kg_notifications where type = 'session_scheduled' and data->>'sessionId' = v_s::text and data->>'kind' = 'rescheduled';
  if n <> 2 then raise exception 'putting a cancelled appointment back must announce a new date, got %', n; end if;
  delete from public.kg_sessions where id = v_s;
  select count(*) into n from public.kg_notifications where type = 'session_scheduled' and data->>'sessionId' = v_s::text and data->>'kind' = 'cancelled';
  if n <> 2 then raise exception 'a hard delete of a future appointment must speak like a cancellation, got %', n; end if;
  delete from public.kg_notifications where type = 'session_scheduled' and data->>'sessionId' = v_s::text;
  -- h) push rows know who is staff, and the anon caller still reaches them
  if not exists (select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
                  where ns.nspname = 'public' and p.proname = 'kg_pending_push'
                    and pg_get_function_result(p.oid) like '%is_staff boolean%') then
    raise exception 'kg_pending_push lacks is_staff';
  end if;
  if not has_function_privilege('anon', 'public.kg_pending_push(text, int)', 'execute')
     or not has_function_privilege('anon', 'public.kg_pending_native_push(text, int)', 'execute') then
    raise exception 'the push dispatcher (anon) lost its grant';
  end if;
  -- i) an exam date reaches the class's families: parent3 is linked to Amira (2e année) for the
  --    length of this block; the link trigger's own rows are swept with it
  insert into public.kg_child_guardians (child_id, guardian_id, is_primary, can_pickup, is_financial)
  values (amira, g_parent3, false, false, false);
  insert into public.kg_learning_assessments (tenant_id, class_id, program_id, title, kind, scheduled_on, max_score, published)
  values (t, cls_2e, prog_2e, 'rehearsal exam', 'exam', '2026-10-06', 20, false)
  returning id into v_x;
  if not exists (select 1 from public.kg_notifications where type = 'assessment_scheduled' and data->>'assessmentId' = v_x::text and data->>'kind' = 'created' and user_id = u_parent3) then
    raise exception 'exam date told no family';
  end if;
  update public.kg_learning_assessments set scheduled_on = '2026-10-07' where id = v_x;
  if not exists (select 1 from public.kg_notifications where type = 'assessment_scheduled' and data->>'assessmentId' = v_x::text and data->>'kind' = 'changed') then raise exception 'moved exam told nobody'; end if;
  update public.kg_learning_assessments set title = 'rehearsal exam (renamed)' where id = v_x;
  select count(*) into n from public.kg_notifications where type = 'assessment_scheduled' and data->>'assessmentId' = v_x::text;
  if n <> 2 then raise exception 'a title edit must be silent (rows: %)', n; end if;
  delete from public.kg_learning_assessments where id = v_x;
  delete from public.kg_child_guardians where child_id = amira and guardian_id = g_parent3;
  delete from public.kg_notifications where type = 'assessment_scheduled' and data->>'assessmentId' = v_x::text;
  -- the link trigger (kg_on_guardian_link_change) told Amira's family and wrote an audit line, twice (link, unlink)
  delete from public.kg_notifications where tenant_id = t and type in ('guardian_access_changed', 'parent_update') and created_at >= v_t0;
  delete from public.kg_audit_log where tenant_id = t and entity = 'kg_child_guardians' and entity_id = amira::text and created_at >= v_t0;
  -- j) nothing of this block survives
  select count(*) into n from public.kg_notifications where tenant_id = t and created_at >= v_t0;
  if n <> 0 then raise exception '% notification rows left behind', n; end if;
  raise notice '0159 rehearsal ok — every write of this block is rolled back below';
end $;
-- ── 0161: a lifted closure speaks too (section e2; kept in step with the migration) ──
do $
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
  raise notice '0161 rehearsal ok — every write of this block is rolled back below';
end $;
rollback;
select 'PASS: calendar lifecycle — events created/changed/removed/cancelled, closures created/confirmed/cancelled, sessions created/rescheduled/changed/cancelled, the exam date, the push shape; nothing survives the block' result;
