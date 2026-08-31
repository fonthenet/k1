-- The reach preview must predict what will actually happen.
--
-- APPLIED 2026-08-31.
--
-- kg_event_audience_count (0094) sized the audience and ignored the date, but
-- kg_on_event_insert refuses to notify for an event that has already started.
-- So creating an event dated last week showed "4 people will be notified" and
-- notified nobody.
--
-- Found the honest way: the owner created a "Test Event" dated 13 August on
-- 31 August, then asked why parents could not see it. The fan-out was right;
-- the number promising otherwise was mine.
create or replace function kg_event_audience_count(
  p_tenant uuid, p_audience kg_audience, p_class uuid,
  p_start_at timestamptz default null
) returns integer
language plpgsql stable security definer set search_path to 'public'
as $function$
declare v int;
begin
  if not kg_is_educator(p_tenant) then
    raise exception 'forbidden';
  end if;

  -- Same rule as the insert trigger, stated once more where the author can see
  -- it: an event that has already started notifies nobody.
  if p_start_at is not null and p_start_at <= now() then
    return 0;
  end if;

  if p_audience = 'staff' then
    select count(*) into v from kg_staff_user_ids(p_tenant) u;
  elsif p_audience = 'class' then
    if p_class is null then return 0; end if;
    select count(*) into v from kg_class_parent_user_ids(p_tenant, p_class) p;
  elsif p_audience = 'parents' then
    select count(distinct p) into v
      from kg_children c, lateral kg_parent_user_ids(c.id) p
     where c.tenant_id = p_tenant and c.status = 'enrolled';
  else
    select count(*) into v from (
      select p as u from kg_children c, lateral kg_parent_user_ids(c.id) p
       where c.tenant_id = p_tenant and c.status = 'enrolled'
      union
      select s from kg_staff_user_ids(p_tenant) s
    ) everyone;
  end if;

  return coalesce(v, 0);
end $function$;

revoke all on function kg_event_audience_count(uuid, kg_audience, uuid, timestamptz) from public, anon;
grant execute on function kg_event_audience_count(uuid, kg_audience, uuid, timestamptz) to authenticated;

-- The 3-argument form from 0094 would otherwise linger as a second, wrong
-- implementation that ignores the date.
drop function if exists kg_event_audience_count(uuid, kg_audience, uuid);

-- Verified after applying, as the owner:
--   past date (13 Aug, like Test Event) -> 0   matches what the trigger did
--   future date (+3 days)               -> 4   the real audience
