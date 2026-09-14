-- 0159 — the calendar reaches the people it concerns, both ways.
--
--   events     every material change notifies (structure, end, room, all-day
--              included), a cancellation tells everyone still told, a removed
--              family hears "no longer concerns you" (and hears "new event"
--              again if re-added), the author is reminded the day before, the
--              payload carries the room and the Arabic names; RSVP from each
--              guardian, a count for the director. The actor of every row is
--              the person doing the write (auth.uid(), cancelled_by for a
--              cancellation), never the event's author by assumption.
--   closures   type 'closure': created / confirmed / reminder, once per
--              person per holiday per kind (per date for 'confirmed').
--   sessions   type 'session_scheduled': created / rescheduled / changed /
--              cancelled / reminder to the child's family; a hard delete of a
--              future appointment speaks like a cancellation.
--   assessments type 'assessment_scheduled': a test or exam date reaches the
--              class's families when set or moved.
--   leave      type 'leave': the member hears the decision.
--   push       kg_pending_push / kg_pending_native_push say whether the
--              recipient is staff, so the push URL never sends a parent to
--              /calendar.
-- Payload times are timestamptz values in jsonb (ISO 8601 with offset, the
-- 0097 shape `new Date()` parses everywhere), never `::text`. Every trigger
-- body and every reminder ROW is wrapped as 0092 taught: a notification never
-- aborts the write that caused it, and one bad row never cancels a day's
-- reminders for every tenant.
begin;
set local lock_timeout = '5s';

-- ── 0. The types the app knows how to render ───────────────────────────────
alter table public.kg_notifications drop constraint if exists kg_notifications_type_known;
alter table public.kg_notifications add constraint kg_notifications_type_known check (type = any (array[
  'message','incident','announcement','application','checkin','checkout','daily_report','task',
  'activity_request','parent_update','payment_overdue','consent_changed','pickup_changed',
  'guardian_access_changed','allergy_changed','health_changed','incident_updated',
  'enrollment_changed','invoice_issued','payment_recorded','payment_reversed','fee_changed',
  'attendance_flagged','activity_decision','session_published','application_status','event',
  'advance_requested','advance_approved','advance_rejected',
  'structure_changed',
  'closure','session_scheduled','assessment_scheduled','leave'
])) not valid;
alter table public.kg_notifications validate constraint kg_notifications_type_known;

-- ── 1. Events ──────────────────────────────────────────────────────────────
-- Same signature as 0097 (replaced in place; the 0091 triggers keep
-- resolving). Payload gains the Arabic class name, the structure, the room,
-- the end, all_day; `time`/`endTime` are '' for an all-day row (the renderer
-- collapses '' and formats only when every placeholder exists). The actor:
-- null on a reminder (the author hears it too), cancelled_by on a
-- cancellation, otherwise whoever is writing (auth.uid()), falling back to the
-- author only when nobody is signed in (a cron, the SQL editor).
create or replace function public.kg_notify_event(
  p_event public.kg_events, p_kind text, p_recipients uuid[]
) returns integer
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_class kg_classes; v_structure kg_structures; v_room kg_rooms; v_sent int; v_actor uuid;
begin
  if p_recipients is null or array_length(p_recipients, 1) is null then return 0; end if;
  select * into v_class from kg_classes where id = p_event.class_id;
  select * into v_structure from kg_structures where id = p_event.structure_id;
  select * into v_room from kg_rooms where id = p_event.room_id;
  v_actor := case p_kind
    when 'reminder' then null
    when 'cancelled' then coalesce(p_event.cancelled_by, auth.uid(), p_event.created_by)
    else coalesce(auth.uid(), p_event.created_by) end;

  v_sent := kg_notify(
    p_event.tenant_id, p_recipients, 'event',
    p_event.title,
    left(coalesce(p_event.description, ''), 140),
    jsonb_build_object(
      'eventId', p_event.id,
      'kind', p_kind,
      'classId', p_event.class_id,
      'className', coalesce(v_class.name, ''),
      'classNameAr', coalesce(v_class.name_ar, ''),
      'structureId', p_event.structure_id,
      'structureName', coalesce(v_structure.name, ''),
      'structureNameAr', coalesce(v_structure.name_ar, ''),
      'roomName', coalesce(v_room.name, ''),
      'roomNameAr', coalesce(v_room.name_ar, ''),
      'date', (p_event.start_at at time zone 'Africa/Algiers')::date,
      'time', case when p_event.all_day then to_jsonb(''::text) else to_jsonb(p_event.start_at) end,
      'endTime', case when p_event.all_day or p_event.end_at is null then to_jsonb(''::text) else to_jsonb(p_event.end_at) end,
      'allDay', p_event.all_day,
      'description', left(coalesce(p_event.description, ''), 140),
      'audience', case when p_event.audience::text = 'staff' then 'staff' else 'both' end),
    v_actor);

  -- More than 30 days out is news, not an interruption: bell only, for a
  -- creation and for a cancellation alike (a class deletion cascading its
  -- far-future events must not ring every phone).
  if p_kind in ('created', 'cancelled') and p_event.start_at > now() + interval '30 days' then
    update kg_notifications set pushed_at = now()
     where type = 'event' and data->>'eventId' = p_event.id::text and data->>'kind' = p_kind and pushed_at is null;
  end if;
  return v_sent;
