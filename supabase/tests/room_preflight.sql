-- Read-only diagnostic for 0155 (room bookings) and 0156 (one schedule
-- shape), every tenant. Run by the lead and shown to the owner before each
-- apply; nothing here writes.
--
--   psql -f supabase/tests/room_preflight.sql                                  before 0155
--   psql -v since_0155='2026-09-14 10:00+01' -f supabase/tests/room_preflight.sql  before 0156
--
-- (a) and (b) must return 0 rows or the migration refuses at the same
-- check, naming the row. (c) lists what the backfill will print as tolerated
-- overlaps (14 Salle 6 pairs on the demo). (d) lists the rows 0156 will
-- rewrite, before → after (five on the demo). (e), for 0156 only, lists an
-- activity whose schedule was emptied since 0155 went live — the wipe the
-- two-file deploy was designed to make impossible, checked anyway.
--
-- (a) and (d) normalise the schedule INLINE: this file runs before 0155 has
-- created kg_activity_schedule_normalise, so the CTE below is that function's
-- twin, statement by statement (integer days 0–7 with 7 = Sunday, the legacy
-- {day,time} with a one-hour end, bounds cut to HH:MM, unreadable slots
-- dropped). Keep the three in step: the function, this CTE, and
-- src/lib/activity-schedule.ts.

-- ── (a) Every schedule must read whole and be valid once normalised ─────────
-- A slot dropped by the normaliser (day or time outside both shapes) or a
-- normalised slot the 0156 CHECK would refuse (end not after start, a
-- malformed explicit end, more than 14 slots). Must be empty.
with normalised as (
  select a.tenant_id, a.id, a.name, a.schedule,
    jsonb_typeof(a.schedule) = 'array' as is_array,
    case when jsonb_typeof(a.schedule) = 'array' then jsonb_array_length(a.schedule) else 0 end as written,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'day', d.key,
        'start', s.t,
        'end', coalesce(
          left(nullif(btrim(e->>'end'), ''), 5),
          to_char((s.t::time + interval '60 minutes'), 'HH24:MI'))
      ) order by d.ord, s.t)
      from jsonb_array_elements(case when jsonb_typeof(a.schedule) = 'array' then a.schedule else '[]'::jsonb end) e
      cross join lateral (
        select left(coalesce(nullif(btrim(e->>'start'), ''), nullif(btrim(e->>'time'), '')), 5) t
      ) s
      join lateral (
        select key, ord from (values
          ('sun',0),('mon',1),('tue',2),('wed',3),('thu',4),('fri',5),('sat',6)) v(key, ord)
        where (jsonb_typeof(e->'day') = 'string' and v.key = lower(btrim(e->>'day')))
           or (jsonb_typeof(e->'day') = 'number' and (e->>'day') ~ '^[0-7]$'
               and v.ord = ((e->>'day')::int % 7))
      ) d on true
      where jsonb_typeof(e) = 'object' and s.t ~ '^([01]\d|2[0-3]):[0-5]\d$'
    ), '[]'::jsonb) as after
  from public.kg_activities a
)
select tenant_id, id, name, schedule,
  case when not is_array then 'schedule is not an array'
       when written <> jsonb_array_length(after) then 'a slot fits neither shape'
       when jsonb_array_length(after) > 14 then 'more than 14 slots'
       else 'a slot ends at or before its start, or its end is malformed' end as problem
from normalised
where not is_array
   or written <> jsonb_array_length(after)
   or jsonb_array_length(after) > 14
   or exists (
     select 1 from jsonb_array_elements(after) x
     where (x->>'end') !~ '^([01]\d|2[0-3]):[0-5]\d$'
        or case when (x->>'end') ~ '^([01]\d|2[0-3]):[0-5]\d$'
                then (x->>'end')::time <= (x->>'start')::time else true end)
order by tenant_id, name;

