-- The same hole 0072 closed for salaries, still open for a child's debt.
--
-- APPLIED 2026-08-30. Verified afterwards: anon -> permission denied; the
-- owner still reads 10000.
--
-- kg_child_balance is SECURITY DEFINER — it has to be, so a finance user can
-- total invoices the RLS policies would otherwise filter — but it never
-- restated an authorization check, and EXECUTE was granted to PUBLIC. The
-- kg_invoices policies underneath are correct; this function was the way past
-- them.
--
-- Verified in a rolled-back transaction before the fix: role `anon`, with no
-- JWT at all, sees zero rows of kg_children and yet
--
--   select kg_child_balance('46ea0fcf-…')  ->  10000.00
--
-- for a named child of a real family. A child id is not a secret — it is in
-- enrolment links and the QR posters printed for the door — so this is one
-- guessable-to-known id away from "how much does that family owe", for anyone
-- on the internet, across every tenant on the platform.
--
-- The rule matches the one the app already applies in its own code: finance of
-- that child's tenant, or a guardian of the child. The web dashboard has always
-- gated the call on `ctx.isFinance`, and no parent-facing screen calls it (the
-- portal totals invoices it can already read), so no existing caller changes
-- behaviour — this only removes the ones that were never supposed to work.
create or replace function kg_child_balance(p_child uuid)
returns numeric language plpgsql stable security definer set search_path = public as $fn$
declare v_tenant uuid;
begin
  select tenant_id into v_tenant from kg_children where id = p_child;
  -- A missing child is not an authorization answer: returning 0 rather than
  -- raising keeps this from being an existence oracle for child ids.
  if v_tenant is null then return 0; end if;

  if not (kg_is_finance(v_tenant) or kg_is_parent_of(p_child)) then
    raise exception 'forbidden';
  end if;

  return (
    select coalesce(sum(greatest(0, total - paid_amount)), 0)
      from kg_invoices
     where child_id = p_child and status not in ('void', 'draft')
  );
end $fn$;

-- Granted to PUBLIC when the function was created; that is what made the leak
-- reachable without a JWT.
revoke execute on function kg_child_balance(uuid) from public, anon;
grant execute on function kg_child_balance(uuid) to authenticated;