end $$;
revoke all on function public.kg_notify_event(public.kg_events, text, uuid[]) from public, anon, authenticated;

-- Everyone still told about this event — by their LATEST row: a person whose
-- last word was 'removed' has already heard it no longer concerns them — plus
-- its current audience: the people to tell when it is called off.
create or replace function public.kg_event_told(e public.kg_events) returns uuid[]
language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce(array_agg(distinct u), '{}'::uuid[]) from (
    select n.user_id as u from kg_notifications n
     where n.type = 'event' and n.data->>'eventId' = e.id::text
     group by n.user_id
    having (array_agg(n.data->>'kind' order by n.created_at desc, n.id desc))[1] <> 'removed'
    union
    select unnest(kg_event_recipients(e))
  ) x where u is not null
$$;
revoke all on function public.kg_event_told(public.kg_events) from public, anon, authenticated;

create or replace function public.kg_on_event_insert() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  begin
    if new.cancelled_at is not null or coalesce(new.end_at, new.start_at) <= now() then return new; end if;
    perform kg_notify_event(new, 'created', kg_event_recipients(new));
  exception when others then
    raise warning 'kg_on_event_insert: %', sqlerrm;
  end;
  return new;
end $$;
revoke all on function public.kg_on_event_insert() from public, anon, authenticated;

-- scope  = audience, class_id, structure_id   → added 'created' (a family removed earlier
--                                                and re-added hears 'created' again: its
--                                                stale 'created' row is dropped first, so
--                                                the 0092 dedupe index lets the new one in),
--                                                removed 'removed', kept 'changed' if when/where moved
-- when   = start_at, end_at, all_day, title   → 'changed'
-- where  = room_id                            → 'changed' (bell only beyond 7 days)
-- text   = description                        → silent
-- cancel = cancelled_at null → set            → 'cancelled' to everyone still told; their created/reminder/changed rows marked read
-- restore = cancelled_at set → null           → 'changed' to the current audience
create or replace function public.kg_on_event_update() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_old uuid[]; v_new uuid[]; v_added uuid[]; v_removed uuid[]; v_kept uuid[];
        v_scope boolean; v_when boolean; v_where boolean;
