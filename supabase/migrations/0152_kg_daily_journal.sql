-- 0152 — the journal of the day reaches every family, automatically.
--
-- The owner's ask: a setting the establishment switches on so that every open
-- day, at a chosen time, each family receives what their child did, ate and
-- lived — and the staff can see it went out. Before this file the pieces
-- existed apart: kg_daily_reports had readers but no writer, kg_menus had no
-- portal reader, the 'daily_report' notification meant "an educator pressed
-- publish", pushes written by pg_cron waited for the 05:35 UTC (06:35 Algiers)
-- Vercel sweep.
--
-- This file adds, in order:
--   kg_kick_push_dispatch / kg_dispatch_pending_push — the database calls the
--       app's dispatcher over pg_net, so a row written at 17:00 leaves for
--       the phone at 17:00 rather than at 06:35 tomorrow. Best effort: pg_net
--       is asynchronous and a failed POST is only visible in
--       net._http_response; a 5-minute sweep with an hourly backoff and a
--       Vercel cron are the backstops. dispatch_url and dispatch_headers are
--       set BY HAND at deploy, never here.
--   kg_tenants.settings->'daily_journal' — { enabled, send_at }, shape-checked,
--       written through kg_set_daily_journal (atomic; no read-modify-write).
--   kg_daily_journal_ledger — one row per child per day: sent, or why not.
--       Read by the staff (Journal rows, the settings footer, the dashboard);
--       written by the sender only.
--   kg_learning_profile — the SQL twin of learningProfile() in
--       src/components/modules/learning/domain.ts (a test compares them).
--   kg_child_placement_on — the class and structure a child was in on a date
--       (kg_child_transfers), so a day page for last week never lists this
--       week's class.
--   kg_child_day_compose / kg_child_day / kg_child_days / kg_child_record_dates
--       — ONE composer of a child's day, read by the sender, the portal day
--       page, the portal Journal tab and the director's preview.
--   kg_daily_journal_data — the composed day reduced to the counts and enums
--       a notification row carries. No sentence is ever rendered in SQL
--       (0049's rule): the client renders in the reader's language.
--   kg_notifications_daily_digest_once — one digest per parent per child per
--       day, whatever the caller.
--   kg_notify_daily_report — the 0012 trigger, silent while the sender is
--       publishing, and deferring to a send the sender has not decided yet.
--   kg_send_daily_journals — the sender, every 15 minutes, per tenant time,
--       per structure day and close, idempotent by the ledger, serialised by
--       an advisory lock, retrying failed and re-deciding unmarked children
--       within the day.
--
-- Deliberately NOT composed, so nobody wires them: paid activities (no
-- attendance table), announcements and events (audience-level, already
-- notified), bathroom (no dashboard writer, no portal reader), and the
-- kg_sessions parent_summary as a push (session_published is its signal; the
-- day page still shows it). The notification type stays 'daily_report':
-- the family-facing artefact already has that name, icon and href, and one
-- fact must not grow a second icon. kg_notifications_type_known is unchanged.
--
-- Bounds that must agree with the app: send_at ≤ 21:00 (the CHECK below and
-- the settings TimePicker), the moment of a structure ≤ 22:00 (the sender
-- clamps), nothing leaves after 22:30 (the sender's cutoff and the trigger's
-- "still due" rule).
--
-- Every new RPC that authenticated may execute checks kg_is_staff /
-- kg_is_parent_of / kg_is_admin as its first statement, and anon is revoked
-- from every one of them, so the 0109 audit (anon-executable definers) keeps
-- printing nothing.
--
-- Manual deploy step, in the SQL editor, never committed:
--   update kg_push_config set dispatch_url = '<NEXT_PUBLIC_APP_URL>/api/push/dispatch';
--   -- with Vercel Deployment Protection on, also:
--   update kg_push_config set dispatch_headers = '{"x-vercel-protection-bypass": "<token>"}';
--   select kg_kick_push_dispatch();
--   select status_code, created from net._http_response order by created desc limit 3;  -- expect 200
--
-- Algeria is UTC+1 with no DST; every clock below is Africa/Algiers.
begin;
set local lock_timeout = '5s';

-- ── 0. The database can reach the dispatcher ───────────────────────────────
create extension if not exists pg_net;

alter table public.kg_push_config
  add column if not exists dispatch_url text,
  add column if not exists dispatch_headers jsonb not null default '{}'::jsonb,
  add column if not exists last_kicked_at timestamptz,
  add column if not exists last_kick_newest timestamptz;
comment on column public.kg_push_config.dispatch_url is
  'Set by hand at deploy: <app origin>/api/push/dispatch. A wrong URL fails silently in net._http_response.';
comment on column public.kg_push_config.dispatch_headers is
  'Extra request headers merged into every kick, e.g. the Vercel protection-bypass token. Set by hand.';

-- Returns the pg_net request id, or NULL when there is nothing to call
-- (no URL configured yet, extension absent). Records the kick so the sweep
-- below can back off on rows that are stuck rather than new.
create or replace function public.kg_kick_push_dispatch() returns bigint
language plpgsql security definer set search_path = public as $$
declare c public.kg_push_config; v_id bigint;
begin
  select * into c from public.kg_push_config limit 1;
  if c.dispatch_url is null or c.secret is null then return null; end if;
  if to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then return null; end if;
  v_id := net.http_post(
    url := c.dispatch_url,
    body := '{}'::jsonb,
    params := '{}'::jsonb,
    headers := jsonb_build_object('content-type', 'application/json', 'x-push-secret', c.secret)
               || coalesce(c.dispatch_headers, '{}'::jsonb),
    timeout_milliseconds := 30000);
  update public.kg_push_config
     set last_kicked_at = now(),
         last_kick_newest = (select max(n.created_at) from public.kg_notifications n where n.pushed_at is null);
  return v_id;
end $$;
revoke all on function public.kg_kick_push_dispatch() from public, anon, authenticated, service_role;

-- The sweep: kiosk check-ins are written by an RPC that no server action
-- flushes, incidents and journals published from the phone likewise. Kicks
-- when an unpushed row has somewhere to go AND is newer than the last kick;
-- rows that survived a kick are stuck on a failing endpoint (the dispatcher
-- marks a row pushed only on delivery or drop) and are retried hourly, not
-- every five minutes for a day.
create or replace function public.kg_dispatch_pending_push() returns bigint
language plpgsql security definer set search_path = public as $$
declare v_newest timestamptz; c public.kg_push_config;
begin
  select max(n.created_at) into v_newest
    from public.kg_notifications n
   where n.pushed_at is null and n.created_at > now() - interval '1 day'
     and (exists (select 1 from public.kg_push_subscriptions s where s.user_id = n.user_id)
       or exists (select 1 from public.kg_push_devices d where d.user_id = n.user_id));
  if v_newest is null then return null; end if;
  select * into c from public.kg_push_config limit 1;
  if c.last_kicked_at is not null
     and v_newest <= coalesce(c.last_kick_newest, '-infinity'::timestamptz)
     and c.last_kicked_at > now() - interval '1 hour' then
    return null;
  end if;
  return public.kg_kick_push_dispatch();
end $$;
revoke all on function public.kg_dispatch_pending_push() from public, anon, authenticated, service_role;

select cron.unschedule('kg-push-dispatch')
 where exists (select 1 from cron.job where jobname = 'kg-push-dispatch');
select cron.schedule('kg-push-dispatch', '*/5 * * * *', $$select public.kg_dispatch_pending_push()$$);

-- ── 1. The setting ─────────────────────────────────────────────────────────
-- settings->'daily_journal' = { "enabled": boolean, "send_at": "HH:MM" }.
-- Absent = off. send_at ≤ 21:00 so that a structure's moment (the later of
-- send_at and its close, clamped to 22:00) always falls before the sender's
-- 22:30 cutoff. Nothing else may live under that key.
create or replace function public.kg_valid_daily_journal_settings(v jsonb) returns boolean
language sql immutable set search_path = public as $$
  select v -> 'daily_journal' is null
      or (jsonb_typeof(v -> 'daily_journal') = 'object'
          and jsonb_typeof(v -> 'daily_journal' -> 'enabled') = 'boolean'
          and coalesce((v -> 'daily_journal' ->> 'send_at') ~ '^(([01][0-9]|20):[0-5][0-9]|21:00)$', false)
          and (select bool_and(k in ('enabled','send_at')) from jsonb_object_keys(v -> 'daily_journal') k));
