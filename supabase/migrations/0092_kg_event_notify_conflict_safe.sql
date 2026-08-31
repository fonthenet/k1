-- Two corrections to 0091, both found by TESTING it rather than reading it.
--
-- APPLIED 2026-08-31.
--
-- 1. 'changed' is not a once-only kind.
--
-- The dedupe index covered every kind. But a material change can legitimately
-- happen more than once: reschedule an event, then move it to another class,
-- and the same parent is owed a second notice. The index refused the insert,
-- the exception escaped the AFTER trigger, and THE STAFF MEMBER'S UPDATE
-- FAILED with a constraint error.
--
-- 'created' and 'reminder' are announcements of existence and a second one is a
-- duplicate. 'changed' and 'cancelled' report something that actually happened;
-- each is news. The trigger only fires them on a material column change, so
-- they cannot run away.
drop index if exists kg_notifications_event_once;

create unique index kg_notifications_event_once
  on kg_notifications (user_id, (data->>'eventId'), (data->>'kind'))
  where type = 'event' and data->>'kind' in ('created', 'reminder');

-- 2. A notification must never abort the write that caused it.
--
-- Every notify path here runs inside an AFTER trigger on the user's own
-- statement, so any exception rolls back their edit. That is the wrong trade in
-- every case: the worst outcome of a dropped notification is silence; the worst
-- outcome of a failed UPDATE is a staff member who cannot reschedule a trip and
-- has no idea why.
--
-- ON CONFLICT DO NOTHING also makes the dedupe declarative rather than racy —
-- the trigger and the daily sweep hold no lock between them.
create or replace function kg_notify(
  p_tenant uuid, p_recipients uuid[], p_type text, p_title text, p_body text,
  p_data jsonb default '{}'::jsonb, p_actor uuid default null
) returns integer
language plpgsql security definer set search_path to 'public'
as $function$
declare v_count int;
begin
  if p_recipients is null or array_length(p_recipients, 1) is null then return 0; end if;
  with inserted as (
    insert into kg_notifications (tenant_id, user_id, type, title, body, data, actor_id)
    select p_tenant, s.u, p_type, p_title, p_body, coalesce(p_data, '{}'::jsonb), p_actor
      from (select distinct u from unnest(p_recipients) as u) s
     where p_actor is null or s.u <> p_actor
    on conflict do nothing
    returning 1
  )
  select count(*) into v_count from inserted;
  return v_count;
end $function$;