begin
  begin
    if old.cancelled_at is null and new.cancelled_at is not null then
      if coalesce(old.end_at, old.start_at) > now() then
        perform kg_notify_event(new, 'cancelled', kg_event_told(old));
        update kg_notifications set read_at = coalesce(read_at, now())
         where type = 'event' and data->>'eventId' = new.id::text and data->>'kind' in ('created', 'reminder', 'changed');
      end if;
      return new;
    end if;
    if new.cancelled_at is not null then return new; end if;
    if old.cancelled_at is not null and new.cancelled_at is null then
      if coalesce(new.end_at, new.start_at) > now() then
        perform kg_notify_event(new, 'changed', kg_event_recipients(new));
      end if;
      return new;
    end if;
    if coalesce(new.end_at, new.start_at) <= now() and coalesce(old.end_at, old.start_at) <= now() then return new; end if;

    v_scope := old.audience is distinct from new.audience
            or old.class_id is distinct from new.class_id
            or old.structure_id is distinct from new.structure_id;
    v_when  := old.start_at is distinct from new.start_at
            or old.end_at is distinct from new.end_at
            or old.all_day is distinct from new.all_day
            or old.title is distinct from new.title;
    v_where := old.room_id is distinct from new.room_id;
    if not (v_scope or v_when or v_where) then return new; end if;

    v_new := kg_event_recipients(new);
    if v_scope then
      v_old := kg_event_recipients(old);
      select coalesce(array_agg(u), '{}'::uuid[]) into v_added from unnest(coalesce(v_new, '{}'::uuid[])) u where u <> all (coalesce(v_old, '{}'::uuid[]));
      select coalesce(array_agg(u), '{}'::uuid[]) into v_removed from unnest(coalesce(v_old, '{}'::uuid[])) u where u <> all (coalesce(v_new, '{}'::uuid[]));
      select coalesce(array_agg(u), '{}'::uuid[]) into v_kept from unnest(coalesce(v_new, '{}'::uuid[])) u where u = any (coalesce(v_old, '{}'::uuid[]));
      if array_length(v_added, 1) is not null and coalesce(new.end_at, new.start_at) > now() then
        delete from kg_notifications
         where type = 'event' and data->>'eventId' = new.id::text and data->>'kind' = 'created' and user_id = any (v_added);
        update kg_notifications set read_at = coalesce(read_at, now())
         where type = 'event' and data->>'eventId' = new.id::text and data->>'kind' = 'removed' and user_id = any (v_added);
        perform kg_notify_event(new, 'created', v_added);
      end if;
      if array_length(v_removed, 1) is not null then
        perform kg_notify_event(old, 'removed', v_removed);
      end if;
      if (v_when or v_where) and array_length(v_kept, 1) is not null then
        perform kg_notify_event(new, 'changed', v_kept);
      end if;
    else
      perform kg_notify_event(new, 'changed', v_new);
    end if;
    -- A room swap a month out is bell-worthy, not phone-worthy.
    if v_where and not v_when and not v_scope and new.start_at > now() + interval '7 days' then
      update kg_notifications set pushed_at = now()
       where type = 'event' and data->>'eventId' = new.id::text and data->>'kind' = 'changed' and pushed_at is null;
    end if;
  exception when others then
    raise warning 'kg_on_event_update: %', sqlerrm;
  end;
  return new;
end $$;
revoke all on function public.kg_on_event_update() from public, anon, authenticated;

-- A hard delete of a future event that was never cancelled still tells the
-- people who were told — with no 7-day cap. The dialog only offers Delete
-- for rows nobody was told about; a cascade (class deletion) still speaks.
create or replace function public.kg_on_event_delete() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  begin
    if old.cancelled_at is null and coalesce(old.end_at, old.start_at) > now() then
      perform kg_notify_event(old, 'cancelled', kg_event_told(old));
    end if;
  exception when others then
    raise warning 'kg_on_event_delete: %', sqlerrm;
  end;
  return old;
end $$;
revoke all on function public.kg_on_event_delete() from public, anon, authenticated;

-- Day-before reminders: cancelled rows skipped; an all-day row is bucketed on
-- its first day (00:00 Algiers) and its 36-hour suppression is measured from
-- 09:00 of that day, so a trip created two days ahead at 14:00 is still
-- reminded. The author is a recipient too when still an active member. Each
-- row is wrapped: one bad row never silences the rest.
create or replace function public.kg_remind_tomorrows_events() returns integer
language plpgsql security definer set search_path = pg_catalog, public as $$
declare e kg_events; v_sent int := 0; v_to uuid[];
begin
  for e in
    select ev.* from kg_events ev
     where ev.cancelled_at is null
       and (ev.start_at at time zone 'Africa/Algiers')::date = ((now() at time zone 'Africa/Algiers')::date + 1)
       and ev.created_at <= ev.start_at + case when ev.all_day then interval '9 hours' else interval '0' end - interval '36 hours'
  loop
    begin
      v_to := kg_event_recipients(e);
      if e.created_by is not null and exists (select 1 from kg_memberships m
             where m.tenant_id = e.tenant_id and m.user_id = e.created_by and m.status = 'active') then
        v_to := array_append(v_to, e.created_by);
      end if;
      v_sent := v_sent + kg_notify_event(e, 'reminder', v_to);
    exception when others then
      raise warning 'kg_remind_tomorrows_events(%): %', e.id, sqlerrm;
    end;
  end loop;
  return v_sent;