$$;
alter table public.kg_tenants drop constraint if exists kg_tenants_daily_journal_shape;
alter table public.kg_tenants add constraint kg_tenants_daily_journal_shape
  check (public.kg_valid_daily_journal_settings(settings));

-- The only writer of the key. Atomic (`||` on the row), so it can never
-- clobber another key of settings the way a read-modify-write from the app
-- could; a bad send_at is refused by the CHECK (23514 → the action's 'invalid').
create or replace function public.kg_set_daily_journal(p_tenant uuid, p_enabled boolean, p_send_at text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_out jsonb;
begin
  if p_tenant is null or not kg_is_admin(p_tenant) then raise exception 'forbidden'; end if;
  update public.kg_tenants
     set settings = coalesce(settings, '{}'::jsonb)
                    || jsonb_build_object('daily_journal', jsonb_build_object('enabled', p_enabled, 'send_at', p_send_at))
   where id = p_tenant
   returning settings -> 'daily_journal' into v_out;
  return v_out;
end $$;
revoke all on function public.kg_set_daily_journal(uuid, boolean, text) from public, anon;
grant execute on function public.kg_set_daily_journal(uuid, boolean, text) to authenticated;

-- ── 2. The ledger: one row per child per day, sent or why not ──────────────
create table if not exists public.kg_daily_journal_ledger (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.kg_tenants(id) on delete cascade,
  child_id uuid not null references public.kg_children(id) on delete cascade,
  structure_id uuid references public.kg_structures(id) on delete set null,
  day date not null,
  status text not null check (status in
    ('sent','skipped_absent','skipped_unmarked','skipped_empty','skipped_no_account','failed')),
  recipients int not null default 0,
  decided_at timestamptz not null default now(),
  note text,
  unique (child_id, day)
);
comment on table public.kg_daily_journal_ledger is
  'Written by kg_send_daily_journals only. The staff read it (Journal rows, settings footer, dashboard); no screen and no policy may ever write it — a WITH CHECK policy here would let a screen forge "sent".';
comment on column public.kg_daily_journal_ledger.decided_at is
  'For a sent row: when the family was told. For a skipped or failed row: when the sender last decided; failed and skipped_unmarked rows are re-decided by later runs of the same day.';
create index if not exists kg_daily_journal_ledger_tenant_day_idx
  on public.kg_daily_journal_ledger (tenant_id, day);
alter table public.kg_daily_journal_ledger enable row level security;
drop policy if exists djl_sel on public.kg_daily_journal_ledger;
create policy djl_sel on public.kg_daily_journal_ledger for select using (kg_is_staff(tenant_id));
-- No insert/update/delete policy: only the definer sender writes it.
revoke all on public.kg_daily_journal_ledger from anon;

-- ── 3. The profile, once, in SQL ───────────────────────────────────────────
-- Mirror of learningProfile() in src/components/modules/learning/domain.ts.
-- scripts/learning-profile.test.mjs parses this CASE and compares the two
-- over every kg_center_type value; edit both or neither.
create or replace function public.kg_learning_profile(p_type text) returns text
language sql immutable set search_path = public as $$
  select case
    when p_type in ('private_primary','private_middle','private_secondary','edu_center') then 'academic'
    when p_type = 'therapy_center' then 'therapy'
    when p_type = 'nursery' then 'care'
    when p_type in ('camp','activity_center') then 'activities'
    else 'development' end;
$$;

-- The class and structure a child was in on a date. The record says where
-- the child is NOW; kg_child_transfers (0140) says when that changed. The
-- placement on p_date is the current one unless a move took effect after
-- p_date, in which case it is where the earliest such move started from.
create or replace function public.kg_child_placement_on(p_child uuid, p_date date)
returns table (class_id uuid, structure_id uuid)
language sql stable set search_path = public as $$
  select
    case when t.id is null then ch.class_id else t.from_class_id end,
    case when t.id is null then ch.structure_id else t.from_structure_id end
  from public.kg_children ch
  left join lateral (
    select x.id, x.from_class_id, x.from_structure_id
      from public.kg_child_transfers x
     where x.child_id = ch.id and x.effective_date > p_date
     order by x.effective_date asc, x.created_at asc limit 1
  ) t on true
  where ch.id = p_child
$$;
revoke all on function public.kg_child_placement_on(uuid, date) from public, anon, authenticated, service_role;

-- ── 4. The composer ────────────────────────────────────────────────────────
-- Internal: no caller guard, no API grant. Reads what the FAMILY may read
-- (published journal, published menu, photos only with consent), so the
-- sender, the staff preview and the parent page all describe the same day.
-- p_include_draft = true (the staff preview, today only) also reads an
-- unpublished journal, because the evening sender will publish it: at 11:00
-- the director must see the mood and meal the family WILL receive at 17:00.
create or replace function public.kg_child_day_compose(p_child uuid, p_date date, p_include_draft boolean default false) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  c record; pl record; v_class_name text; v_class_name_ar text; v_s_type text;
  v_type text; v_profile text; v_hours jsonb;
  v_hol_name text; v_hol_name_ar text; v_hol_tentative boolean;
  v_from timestamptz; v_to timestamptz; v_photos_ok boolean;
  v_att jsonb; v_lessons jsonb; v_menu jsonb; v_journal jsonb; v_incidents jsonb; v_sessions jsonb;
begin
  select ch.id, ch.tenant_id, ch.first_name, ch.last_name, ch.first_name_ar, ch.last_name_ar,
         t.center_type::text as t_type
    into c
    from public.kg_children ch
    join public.kg_tenants t on t.id = ch.tenant_id
   where ch.id = p_child;
  if not found then return null; end if;

  select * into pl from public.kg_child_placement_on(p_child, p_date);
  select cl.name, cl.name_ar into v_class_name, v_class_name_ar from public.kg_classes cl where cl.id = pl.class_id;
  select s.center_type::text into v_s_type from public.kg_structures s where s.id = pl.structure_id;

  v_type := coalesce(v_s_type, c.t_type);
  v_profile := public.kg_learning_profile(v_type);
  v_from := (p_date::timestamp) at time zone 'Africa/Algiers';
  v_to := ((p_date + 1)::timestamp) at time zone 'Africa/Algiers';

  v_hours := public.kg_structure_hours(pl.structure_id, c.tenant_id) -> lower(to_char(p_date, 'Dy'));
  select h.name, h.name_ar, h.tentative into v_hol_name, v_hol_name_ar, v_hol_tentative
    from public.kg_holidays h
   where h.tenant_id = c.tenant_id and h.closure
     and p_date between h.date and coalesce(h.end_date, h.date)
     and (h.structure_id is null or h.structure_id = pl.structure_id)
   order by h.tentative, h.date limit 1;

  select jsonb_build_object('status', a.status, 'checkIn', a.check_in_at,
                            'checkOut', a.check_out_at, 'pickedUpBy', a.picked_up_by)
    into v_att from public.kg_attendance a where a.child_id = p_child and a.date = p_date;

  select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'title', l.title, 'kind', l.kind,
           'startsAt', l.starts_at, 'endsAt', l.ends_at, 'status', l.status) order by l.starts_at), '[]'::jsonb)
    into v_lessons from public.kg_learning_lessons l
   where pl.class_id is not null and l.class_id = pl.class_id and l.status <> 'cancelled'
     and l.starts_at >= v_from and l.starts_at < v_to;

  -- The child's structure's menu, else the building's; never another structure's.
  select jsonb_build_object('breakfast', m.breakfast, 'lunch', m.lunch, 'snack', m.snack, 'notes', m.notes)
    into v_menu from public.kg_menus m
   where m.tenant_id = c.tenant_id and m.date = p_date and m.published
     and (m.structure_id is null or m.structure_id = pl.structure_id)
   order by (m.structure_id is not distinct from pl.structure_id) desc limit 1;

  v_photos_ok := exists (select 1 from public.kg_consents k
                          where k.child_id = p_child and k.consent_type = 'photos' and k.granted);
  select jsonb_build_object('id', r.id, 'mood', r.mood, 'meals', r.meals, 'nap', r.nap,
           'activitiesText', r.activities_text, 'notes', r.notes,
           'photos', case when v_photos_ok then r.photos else '[]'::jsonb end,
           'published', r.published, 'updatedAt', r.updated_at)
    into v_journal from public.kg_daily_reports r
   where r.child_id = p_child and r.date = p_date and (r.published or p_include_draft);

  select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'occurredAt', i.occurred_at, 'severity', i.severity,
           'location', i.location, 'description', i.description, 'actionTaken', i.action_taken,
           'acknowledged', i.parent_ack_at is not null, 'acknowledgedAt', i.parent_ack_at) order by i.occurred_at), '[]'::jsonb)
    into v_incidents from public.kg_incidents i
   where i.child_id = p_child and i.occurred_at >= v_from and i.occurred_at < v_to;

  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'type', s.session_type, 'at', s.scheduled_at,
           'summary', s.parent_summary) order by s.scheduled_at), '[]'::jsonb)
    into v_sessions from public.kg_sessions s
   where s.child_id = p_child and s.published and coalesce(s.parent_summary, '') <> ''
     and s.scheduled_at >= v_from and s.scheduled_at < v_to;

  return jsonb_build_object(
    'date', p_date::text,
    'child', jsonb_build_object('id', c.id, 'tenantId', c.tenant_id, 'firstName', c.first_name, 'lastName', c.last_name,
      'firstNameAr', c.first_name_ar, 'lastNameAr', c.last_name_ar, 'classId', pl.class_id,
      'className', v_class_name, 'classNameAr', v_class_name_ar, 'structureId', pl.structure_id,
      'centerType', v_type, 'profile', v_profile),
    'closed', (v_hours is null or v_hours = 'null'::jsonb) or (v_hol_name is not null and not v_hol_tentative),
    'hours', case when v_hours is null or v_hours = 'null'::jsonb then null else v_hours end,
    'holiday', case when v_hol_name is null then null
               else jsonb_build_object('name', v_hol_name, 'nameAr', v_hol_name_ar, 'tentative', v_hol_tentative) end,
    'attendance', v_att,
    'lessons', v_lessons,
    'menu', v_menu,
    'journal', v_journal,
    'incidents', v_incidents,
    'sessions', v_sessions);
