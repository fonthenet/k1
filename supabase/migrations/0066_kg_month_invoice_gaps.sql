-- Find and fix invoices that are open but short.
--
-- Two mechanisms already keep a month right: the trigger from 0033 bills an
-- activity the moment an enrolment goes active, and kg_generate_monthly_invoices
-- bills every child who has no invoice yet. Neither covers the case in between —
-- an invoice that already EXISTS but is missing a charge. Re-running the month
-- skips that child (they have an invoice), and the trigger has already fired
-- (the enrolment is old). The bill stays short forever, and nothing says so.
--
-- That is how F-2026-0017 sat at 5 000 DA owing 13 200: approved before the
-- fee-plan fix, so the invoice was opened with only an admission fee, and every
-- later mechanism considered that month handled.
--
-- kg_month_invoice_gaps reports it; kg_complete_month_invoices repairs it. Both
-- are finance-only, and both leave a settled month alone — a paid invoice is a
-- receipt the family already holds, not a debt to reopen.
create or replace function kg_month_invoice_gaps(p_tenant uuid, p_month date)
returns table (child_id uuid, first_name text, last_name text,
               first_name_ar text, last_name_ar text, missing numeric)
language sql stable security definer set search_path = public as $$
  with m as (select date_trunc('month', p_month)::date d),
  inv as (
    select i.id, i.child_id from kg_invoices i, m
     where i.tenant_id = p_tenant and i.period_month = m.d
       and i.status not in ('void', 'paid')),
  tui as (
    select inv.child_id,
           round(coalesce(cf.custom_amount, fp.amount)
                 * (1 - coalesce(cf.discount_pct, 0) / 100.0), 2) amt
      from inv
      join kg_child_fees cf on cf.child_id = inv.child_id and cf.tenant_id = p_tenant
      join kg_fee_plans fp on fp.id = cf.fee_plan_id and fp.period = 'monthly', m
     where cf.start_date <= (m.d + interval '1 month - 1 day')::date
       and (cf.end_date is null or cf.end_date >= m.d)
       and not exists (select 1 from kg_invoice_items x
                        where x.invoice_id = inv.id and x.kind = 'tuition')),
  act as (
    select inv.child_id, sum(a.fee_amount) amt
      from inv
      join kg_activity_enrollments ae on ae.child_id = inv.child_id and ae.status = 'active'
      join kg_activities a on a.id = ae.activity_id
       and a.fee_amount > 0 and a.fee_period = 'monthly', m
     where (ae.end_date is null or ae.end_date >= m.d)
       and not exists (select 1 from kg_invoice_items x
                        where x.invoice_id = inv.id and x.activity_id = a.id)
     group by inv.child_id)
  select c.id, c.first_name, c.last_name, c.first_name_ar, c.last_name_ar,
         coalesce(t.amt, 0) + coalesce(x.amt, 0)
    from kg_children c
    left join tui t on t.child_id = c.id
    left join act x on x.child_id = c.id
   where kg_is_finance(p_tenant)
     and c.tenant_id = p_tenant
     and coalesce(t.amt, 0) + coalesce(x.amt, 0) > 0
   order by c.first_name, c.last_name;
$$;

create or replace function kg_complete_month_invoices(p_tenant uuid, p_month date)
returns table (children int, added numeric)
language plpgsql security definer set search_path = public as $$
declare r record; v_n int := 0; v_sum numeric := 0; v_a numeric;
begin
  if not kg_is_finance(p_tenant) then raise exception 'forbidden'; end if;
  for r in select g.child_id from kg_month_invoice_gaps(p_tenant, p_month) g loop
    v_a := kg_bill_child_month(p_tenant, r.child_id, p_month);
    if v_a > 0 then v_n := v_n + 1; v_sum := v_sum + v_a; end if;
  end loop;
  children := v_n; added := v_sum; return next;
end $$;

revoke execute on function kg_month_invoice_gaps(uuid, date) from public, anon;
revoke execute on function kg_complete_month_invoices(uuid, date) from public, anon;
grant execute on function kg_month_invoice_gaps(uuid, date) to authenticated;
grant execute on function kg_complete_month_invoices(uuid, date) to authenticated;
