-- How many people an event is about to interrupt.
--
-- APPLIED 2026-08-31.
--
-- The event dialog opens on audience 'all' and nothing told the author what
-- that means. While events notified nobody that was harmless; from 0091 a stray
-- default is a push to every family in the crèche. The author is the only
-- person who can catch it, and only if the number is on screen BEFORE they save.
--
-- Returns a count and nothing else — never the recipients. kg_event_recipients
-- itself stays revoked from clients (it is a parent directory), which is why
-- this exists as a separate function rather than as a grant.
create or replace function kg_event_audience_count(
  p_tenant uuid, p_audience kg_audience, p_class uuid
) returns integer
language plpgsql stable security definer set search_path to 'public'
as $function$
declare v int;
begin
  -- Staff-only, and only for their own crèche: a count is still a fact about
  -- somebody else's family if you can ask it of an arbitrary tenant.
  if not kg_is_educator(p_tenant) then
    raise exception 'forbidden';
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

revoke all on function kg_event_audience_count(uuid, kg_audience, uuid) from public, anon;
grant execute on function kg_event_audience_count(uuid, kg_audience, uuid) to authenticated;
