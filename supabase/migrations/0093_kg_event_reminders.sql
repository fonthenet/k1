-- The day-before reminder.
--
-- APPLIED 2026-08-31, with cron job 'kg-event-reminders'.
--
-- "Created" and "starts tomorrow" are two different messages and neither works
-- alone. An event announced in March for June is legitimate news when created —
-- parents plan around it — and completely forgotten by June. A reminder alone
-- means that same event is silent for three months while families book other
-- things.
--
-- Bounded so it cannot become noise:
--   * once per person per event (the unique index covers 'reminder')
--   * only for an event starting TOMORROW in Algiers
--   * suppressed when the event was created less than 36 hours before it starts
--   * once a day, not every 15 minutes like the announcement sweep: a */15 job
--     with a "within 24h" window wakes a phone at 03:00 for an event at 03:00
--     tomorrow.
create or replace function kg_remind_tomorrows_events()
returns integer
language plpgsql security definer set search_path to 'public'
as $function$
declare e kg_events; v_sent int := 0;
begin
  for e in
    select ev.* from kg_events ev
     where (ev.start_at at time zone 'Africa/Algiers')::date
         = ((now() at time zone 'Africa/Algiers')::date + 1)
       and ev.created_at <= ev.start_at - interval '36 hours'
  loop
    v_sent := v_sent + kg_notify_event(e, 'reminder', kg_event_recipients(e));
  end loop;
  return v_sent;
end $function$;

revoke all on function kg_remind_tomorrows_events() from public, anon, authenticated;

-- 05:30 UTC = 06:30 Africa/Algiers, before the doors open. Algeria is UTC+1
-- year-round with no DST (established in 0048), so a fixed UTC cron is a fixed
-- local time. The DATE BUCKET is computed in Algiers, not UTC — bucketing in
-- UTC silently mis-files every event starting between 00:00 and 01:00 local.
select cron.schedule(
  'kg-event-reminders',
  '30 5 * * *',
  $$select kg_remind_tomorrows_events()$$
);