end $$;
revoke all on function public.kg_child_day_compose(uuid, date, boolean) from public, anon, authenticated, service_role;

-- Public entry: the caller guard is the first statement. Staff of the tenant
-- or a parent of the child; a departed teacher (kg_is_staff false) and a
-- parent of another family are refused, not shown an empty day. Never drafts.
create or replace function public.kg_child_day(p_child uuid, p_date date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_tenant uuid;
begin
  select tenant_id into v_tenant from public.kg_children where id = p_child;
  if v_tenant is null or not (kg_is_staff(v_tenant) or kg_is_parent_of(p_child)) then
    raise exception 'forbidden';
  end if;
  return public.kg_child_day_compose(p_child, p_date, false);
end $$;
revoke all on function public.kg_child_day(uuid, date) from public, anon;
grant execute on function public.kg_child_day(uuid, date) to authenticated;

-- The dates in a window (≤ 124 days) on which the CHILD has a record:
-- attendance, a published journal, an incident, a published session. The
-- class's blocks alone never make a day (a family is never told about a day
-- nobody said the child attended). The portal's day navigation reads this
-- over ±60 days to reopen a closed day that nevertheless holds a record.
create or replace function public.kg_child_record_dates(p_child uuid, p_from date, p_to date) returns date[]
language plpgsql stable security definer set search_path = public as $$
declare v_tenant uuid; v_from timestamptz; v_to timestamptz; v_out date[];
begin
  select tenant_id into v_tenant from public.kg_children where id = p_child;
  if v_tenant is null or not (kg_is_staff(v_tenant) or kg_is_parent_of(p_child)) then
    raise exception 'forbidden';
  end if;
  if p_to < p_from or p_to - p_from > 124 then raise exception 'invalid_range'; end if;
  v_from := (p_from::timestamp) at time zone 'Africa/Algiers';
  v_to := ((p_to + 1)::timestamp) at time zone 'Africa/Algiers';
  select coalesce(array_agg(d order by d), '{}'::date[]) into v_out from (
    select a.date as d from public.kg_attendance a where a.child_id = p_child and a.date between p_from and p_to
    union select r.date from public.kg_daily_reports r where r.child_id = p_child and r.published and r.date between p_from and p_to
    union select (i.occurred_at at time zone 'Africa/Algiers')::date from public.kg_incidents i
           where i.child_id = p_child and i.occurred_at >= v_from and i.occurred_at < v_to
    union select (s.scheduled_at at time zone 'Africa/Algiers')::date from public.kg_sessions s
           where s.child_id = p_child and s.published and coalesce(s.parent_summary,'') <> ''
             and s.scheduled_at >= v_from and s.scheduled_at < v_to
  ) x;
  return v_out;
