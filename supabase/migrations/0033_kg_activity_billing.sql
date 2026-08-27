-- 0033 — Paid activities are billed. Dropped activities stop being billed.
--
-- kg_activities.fee_amount existed since 0001 and nothing ever read it:
-- kg_generate_monthly_invoices billed tuition from kg_child_fees only. A
-- parent could request a 3 000 DA/month class, staff could approve it, and the
-- crèche would never invoice a dinar of it.
--
-- Enrolment changes arrive from four different places (parent request, staff
-- approve, staff enrol, parent withdraw), so the billing lives in a trigger on
-- kg_activity_enrollments rather than in any one server action — the same
-- reason check-in notifications live in the database.

-- One activity may appear at most once on an invoice. Both the enrolment
-- trigger and the monthly run insert with `on conflict do nothing`, so
-- whichever fires first wins and the second is a no-op.
create unique index if not exists kg_invoice_items_activity_unique
  on kg_invoice_items (invoice_id, activity_id) where activity_id is not null;

-- Re-derive an invoice's money from its lines, then its status from its
-- payments. Matches how kg_generate_monthly_invoices has always stored them:
-- unit_amount is the list price, amount is what is actually charged, and the
-- difference is the discount.
create or replace function kg_invoice_recalc(p_invoice uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_sub numeric; v_total numeric; v_items int;
begin
  select coalesce(sum(qty * unit_amount), 0), coalesce(sum(amount), 0), count(*)
    into v_sub, v_total, v_items
    from kg_invoice_items where invoice_id = p_invoice;

  update kg_invoices
     set subtotal = v_sub, discount = greatest(0, v_sub - v_total), total = v_total
   where id = p_invoice;

  -- An invoice emptied by a withdrawal is voided, never deleted: the register
  -- required by décret exécutif 19-253 has to stay gapless.
  if v_items = 0 then
    update kg_invoices set status = 'void'
     where id = p_invoice and paid_amount = 0 and status <> 'void';
  end if;

  perform kg_apply_invoice_balance(p_invoice);
end $$;

-- The invoice that should carry this month's charges for a child, creating it
-- if the monthly run has not reached this child yet.
create or replace function kg_open_invoice_for_month(p_tenant uuid, p_child uuid, p_month date)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_inv uuid; v_start date := date_trunc('month', p_month)::date;
begin
  select id into v_inv from kg_invoices
   where child_id = p_child and period_month = v_start and status <> 'void'
   order by created_at limit 1;
  if v_inv is not null then return v_inv; end if;

  insert into kg_invoices (tenant_id, child_id, period_month, issue_date, due_date,
                           status, subtotal, discount, total, created_by)
  values (p_tenant, p_child, v_start, current_date,
          (v_start + interval '9 days')::date, 'unpaid', 0, 0, 0, auth.uid())
  returning id into v_inv;
  return v_inv;
end $$;

create or replace function kg_on_activity_enrollment_billing() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_act kg_activities;
  v_row kg_activity_enrollments;
  v_was text; v_is text;
  v_inv uuid; v_month date; v_label text; r record;
begin
  if tg_op = 'DELETE' then v_row := old; else v_row := new; end if;
  v_was := case when tg_op = 'INSERT' then null else old.status::text end;
  v_is  := case when tg_op = 'DELETE' then null else new.status::text end;

  select * into v_act from kg_activities where id = v_row.activity_id;
  -- Free activities and pay-per-session ones never produce an enrolment line:
  -- per_session is billed from attendance, not from signing up.
  if v_act.id is null or v_act.fee_amount <= 0 or v_act.fee_period = 'per_session' then
    return v_row;
  end if;

  v_month := date_trunc('month', (now() at time zone 'Africa/Algiers')::date)::date;

  -- ---- became active: bill it -------------------------------------------
  if v_is = 'active' and v_was is distinct from 'active' then
    v_inv := kg_open_invoice_for_month(v_row.tenant_id, v_row.child_id, v_month);
    v_label := coalesce(v_act.name, '') ||
      case when v_act.fee_period = 'monthly'
           then ' — ' || to_char(v_month, 'MM/YYYY') else '' end;

    insert into kg_invoice_items (invoice_id, tenant_id, kind, description,
                                  qty, unit_amount, amount, activity_id)
    values (v_inv, v_row.tenant_id, 'activity', v_label, 1,
            v_act.fee_amount, v_act.fee_amount, v_row.activity_id)
    on conflict do nothing;

    perform kg_invoice_recalc(v_inv);
    return v_row;
  end if;

  -- ---- stopped being active: unbill what has not been paid ---------------
  if v_was = 'active' and v_is is distinct from 'active' then
    -- Only an invoice with nothing collected against it can lose a line. Once
    -- any money has been received there is no way to know which line it paid
    -- for, and deleting one would leave an unexplained credit — that is a
    -- refund decision, and a human makes it.
    for r in
      select i.id from kg_invoices i
       join kg_invoice_items it on it.invoice_id = i.id
       where i.child_id = v_row.child_id
         and it.activity_id = v_row.activity_id
         and i.status <> 'void'
         and i.paid_amount = 0
         and i.period_month >= v_month
    loop
      delete from kg_invoice_items
       where invoice_id = r.id and activity_id = v_row.activity_id;
      perform kg_invoice_recalc(r.id);
    end loop;
  end if;

  return v_row;
end $$;

drop trigger if exists trg_kg_activity_enrollment_billing on kg_activity_enrollments;
create trigger trg_kg_activity_enrollment_billing
  after insert or update or delete on kg_activity_enrollments
  for each row execute function kg_on_activity_enrollment_billing();

-- The monthly run has to bill monthly activities too, and has to reach a child
-- who is enrolled in a paid activity but carries no tuition fee plan — that
-- child produced no invoice at all before.
create or replace function kg_generate_monthly_invoices(p_tenant uuid, p_month date)
returns int language plpgsql security definer set search_path = public as $$
declare v_count int := 0; r record; a record; v_inv uuid; v_amount numeric;
        v_start date := date_trunc('month', p_month)::date;
begin
  if not kg_is_finance(p_tenant) then raise exception 'forbidden'; end if;

  for r in
    -- Every enrolled child who owes something this month: a monthly fee plan,
    -- a monthly paid activity, or both.
    select c.id as child_id,
           cf.custom_amount, cf.discount_pct,
           fp.name as plan_name, fp.amount as plan_amount
    from kg_children c
    left join kg_child_fees cf
      on cf.child_id = c.id and cf.tenant_id = p_tenant
     and cf.start_date <= (v_start + interval '1 month - 1 day')::date
     and (cf.end_date is null or cf.end_date >= v_start)
    left join kg_fee_plans fp on fp.id = cf.fee_plan_id and fp.period = 'monthly'
    where c.tenant_id = p_tenant and c.status = 'enrolled'
      and (fp.id is not null or exists (
        select 1 from kg_activity_enrollments ae
        join kg_activities act on act.id = ae.activity_id
        where ae.child_id = c.id and ae.status = 'active'
          and act.fee_amount > 0 and act.fee_period = 'monthly'
          and (ae.end_date is null or ae.end_date >= v_start)))
      and not exists (
        select 1 from kg_invoices i
        where i.child_id = c.id and i.period_month = v_start and i.status <> 'void')
  loop
    v_inv := kg_open_invoice_for_month(p_tenant, r.child_id, v_start);

    if r.plan_amount is not null then
      v_amount := round(coalesce(r.custom_amount, r.plan_amount)
                        * (1 - coalesce(r.discount_pct, 0) / 100.0), 2);
      insert into kg_invoice_items (invoice_id, tenant_id, kind, description, qty, unit_amount, amount)
        values (v_inv, p_tenant, 'tuition',
          r.plan_name || ' — ' || to_char(p_month, 'MM/YYYY'), 1,
          coalesce(r.custom_amount, r.plan_amount), v_amount);
    end if;

    for a in
      select act.id, act.name, act.fee_amount
        from kg_activity_enrollments ae
        join kg_activities act on act.id = ae.activity_id
       where ae.child_id = r.child_id and ae.status = 'active'
         and act.fee_amount > 0 and act.fee_period = 'monthly'
         and (ae.end_date is null or ae.end_date >= v_start)
    loop
      insert into kg_invoice_items (invoice_id, tenant_id, kind, description,
                                    qty, unit_amount, amount, activity_id)
        values (v_inv, p_tenant, 'activity',
                a.name || ' — ' || to_char(p_month, 'MM/YYYY'), 1,
                a.fee_amount, a.fee_amount, a.id)
      on conflict do nothing;
    end loop;

    perform kg_invoice_recalc(v_inv);
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

revoke execute on function kg_invoice_recalc(uuid) from anon, authenticated;
revoke execute on function kg_open_invoice_for_month(uuid, uuid, date) from anon, authenticated;
revoke execute on function kg_on_activity_enrollment_billing() from anon, authenticated;
revoke execute on function kg_apply_invoice_balance(uuid) from anon, authenticated;
revoke execute on function kg_income_category_for_payment(uuid, uuid) from anon, authenticated;
revoke execute on function kg_category_id(uuid, text, kg_txn_kind) from anon, authenticated;
