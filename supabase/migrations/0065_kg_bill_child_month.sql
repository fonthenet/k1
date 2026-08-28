-- Charge a child for the month their tariff was decided in.
--
-- The gap this closes: a child could be approved with no fee plan (the office
-- often has not settled the tariff on the day the family enrols). Their invoice
-- then held the admission fee alone. Assigning "Demi-journée" a week later
-- wrote kg_child_fees and nothing else — and the monthly run only ever bills
-- the NEXT month, so the month in between was never charged and no screen said
-- so. That is how F-2026-0017 read 5 000 DA when it owed 13 200.
--
-- Idempotent by construction: it adds tuition only when the invoice has no
-- tuition line, and each activity only when that activity_id is not already on
-- it. Safe to call on every assignment, and safe to call twice.
create or replace function kg_bill_child_month(
  p_tenant uuid, p_child uuid, p_month date default null
) returns numeric language plpgsql security definer set search_path = public as $$
declare
  v_month date := date_trunc('month', coalesce(p_month, current_date))::date;
  v_inv uuid; v_plan record; a record; v_amount numeric; v_added numeric := 0;
  v_status text; v_has_tuition boolean; v_pending boolean;
begin
  if not kg_is_finance(p_tenant) then raise exception 'forbidden'; end if;
  if not exists (select 1 from kg_children
                  where id = p_child and tenant_id = p_tenant and status = 'enrolled') then
    return 0;
  end if;

  select id, status::text into v_inv, v_status
    from kg_invoices
   where child_id = p_child and period_month = v_month and status <> 'void'
   order by created_at limit 1;

  -- A settled month is closed. Re-opening a paid invoice would turn a receipt
  -- the family already holds into a debt they never agreed to.
  if v_status = 'paid' then return 0; end if;

  select cf.custom_amount, cf.discount_pct, fp.name, fp.amount
    into v_plan
    from kg_child_fees cf
    join kg_fee_plans fp on fp.id = cf.fee_plan_id and fp.period = 'monthly'
   where cf.child_id = p_child and cf.tenant_id = p_tenant
     and cf.start_date <= (v_month + interval '1 month - 1 day')::date
     and (cf.end_date is null or cf.end_date >= v_month)
   order by cf.start_date desc limit 1;

  v_has_tuition := v_inv is not null and exists (
    select 1 from kg_invoice_items where invoice_id = v_inv and kind = 'tuition');

  -- Decide before opening anything. Opening the invoice first meant a child
  -- given a one-off plan (admission, say) got an empty invoice that recalc then
  -- voided — a burnt number and a void row for a call that owed nothing.
  v_pending := (v_plan.name is not null and not v_has_tuition)
    or exists (
      select 1 from kg_activity_enrollments ae
        join kg_activities act on act.id = ae.activity_id
       where ae.child_id = p_child and ae.status = 'active'
         and act.fee_amount > 0 and act.fee_period = 'monthly'
         and (ae.end_date is null or ae.end_date >= v_month)
         and (v_inv is null or not exists (
               select 1 from kg_invoice_items
                where invoice_id = v_inv and activity_id = act.id)));
  if not v_pending then return 0; end if;

  if v_inv is null then
    v_inv := kg_open_invoice_for_month(p_tenant, p_child, v_month);
  end if;

  if v_plan.name is not null and not exists (
    select 1 from kg_invoice_items where invoice_id = v_inv and kind = 'tuition'
  ) then
    v_amount := round(coalesce(v_plan.custom_amount, v_plan.amount)
                      * (1 - coalesce(v_plan.discount_pct, 0) / 100.0), 2);
    insert into kg_invoice_items (invoice_id, tenant_id, kind, description,
                                  qty, unit_amount, amount)
    values (v_inv, p_tenant, 'tuition',
            v_plan.name || ' — ' || to_char(v_month, 'MM/YYYY'), 1,
            coalesce(v_plan.custom_amount, v_plan.amount), v_amount);
    v_added := v_added + v_amount;
  end if;

  for a in
    select act.id, act.name, act.fee_amount
      from kg_activity_enrollments ae
      join kg_activities act on act.id = ae.activity_id
     where ae.child_id = p_child and ae.status = 'active'
       and act.fee_amount > 0 and act.fee_period = 'monthly'
       and (ae.end_date is null or ae.end_date >= v_month)
  loop
    if exists (select 1 from kg_invoice_items
                where invoice_id = v_inv and activity_id = a.id) then
      continue;
    end if;
    insert into kg_invoice_items (invoice_id, tenant_id, kind, description,
                                  qty, unit_amount, amount, activity_id)
    values (v_inv, p_tenant, 'activity',
            a.name || ' — ' || to_char(v_month, 'MM/YYYY'), 1,
            a.fee_amount, a.fee_amount, a.id);
    v_added := v_added + a.fee_amount;
  end loop;

  perform kg_invoice_recalc(v_inv);
  return v_added;
end $$;

revoke execute on function kg_bill_child_month(uuid, uuid, date) from public, anon;
grant execute on function kg_bill_child_month(uuid, uuid, date) to authenticated;
