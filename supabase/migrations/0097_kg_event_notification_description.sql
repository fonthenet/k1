-- The description is the part that says WHAT the event is.
--
-- APPLIED 2026-08-31.
--
-- kg_notify_event already copied it into kg_notifications.body, but the client
-- template rendered only date/time/class, so "having a picnic outside" was
-- written to the database and shown to nobody. The staff member typed it and it
-- went nowhere.
--
-- It goes in the payload under its own key rather than being read from `body`,
-- because the mobile renderer builds its placeholder values from `data` alone —
-- a template naming a value that lives only on the row would fall back to raw
-- text and lose the localised date with it.
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
      -- Empty string, never null: the mobile renderer only formats a template
      -- when every placeholder it names can be supplied.
      'description', left(coalesce(p_event.description, ''), 140),
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

-- Backfill what has already been sent, so the rows on screen gain the
-- description rather than staying poorer than everything created after them.
update kg_notifications n
   set data = n.data || jsonb_build_object('description', left(coalesce(e.description, ''), 140))
  from kg_events e
 where n.type = 'event'
   and n.data->>'eventId' = e.id::text
   and not (n.data ? 'description');