end $$;
revoke all on function public.kg_remind_tomorrows_events() from public, anon, authenticated;

-- Existing rows gain the Arabic class name, the structure and the room, as
-- 0097 did for the description, so the feed does not stay poorer than
-- tomorrow's rows. endTime keeps the 0097 shape (a timestamptz in jsonb).
update public.kg_notifications n
   set data = n.data || jsonb_build_object('classNameAr', coalesce(c.name_ar, ''))
  from public.kg_events e left join public.kg_classes c on c.id = e.class_id
 where n.type = 'event' and n.data->>'eventId' = e.id::text and not (n.data ? 'classNameAr');
update public.kg_notifications n
   set data = n.data || jsonb_build_object('structureName', coalesce(s.name, ''), 'structureNameAr', coalesce(s.name_ar, ''),
                                           'roomName', coalesce(r.name, ''), 'roomNameAr', coalesce(r.name_ar, ''),
                                           'endTime', coalesce(to_jsonb(e.end_at), to_jsonb(''::text)), 'allDay', false)
  from public.kg_events e left join public.kg_structures s on s.id = e.structure_id left join public.kg_rooms r on r.id = e.room_id
 where n.type = 'event' and n.data->>'eventId' = e.id::text and not (n.data ? 'roomName');

-- ── 2. RSVP: "J'y serai" from each guardian, a count for the director ──────
-- One row per PERSON: two guardians of one child answer separately and both
-- count; the dialog says "par personne". `asked` counts recipient users.
create table if not exists public.kg_event_responses (
  event_id uuid not null references public.kg_events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  tenant_id uuid not null references public.kg_tenants(id) on delete cascade,
  response text not null check (response in ('going', 'not_going')),
  note text check (length(note) <= 280),
  responded_at timestamptz not null default now(),
  primary key (event_id, user_id)
);
alter table public.kg_event_responses enable row level security;
-- A member answers, once, on an event of THEIR tenant that asked (rsvp) and
-- has not started; the event's tenant and the row's tenant are the same row
-- (qualified: an unqualified tenant_id inside the EXISTS binds to kg_events).
-- Educators read every answer of the tenant.
drop policy if exists rsp_own_sel on public.kg_event_responses;
create policy rsp_own_sel on public.kg_event_responses for select
  using (user_id = auth.uid() or kg_is_educator(tenant_id));
drop policy if exists rsp_own_ins on public.kg_event_responses;
create policy rsp_own_ins on public.kg_event_responses for insert with check (
  user_id = auth.uid() and kg_is_member(tenant_id) and exists (
    select 1 from public.kg_events e
     where e.id = kg_event_responses.event_id and e.tenant_id = kg_event_responses.tenant_id and e.rsvp
       and e.cancelled_at is null and coalesce(e.end_at, e.start_at) > now()));
drop policy if exists rsp_own_upd on public.kg_event_responses;
create policy rsp_own_upd on public.kg_event_responses for update using (user_id = auth.uid()) with check (
  user_id = auth.uid() and exists (
    select 1 from public.kg_events e
     where e.id = kg_event_responses.event_id and e.tenant_id = kg_event_responses.tenant_id and e.rsvp
       and e.cancelled_at is null and coalesce(e.end_at, e.start_at) > now()));
drop policy if exists rsp_own_del on public.kg_event_responses;
create policy rsp_own_del on public.kg_event_responses for delete using (user_id = auth.uid());
grant select, insert, update, delete on public.kg_event_responses to authenticated;

-- going · not_going · asked (family recipients of the event, resolved now — never
-- kg_event_audience_count, which is 0 once the event has started). NULL-safe:
-- a NULL element in `all(...)` would make `asked` 0 forever.
create or replace function public.kg_event_rsvp_summary(p_event uuid)
returns table (going int, not_going int, asked int)
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare e kg_events; v_staff uuid[];
begin
  select * into e from kg_events where id = p_event;
  if e.id is null or not kg_is_educator(e.tenant_id) then return; end if;
  select coalesce(array_agg(u), '{}'::uuid[]) into v_staff from kg_staff_user_ids(e.tenant_id) u where u is not null;
  return query
    select (select count(*)::int from kg_event_responses r where r.event_id = e.id and r.response = 'going'),
           (select count(*)::int from kg_event_responses r where r.event_id = e.id and r.response = 'not_going'),
           (select count(*)::int from unnest(kg_event_recipients(e)) u where u is not null and u <> all (v_staff));
