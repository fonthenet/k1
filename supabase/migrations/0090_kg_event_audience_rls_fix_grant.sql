-- Correction to 0089.
--
-- APPLIED 2026-08-31.
--
-- 0089's policies called kg_class_parent_user_ids, which returns a DIRECTORY of
-- parent user_ids and is therefore revoked from clients (0087's whole subject).
-- But an RLS policy is evaluated as the QUERYING role, not as the table owner,
-- so the parent portal got `permission denied for function
-- kg_class_parent_user_ids` on every event read. Caught by the verification
-- immediately after applying; no client shipped against it.
--
-- Granting the directory function to `authenticated` would have fixed the error
-- by reintroducing exactly the leak 0087 closed. So the policy gets its own
-- predicate: one that answers only about the CALLER, and returns a boolean
-- rather than a list.
--
-- Two functions, one rule. The status/tenant test is written identically in
-- both, and the pair is the single place to change it.
create or replace function kg_is_parent_of_class(p_tenant uuid, p_class uuid)
returns boolean
language sql stable security definer set search_path to 'public'
as $function$
  select exists (
    select 1 from kg_children c
     where c.class_id = p_class
       and c.tenant_id = p_tenant
       and c.status = 'enrolled'
       and kg_is_parent_of(c.id)      -- scoped to the caller; never a directory
  )
$function$;

revoke all on function kg_is_parent_of_class(uuid, uuid) from public, anon;
grant execute on function kg_is_parent_of_class(uuid, uuid) to authenticated;

-- kg_is_staff, not kg_is_educator: ev_all already covers educators, but
-- kg_is_educator excludes ACCOUNTANT, who reads the calendar today only via the
-- permissive ev_sel. Narrowing to educators would quietly remove the calendar
-- from the accountant.
drop policy if exists ev_sel on kg_events;
create policy ev_sel on kg_events for select
  using (
    kg_is_staff(tenant_id)
    or (
      kg_is_member(tenant_id)
      and (
        audience = 'all'
        or audience = 'parents'
        or (audience = 'class' and class_id is not null
            and kg_is_parent_of_class(tenant_id, class_id))
      )
    )
  );

-- The same rule applied back to announcements: 0079 was right in shape but
-- carried no status and no tenant test.
drop policy if exists ann_sel on kg_announcements;
create policy ann_sel on kg_announcements for select
  using (
    kg_is_staff(tenant_id)
    or (
      kg_is_member(tenant_id)
      and (
        audience = 'all'
        or audience = 'parents'
        or (audience = 'class' and class_id is not null
            and kg_is_parent_of_class(tenant_id, class_id))
      )
    )
  );

-- Verified after applying, in a rolled-back transaction:
--   Rayan (Petite Section)      2 events  — "Outdoor trip" gone
--   Lina  (Crèche Bébés)        3 events  — still sees her class's trip
--   owner                       3 events
--   parent announcements        2         — no regression
