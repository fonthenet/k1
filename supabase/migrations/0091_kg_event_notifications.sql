-- Telling the right parents about an event, once.
--
-- APPLIED 2026-08-31 (dedupe index corrected by 0092).
--
-- No parent had ever been alerted about an event: 'event' was not among the
-- notification types and nothing fanned events out. This adds it, deliberately
-- narrower than the announcement path it is modelled on.
create or replace function kg_event_recipients(e kg_events)
returns uuid[]
language plpgsql stable security definer set search_path to 'public'
as $function$
declare v uuid[];
begin
  if e.audience = 'staff' then
    select array_agg(distinct u) into v from kg_staff_user_ids(e.tenant_id) u;

  elsif e.audience = 'class' then
    -- Explicit branch, NOT `elsif ... and class_id is not null`. In
    -- kg_announcement_recipients that extra condition means a class row with a
    -- null class falls through to the else and notifies EVERY parent in the
    -- tenant about something the policy hides from all of them.
    if e.class_id is null then
      return '{}'::uuid[];
    end if;
    select array_agg(distinct p) into v
      from kg_class_parent_user_ids(e.tenant_id, e.class_id) p;

  elsif e.audience = 'parents' then
    select array_agg(distinct p) into v
      from kg_children c, lateral kg_parent_user_ids(c.id) p
     where c.tenant_id = e.tenant_id and c.status = 'enrolled';

  else  -- 'all': parents AND staff, deduped ACROSS the two sets
    select array_agg(distinct everyone.u) into v
      from (
        select p as u from kg_children c, lateral kg_parent_user_ids(c.id) p
         where c.tenant_id = e.tenant_id and c.status = 'enrolled'
        union
        select s from kg_staff_user_ids(e.tenant_id) s
      ) everyone;
  end if;

  return coalesce(v, '{}'::uuid[]);
end $function$;

revoke all on function kg_event_recipients(kg_events) from public, anon, authenticated;

-- Identity is (user, event, kind). Deduping on eventId alone — the shape the
-- announcement sweep uses — would permanently block the day-before reminder,
-- because 'created' already carries the same eventId. Superseded by 0092,
-- which narrows this to the once-only kinds.
create unique index if not exists kg_notifications_event_once
  on kg_notifications (user_id, (data->>'eventId'), (data->>'kind'))
  where type = 'event';

create or replace function kg_notify_event(
  p_event kg_events, p_kind text, p_recipients uuid[]
) returns integer
language plpgsql security definer set search_path to 'public'
as $function$
declare v_class text; v_sent int;
begin
  if p_recipients is null or array_length(p_recipients, 1) is null then return 0; end if;

  -- The class name rides along so two class events are distinguishable in the
  -- feed. Never a child's name: this payload reaches a lock screen, and every
  -- recipient gets the identical row.
  select c.name into v_class from kg_classes c where c.id = p_event.class_id;

  v_sent := kg_notify(
    p_event.tenant_id, p_recipients, 'event',
    p_event.title,
    left(coalesce(p_event.description, ''), 140),
    jsonb_build_object(
      'eventId', p_event.id,
      'kind', p_kind,
      'classId', p_event.class_id,
      'className', v_class,
      'date', (p_event.start_at at time zone 'Africa/Algiers')::date,
      'audience', case when p_event.audience = 'staff' then 'staff' else 'both' end),
    p_event.created_by);

  -- An event more than 30 days out is news, not an interruption: it lands in
  -- the bell but does not ring a phone at 21:00 about something in October.
  -- kg_pending_push only returns rows with pushed_at is null, so marking them
  -- sent is the whole mechanism.
  if p_kind = 'created' and p_event.start_at > now() + interval '30 days' then
    update kg_notifications
       set pushed_at = now()
     where type = 'event'
       and data->>'eventId' = p_event.id::text
       and data->>'kind' = p_kind
       and pushed_at is null;
  end if;

  return v_sent;
end $function$;

revoke all on function kg_notify_event(kg_events, text, uuid[]) from public, anon, authenticated;

create or replace function kg_on_event_insert()
returns trigger language plpgsql security definer set search_path to 'public'
as $function$
begin
  -- Back-filling last week's trip must not alert anybody.
  if new.start_at <= now() then return new; end if;
  perform kg_notify_event(new, 'created', kg_event_recipients(new));
  return new;
end $function$;

drop trigger if exists trg_kg_event_insert on kg_events;
create trigger trg_kg_event_insert
  after insert on kg_events for each row execute function kg_on_event_insert();

-- Bound to specific columns, so editing a colour swatch or fixing a typo does
-- not push the whole class. kg_events has no updated_at, so OLD is the only
-- signal there is.
--
-- The class/audience diff is the one place a set difference is required:
--   new - old  newly concerned      -> 'created'
--   old - new  no longer concerned  -> 'changed'
--   kept       -> 'changed' only if the date or title moved
create or replace function kg_on_event_update()
returns trigger language plpgsql security definer set search_path to 'public'
as $function$
declare v_old uuid[]; v_new uuid[]; v_added uuid[]; v_removed uuid[]; v_kept uuid[];
        v_scope_changed boolean; v_when_changed boolean;
begin
  if new.start_at <= now() and old.start_at <= now() then return new; end if;

  v_scope_changed := old.audience is distinct from new.audience
                  or old.class_id is distinct from new.class_id;
  v_when_changed  := old.start_at is distinct from new.start_at
                  or old.title    is distinct from new.title;
  if not (v_scope_changed or v_when_changed) then return new; end if;

  v_new := kg_event_recipients(new);

  if v_scope_changed then
    v_old := kg_event_recipients(old);
    select coalesce(array_agg(u), '{}'::uuid[]) into v_added
      from unnest(coalesce(v_new,'{}'::uuid[])) u
     where u <> all (coalesce(v_old, '{}'::uuid[]));
    select coalesce(array_agg(u), '{}'::uuid[]) into v_removed
      from unnest(coalesce(v_old,'{}'::uuid[])) u
     where u <> all (coalesce(v_new, '{}'::uuid[]));
    select coalesce(array_agg(u), '{}'::uuid[]) into v_kept
      from unnest(coalesce(v_new,'{}'::uuid[])) u
     where u = any (coalesce(v_old, '{}'::uuid[]));

    if array_length(v_added, 1) is not null and new.start_at > now() then
      perform kg_notify_event(new, 'created', v_added);
    end if;
    if array_length(v_removed, 1) is not null then
      perform kg_notify_event(old, 'changed', v_removed);
    end if;
    if v_when_changed and array_length(v_kept, 1) is not null then
      perform kg_notify_event(new, 'changed', v_kept);
    end if;
  else
    perform kg_notify_event(new, 'changed', v_new);
  end if;

  return new;
end $function$;

drop trigger if exists trg_kg_event_update on kg_events;
create trigger trg_kg_event_update
  after update on kg_events for each row execute function kg_on_event_update();

-- Hard delete, and the parents already told about "Sports day Thursday" hear
-- nothing. Within a week of the date that silence is worse than one more push;
-- beyond it, the row quietly leaving the calendar is enough.
create or replace function kg_on_event_delete()
returns trigger language plpgsql security definer set search_path to 'public'
as $function$
begin
  if old.start_at > now() and old.start_at < now() + interval '7 days' then
    perform kg_notify_event(old, 'cancelled', kg_event_recipients(old));
  end if;
  return old;
end $function$;

drop trigger if exists trg_kg_event_delete on kg_events;
create trigger trg_kg_event_delete
  before delete on kg_events for each row execute function kg_on_event_delete();
