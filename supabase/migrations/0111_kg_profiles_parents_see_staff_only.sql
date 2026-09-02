-- 0111 — a parent could read every other parent's name, phone and photo.
--
-- ---------------------------------------------------------------------------
-- What is wrong
-- ---------------------------------------------------------------------------
--
-- kg_profiles is readable through
--
--   pr_sel  SELECT  USING (id = auth.uid() OR kg_shares_tenant(id))
--
-- and kg_shares_tenant (0003) answers "do we both hold an active membership in
-- the same crèche?". Since 0008 every parent with an account holds a
-- membership with role 'parent', so two parents at the same crèche "share a
-- tenant" and each may read the other's profile row: full_name, phone,
-- avatar_url. Each Jijel parent can list nine profiles today, two or three of
-- them other families' phone numbers. A crèche does not hand out the parents'
-- directory, and neither should its database.
--
-- ---------------------------------------------------------------------------
-- The fix
-- ---------------------------------------------------------------------------
--
-- kg_shares_tenant now means "we share a crèche AND at least one of us works
-- there". Staff keep the directory they had — they read parents and each
-- other — and a parent reads the staff they message and nobody else's family.
--
-- One exception, so a co-parent is not erased from a shared thread: two
-- guardians of the SAME child may read each other. One Jijel child already has
-- two account-holding guardians, and the family thread shows both their names.
-- Guardianship of a child is a fact both already know.
--
-- The policy text is unchanged; only the function is redefined, so every
-- other caller of kg_shares_tenant — there are none in the migrations or the
-- web app besides pr_sel — gets the same narrower answer.

begin;

create or replace function kg_shares_tenant(other uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from kg_memberships a
    join kg_memberships b on a.tenant_id = b.tenant_id
    where a.user_id = auth.uid() and a.status = 'active'
      and b.user_id = other and b.status = 'active'
      and (a.role <> 'parent' or b.role <> 'parent')
  )
  or exists (
    select 1
      from kg_guardians ga
      join kg_child_guardians ca on ca.guardian_id = ga.id
      join kg_child_guardians cb on cb.child_id = ca.child_id
      join kg_guardians gb on gb.id = cb.guardian_id
     where ga.user_id = auth.uid() and gb.user_id = other
  )
$$;

comment on function kg_shares_tenant(uuid) is
  'True when the caller and `other` share an active membership in a crèche and at least one of them is staff there, or when both are guardians of the same child. Parents never see other families through this. See 0111.';

commit;