-- ── (b) No class may point at another tenant's room ─────────────────────────
-- 0123's FK was single-column; 0155 adds the composite one. Must be empty.
select c.tenant_id, c.id as class_id, c.name, c.room_id, r.tenant_id as room_tenant_id
from public.kg_classes c join public.kg_rooms r on r.id = c.room_id
where r.tenant_id <> c.tenant_id
order by c.tenant_id, c.name;

-- ── (c) The overlapping pairs the backfill will print (warned, not refused) ──
-- Every non-cancelled cours of a class with a home room is ledgered in that
-- room, inherited; two classes sharing a room and teaching at once are the
-- tolerated tier. One line per pair, in the shape of the deploy log.
select a.tenant_id,
  rm.name || ' · ' || to_char(a.starts_at at time zone 'Africa/Algiers', 'YYYY-MM-DD')
    || ' · ' || to_char(a.starts_at at time zone 'Africa/Algiers', 'HH24:MI')
    || '–' || to_char(a.ends_at at time zone 'Africa/Algiers', 'HH24:MI')
    || ' · ' || ca.name || ' (' || a.title || ') ↔ ' || cb.name || ' (' || b.title || ')' as pair
from public.kg_learning_lessons a
join public.kg_classes ca on ca.id = a.class_id
join public.kg_learning_lessons b on a.id < b.id
join public.kg_classes cb on cb.id = b.class_id and cb.room_id = ca.room_id
join public.kg_rooms rm on rm.id = ca.room_id
where a.status <> 'cancelled' and b.status <> 'cancelled'
  and ca.room_id is not null
  and a.starts_at < b.ends_at and b.starts_at < a.ends_at
order by a.tenant_id, rm.name, a.starts_at, ca.name;

-- ── (d) The rows 0156 will rewrite to the one shape, before → after ─────────
-- On the demo: the four integer-day rows (a number becomes a name) and
-- Anglais (its one-hour end is derived). The deploy log of 0156 prints the
-- same lines.
with normalised as (
  select a.tenant_id, a.id, a.name, a.schedule,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'day', d.key,
        'start', s.t,
        'end', coalesce(
          left(nullif(btrim(e->>'end'), ''), 5),
          to_char((s.t::time + interval '60 minutes'), 'HH24:MI'))
      ) order by d.ord, s.t)
      from jsonb_array_elements(case when jsonb_typeof(a.schedule) = 'array' then a.schedule else '[]'::jsonb end) e
      cross join lateral (
        select left(coalesce(nullif(btrim(e->>'start'), ''), nullif(btrim(e->>'time'), '')), 5) t
      ) s
      join lateral (
        select key, ord from (values
          ('sun',0),('mon',1),('tue',2),('wed',3),('thu',4),('fri',5),('sat',6)) v(key, ord)
        where (jsonb_typeof(e->'day') = 'string' and v.key = lower(btrim(e->>'day')))
           or (jsonb_typeof(e->'day') = 'number' and (e->>'day') ~ '^[0-7]$'
               and v.ord = ((e->>'day')::int % 7))
      ) d on true
      where jsonb_typeof(e) = 'object' and s.t ~ '^([01]\d|2[0-3]):[0-5]\d$'
    ), '[]'::jsonb) as after
  from public.kg_activities a
)
select tenant_id, id, name, schedule as before, after
from normalised
where schedule <> after
order by tenant_id, name;

-- ── (e) 0156 only: nothing was emptied since 0155 went live ─────────────────
-- The deployed build read a canonical row as an empty schedule; 0155 rewrote
-- nothing so it never could. An activity emptied since the apply time of
-- 0155 (pass -v since_0155='YYYY-MM-DD HH:MM+01'; default: the last 30 days)
-- is listed here for the director to reopen before 0156 runs. Must be empty.
\if :{?since_0155}
\else
\set since_0155 ''
\endif
select tenant_id, id, name, updated_at
from public.kg_activities
where schedule = '[]'::jsonb
  and updated_at > coalesce(nullif(:'since_0155', '')::timestamptz, now() - interval '30 days')
order by tenant_id, updated_at desc;