end $$;
revoke all on function public.kg_child_record_dates(uuid, date, date) from public, anon;
grant execute on function public.kg_child_record_dates(uuid, date, date) to authenticated;

-- The child's dated days over a window (≤ 62 days), one lean row per day that
-- holds a record of the child (same rule as kg_child_record_dates), newest
-- first: the portal's Journal tab list. The blocks count uses the class the
-- child was in THAT day.
create or replace function public.kg_child_days(p_child uuid, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_tenant uuid; v_photos_ok boolean; v_out jsonb;
begin
  select tenant_id into v_tenant from public.kg_children where id = p_child;
  if v_tenant is null or not (kg_is_staff(v_tenant) or kg_is_parent_of(p_child)) then
    raise exception 'forbidden';
  end if;
  if p_to < p_from or p_to - p_from > 62 then raise exception 'invalid_range'; end if;
  v_photos_ok := exists (select 1 from public.kg_consents k
                          where k.child_id = p_child and k.consent_type = 'photos' and k.granted);
  with days as (
    select unnest(public.kg_child_record_dates(p_child, p_from, p_to)) as d
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'date', d.d::text,
      'attendance', (select jsonb_build_object('status', a.status, 'checkIn', a.check_in_at, 'checkOut', a.check_out_at)
                       from public.kg_attendance a where a.child_id = p_child and a.date = d.d),
      'mood', (select r.mood from public.kg_daily_reports r where r.child_id = p_child and r.date = d.d and r.published),
      'journal', exists (select 1 from public.kg_daily_reports r where r.child_id = p_child and r.date = d.d and r.published),
      'photos', coalesce((select case when v_photos_ok then jsonb_array_length(r.photos) else 0 end
                            from public.kg_daily_reports r where r.child_id = p_child and r.date = d.d and r.published), 0),
      'lessons', (select count(*) from public.kg_learning_lessons l
                   where l.class_id = (select p.class_id from public.kg_child_placement_on(p_child, d.d) p)
                     and l.status <> 'cancelled' and l.kind <> 'care'
                     and l.starts_at >= (d.d::timestamp) at time zone 'Africa/Algiers'
                     and l.starts_at < ((d.d + 1)::timestamp) at time zone 'Africa/Algiers'),
      'incidents', (select count(*) from public.kg_incidents i where i.child_id = p_child
                     and i.occurred_at >= (d.d::timestamp) at time zone 'Africa/Algiers'
                     and i.occurred_at < ((d.d + 1)::timestamp) at time zone 'Africa/Algiers'),
      'sessions', (select count(*) from public.kg_sessions s where s.child_id = p_child and s.published
                     and coalesce(s.parent_summary,'') <> ''
                     and s.scheduled_at >= (d.d::timestamp) at time zone 'Africa/Algiers'
                     and s.scheduled_at < ((d.d + 1)::timestamp) at time zone 'Africa/Algiers')
    ) order by d.d desc), '[]'::jsonb)
    into v_out from days d;
  return v_out;
