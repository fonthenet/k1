-- Give an event notification enough to act on.
--
-- APPLIED 2026-08-31.
--
-- The row said "Walkout / 3 September" and stopped there — no time, and no way
-- to tell which class a trip belongs to when a guardian has children in two of
-- them (Faycel B has children in Crèche Bébés AND Grande Section, so this is
-- not hypothetical).
--
-- Both new keys are strings the clients localise themselves:
--   time       the full start timestamp; each app formats it in its own locale
--              and in Africa/Algiers, so an Arabic reader gets ٠٩:٠٠
--   className  ALWAYS present, empty string when the event has no class.
--              The mobile renderer only formats a template when every
--              placeholder it names can be supplied, so a null here would make
--              it silently fall back to the raw stored text.
create or replace function kg_notify_event(
  p_event kg_events, p_kind text, p_recipients uuid[]
) returns integer
language plpgsql security definer set search_path to 'public'
as $function$
declare v_class text; v_sent int;
begin
  if p_recipients is null or array_length(p_recipients, 1) is null then return 0; end if;

  select c.name into v_class from kg_classes c where c.id = p_event.class_id;

  v_sent := kg_notify(
    p_event.tenant_id, p_recipients, 'event',
    p_event.title,
    left(coalesce(p_event.description, ''), 140),
    jsonb_build_object(
      'eventId', p_event.id,
      'kind', p_kind,
      'classId', p_event.class_id,
      'className', coalesce(v_class, ''),
      'date', (p_event.start_at at time zone 'Africa/Algiers')::date,
      'time', p_event.start_at,
      'audience', case when p_event.audience = 'staff' then 'staff' else 'both' end),
    p_event.created_by);

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

-- Backfill the rows already sent, so the reminders already on screen gain their
-- time and class rather than staying visibly poorer than everything after them.
update kg_notifications n
   set data = n.data
            || jsonb_build_object('time', e.start_at)
            || jsonb_build_object('className', coalesce(c.name, ''))
  from kg_events e
  left join kg_classes c on c.id = e.class_id
 where n.type = 'event'
   and n.data->>'eventId' = e.id::text
   and not (n.data ? 'time');