end $$;
revoke all on function public.kg_event_rsvp_summary(uuid) from public, anon;
grant execute on function public.kg_event_rsvp_summary(uuid) to authenticated;

-- ── 3. Push: who the recipient is, decided by the database ─────────────────
-- A new column in RETURNS TABLE cannot be REPLACEd: drop and recreate, then
-- re-issue the grants in house style — revoke from public, grant to the roles
-- that call it (push-server.ts calls both with the anon key; the secret gates
-- the body). Verified 2026-09-12: kg_pending_push carried a PUBLIC grant,
-- kg_pending_native_push anon + authenticated; both keep working for anon.
drop function if exists public.kg_pending_push(text, int);
drop function if exists public.kg_pending_native_push(text, int);
create function public.kg_pending_push(p_secret text, p_limit int default 200)
returns table (
  notification_id uuid, user_id uuid, locale text, type text,
  title text, body text, data jsonb, created_at timestamptz,
  endpoint text, p256dh text, auth text, is_staff boolean
) language plpgsql stable security definer set search_path = public as $$
begin
  if not kg_push_secret_ok(p_secret) then raise exception 'forbidden'; end if;
  return query
    select n.id, n.user_id, coalesce(pr.locale, t.default_locale, 'ar'), n.type,
           n.title, n.body, n.data, n.created_at,
           s.endpoint, s.p256dh, s.auth,
           exists (select 1 from kg_memberships m where m.user_id = n.user_id and m.tenant_id = n.tenant_id
                     and m.status = 'active' and m.role <> 'parent')
      from kg_notifications n
      join kg_push_subscriptions s on s.user_id = n.user_id
      left join kg_profiles pr on pr.id = n.user_id
      left join kg_tenants t on t.id = n.tenant_id
     where n.pushed_at is null
       and n.created_at > now() - interval '1 day'
     order by n.created_at
     limit p_limit;
end $$;
create function public.kg_pending_native_push(p_secret text, p_limit int default 200)
returns table (
  notification_id uuid, user_id uuid, locale text, type text,
  title text, body text, data jsonb, created_at timestamptz,
  token text, platform text, is_staff boolean
) language plpgsql stable security definer set search_path = public as $$
begin
  if not kg_push_secret_ok(p_secret) then raise exception 'forbidden'; end if;
  return query
    select n.id, n.user_id, coalesce(pr.locale, t.default_locale, 'ar'), n.type,
           n.title, n.body, n.data, n.created_at,
           d.token, d.platform,
           exists (select 1 from kg_memberships m where m.user_id = n.user_id and m.tenant_id = n.tenant_id
                     and m.status = 'active' and m.role <> 'parent')
      from kg_notifications n
      join kg_push_devices d on d.user_id = n.user_id
      left join kg_profiles pr on pr.id = n.user_id
      left join kg_tenants t on t.id = n.tenant_id
     where n.pushed_at is null
       and n.created_at > now() - interval '1 day'
     order by n.created_at
     limit p_limit;
end $$;
revoke all on function public.kg_pending_push(text, int) from public;
revoke all on function public.kg_pending_native_push(text, int) from public;
grant execute on function public.kg_pending_push(text, int) to anon, authenticated, service_role;
grant execute on function public.kg_pending_native_push(text, int) to anon, authenticated, service_role;

-- ── 4. Closures tell people ────────────────────────────────────────────────
-- Once per person per holiday per kind; 'confirmed' also per date, so a second
-- correction of an Aïd is announced (the first index shape would silence it).
create unique index if not exists kg_notifications_closure_once
  on public.kg_notifications (user_id, (data->>'holidayId'), (data->>'kind'), (data->>'date'))
  where type = 'closure';

