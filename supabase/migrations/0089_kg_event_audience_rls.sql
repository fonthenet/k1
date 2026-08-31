-- Events: who may READ one, and who is a "parent of this class".
--
-- APPLIED 2026-08-31 (as kg_event_audience_rls, corrected by 0090).
--
-- kg_events carries audience + class_id exactly like kg_announcements but never
-- got the fix 0079 gave announcements: ev_sel was `kg_is_member(tenant_id)`
-- alone. Verified against production BEFORE this ran — a parent of a child in
-- Petite Section could read all 3 events including "Outdoor trip", which is
-- scoped to Crèche Bébés (5 of 17 children). Announcements for the same parent
-- correctly returned 2.
--
-- ONE definition of "parent of this class". Three places disagreed:
--   kg_announcement_recipients  c.status = 'enrolled'   (0049)
--   ann_sel policy              no status test at all   (0079)
--   both clients' getMyChildren no status test at all
-- so a family that withdrew in June kept reading their old class's
-- announcements in September while never being notified. 'enrolled' is the
-- rule; every child in production is enrolled today, so nothing changed for
-- anyone currently reading the calendar.
create or replace function kg_class_parent_user_ids(p_tenant uuid, p_class uuid)
returns setof uuid
language sql stable security definer set search_path to 'public'
as $function$
  select distinct p
    from kg_children c, lateral kg_parent_user_ids(c.id) p
   where c.class_id = p_class
     and c.tenant_id = p_tenant      -- 0049 matched on class_id alone
     and c.status = 'enrolled'
$function$;

-- Internal: 0087 documented what a helper like this becomes when it is
-- callable — a directory of parents.
revoke all on function kg_class_parent_user_ids(uuid, uuid) from public, anon, authenticated;

-- audience='class' with class_id NULL is the worst row in the schema: the
-- policy hides it from everybody while kg_announcement_recipients falls through
-- its `elsif ... and class_id is not null` into the else branch and notifies
-- EVERY parent — and the title is copied into each notification, so hiding the
-- source row afterwards achieves nothing. Zod guarded the dialog; nothing
-- guarded the table. Verified 0 violating rows before adding these.
alter table kg_events
  add constraint kg_events_class_needs_id
  check (audience <> 'class' or class_id is not null);

alter table kg_announcements
  add constraint kg_announcements_class_needs_id
  check (audience <> 'class' or class_id is not null);

-- Never deliver the same notification twice to one person.
--
-- kg_announcement_recipients concatenates parents || staff for audience='all'
-- with no dedupe across the join, and kg_notify inserted `from unnest(...)`
-- with no DISTINCT. Measured on production before this fix: an audience='all'
-- announcement resolved to 11 recipients, 10 distinct — one real person (a
-- staff member who is also a guardian) notified twice, every time. And because
-- the push tag is `type:notification_id`, the two banners stacked rather than
-- collapsing.
--
-- Fixed in kg_notify rather than in the recipients function so it holds for
-- every caller, announcements included. (Superseded by 0092, which adds
-- ON CONFLICT DO NOTHING.)
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
    returning 1
  )
  select count(*) into v_count from inserted;
  return v_count;
end $function$;

-- NOTE: this migration also rewrote ev_sel and ann_sel to call
-- kg_class_parent_user_ids directly. That was WRONG and 0090 fixes it — an RLS
-- policy is evaluated as the querying role, which has no EXECUTE on a revoked
-- function. See 0090 for the policies as they actually stand.
