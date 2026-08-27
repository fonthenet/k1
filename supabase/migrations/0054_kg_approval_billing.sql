-- 0054 — Approving a child starts their billing.
--
-- kg_approve_application took a class and a tag code and nothing else. It
-- created the child, the guardians, the health record, the activity
-- enrolments and the parent membership — and no fee plan and no invoice. So an
-- approved child was enrolled, counted in the décret 19-253 registers, checked
-- in at the door every morning, and billed nothing. Silently, forever, with no
-- screen anywhere showing that anything was wrong. On this database that was
-- already 2 of 14 enrolled children.
--
-- The monthly run (0047) does not rescue them either: it bills from
-- kg_child_fees, so a child with no fee row is skipped every month without
-- appearing in the run exceptions as anything a human would investigate.
--
-- Nothing below re-implements billing. kg_generate_monthly_invoices remains the
-- one place that knows how to price a month; this only makes sure the fee row
-- it reads actually exists, and optionally raises the first invoice at once so
-- the family is not billed from the 1st of next month for a child who started
-- on the 3rd of this one.

-- Assigns the standing fee and, when asked, raises the first invoice.
create or replace function kg_start_child_billing(
  p_tenant uuid,
  p_child uuid,
  p_fee_plan uuid,
  p_discount_pct numeric default 0,
  p_custom_amount numeric default null,
  p_registration_fee numeric default null,
  p_bill_first_month boolean default true
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_plan kg_fee_plans;
  v_month date := date_trunc('month', (now() at time zone 'Africa/Algiers')::date)::date;
  v_inv uuid;
  v_amount numeric;
begin
  if not kg_is_admin(p_tenant) then raise exception 'forbidden'; end if;
  if p_fee_plan is null then return null; end if;

  select * into v_plan from kg_fee_plans where id = p_fee_plan and tenant_id = p_tenant;
  if v_plan.id is null then raise exception 'unknown_fee_plan'; end if;

  -- The standing fee. One open row per child: re-running this closes nothing
  -- and duplicates nothing, because approval happens once.
  insert into kg_child_fees (tenant_id, child_id, fee_plan_id, custom_amount,
                             discount_pct, start_date)
  values (p_tenant, p_child, p_fee_plan, p_custom_amount,
          coalesce(p_discount_pct, 0), current_date)
  on conflict do nothing;

  if not coalesce(p_bill_first_month, true) and coalesce(p_registration_fee, 0) <= 0 then
    return null;
  end if;

  v_inv := kg_open_invoice_for_month(p_tenant, p_child, v_month);

  -- A one-off registration fee, if the crèche charges one. Kind 'registration'
  -- is not decoration: kg_income_category_for_payment (0031) routes the money
  -- to "Frais d'inscription" on the strength of it, so it lands in the right
  -- accounting category instead of being reported as tuition.
  if coalesce(p_registration_fee, 0) > 0 then
    insert into kg_invoice_items (invoice_id, tenant_id, kind, description,
                                  qty, unit_amount, amount)
    values (v_inv, p_tenant, 'registration', 'Frais d''inscription', 1,
            p_registration_fee, p_registration_fee);
  end if;

  -- The month's tuition, priced exactly as kg_generate_monthly_invoices prices
  -- it — same rounding, same description shape — so an invoice raised at
  -- approval and one raised by the schedule are indistinguishable.
  if coalesce(p_bill_first_month, true) then
    v_amount := round(coalesce(p_custom_amount, v_plan.amount)
                      * (1 - coalesce(p_discount_pct, 0) / 100.0), 2);
    insert into kg_invoice_items (invoice_id, tenant_id, kind, description,
                                  qty, unit_amount, amount)
    values (v_inv, p_tenant, 'tuition',
            v_plan.name || ' — ' || to_char(v_month, 'MM/YYYY'), 1,
            coalesce(p_custom_amount, v_plan.amount), v_amount);
  end if;

  perform kg_invoice_recalc(v_inv);
  return v_inv;
end $$;
revoke execute on function kg_start_child_billing(uuid, uuid, uuid, numeric, numeric, numeric, boolean) from anon;
grant execute on function kg_start_child_billing(uuid, uuid, uuid, numeric, numeric, numeric, boolean) to authenticated;

-- Approval and billing in ONE call, therefore one transaction. Two RPCs from
-- the server action would leave a child enrolled-but-unbilled whenever the
-- second failed — which is precisely the bug this migration exists to close.
create or replace function kg_approve_and_bill(
  p_app uuid,
  p_class uuid,
  p_tag_code text,
  p_fee_plan uuid default null,
  p_discount_pct numeric default 0,
  p_custom_amount numeric default null,
  p_registration_fee numeric default null,
  p_bill_first_month boolean default true
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_child uuid; v_tenant uuid;
begin
  v_child := kg_approve_application(p_app, p_class, p_tag_code);
  select tenant_id into v_tenant from kg_children where id = v_child;

  if p_fee_plan is not null then
    perform kg_start_child_billing(v_tenant, v_child, p_fee_plan, p_discount_pct,
                                   p_custom_amount, p_registration_fee,
                                   p_bill_first_month);
  end if;
  return v_child;
end $$;
revoke execute on function kg_approve_and_bill(uuid, uuid, text, uuid, numeric, numeric, numeric, boolean) from anon;
grant execute on function kg_approve_and_bill(uuid, uuid, text, uuid, numeric, numeric, numeric, boolean) to authenticated;

-- What a child owes, for the badge on their record. Void and draft invoices are
-- excluded on the same rule the parent portal uses, so the two sides cannot
-- disagree about the number.
create or replace function kg_child_balance(p_child uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(greatest(0, total - paid_amount)), 0)
    from kg_invoices
   where child_id = p_child and status not in ('void', 'draft')
$$;
grant execute on function kg_child_balance(uuid) to authenticated;
