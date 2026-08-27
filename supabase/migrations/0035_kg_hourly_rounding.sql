-- 0035 — An hourly payslip must reproduce by hand.
--
-- kg_expected_pay multiplied the raw hours (42.9166…) while kg_hours_worked
-- reported them rounded to 42.92. A payslip showing "42.92 h x 350 DA" totalled
-- 15 020.83 instead of 15 022.00 — 1.17 DA that nobody could account for, which
-- is exactly the kind of thing a wage dispute is made of. Both now agree on the
-- same rounded hours, so the line on the payslip is the arithmetic that was
-- actually done.

create or replace function kg_expected_pay(p_membership uuid, p_month date)
returns numeric language plpgsql stable security definer set search_path = public as $$
declare m kg_memberships;
begin
  select * into m from kg_memberships where id = p_membership;
  if m.id is null then return 0; end if;

  if m.pay_type = 'hourly' then
    return round(coalesce(m.hourly_rate, 0) * kg_hours_worked(p_membership, p_month), 2);
  end if;

  return coalesce(m.base_salary, 0);
end $$;
