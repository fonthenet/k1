-- Which days the crèche is open, and when.
--
-- Friday/Saturday was hardcoded in six places: two independent copies of an
-- isWeekend() helper, the calendar's column shading, the reports grid's five
-- columns, the attendance banner, and SCHEDULE_DAYS — which did not merely
-- style a Friday differently but made it impossible to schedule an activity on
-- one at all. A crèche that opens Saturday, or closes Thursday, had no way to
-- say so.
--
-- Stored on the tenant rather than in a table: seven rows per crèche that are
-- always read together and always written together. Null for a day means
-- closed; anything else is {open, close} in local HH:MM.
--
-- The default reproduces exactly what the code did before, so nothing changes
-- for an existing crèche until somebody edits it.
create or replace function kg_valid_opening_hours(v jsonb)
returns boolean language sql immutable set search_path = public as $fn$
  select jsonb_typeof(v) = 'object'
     and (select count(*) from jsonb_object_keys(v)) = 7
     and (select bool_and(k in ('sun','mon','tue','wed','thu','fri','sat'))
            from jsonb_object_keys(v) k)
     and (select bool_and(
            e.value = 'null'::jsonb
            or (jsonb_typeof(e.value) = 'object'
                and e.value ? 'open' and e.value ? 'close'
                and e.value->>'open'  ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
                and e.value->>'close' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
                and e.value->>'close' > e.value->>'open'))
          from jsonb_each(v) e);
$fn$;

alter table kg_tenants
  add column if not exists opening_hours jsonb not null default jsonb_build_object(
    'sun', jsonb_build_object('open','08:00','close','16:30'),
    'mon', jsonb_build_object('open','08:00','close','16:30'),
    'tue', jsonb_build_object('open','08:00','close','16:30'),
    'wed', jsonb_build_object('open','08:00','close','16:30'),
    'thu', jsonb_build_object('open','08:00','close','16:30'),
    'fri', 'null'::jsonb,
    'sat', 'null'::jsonb
  );

alter table kg_tenants drop constraint if exists kg_tenants_opening_hours_shape;
alter table kg_tenants add constraint kg_tenants_opening_hours_shape
  check (kg_valid_opening_hours(opening_hours));

comment on column kg_tenants.opening_hours is
  'Weekly opening pattern. One key per weekday (sun..sat); null means closed, otherwise {open,close} as HH:MM local time. Defaults to the Algerian week: Sunday-Thursday open, Friday/Saturday closed.';

-- Open on this date? The weekly pattern says which days, kg_holidays says which
-- individual dates are cancelled anyway. A tentative holiday is a proposal, not
-- a closure, so it does not count.
create or replace function kg_is_open_on(p_tenant uuid, p_date date)
returns boolean language sql stable security definer set search_path = public as $fn$
  select coalesce((
    select t.opening_hours -> lower(to_char(p_date, 'Dy')) <> 'null'::jsonb
      from kg_tenants t where t.id = p_tenant
  ), false)
  and not exists (
    select 1 from kg_holidays h
     where h.tenant_id = p_tenant and h.date = p_date and not h.tentative
  );
$fn$;
grant execute on function kg_is_open_on(uuid, date) to authenticated;