end $$;
revoke all on function public.kg_child_days(uuid, date, date) from public, anon;
grant execute on function public.kg_child_days(uuid, date, date) to authenticated;

-- ── 5. The notification data: counts and enums, never text ─────────────────
create or replace function public.kg_daily_journal_data(p_day jsonb) returns jsonb
language plpgsql immutable set search_path = public as $$
declare
  v_j jsonb := p_day -> 'journal'; v_lessons int := 0; v_eaten text; v_nap int; v_menu boolean;
  v_photos int := 0; v_incidents int := 0; v_tellable boolean; v_start time; v_end time;
begin
  if p_day is null then return null; end if;
  select count(*) into v_lessons from jsonb_array_elements(coalesce(p_day -> 'lessons', '[]'::jsonb)) e
   where e ->> 'kind' <> 'care';
  v_menu := jsonb_typeof(p_day -> 'menu') = 'object';
  if jsonb_typeof(v_j) = 'object' then
    -- The lunch line when there is one, else the meal eaten least: a family
    -- must never read "a tout mangé" about a day that also holds "rien".
    select coalesce(
      (select e ->> 'eaten' from jsonb_array_elements(coalesce(v_j -> 'meals', '[]'::jsonb)) e
        where e ->> 'meal' = 'lunch' limit 1),
      (select e ->> 'eaten' from jsonb_array_elements(coalesce(v_j -> 'meals', '[]'::jsonb)) e
        order by case e ->> 'eaten' when 'none' then 0 when 'little' then 1 when 'half' then 2 when 'all' then 3 else 4 end
        limit 1))
      into v_eaten;
    -- A nap whose end is not after its start (a typo) is silent, never "pas
    -- de sieste"; the write side refuses it too.
    if jsonb_typeof(v_j -> 'nap') = 'object' then
      if (v_j -> 'nap' ->> 'slept') = 'false' then
        v_nap := 0;
      elsif (v_j -> 'nap' ->> 'minutes') ~ '^[0-9]+$' then
        v_nap := (v_j -> 'nap' ->> 'minutes')::int;
      elsif (v_j -> 'nap' ->> 'start') ~ '^[0-2][0-9]:[0-5][0-9]$' and (v_j -> 'nap' ->> 'end') ~ '^[0-2][0-9]:[0-5][0-9]$' then
        v_start := (v_j -> 'nap' ->> 'start')::time; v_end := (v_j -> 'nap' ->> 'end')::time;
        v_nap := case when v_end > v_start then (extract(epoch from (v_end - v_start)) / 60)::int else null end;
      end if;
    end if;
    v_photos := case when jsonb_typeof(v_j -> 'photos') = 'array' then jsonb_array_length(v_j -> 'photos') else 0 end;
  end if;
  v_incidents := case when jsonb_typeof(p_day -> 'incidents') = 'array' then jsonb_array_length(p_day -> 'incidents') else 0 end;
  -- Something an earlier push did not already say: a block, a menu, a journal.
  -- Arrival and incidents had their own rows the moment they happened.
  v_tellable := v_lessons > 0 or v_menu or jsonb_typeof(v_j) = 'object';
  return jsonb_build_object(
    'source', 'digest',
    'date', p_day ->> 'date',
    'profile', p_day -> 'child' ->> 'profile',
    'attendance', p_day -> 'attendance' ->> 'status',
    'arrivedAt', p_day -> 'attendance' ->> 'checkIn',
    'leftAt', p_day -> 'attendance' ->> 'checkOut',
    'lessons', v_lessons,
    'menu', v_menu,
    'eaten', case when v_eaten in ('all','half','little','none') then v_eaten else null end,
    'napMinutes', v_nap,
    'mood', v_j ->> 'mood',
    'photos', v_photos,
    'incidents', v_incidents,
    'tellable', v_tellable);
