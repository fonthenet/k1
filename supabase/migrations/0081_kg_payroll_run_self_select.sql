-- 0081 — an employee may read the payroll run their own payslip belongs to.
--
-- NOT YET APPLIED. Apply 0081, then 0082, then 0083, in that order: 0083's
-- kg_payroll_create filters advances on the status column 0082 adds.
--
-- ---------------------------------------------------------------------------
-- What is wrong
-- ---------------------------------------------------------------------------
--
-- kg_payroll_items already lets a member read their own line:
--
--     pri_sel  SELECT  USING (kg_is_finance(tenant_id)
--                             OR kg_is_my_membership(membership_id))
--
-- kg_payroll_runs has exactly one policy:
--
--     prr_all  ALL     USING (kg_is_finance(tenant_id))
--
-- So the employee can read the amount but not the month it is for, not whether
-- it has been finalised, and not whether it has been paid. Every one of those
-- lives on the run.
--
-- A payslip screen that embeds `kg_payroll_runs(month, status)` does not fail
-- loudly here — PostgREST returns the item with the embedded object null, and
-- the screen renders a payslip with no period on it. That is the worst shape of
-- this bug: it looks like a rendering mistake rather than a permission one, and
-- the obvious "fix" is to read the month from somewhere else and leave the hole
-- open.
--
-- ---------------------------------------------------------------------------
-- The shape of the fix
-- ---------------------------------------------------------------------------
--
-- One SELECT policy, ORed onto the existing prr_all. Writes are untouched:
-- prr_all keeps its grip on INSERT/UPDATE/DELETE, so nobody gains the ability
-- to create, finalise or pay a run.
--
-- The membership lookup goes through a SECURITY DEFINER helper rather than a
-- subquery on kg_payroll_items. A subquery inside a policy is itself evaluated
-- under the caller's RLS, which would make every read of kg_payroll_runs walk
-- kg_payroll_items under pri_sel — correct, but it ties two policies together
-- so that a future edit to either one silently changes the other. The helper
-- says the thing once, in one place.
--
-- Note it deliberately does NOT check kg_memberships.status: an employee who
-- has since left must still be able to read the payslip for a month they
-- worked. Their membership row survives; only the shell they can open changes.

begin;

create or replace function kg_has_payslip_in_run(p_run uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1
      from kg_payroll_items i
      join kg_memberships m on m.id = i.membership_id
     where i.run_id = p_run
       and m.user_id = auth.uid()
  )
$function$;

revoke all on function kg_has_payslip_in_run(uuid) from public, anon;
grant execute on function kg_has_payslip_in_run(uuid) to authenticated;

drop policy if exists prr_sel on kg_payroll_runs;
create policy prr_sel on kg_payroll_runs for select
  using (kg_is_finance(tenant_id) or kg_has_payslip_in_run(id));

commit;

-- ---------------------------------------------------------------------------
-- Check afterwards. As the educator with a payslip (user
-- 6f885045-e7ec-408e-9833-947499fe8bb6), this must return their runs and only
-- theirs, and the UPDATE must still match nothing:
--
--   begin;
--   select set_config('request.jwt.claims',
--     json_build_object('sub','6f885045-e7ec-408e-9833-947499fe8bb6',
--                       'role','authenticated')::text, true);
--   set local role authenticated;
--   select id, month, status from kg_payroll_runs;          -- expect 2 rows
--   update kg_payroll_runs set status = 'draft';            -- expect 0 rows
--   rollback;
--
-- ROLLBACK of this migration:
--
--   drop policy if exists prr_sel on kg_payroll_runs;
--   drop function if exists kg_has_payslip_in_run(uuid);
--
-- Nothing else depends on either object, and dropping them restores the
-- finance-only visibility exactly.
-- ---------------------------------------------------------------------------
