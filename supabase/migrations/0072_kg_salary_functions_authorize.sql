-- Salary lookups were readable by anyone, including the public.
--
-- kg_expected_pay and kg_hours_worked are SECURITY DEFINER — they bypass RLS by
-- design so payroll can read across memberships — but neither restated an
-- authorization check, and both were granted to PUBLIC. The tables underneath
-- were correctly protected; these two functions were the way around them.
--
-- Verified before the fix, in rolled-back transactions: a parent (who can see
-- exactly one row of kg_memberships) read the owner's salary as 60 000 and
-- their own child's teacher's as 35 000; the owner of an unrelated crèche read
-- the same figures; and so did role `anon`, with no JWT at all. A parent does
-- not even have to guess an id — kg_class_staff hands them the membership ids
-- of their child's teachers.
--
-- kg_payroll_basis had the guard all along ("if not kg_is_finance(p_tenant)
-- then raise exception"). These two were simply missed, and nothing else in the
-- app calls them directly, so the check can be added without changing a caller.
--
-- The rule: finance of that membership's own tenant, or the person themselves.
-- Self-access is kept deliberately — a member reading their own expected pay is
-- the payslip working as intended.
create or replace function kg_hours_worked(p_membership uuid, p_month date)
returns numeric language plpgsql stable security definer set search_path = public as $fn$
declare v_tenant uuid;
begin
  select tenant_id into v_tenant from kg_memberships where id = p_membership;
  if v_tenant is null then return 0; end if;
  if not (kg_is_finance(v_tenant) or kg_is_my_membership(p_membership)) then
    raise exception 'forbidden';
  end if;

  return (
    select round(coalesce(sum(
      greatest(
        extract(epoch from (ts.clock_out_at - ts.clock_in_at)) / 3600.0
          - kg_unpaid_break_minutes(m.pay_type, ts.break_minutes, t.lunch_allowance_minutes) / 60.0,
        0
      )
    ), 0), 2)
    from kg_timesheets ts
    join kg_memberships m on m.id = ts.membership_id
    join kg_tenants t on t.id = ts.tenant_id
    where ts.membership_id = p_membership
      and ts.clock_in_at is not null and ts.clock_out_at is not null
      and date_trunc('month', ts.date) = date_trunc('month', p_month)
  );
end $fn$;

create or replace function kg_expected_pay(p_membership uuid, p_month date)
returns numeric language plpgsql stable security definer set search_path = public as $fn$
declare m kg_memberships;
begin
  select * into m from kg_memberships where id = p_membership;
  if m.id is null then return 0; end if;
  if not (kg_is_finance(m.tenant_id) or kg_is_my_membership(p_membership)) then
    raise exception 'forbidden';
  end if;

  if m.pay_type = 'hourly' then
    return round(coalesce(m.hourly_rate, 0) * kg_hours_worked(p_membership, p_month), 2);
  end if;
  return coalesce(m.base_salary, 0);
end $fn$;

-- Granted to PUBLIC by 0030; that is what made the leak reachable by anon.
revoke execute on function kg_hours_worked(uuid, date) from public, anon;
revoke execute on function kg_expected_pay(uuid, date) from public, anon;
grant execute on function kg_hours_worked(uuid, date) to authenticated;
grant execute on function kg_expected_pay(uuid, date) to authenticated;
