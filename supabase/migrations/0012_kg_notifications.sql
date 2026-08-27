-- Notifications + web push.
--
-- kg_notifications existed since 0001 but nothing ever wrote to it. Fan-out
-- lives in DB triggers rather than server actions for two reasons: an action
-- can be forgotten, and several real events never pass through one at all —
-- a kiosk check-in runs through kg_checkin_by_tag, not a form post.
--
-- Rows carry a structured `type` + `data` payload. Titles are localised by the
-- reader (UI) and by the push dispatcher (per recipient's kg_profiles.locale),
-- so we never freeze one language into the database. `title`/`body` are kept
-- as a last-resort fallback for a type the client doesn't know yet.

alter table kg_notifications
  add column if not exists pushed_at timestamptz,
  add column if not exists actor_id uuid references auth.users(id) on delete set null;

create index if not exists kg_notifications_unpushed_idx
  on kg_notifications (created_at) where pushed_at is null;
create index if not exists kg_notifications_unread_idx
  on kg_notifications (user_id) where read_at is null;

-- ── Push subscriptions (one row per browser/device) ──────────────────────
create table if not exists kg_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tenant_id uuid references kg_tenants(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  failure_count int not null default 0,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index if not exists kg_push_subscriptions_user_idx on kg_push_subscriptions (user_id);

alter table kg_push_subscriptions enable row level security;
drop policy if exists ps_own on kg_push_subscriptions;
create policy ps_own on kg_push_subscriptions for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ── Recipient helpers ────────────────────────────────────────────────────
create or replace function kg_parent_user_ids(p_child uuid) returns setof uuid
language sql stable security definer set search_path = public as $$
  select distinct g.user_id
  from kg_child_guardians cg
  join kg_guardians g on g.id = cg.guardian_id
  where cg.child_id = p_child and g.user_id is not null
$$;

create or replace function kg_staff_user_ids(p_tenant uuid, p_roles kg_role[] default null)
returns setof uuid language sql stable security definer set search_path = public as $$
  select m.user_id from kg_memberships m
  where m.tenant_id = p_tenant and m.status = 'active'
    and m.role <> 'parent'
    and (p_roles is null or m.role = any(p_roles))
$$;

-- ── Core fan-out ─────────────────────────────────────────────────────────
-- Never notifies the actor about their own action.
create or replace function kg_notify(
  p_tenant uuid, p_recipients uuid[], p_type text,
  p_title text, p_body text, p_data jsonb default '{}'::jsonb,
  p_actor uuid default null
) returns int language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  if p_recipients is null or array_length(p_recipients, 1) is null then return 0; end if;
  with inserted as (
    insert into kg_notifications (tenant_id, user_id, type, title, body, data, actor_id)
    select p_tenant, u, p_type, p_title, p_body, coalesce(p_data, '{}'::jsonb), p_actor
    from unnest(p_recipients) u
    where p_actor is null or u <> p_actor
    returning 1
  )
  select count(*) into v_count from inserted;
  return v_count;
end $$;

revoke execute on function kg_notify(uuid, uuid[], text, text, text, jsonb, uuid) from anon, authenticated;

-- ── Triggers ─────────────────────────────────────────────────────────────

-- 1. A message in a thread notifies the other side.
create or replace function kg_notify_thread_message() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_thread kg_threads; v_child kg_children; v_recipients uuid[]; v_sender_is_staff boolean;
begin
  select * into v_thread from kg_threads where id = new.thread_id;
  if v_thread.id is null then return new; end if;

  select exists (
    select 1 from kg_memberships m
    where m.tenant_id = v_thread.tenant_id and m.user_id = new.sender_id
      and m.status = 'active' and m.role <> 'parent'
  ) into v_sender_is_staff;

  if v_sender_is_staff then
    -- staff replied → tell the family
    if v_thread.child_id is not null then
      select array_agg(u) into v_recipients from kg_parent_user_ids(v_thread.child_id) u;
    end if;
  else
    -- parent wrote → tell the office
    select array_agg(u) into v_recipients
      from kg_staff_user_ids(v_thread.tenant_id, array['owner','admin','educator']::kg_role[]) u;
  end if;

  if v_thread.child_id is not null then
    select * into v_child from kg_children where id = v_thread.child_id;
  end if;

  perform kg_notify(
    v_thread.tenant_id, v_recipients, 'message',
    coalesce(nullif(v_thread.subject, ''), 'رسالة جديدة'),
    left(new.body, 140),
    jsonb_build_object(
      'threadId', v_thread.id, 'childId', v_thread.child_id,
      'childName', coalesce(v_child.first_name || ' ' || v_child.last_name, ''),
      'audience', case when v_sender_is_staff then 'parent' else 'staff' end
    ),
    new.sender_id
  );
  return new;
end $$;
drop trigger if exists trg_kg_notify_thread_message on kg_thread_messages;
create trigger trg_kg_notify_thread_message after insert on kg_thread_messages
  for each row execute function kg_notify_thread_message();

-- 2. Incident reported → the child's family.
create or replace function kg_notify_incident() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_recipients uuid[]; v_child kg_children;
begin
  select array_agg(u) into v_recipients from kg_parent_user_ids(new.child_id) u;
  select * into v_child from kg_children where id = new.child_id;
  perform kg_notify(new.tenant_id, v_recipients, 'incident',
    'تقرير حادث', left(new.description, 140),
    jsonb_build_object('incidentId', new.id, 'childId', new.child_id,
      'childName', coalesce(v_child.first_name || ' ' || v_child.last_name, ''),
      'severity', new.severity, 'audience', 'parent'),
    new.reported_by);
  return new;
end $$;
drop trigger if exists trg_kg_notify_incident on kg_incidents;
create trigger trg_kg_notify_incident after insert on kg_incidents
  for each row execute function kg_notify_incident();

-- 3. Announcement published → its audience.
create or replace function kg_notify_announcement() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_recipients uuid[];
begin
  if new.publish_at > now() then return new; end if;

  if new.audience = 'staff' then
    select array_agg(u) into v_recipients from kg_staff_user_ids(new.tenant_id) u;
  elsif new.audience = 'class' and new.class_id is not null then
    select array_agg(distinct p) into v_recipients
      from kg_children c, lateral kg_parent_user_ids(c.id) p
     where c.class_id = new.class_id and c.status = 'enrolled';
  else -- all | parents
    select array_agg(distinct p) into v_recipients
      from kg_children c, lateral kg_parent_user_ids(c.id) p
     where c.tenant_id = new.tenant_id and c.status = 'enrolled';
    if new.audience = 'all' then
      v_recipients := v_recipients || coalesce(
        (select array_agg(u) from kg_staff_user_ids(new.tenant_id) u), '{}'::uuid[]);
    end if;
  end if;

  perform kg_notify(new.tenant_id, v_recipients, 'announcement',
    new.title, left(coalesce(new.body, ''), 140),
    jsonb_build_object('announcementId', new.id, 'audience',
      case when new.audience = 'staff' then 'staff' else 'both' end),
    new.created_by);
  return new;
end $$;
drop trigger if exists trg_kg_notify_announcement on kg_announcements;
create trigger trg_kg_notify_announcement after insert on kg_announcements
  for each row execute function kg_notify_announcement();

-- 4. Enrollment application submitted → admins.
create or replace function kg_notify_application() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_recipients uuid[];
begin
  select array_agg(u) into v_recipients
    from kg_staff_user_ids(new.tenant_id, array['owner','admin']::kg_role[]) u;
  perform kg_notify(new.tenant_id, v_recipients, 'application',
    'طلب تسجيل جديد',
    coalesce(new.child->>'first_name','') || ' ' || coalesce(new.child->>'last_name',''),
    jsonb_build_object('applicationId', new.id, 'audience', 'staff'),
    new.applicant_user_id);
  return new;
end $$;
drop trigger if exists trg_kg_notify_application on kg_applications;
create trigger trg_kg_notify_application after insert on kg_applications
  for each row execute function kg_notify_application();

-- 5. Check-in / check-out → the family, naming who did it.
create or replace function kg_notify_attendance() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_recipients uuid[]; v_child kg_children; v_kind text; v_at timestamptz;
begin
  if tg_op = 'INSERT' then
    if new.check_in_at is null then return new; end if;
    v_kind := 'checkin'; v_at := new.check_in_at;
  else
    if new.check_out_at is not null and old.check_out_at is distinct from new.check_out_at then
      v_kind := 'checkout'; v_at := new.check_out_at;
    elsif new.check_in_at is not null and old.check_in_at is distinct from new.check_in_at then
      v_kind := 'checkin'; v_at := new.check_in_at;
    else
      return new;
    end if;
  end if;

  select array_agg(u) into v_recipients from kg_parent_user_ids(new.child_id) u;
  select * into v_child from kg_children where id = new.child_id;
  perform kg_notify(new.tenant_id, v_recipients, v_kind,
    coalesce(v_child.first_name || ' ' || v_child.last_name, ''),
    to_char(v_at at time zone 'Africa/Algiers', 'HH24:MI'),
    jsonb_build_object('childId', new.child_id,
      'childName', coalesce(v_child.first_name || ' ' || v_child.last_name, ''),
      'at', v_at, 'by', new.picked_up_by, 'audience', 'parent'),
    null);
  return new;
end $$;
drop trigger if exists trg_kg_notify_attendance on kg_attendance;
create trigger trg_kg_notify_attendance after insert or update on kg_attendance
  for each row execute function kg_notify_attendance();

-- 6. Daily report published → the family.
create or replace function kg_notify_daily_report() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_recipients uuid[]; v_child kg_children;
begin
  if not new.published then return new; end if;
  if tg_op = 'UPDATE' and old.published then return new; end if;

  select array_agg(u) into v_recipients from kg_parent_user_ids(new.child_id) u;
  select * into v_child from kg_children where id = new.child_id;
  perform kg_notify(new.tenant_id, v_recipients, 'daily_report',
    coalesce(v_child.first_name || ' ' || v_child.last_name, ''), null,
    jsonb_build_object('childId', new.child_id, 'date', new.date,
      'childName', coalesce(v_child.first_name || ' ' || v_child.last_name, ''),
      'audience', 'parent'),
    new.created_by);
  return new;
end $$;
drop trigger if exists trg_kg_notify_daily_report on kg_daily_reports;
create trigger trg_kg_notify_daily_report after insert or update on kg_daily_reports
  for each row execute function kg_notify_daily_report();

-- 7. Task assigned → the assignee.
create or replace function kg_notify_task() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_user uuid;
begin
  if new.assignee_id is null then return new; end if;
  if tg_op = 'UPDATE' and old.assignee_id is not distinct from new.assignee_id then return new; end if;
  select user_id into v_user from kg_memberships where id = new.assignee_id;
  if v_user is null then return new; end if;
  perform kg_notify(new.tenant_id, array[v_user], 'task',
    new.title, left(coalesce(new.description, ''), 140),
    jsonb_build_object('taskId', new.id, 'dueDate', new.due_date,
      'priority', new.priority, 'audience', 'staff'),
    coalesce(new.created_by, auth.uid()));
  return new;
end $$;
drop trigger if exists trg_kg_notify_task on kg_tasks;
create trigger trg_kg_notify_task after insert or update of assignee_id on kg_tasks
  for each row execute function kg_notify_task();

-- 8. Activity request from a family → admins.
create or replace function kg_notify_activity_request() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_recipients uuid[]; v_child kg_children; v_activity kg_activities;
begin
  if new.status <> 'requested' then return new; end if;
  select array_agg(u) into v_recipients
    from kg_staff_user_ids(new.tenant_id, array['owner','admin']::kg_role[]) u;
  select * into v_child from kg_children where id = new.child_id;
  select * into v_activity from kg_activities where id = new.activity_id;
  perform kg_notify(new.tenant_id, v_recipients, 'activity_request',
    coalesce(v_activity.name, ''),
    coalesce(v_child.first_name || ' ' || v_child.last_name, ''),
    jsonb_build_object('childId', new.child_id, 'activityId', new.activity_id,
      'childName', coalesce(v_child.first_name || ' ' || v_child.last_name, ''),
      'activityName', coalesce(v_activity.name, ''), 'audience', 'staff'),
    auth.uid());
  return new;
end $$;
drop trigger if exists trg_kg_notify_activity_request on kg_activity_enrollments;
create trigger trg_kg_notify_activity_request after insert on kg_activity_enrollments
  for each row execute function kg_notify_activity_request();

-- ── Reader helpers ───────────────────────────────────────────────────────
create or replace function kg_mark_notifications_read(p_ids uuid[] default null)
returns int language plpgsql security definer set search_path = public as $$
declare v int;
begin
  update kg_notifications set read_at = now()
   where user_id = auth.uid() and read_at is null
     and (p_ids is null or id = any(p_ids));
  get diagnostics v = row_count;
  return v;
end $$;
grant execute on function kg_mark_notifications_read(uuid[]) to authenticated;