end $$;
revoke all on function public.kg_daily_journal_data(jsonb) from public, anon, authenticated, service_role;

-- Staff preview: "what Adam's family would receive". Same composer, same
-- data; today's draft journal included, since the sender will publish it.
create or replace function public.kg_daily_journal_preview(p_child uuid, p_date date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_tenant uuid; v_day jsonb; v_data jsonb;
begin
  select tenant_id into v_tenant from public.kg_children where id = p_child;
  if v_tenant is null or not kg_is_staff(v_tenant) then raise exception 'forbidden'; end if;
  v_day := public.kg_child_day_compose(p_child, p_date, p_date = (now() at time zone 'Africa/Algiers')::date);
  v_data := public.kg_daily_journal_data(v_day);
  return jsonb_build_object('day', v_day, 'data', v_data - 'tellable',
    'tellable', coalesce((v_data ->> 'tellable')::boolean, false));
end $$;
revoke all on function public.kg_daily_journal_preview(uuid, date) from public, anon;
grant execute on function public.kg_daily_journal_preview(uuid, date) to authenticated;

-- One row for the caller only, already read (a preview never raises the badge),
-- audience 'staff', flagged preview (so the once-per-day index below ignores
-- it), and the push she receives is the family's exact row.
create or replace function public.kg_send_daily_journal_preview(p_child uuid, p_date date) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_child public.kg_children; v_data jsonb; v_id uuid; v_name text;
begin
  select * into v_child from public.kg_children where id = p_child;
  if v_child.id is null or not kg_is_admin(v_child.tenant_id) then raise exception 'forbidden'; end if;
  v_data := public.kg_daily_journal_data(
    public.kg_child_day_compose(p_child, p_date, p_date = (now() at time zone 'Africa/Algiers')::date)) - 'tellable';
  v_name := coalesce(v_child.first_name || ' ' || v_child.last_name, '');
  insert into public.kg_notifications (tenant_id, user_id, type, title, body, data, actor_id, read_at)
  values (v_child.tenant_id, auth.uid(), 'daily_report', v_name, null,
          v_data || jsonb_build_object('childId', p_child, 'childName', v_name, 'audience', 'staff', 'preview', true),
          null, now())
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.kg_send_daily_journal_preview(uuid, date) from public, anon;
grant execute on function public.kg_send_daily_journal_preview(uuid, date) to authenticated;

-- One digest per parent per child per day, whatever the caller: the cron, an
-- operator's run from the SQL editor beside it, a re-run after a partial
-- failure. kg_notify's target-less ON CONFLICT DO NOTHING honours a partial
-- unique index, so a second attempt inserts nothing and returns 0.
-- Previews are the admin's own rows and may repeat.
create unique index if not exists kg_notifications_daily_digest_once
  on public.kg_notifications (user_id, (data->>'childId'), (data->>'date'))
  where type = 'daily_report' and data->>'source' = 'digest' and not (data ? 'preview');

-- ── 6. The journal trigger defers to a send the sender has not decided ─────
create or replace function public.kg_notify_daily_report() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_recipients uuid[]; v_child public.kg_children; v_dj jsonb;
  v_local timestamp; v_hours jsonb; v_due boolean := false;
begin
  if not new.published then return new; end if;
  if tg_op = 'UPDATE' and old.published then return new; end if;
  -- The evening sender publishes the journal itself and tells the family in
  -- one row; it marks its session so this trigger stays quiet.
  if coalesce(current_setting('kg.journal_sender', true), '') = 'on' then return new; end if;

  select * into v_child from public.kg_children where id = new.child_id;

  -- With the automatic journal on, a journal published during the day rides
  -- inside the evening send — whenever that send is still to come for this
  -- child: today's date, the structure open today, before the sender's
  -- cutoff, and no ledger row the sender will not revisit. "Still due" means
  -- "the sender has not decided this child yet", never "before the hour":
  -- a journal published at 17:01, one run ahead of the sender, must not be
  -- told twice, and one published on a closed day (which the sender never
  -- visits) must be told once.
  select t.settings -> 'daily_journal' into v_dj from public.kg_tenants t where t.id = new.tenant_id;
  v_local := now() at time zone 'Africa/Algiers';
  if coalesce(v_dj ->> 'enabled', 'false') = 'true'
     and new.date = v_local::date and v_local::time <= time '22:30' then
    v_hours := public.kg_structure_hours(v_child.structure_id, new.tenant_id) -> lower(to_char(new.date, 'Dy'));
    v_due := v_hours is not null and v_hours <> 'null'::jsonb
      and not exists (select 1 from public.kg_holidays h
                       where h.tenant_id = new.tenant_id and h.closure and not h.tentative
                         and new.date between h.date and coalesce(h.end_date, h.date)
                         and (h.structure_id is null or h.structure_id = v_child.structure_id))
      and not exists (select 1 from public.kg_daily_journal_ledger l
                       where l.child_id = new.child_id and l.day = new.date
                         and l.status not in ('failed','skipped_unmarked'));
  end if;
  if v_due then return new; end if;

  select array_agg(u) into v_recipients from public.kg_parent_user_ids(new.child_id) u;
  perform public.kg_notify(new.tenant_id, v_recipients, 'daily_report',
    coalesce(v_child.first_name || ' ' || v_child.last_name, ''), null,
    jsonb_build_object('childId', new.child_id, 'date', new.date::text, 'source', 'journal',
      'childName', coalesce(v_child.first_name || ' ' || v_child.last_name, ''),
      'audience', 'parent'),
    new.created_by);
  return new;
end $$;
drop trigger if exists trg_kg_notify_daily_report on public.kg_daily_reports;
create trigger trg_kg_notify_daily_report after insert or update on public.kg_daily_reports
  for each row execute function public.kg_notify_daily_report();

-- ── 7. The sender ──────────────────────────────────────────────────────────
-- Every 15 minutes. Per tenant: the switch and the time. Per child: the
-- structure's weekday, its confirmed closures, its close (the moment is the
-- later of the chosen time and the close, clamped to 22:00, so no report
-- leaves before the last departures are logged and none is stranded past the
-- cutoff). Idempotent by the ledger's unique (child_id, day) and by the
-- digest index; serialised by an advisory lock (pg_cron serialises the job,
-- the SQL editor does not). A failed child is retried by the next run; an
-- unmarked child is re-decided by the next run (the register may be taken
-- late). One bad child never stops the others. At most 2000 children per
-- run; the next run continues where this one stopped, since decided children
-- carry a ledger row. A signed-in caller is refused whatever the role: the
-- cron (no JWT) and the SQL editor are the only callers. p_tenant narrows an
-- operator's run.
create or replace function public.kg_send_daily_journals(p_tenant uuid default null) returns int
language plpgsql security definer set search_path = public as $$
declare
  t record; c record;
  v_local timestamp; v_day date; v_time time; v_send_at time;
  v_hours jsonb; v_close time; v_moment time;
  v_att text; v_has_journal boolean; v_day_json jsonb; v_data jsonb;
  v_recipients uuid[]; v_n int; v_status text; v_note text; v_sent int := 0;
