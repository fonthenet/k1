-- The monthly run now accounts for every enrolled child, including the ones it
-- cannot bill.
--
-- Its WHERE clause used to end with
--
--     and (fp.id is not null or exists ( ...a paid monthly activity... ))
--
-- so a child with no monthly plan was never in the loop. Not billed, not
-- skipped, not an exception — absent. The run reported "12 invoices created",
-- which was true about everything it looked at, and it never looked at them.
-- A child parked on "no plan" therefore fell out of billing permanently and in
-- total silence, month after month, and nothing anywhere said so.
--
-- That matters because "I'll decide with the crèche" is a legitimate answer on
-- the enrolment form, and approving with no plan is a legitimate decision
-- (a mid-month start, a staff child, a sponsored place). What was missing was
-- anything to chase the consequence. Now the run's own numbers close:
--
--     created + skipped + (nothing to bill) = enrolled children considered
--
-- and separately, `unbilled_count` counts every child charged NO TUITION this
-- month — including those who still get an activity-only invoice. That overlap
-- is deliberate: an activity-only invoice is the failure mode that started
-- this, and counting it as a success is what hid it.
alter table kg_invoice_runs
  add column if not exists unbilled_count int not null default 0;

create or replace function kg_generate_monthly_invoices(
  p_tenant uuid, p_month date, p_source text default 'manual'
) returns int language plpgsql security definer set search_path = public as $$
declare v_count int := 0; v_skipped int := 0; v_unbilled int := 0;
        r record; a record; v_inv uuid;
        v_amount numeric; v_start date := date_trunc('month', p_month)::date;
        v_run uuid;
begin
  if p_source <> 'schedule' and not kg_is_finance(p_tenant) then
    raise exception 'forbidden';
  end if;

  insert into kg_invoice_runs (tenant_id, period_month, trigger_source, triggered_by)
  values (p_tenant, v_start, p_source, auth.uid())
  on conflict (tenant_id, period_month) do update
    set started_at = now(), finished_at = null, status = 'running',
        trigger_source = excluded.trigger_source, triggered_by = excluded.triggered_by
  returning id into v_run;
  delete from kg_invoice_run_exceptions where run_id = v_run;

  for r in
    select c.id as child_id,
           plan.custom_amount, plan.discount_pct, plan.plan_name, plan.plan_amount,
           exists (
             select 1 from kg_activity_enrollments ae
             join kg_activities act on act.id = ae.activity_id
             where ae.child_id = c.id and ae.status = 'active'
               and act.fee_amount > 0 and act.fee_period = 'monthly'
               and (ae.end_date is null or ae.end_date >= v_start)
           ) as has_billable_activity
    from kg_children c
    -- LATERAL, not a plain join: a child legitimately holds more than one
    -- kg_child_fees row (the monthly plan AND the one-off admission fee), and
    -- joining them straight would put that child through the loop twice —
    -- invoiced on the first pass and counted as "already invoiced" on the
    -- second. One row per child, monthly plans only.
    left join lateral (
      select cf.custom_amount, cf.discount_pct,
             fp.name as plan_name, fp.amount as plan_amount
        from kg_child_fees cf
        join kg_fee_plans fp on fp.id = cf.fee_plan_id and fp.period = 'monthly'
       where cf.child_id = c.id and cf.tenant_id = p_tenant
         and cf.start_date <= (v_start + interval '1 month - 1 day')::date
         and (cf.end_date is null or cf.end_date >= v_start)
       order by cf.start_date desc
       limit 1
    ) plan on true
    where c.tenant_id = p_tenant and c.status = 'enrolled'
  loop
    if exists (select 1 from kg_invoices i
                where i.child_id = r.child_id and i.period_month = v_start
                  and i.status <> 'void') then
      v_skipped := v_skipped + 1;
      insert into kg_invoice_run_exceptions (run_id, child_id, code)
        values (v_run, r.child_id, 'already_invoiced');
      continue;
    end if;

    -- No monthly plan means no TUITION is charged, and that is reported even
    -- when the child has activities to bill. Reporting only the children with
    -- nothing at all to bill would have hidden the exact case that started
    -- this: a child with paid activities and no plan gets an activity-only
    -- invoice, the run counts them under "created", and the crèche quietly
    -- loses the tuition every month while the report says everything worked.
    if r.plan_amount is null then
      v_unbilled := v_unbilled + 1;
      insert into kg_invoice_run_exceptions (run_id, child_id, code)
        values (v_run, r.child_id, 'no_fee_plan');
      -- Nothing at all to invoice: no plan and no paid activity.
      if not r.has_billable_activity then
        continue;
      end if;
    end if;

    insert into kg_invoices (tenant_id, child_id, period_month, issue_date, due_date,
                             status, subtotal, discount, total, created_by)
    values (p_tenant, r.child_id, v_start, current_date,
            (v_start + interval '9 days')::date, 'draft', 0, 0, 0, auth.uid())
    returning id into v_inv;

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

  update kg_invoice_runs
     set finished_at = now(), status = 'completed',
         created_count = v_count, skipped_count = v_skipped,
         unbilled_count = v_unbilled
   where id = v_run;
  return v_count;
end $$;

-- The last run for a month, with the children it could not bill, for the
-- screen that reports it.
create or replace function kg_invoice_run_summary(p_tenant uuid, p_month date)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when r.id is null then null else jsonb_build_object(
    'runId', r.id, 'finishedAt', r.finished_at, 'status', r.status,
    'created', r.created_count, 'skipped', r.skipped_count,
    'unbilled', r.unbilled_count,
    'unbilledChildren', coalesce((
      select jsonb_agg(jsonb_build_object(
               'childId', c.id, 'firstName', c.first_name, 'lastName', c.last_name,
               'firstNameAr', c.first_name_ar, 'lastNameAr', c.last_name_ar)
             order by c.first_name)
        from kg_invoice_run_exceptions x
        join kg_children c on c.id = x.child_id
       where x.run_id = r.id and x.code = 'no_fee_plan'
    ), '[]'::jsonb)
  ) end
  from (select * from kg_invoice_runs
         where tenant_id = p_tenant
           and period_month = date_trunc('month', p_month)::date
           and kg_is_finance(p_tenant)) r
$$;
revoke execute on function kg_invoice_run_summary(uuid, date) from public, anon;
grant execute on function kg_invoice_run_summary(uuid, date) to authenticated;