-- The families of the enrolled children of that structure (all, when the
-- closure is the building's) and the staff.
create or replace function public.kg_closure_recipients(h public.kg_holidays) returns uuid[]
language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce(array_agg(distinct u), '{}'::uuid[]) from (
    select p as u from kg_children c, lateral kg_parent_user_ids(c.id) p
     where c.tenant_id = h.tenant_id and c.status = 'enrolled'
       and (h.structure_id is null or c.structure_id = h.structure_id)
    union
    select s from kg_staff_user_ids(h.tenant_id) s
  ) everyone where u is not null
$$;
revoke all on function public.kg_closure_recipients(public.kg_holidays) from public, anon, authenticated;

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
  -- beyond 30 days it is the bell only, the rule events already follow.
  if p_kind in ('created', 'confirmed') and h.date > (now() at time zone 'Africa/Algiers')::date + 30 then
    update kg_notifications set pushed_at = now()
     where type = 'closure' and data->>'holidayId' = h.id::text and data->>'kind' = p_kind and pushed_at is null;
  end if;
  return v_sent;
end $$;
revoke all on function public.kg_notify_closure(public.kg_holidays, text) from public, anon, authenticated;

-- created:   a CONFIRMED closure appears (insert, or the closure switch turned
--            on, or a confirmed row that was not a closure) — kind public
--            excluded, the generated national dates are not news.
-- confirmed: tentative → confirmed, a confirmed closure's dates move, or its
--            scope changes (école-only → whole building tells the new audience).
-- Never for a past day, never for a tentative row.
create or replace function public.kg_holiday_notify_trg() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_today date := (now() at time zone 'Africa/Algiers')::date;
begin
  begin
    if not new.closure or new.tentative or coalesce(new.end_date, new.date) < v_today then return new; end if;
    if tg_op = 'INSERT' then
      if new.kind <> 'public' then perform kg_notify_closure(new, 'created'); end if;
    elsif old.tentative then
      perform kg_notify_closure(new, 'confirmed');
    elsif not old.closure then
      if new.kind <> 'public' then perform kg_notify_closure(new, 'created'); end if;
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
drop trigger if exists kg_holiday_notify on public.kg_holidays;
create trigger kg_holiday_notify after insert or update of date, end_date, tentative, closure, structure_id on public.kg_holidays
  for each row execute function public.kg_holiday_notify_trg();

-- The afternoon before the first day the structure would otherwise have
-- opened (a break starting on a Friday is announced on Saturday for Sunday).
-- Hours null = the default Sun–Thu week, as toOpeningHours assumes. Per-row
-- wrapped.
create or replace function public.kg_remind_tomorrows_closures() returns int
language plpgsql security definer set search_path = pg_catalog, public as $$
declare h kg_holidays; v_tomorrow date := (now() at time zone 'Africa/Algiers')::date + 1;
        v_sent int := 0; v_first date; d date; v_hours jsonb; v_day jsonb;
begin
  for h in select * from kg_holidays x
            where x.closure and not x.tentative
              and v_tomorrow between x.date and coalesce(x.end_date, x.date)
              and x.created_at <= (v_tomorrow::timestamp at time zone 'Africa/Algiers') - interval '36 hours'
  loop
    begin
      v_hours := kg_structure_hours(h.structure_id, h.tenant_id);
      v_first := null; d := h.date;
      while d <= coalesce(h.end_date, h.date) and v_first is null loop
        v_day := case when v_hours is null then null else v_hours -> lower(to_char(d, 'Dy')) end;
        if (v_hours is null and extract(dow from d) between 0 and 4)
           or (v_day is not null and v_day <> 'null'::jsonb) then
          v_first := d;
        end if;
        d := d + 1;
      end loop;
      if v_first = v_tomorrow then
        v_sent := v_sent + kg_notify_closure(h, 'reminder');
      end if;
    exception when others then
      raise warning 'kg_remind_tomorrows_closures(%): %', h.id, sqlerrm;
    end;
  end loop;
  return v_sent;
end $$;
revoke all on function public.kg_remind_tomorrows_closures() from public, anon, authenticated;
-- 15:00 UTC = 16:00 Africa/Algiers: heard before pick-up, not at 06:30.
do $$ begin
  perform cron.unschedule('kg-closure-reminders');
exception when others then null; end $$;
select cron.schedule('kg-closure-reminders', '0 15 * * *', $$select public.kg_remind_tomorrows_closures()$$);

-- ── 5. A therapy appointment reaches the family ────────────────────────────
create unique index if not exists kg_notifications_session_once
  on public.kg_notifications (user_id, (data->>'sessionId'), (data->>'kind'))
  where type = 'session_scheduled' and data->>'kind' in ('created', 'reminder');

create or replace function public.kg_notify_session_scheduled(s public.kg_sessions, p_kind text) returns int
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_child kg_children; v_recipients uuid[];
begin
  select * into v_child from kg_children where id = s.child_id;
  select coalesce(array_agg(u), '{}'::uuid[]) into v_recipients from kg_parent_user_ids(s.child_id) u;
  if array_length(v_recipients, 1) is null then return 0; end if;
  return kg_notify(s.tenant_id, v_recipients, 'session_scheduled',
    v_child.first_name || ' ' || v_child.last_name, null,
    jsonb_build_object('sessionId', s.id, 'kind', p_kind, 'childId', s.child_id,
                       'childName', v_child.first_name || ' ' || v_child.last_name,
                       'childNameAr', nullif(trim(coalesce(v_child.first_name_ar, '') || ' ' || coalesce(v_child.last_name_ar, '')), ''),
                       'date', (s.scheduled_at at time zone 'Africa/Algiers')::date,
                       'time', s.scheduled_at,
                       'endTime', s.scheduled_at + s.duration_min * interval '1 minute',
                       'sessionType', s.session_type,
                       'therapist', coalesce(kg_member_name(s.therapist_id), ''),
                       'audience', 'parent'),
    case when p_kind = 'reminder' then null else auth.uid() end);
end $$;
revoke all on function public.kg_notify_session_scheduled(public.kg_sessions, text) from public, anon, authenticated;

-- created     a future scheduled insert
-- rescheduled scheduled_at moves, or a cancelled row is put back (a new date
--             for the family — the 'created' dedupe would silence a second 'created')
-- changed     therapist, room or duration moves on a future scheduled row
-- cancelled   status → cancelled, or a hard delete, on a future row
-- Nothing for past rows, outcome edits, or the parent_summary (session_published, 0049).
create or replace function public.kg_session_scheduled_trg() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  begin
    if tg_op = 'DELETE' then
      if old.status = 'scheduled' and old.scheduled_at > now() then
        perform kg_notify_session_scheduled(old, 'cancelled');
      end if;
      return old;
    elsif tg_op = 'INSERT' then
      if new.status = 'scheduled' and new.scheduled_at > now() then
        perform kg_notify_session_scheduled(new, 'created');
      end if;
    elsif old.status <> 'cancelled' and new.status = 'cancelled' then
      if old.scheduled_at > now() then perform kg_notify_session_scheduled(new, 'cancelled'); end if;
    elsif new.status = 'scheduled' and new.scheduled_at > now() then
      if old.status = 'cancelled' or old.scheduled_at is distinct from new.scheduled_at then
        perform kg_notify_session_scheduled(new, 'rescheduled');
      elsif (old.therapist_id, old.room_id, old.duration_min) is distinct from (new.therapist_id, new.room_id, new.duration_min) then
        perform kg_notify_session_scheduled(new, 'changed');
      end if;
    end if;
  exception when others then
    raise warning 'kg_session_scheduled_trg: %', sqlerrm;
  end;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
revoke all on function public.kg_session_scheduled_trg() from public, anon, authenticated;
drop trigger if exists kg_session_scheduled on public.kg_sessions;
create trigger kg_session_scheduled
  after insert or update of scheduled_at, status, therapist_id, room_id, duration_min on public.kg_sessions
  for each row execute function public.kg_session_scheduled_trg();
drop trigger if exists kg_session_scheduled_delete on public.kg_sessions;
create trigger kg_session_scheduled_delete before delete on public.kg_sessions
  for each row execute function public.kg_session_scheduled_trg();

-- The suppression window reads scheduled_changed_at (0157): an outcome typed
-- the afternoon before does not silence the family's reminder. Per-row wrapped.
create or replace function public.kg_remind_tomorrows_sessions() returns int
language plpgsql security definer set search_path = pg_catalog, public as $$
declare s kg_sessions; v_sent int := 0;
begin
  for s in select x.* from kg_sessions x
            where x.status = 'scheduled'
              and (x.scheduled_at at time zone 'Africa/Algiers')::date = ((now() at time zone 'Africa/Algiers')::date + 1)
              and coalesce(x.scheduled_changed_at, x.created_at) <= x.scheduled_at - interval '36 hours'
  loop
    begin
      v_sent := v_sent + kg_notify_session_scheduled(s, 'reminder');
    exception when others then
      raise warning 'kg_remind_tomorrows_sessions(%): %', s.id, sqlerrm;
    end;
  end loop;
  return v_sent;
end $$;
revoke all on function public.kg_remind_tomorrows_sessions() from public, anon, authenticated;

-- Two morning jobs, one per function: a failure in one never costs the other.
-- 05:30 UTC = 06:30 Africa/Algiers (0093).
do $$ begin
  perform cron.unschedule('kg-event-reminders');
exception when others then null; end $$;
select cron.schedule('kg-event-reminders', '30 5 * * *', $$select public.kg_remind_tomorrows_events()$$);
do $$ begin
  perform cron.unschedule('kg-session-reminders');
exception when others then null; end $$;
select cron.schedule('kg-session-reminders', '30 5 * * *', $$select public.kg_remind_tomorrows_sessions()$$);

-- ── 6. A test or exam date reaches the class's families ────────────────────
create unique index if not exists kg_notifications_assessment_once
  on public.kg_notifications (user_id, (data->>'assessmentId'), (data->>'kind'), (data->>'date'))
  where type = 'assessment_scheduled';

create or replace function public.kg_assessment_scheduled_trg() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_class kg_classes; v_kind text; v_recipients uuid[];
begin
  begin
    if new.kind not in ('test', 'exam') or new.scheduled_on < (now() at time zone 'Africa/Algiers')::date then return new; end if;
    if tg_op = 'INSERT' then v_kind := 'created';
    elsif old.scheduled_on is distinct from new.scheduled_on then v_kind := 'changed';
    else return new; end if;
    select * into v_class from kg_classes where id = new.class_id;
    select coalesce(array_agg(u), '{}'::uuid[]) into v_recipients from kg_class_parent_user_ids(new.tenant_id, new.class_id) u;
    perform kg_notify(new.tenant_id, v_recipients, 'assessment_scheduled', new.title, null,
      jsonb_build_object('assessmentId', new.id, 'kind', v_kind, 'assessmentKind', new.kind,
                         'classId', new.class_id, 'className', coalesce(v_class.name, ''), 'classNameAr', coalesce(v_class.name_ar, ''),
                         'date', new.scheduled_on, 'audience', 'parent'),
      auth.uid());
  exception when others then
    raise warning 'kg_assessment_scheduled_trg: %', sqlerrm;
  end;
  return new;
end $$;
revoke all on function public.kg_assessment_scheduled_trg() from public, anon, authenticated;
drop trigger if exists kg_assessment_scheduled on public.kg_learning_assessments;
create trigger kg_assessment_scheduled after insert or update of scheduled_on on public.kg_learning_assessments
  for each row execute function public.kg_assessment_scheduled_trg();

-- ── 7. The member hears the leave decision ─────────────────────────────────
create or replace function public.kg_leave_decided_trg() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_user uuid;
begin
  begin
    if old.status = 'pending' and new.status in ('approved', 'rejected') then
      select m.user_id into v_user from kg_memberships m where m.id = new.membership_id;
      if v_user is not null then
        perform kg_notify(new.tenant_id, array[v_user], 'leave', coalesce(kg_member_name(new.membership_id), ''), null,
          jsonb_build_object('leaveId', new.id, 'kind', new.status, 'leaveType', new.leave_type,
                             'date', new.start_date, 'endDate', new.end_date, 'audience', 'staff'),
          auth.uid());
      end if;
    end if;
  exception when others then
    raise warning 'kg_leave_decided_trg: %', sqlerrm;
  end;
  return new;
end $$;
revoke all on function public.kg_leave_decided_trg() from public, anon, authenticated;
drop trigger if exists kg_leave_decided on public.kg_leave_requests;
create trigger kg_leave_decided after update of status on public.kg_leave_requests
  for each row execute function public.kg_leave_decided_trg();

-- ── 8. Rehearsal (demo tenant; every row written here is deleted here) ─────
-- Dry run: keep the final `raise exception`. Apply: change it to `raise notice`.
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
  raise exception '0159 rehearsal ok — rolled back';
end $$;
notify pgrst, 'reload schema';
commit;
