-- A guardian linked to an auth user MUST have a parent membership, otherwise
-- getTenantContext() finds no workspace and sends a parent to owner onboarding
-- ("Create your kindergarten"). kg_approve_application creates one, but a
-- guardian linked by any other path (admin linking an existing guardian, seeds,
-- imports) previously stranded that parent. Enforce the invariant in the DB.

-- 1) Backfill: every already-linked guardian gets a parent membership.
insert into kg_memberships (tenant_id, user_id, role)
select distinct g.tenant_id, g.user_id, 'parent'::kg_role
from kg_guardians g
where g.user_id is not null
on conflict (tenant_id, user_id) do nothing;  -- never downgrade an existing role

-- 2) Keep it true for the future.
create or replace function kg_ensure_parent_membership() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.user_id is not null then
    insert into kg_memberships (tenant_id, user_id, role)
      values (new.tenant_id, new.user_id, 'parent')
      on conflict (tenant_id, user_id) do nothing;
    insert into kg_profiles (id) values (new.user_id) on conflict (id) do nothing;
  end if;
  return new;
end $$;

drop trigger if exists trg_kg_guardian_membership on kg_guardians;
create trigger trg_kg_guardian_membership
  after insert or update of user_id on kg_guardians
  for each row execute function kg_ensure_parent_membership();

revoke execute on function kg_ensure_parent_membership() from anon, authenticated;