begin
  if coalesce(current_setting('request.jwt.claims', true), '') <> '' then
    raise exception 'forbidden';
  end if;
  if not pg_try_advisory_xact_lock(hashtext('kg_send_daily_journals')) then return 0; end if;
  v_local := now() at time zone 'Africa/Algiers';
  v_day := v_local::date;
  v_time := v_local::time;
  -- Nothing leaves after 22:30 local: a switch flipped at midnight must not
  -- wake a family; tomorrow's run starts a fresh day. The trigger above uses
  -- the same bound to know the sender will not come.
  if v_time > time '22:30' then return 0; end if;
  perform set_config('kg.journal_sender', 'on', true);

  for t in
    select tn.id, tn.settings -> 'daily_journal' as dj
      from public.kg_tenants tn
     where tn.status = 'active'
       and (p_tenant is null or tn.id = p_tenant)
       and coalesce(tn.settings -> 'daily_journal' ->> 'enabled', 'false') = 'true'
  loop
    v_send_at := coalesce((t.dj ->> 'send_at')::time, time '17:00');
    if v_time < v_send_at then continue; end if;

    for c in
      select ch.id, ch.structure_id, l.status as prev
        from public.kg_children ch
        left join public.kg_daily_journal_ledger l on l.child_id = ch.id and l.day = v_day
       where ch.tenant_id = t.id and ch.status = 'enrolled'
         and (l.id is null or l.status in ('failed','skipped_unmarked'))
       order by ch.structure_id, ch.id
       limit 2000
    loop
      -- A tentative holiday closes nothing, as everywhere else in the product
      -- (closure.ts, kg_is_open_on) — hence the inline test, not
      -- kg_structure_closed_on, which ignores `tentative`.
      v_hours := public.kg_structure_hours(c.structure_id, t.id) -> lower(to_char(v_day, 'Dy'));
      if v_hours is null or v_hours = 'null'::jsonb then continue; end if;
      if exists (select 1 from public.kg_holidays h
                  where h.tenant_id = t.id and h.closure and not h.tentative
                    and v_day between h.date and coalesce(h.end_date, h.date)
                    and (h.structure_id is null or h.structure_id = c.structure_id)) then continue; end if;
      v_close := (v_hours ->> 'close')::time;
      v_moment := least(greatest(v_send_at, coalesce(v_close, v_send_at)), time '22:00');
      if v_time < v_moment then continue; end if;

      v_status := null; v_note := null; v_n := 0;
      begin
        select a.status::text into v_att from public.kg_attendance a where a.child_id = c.id and a.date = v_day;
        v_has_journal := exists (select 1 from public.kg_daily_reports r where r.child_id = c.id and r.date = v_day);
        if v_att in ('absent','sick','excused') then
          v_status := 'skipped_absent';
        elsif v_att is null and not v_has_journal then
          v_status := 'skipped_unmarked';
        else
          -- The evening send IS the journal's publication.
          update public.kg_daily_reports set published = true
           where child_id = c.id and date = v_day and not published;
          v_day_json := public.kg_child_day_compose(c.id, v_day, false);
          v_data := public.kg_daily_journal_data(v_day_json);
          if not coalesce((v_data ->> 'tellable')::boolean, false) then
            v_status := 'skipped_empty';
          else
            select array_agg(u) into v_recipients from public.kg_parent_user_ids(c.id) u;
            if v_recipients is null then
              v_status := 'skipped_no_account';
            else
              v_n := public.kg_notify_family(t.id, c.id, 'daily_report', v_data - 'tellable', null);
              v_status := 'sent';
              v_sent := v_sent + 1;
            end if;
          end if;
        end if;
      exception when others then
        -- The block is a subtransaction: the publish and any notify above are
        -- undone with it, so the retry starts clean.
        v_status := 'failed'; v_note := left(sqlerrm, 300); v_n := 0;
      end;
      -- A row is written when the decision changed, or when it failed again
      -- (the note and decided_at are the operator's trail).
      if c.prev is distinct from v_status or v_status = 'failed' then
        insert into public.kg_daily_journal_ledger (tenant_id, child_id, structure_id, day, status, recipients, note)
        values (t.id, c.id, c.structure_id, v_day, v_status, v_n, v_note)
        on conflict (child_id, day) do update
          set status = excluded.status, recipients = excluded.recipients, note = excluded.note,
              structure_id = excluded.structure_id, decided_at = now()
          where public.kg_daily_journal_ledger.status in ('failed','skipped_unmarked');
      end if;
    end loop;
  end loop;

  if v_sent > 0 then perform public.kg_kick_push_dispatch(); end if;
  return v_sent;
end $$;
revoke all on function public.kg_send_daily_journals(uuid) from public, anon, authenticated, service_role;

select cron.unschedule('kg-daily-journal')
 where exists (select 1 from cron.job where jobname = 'kg-daily-journal');
select cron.schedule('kg-daily-journal', '*/15 * * * *', $$select public.kg_send_daily_journals()$$);

notify pgrst, 'reload schema';
commit;
