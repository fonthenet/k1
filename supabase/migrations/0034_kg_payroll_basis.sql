-- 0034 — One round trip for "what should each person be paid this month".
--
-- createPayrollRun read kg_memberships.base_salary directly, which is only
-- correct for monthly staff. Hourly staff would have been paid a flat
-- base_salary they do not have. The arithmetic lives in the database
-- (kg_expected_pay, 0030) so the payroll run and any future payslip or report
-- cannot drift apart.

alter table kg_payroll_items
  add column if not exists hours numeric(8,2);

comment on column kg_payroll_items.hours is
  'Hours the base_amount was computed from, for hourly staff. Null for monthly — kept so a payslip can show the arithmetic that produced it.';

create or replace function kg_payroll_basis(p_tenant uuid, p_month date)
returns table (
  membership_id uuid,
  pay_type kg_pay_type,
  hourly_rate numeric,
  hours numeric,
  expected numeric
) language plpgsql stable security definer set search_path = public as $$
begin
  if not kg_is_finance(p_tenant) then raise exception 'forbidden'; end if;
  return query
    select m.id, m.pay_type, m.hourly_rate,
           case when m.pay_type = 'hourly' then kg_hours_worked(m.id, p_month) end,
           kg_expected_pay(m.id, p_month)
      from kg_memberships m
     where m.tenant_id = p_tenant and m.status = 'active' and m.role <> 'parent';
end $$;
grant execute on function kg_payroll_basis(uuid, date) to authenticated;
