-- 0143 — approving a transfer never raises an admission fee.
--
-- kg_approve_and_bill runs kg_start_child_billing after every approval, and
-- that charges each one-off plan the child has not yet paid. For a NEW child
-- that is the admission fee, correctly. For a child already here who is
-- moving crèche → école it was the building-wide admission fee a second time
-- whenever the original charge predates kg_child_fees — which is every child
-- migrated in from paper. Seen on the demo: 8 000 DA on a move.
--
-- kg_start_child_billing gains a switch; only kg_approve_and_bill calls it
-- (no PostgREST caller — grep the app), so the signature can change in place.

drop function if exists kg_start_child_billing(uuid, uuid, uuid, numeric, numeric, boolean);
create or replace function kg_start_child_billing(
  p_tenant uuid, p_child uuid, p_fee_plan uuid, p_discount_pct numeric default 0,
  p_custom_amount numeric default null, p_bill_first_month boolean default true,
  p_admission boolean default true
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_plan kg_fee_plans;
  v_month date := date_trunc('month', (now() at time zone 'Africa/Algiers')::date)::date;
  v_inv uuid;
  v_amount numeric;
  v_once kg_fee_plans;
  v_charged boolean := false;
  v_structure uuid;
begin
  if not kg_is_admin(p_tenant) then raise exception 'forbidden'; end if;
  select structure_id into v_structure from kg_children where id = p_child;

  if p_fee_plan is not null then
    select * into v_plan from kg_fee_plans
     where id = p_fee_plan and tenant_id = p_tenant and period = 'monthly';
    if v_plan.id is null then raise exception 'unknown_fee_plan'; end if;
    if not exists (select 1 from kg_child_fees
                    where child_id = p_child and fee_plan_id = p_fee_plan
                      and (end_date is null or end_date >= current_date)) then
      insert into kg_child_fees (tenant_id, child_id, fee_plan_id, custom_amount,
                                 discount_pct, start_date)
      values (p_tenant, p_child, p_fee_plan, p_custom_amount,
              coalesce(p_discount_pct, 0), current_date);
    end if;
  end if;

  if p_admission then
    for v_once in
      select * from kg_fee_plans
       where tenant_id = p_tenant and active and period = 'once'
         and (structure_id is null or structure_id = v_structure)
       order by amount desc
    loop
      if exists (select 1 from kg_child_fees
                  where child_id = p_child and fee_plan_id = v_once.id) then
        continue;
      end if;
      if v_once.amount <= 0 then continue; end if;
      if v_inv is null then v_inv := kg_open_invoice_for_month(p_tenant, p_child, v_month); end if;
      insert into kg_invoice_items (invoice_id, tenant_id, kind, description,
                                    qty, unit_amount, amount)
      values (v_inv, p_tenant, 'registration', v_once.name, 1, v_once.amount, v_once.amount);
      insert into kg_child_fees (tenant_id, child_id, fee_plan_id, start_date, end_date)
      values (p_tenant, p_child, v_once.id, current_date, current_date);
      v_charged := true;
    end loop;
  end if;

  if coalesce(p_bill_first_month, true) and v_plan.id is not null then
    if v_inv is null then v_inv := kg_open_invoice_for_month(p_tenant, p_child, v_month); end if;
    v_amount := round(coalesce(p_custom_amount, v_plan.amount)
                      * (1 - coalesce(p_discount_pct, 0) / 100.0), 2);
    insert into kg_invoice_items (invoice_id, tenant_id, kind, description,
                                  qty, unit_amount, amount)
    values (v_inv, p_tenant, 'tuition',
            v_plan.name || ' — ' || to_char(v_month, 'MM/YYYY'), 1,
            coalesce(p_custom_amount, v_plan.amount), v_amount);
    v_charged := true;
  end if;

  if v_inv is not null and v_charged then
    perform kg_invoice_recalc(v_inv);
  end if;
  return v_inv;
end $$;
revoke all on function kg_start_child_billing(uuid, uuid, uuid, numeric, numeric, boolean, boolean) from public, anon;
grant execute on function kg_start_child_billing(uuid, uuid, uuid, numeric, numeric, boolean, boolean) to authenticated;

create or replace function kg_approve_and_bill(
  p_app uuid, p_class uuid, p_tag_code text,
  p_fee_plan uuid default null, p_discount_pct numeric default 0,
  p_custom_amount numeric default null, p_bill_first_month boolean default true
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_child uuid; v_tenant uuid; v_transfer boolean;
begin
  -- Decided BEFORE the approval: it sets created_child_id on both kinds.
  select existing_child_id is not null into v_transfer from kg_applications where id = p_app;
  v_child := kg_approve_application(p_app, p_class, p_tag_code);
  select tenant_id into v_tenant from kg_children where id = v_child;
  perform kg_start_child_billing(v_tenant, v_child, p_fee_plan, p_discount_pct,
                                 p_custom_amount, p_bill_first_month,
                                 not coalesce(v_transfer, false));
  return v_child;
end $$;
