-- 0056 — The admission fee is a fee plan, not a number somebody retypes.
--
-- 0054 asked the reviewer to key a registration amount into the approval dialog.
-- That was wrong, and the crèche's own data says so: kg_fee_plans already holds
--
--     Frais d'inscription — 5 000 DA — period 'once' — "payable une seule fois
--     à l'admission"
--
-- and no code in the entire database referenced period 'once'. The fee was
-- modelled correctly and then never applied by anything, which is why the
-- tariffs screen reports "Aucun enfant assigné" against it forever, and why a
-- family is admitted without ever being charged the admission fee the crèche
-- believes it charges.
--
-- So: every ACTIVE 'once' plan is applied automatically at approval. The amount
-- comes from the plan, so changing the tariff changes what new families pay and
-- nobody has to remember a number.
--
-- Recording it in kg_child_fees is safe and deliberate. kg_generate_monthly_
-- invoices joins `fp.period = 'monthly'`, so a 'once' row can never be billed a
-- second time by the schedule — while giving the tariffs screen the assignment
-- count it is currently missing, and leaving a record of who was charged
-- admission and when.

drop function if exists kg_approve_and_bill(uuid, uuid, text, uuid, numeric, numeric, numeric, boolean);
drop function if exists kg_start_child_billing(uuid, uuid, uuid, numeric, numeric, numeric, boolean);

create or replace function kg_start_child_billing(
  p_tenant uuid,
  p_child uuid,
  p_fee_plan uuid,
  p_discount_pct numeric default 0,
  p_custom_amount numeric default null,
  p_bill_first_month boolean default true
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_plan kg_fee_plans;
  v_month date := date_trunc('month', (now() at time zone 'Africa/Algiers')::date)::date;
  v_inv uuid;
  v_amount numeric;
  v_once kg_fee_plans;
  v_charged boolean := false;
begin
  if not kg_is_admin(p_tenant) then raise exception 'forbidden'; end if;

  if p_fee_plan is not null then
    select * into v_plan from kg_fee_plans
     where id = p_fee_plan and tenant_id = p_tenant and period = 'monthly';
    if v_plan.id is null then raise exception 'unknown_fee_plan'; end if;

    insert into kg_child_fees (tenant_id, child_id, fee_plan_id, custom_amount,
                               discount_pct, start_date)
    values (p_tenant, p_child, p_fee_plan, p_custom_amount,
            coalesce(p_discount_pct, 0), current_date)
    on conflict do nothing;
  end if;

  -- ── Admission fees, straight from the tariff list ─────────────────────
  for v_once in
    select * from kg_fee_plans
     where tenant_id = p_tenant and active and period = 'once'
     order by amount desc
  loop
    -- Charged once in a lifetime, so never twice for the same child even if
    -- approval is somehow replayed.
    if exists (select 1 from kg_child_fees
                where child_id = p_child and fee_plan_id = v_once.id) then
      continue;
    end if;
    if v_once.amount <= 0 then continue; end if;

    if v_inv is null then v_inv := kg_open_invoice_for_month(p_tenant, p_child, v_month); end if;

    insert into kg_invoice_items (invoice_id, tenant_id, kind, description,
                                  qty, unit_amount, amount)
    values (v_inv, p_tenant, 'registration', v_once.name, 1, v_once.amount, v_once.amount);

    -- The record that this child has now been charged admission. Cannot be
    -- billed monthly: the generator's join demands period = 'monthly'.
    insert into kg_child_fees (tenant_id, child_id, fee_plan_id, start_date, end_date)
    values (p_tenant, p_child, v_once.id, current_date, current_date)
    on conflict do nothing;

    v_charged := true;
  end loop;

  -- ── The month's tuition ───────────────────────────────────────────────
  if coalesce(p_bill_first_month, true) and v_plan.id is not null then
    if v_inv is null then v_inv := kg_open_invoice_for_month(p_tenant, p_child, v_month); end if;

    -- Priced exactly as kg_generate_monthly_invoices prices it, so an invoice
    -- raised at approval and one raised by the schedule are indistinguishable.
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
revoke execute on function kg_start_child_billing(uuid, uuid, uuid, numeric, numeric, boolean) from anon;
grant execute on function kg_start_child_billing(uuid, uuid, uuid, numeric, numeric, boolean) to authenticated;

create or replace function kg_approve_and_bill(
  p_app uuid,
  p_class uuid,
  p_tag_code text,
  p_fee_plan uuid default null,
  p_discount_pct numeric default 0,
  p_custom_amount numeric default null,
  p_bill_first_month boolean default true
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_child uuid; v_tenant uuid;
begin
  v_child := kg_approve_application(p_app, p_class, p_tag_code);
  select tenant_id into v_tenant from kg_children where id = v_child;

  -- Runs even with no monthly plan chosen: the admission fee is owed on
  -- admission, which is what 'once' means.
  perform kg_start_child_billing(v_tenant, v_child, p_fee_plan, p_discount_pct,
                                 p_custom_amount, p_bill_first_month);
  return v_child;
end $$;
revoke execute on function kg_approve_and_bill(uuid, uuid, text, uuid, numeric, numeric, boolean) from anon;
grant execute on function kg_approve_and_bill(uuid, uuid, text, uuid, numeric, numeric, boolean) to authenticated;

-- What a new admission will be charged, so the approval screen can show the
-- figure instead of asking somebody to remember it.
create or replace function kg_admission_fees(p_tenant uuid)
returns table (id uuid, name text, name_ar text, amount numeric)
language sql stable security definer set search_path = public as $$
  select id, name, name_ar, amount
    from kg_fee_plans
   where tenant_id = p_tenant and active and period = 'once' and amount > 0
   order by amount desc
$$;
grant execute on function kg_admission_fees(uuid) to authenticated;
