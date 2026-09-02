-- 0112 — "Suspend" changed a badge on the operator's screen and nothing else.
--
-- ---------------------------------------------------------------------------
-- What is wrong
-- ---------------------------------------------------------------------------
--
-- 0043 gave the platform operator kg_set_tenant_status, and it does write
-- kg_tenants.status = 'suspended'. Nothing reads it. Every policy in the
-- system asks kg_is_member / kg_role_in "does this user hold an active
-- membership in this tenant?" and never "is the tenant itself active?", so a
-- suspended crèche's staff keep reading and writing every table exactly as
-- before, from the web, the phone app and the kiosk. The only thing the
-- operator's one lever moved was the colour of a pill on /admin/tenants.
--
-- Worse, the owner can move it back. t_upd is `USING (kg_is_admin(id))` with
-- no WITH CHECK and no column restriction, and settings/actions.ts proves the
-- owner's UPDATE path on kg_tenants works — so `PATCH kg_tenants?id=eq.<mine>
-- {"status":"active"}` over PostgREST un-suspends the account the operator
-- just suspended.
--
-- Today all six tenants are active, so this is latent. It is also the only
-- enforcement the business has until billing is wired.
--
-- ---------------------------------------------------------------------------
-- The fix
-- ---------------------------------------------------------------------------
--
-- Enforce at the RLS layer so every client stops at once. One helper,
-- kg_tenant_active, and the three membership predicates every policy is built
-- on gain the extra condition. A suspended tenant's rows become invisible and
-- unwritable to its own members — including kg_tenants itself (t_sel is
-- kg_is_member(id)), which is what the web app uses to detect the state and
-- show a /suspended page instead of an empty dashboard.
--
-- The platform functions do not go through these predicates: kg_platform_*
-- and kg_set_tenant_status check kg_is_platform_admin() and run as the owner,
-- so the operator can still see the crèche and re-activate it.
--
-- Then lock the column. A BEFORE UPDATE trigger refuses any change to status
-- (and to id, slug and created_at, which nobody should be rewriting either)
-- unless the caller is a platform admin. The trigger keys on auth.uid(): a
-- direct database session — the SQL editor, psql, this migration — has no JWT
-- and is not what the guard is for; a PostgREST request always has one.
--
-- NOT done: `revoke update (status, ...)`. Column-level privileges are only
-- consulted when the role lacks the table-level privilege, and both API roles
-- hold table-level UPDATE on kg_tenants, so the revoke would be a silent
-- no-op. Making it real would mean revoking the table grant and re-granting a
-- column list that every future `alter table kg_tenants add column` has to
-- remember to extend. The trigger closes the same door without the trap.
--
-- t_upd finally gets a WITH CHECK, so an admin's update must still be their
-- own tenant afterwards.
--
-- Smoke test after applying, as the demo owner: suspend the demo tenant from
-- /admin/tenants; `select count(*) from kg_children` as that owner must be 0
-- and the web app must land on /suspended; re-activate and both come back.

begin;

/* --------------------------------------------------------------- helper */

create or replace function kg_tenant_active(t uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from kg_tenants where id = t and status = 'active')
$$;

comment on function kg_tenant_active(uuid) is
  'True while the tenant is not suspended. Every membership predicate (kg_is_member, kg_role_in, kg_my_tenants) folds this in; the platform functions deliberately do not. See 0112.';

/* ------------------------------------------------- membership predicates */

create or replace function kg_my_tenants() returns setof uuid
language sql stable security definer set search_path = public as $$
  select m.tenant_id
    from kg_memberships m
    join kg_tenants t on t.id = m.tenant_id and t.status = 'active'
   where m.user_id = auth.uid() and m.status = 'active'
$$;

create or replace function kg_role_in(t uuid, roles kg_role[]) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from kg_memberships
    where tenant_id = t and user_id = auth.uid() and status = 'active' and role = any(roles)
  ) and kg_tenant_active(t)
$$;

create or replace function kg_is_member(t uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from kg_memberships
    where tenant_id = t and user_id = auth.uid() and status = 'active'
  ) and kg_tenant_active(t)
$$;

/* ------------------------------------------------------ the status lock */

create or replace function kg_tenant_identity_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not kg_is_platform_admin() and (
       new.status     is distinct from old.status
    or new.id         is distinct from old.id
    or new.slug       is distinct from old.slug
    or new.created_at is distinct from old.created_at
  ) then
    raise exception 'forbidden' using hint = 'only the platform operator may change a tenant''s status';
  end if;
  return new;
end $$;
revoke all on function kg_tenant_identity_guard() from public, anon, authenticated;

drop trigger if exists trg_kg_tenant_identity_guard on kg_tenants;
create trigger trg_kg_tenant_identity_guard
  before update of status, id, slug, created_at on kg_tenants
  for each row execute function kg_tenant_identity_guard();

drop policy if exists t_upd on kg_tenants;
create policy t_upd on kg_tenants for update
  using (kg_is_admin(id))
  with check (kg_is_admin(id));

commit;
