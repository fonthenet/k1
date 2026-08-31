-- Authorization for the money functions.
--
-- APPLIED 2026-08-30. Verified afterwards in a rolled-back transaction:
--   anon forging p_source='schedule' -> permission denied
--   cron sweep as postgres           -> still runs (17 invoices)
--   finance "generate" button        -> still works (17)
--   educator generating              -> forbidden
--   dashboard arrears refresh        -> still works
--
-- ---------------------------------------------------------------------------
-- What is wrong
-- ---------------------------------------------------------------------------
--
-- kg_generate_monthly_invoices() opens with:
--
--     if p_source <> 'schedule' and not kg_is_finance(p_tenant) then
--       raise exception 'forbidden';
--     end if;
--
-- p_source is an argument. Passing 'schedule' skips the permission check
-- entirely, p_tenant is also caller-supplied, and EXECUTE is held by PUBLIC —
-- so `anon` has it. A caller holding nothing but the publishable anon key and
-- one tenant uuid can invoice any kindergarten on the platform.
--
-- Demonstrated against production inside a rolled-back transaction, with no
-- JWT and role anon:
--
--     kg_generate_monthly_invoices(
--       'fb050631-e62f-43f1-9e12-933e564974e8', date '2099-03-01', 'schedule')
--     -> 16 draft invoices, 155 300.00 DZD
--
-- kg_generate_all_tenants() is the same hole across every active tenant at
-- once, and it too is PUBLIC-executable.
--
-- The mistake is structural, not a typo: an argument value is being used as the
-- authorization signal. Anything the caller can type, the caller can forge. So
-- the fix does not tighten the string test — it removes it, and moves the
-- privilege to the grant layer where the caller has no say.
--
-- ---------------------------------------------------------------------------
-- The shape of the fix
-- ---------------------------------------------------------------------------
--
--   kg_generate_monthly_invoices  - ALWAYS checks kg_is_finance. Keeps its
--                                   signature, so the web's "generate" button
--                                   (which passes the default 'manual') is
--                                   unaffected. Revoked from PUBLIC and anon.
--   kg_generate_month_unchecked   - new, private. Does the work. Executable by
--                                   nobody except the owner, which is what the
--                                   pg_cron job already runs as.
--   kg_generate_all_tenants       - calls the private one. Revoked from
--                                   everyone; cron runs as postgres and is
--                                   unaffected.
--
-- Verified before writing this: cron.job rows 1-3 all have username 'postgres',
-- so no revoke below can stop a scheduled run.
--
-- ---------------------------------------------------------------------------

begin;

-- 1. The worker. Same body as the current function, minus the p_source escape.
--    Private: authorization is the EXECUTE grant, and there is none.
create or replace function kg_generate_month_unchecked(
  p_tenant uuid, p_month date, p_source text default 'schedule'
) returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_count int := 0; v_skipped int := 0; v_unbilled int := 0;
        r record; a record; v_inv uuid;
        v_amount numeric; v_start date := date_trunc('month', p_month)::date;
        v_run uuid;
begin
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

    if r.plan_amount is null then
      v_unbilled := v_unbilled + 1;
      insert into kg_invoice_run_exceptions (run_id, child_id, code)
        values (v_run, r.child_id, 'no_fee_plan');
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
end $function$;

revoke all on function kg_generate_month_unchecked(uuid, date, text) from public;
revoke all on function kg_generate_month_unchecked(uuid, date, text) from anon, authenticated;

-- 2. The public entry point. Same signature as before; p_source is now only a
--    label written to kg_invoice_runs.trigger_source, never a permission.
create or replace function kg_generate_monthly_invoices(
  p_tenant uuid, p_month date, p_source text default 'manual'
) returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not kg_is_finance(p_tenant) then
    raise exception 'forbidden';
  end if;
  -- A caller may not claim to be the scheduler.
  return kg_generate_month_unchecked(
    p_tenant, p_month,
    case when p_source = 'schedule' then 'manual' else coalesce(p_source, 'manual') end
  );
end $function$;

revoke all on function kg_generate_monthly_invoices(uuid, date, text) from public;
revoke all on function kg_generate_monthly_invoices(uuid, date, text) from anon;
grant execute on function kg_generate_monthly_invoices(uuid, date, text) to authenticated;

-- 3. The scheduled sweep. cron runs as postgres, so it needs no grant at all.
create or replace function kg_generate_all_tenants(p_month date default null)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare t record; v_total int := 0; v_month date := coalesce(p_month,
  date_trunc('month', (now() at time zone 'Africa/Algiers')::date)::date);
begin
  for t in select id from kg_tenants where status = 'active' loop
    begin
      v_total := v_total + kg_generate_month_unchecked(t.id, v_month, 'schedule');
    exception when others then
      update kg_invoice_runs set status = 'failed', finished_at = now()
       where tenant_id = t.id and period_month = v_month;
    end;
  end loop;
  return v_total;
end $function$;

revoke all on function kg_generate_all_tenants(date) from public;
revoke all on function kg_generate_all_tenants(date) from anon, authenticated;

-- 4. kg_refresh_overdue_invoices had NO permission check and p_tenant defaults
--    to null, so one call from any caller swept every tenant on the platform
--    and sent each one's owners a "you are owed money" notification. Cron calls
--    it with no argument; a client must now name its own tenant and hold
--    finance rights.
create or replace function kg_refresh_overdue_invoices(p_tenant uuid default null)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_flipped int; r record; v_recipients uuid[]; v_already boolean;
begin
  -- Null tenant means "every tenant", which only the scheduler may ask for.
  -- Inside SECURITY DEFINER current_user is the owner, so the caller is
  -- identified by whether PostgREST put a JWT on the transaction.
  if coalesce(current_setting('request.jwt.claims', true), '') <> '' then
    if p_tenant is null then
      raise exception 'forbidden';
    end if;
    if not kg_is_finance(p_tenant) then
      raise exception 'forbidden';
    end if;
  end if;

  update kg_invoices i
     set status = 'overdue'
   where (p_tenant is null or i.tenant_id = p_tenant)
     and i.status in ('unpaid', 'partial', 'sent')
     and i.due_date is not null
     and i.due_date < (now() at time zone 'Africa/Algiers')::date
     and i.total > i.paid_amount;
  get diagnostics v_flipped = row_count;

  for r in
    select i.tenant_id,
           count(*) as overdue_count,
           sum(i.total - i.paid_amount) as outstanding
      from kg_invoices i
     where (p_tenant is null or i.tenant_id = p_tenant)
       and i.status = 'overdue'
       and i.total > i.paid_amount
     group by i.tenant_id
  loop
    select exists (
      select 1 from kg_notifications n
       where n.tenant_id = r.tenant_id
         and n.type = 'payment_overdue'
         and (n.created_at at time zone 'Africa/Algiers')::date
             = (now() at time zone 'Africa/Algiers')::date
    ) into v_already;
    if v_already then continue; end if;

    select array_agg(u) into v_recipients
      from kg_staff_user_ids(r.tenant_id, array['owner','admin','accountant']::kg_role[]) u;

    perform kg_notify(r.tenant_id, v_recipients, 'payment_overdue',
      to_char(r.outstanding, 'FM999G999G999') || ' DZD',
      null,
      jsonb_build_object('count', r.overdue_count, 'amount', r.outstanding,
                         'audience', 'staff'),
      null);
  end loop;

  return v_flipped;
end $function$;

revoke all on function kg_refresh_overdue_invoices(uuid) from public;
revoke all on function kg_refresh_overdue_invoices(uuid) from anon;
grant execute on function kg_refresh_overdue_invoices(uuid) to authenticated;

-- 5. kg_child_balance — SUPERSEDED, NOT APPLIED FROM THIS FILE.
--
--    This file originally guarded it with `kg_is_staff(v_tenant)`. Migration
--    0086 applies the same fix with `kg_is_finance` instead, which is what the
--    dashboard itself enforces: an educator opening a child's record must not
--    be shown the family's money. 0086 runs after this file, so replaying both
--    in order lands on the finance-only rule either way — but the weaker
--    version was never applied to production, and is left out here so this
--    file does not read as though it were.

-- 6. The remaining SECURITY DEFINER helpers are internal plumbing called by
--    triggers and by the functions above. Nothing client-side calls them
--    directly, so no client role needs EXECUTE.
--
--    NOTE: revoking from `authenticated` here is the one part of this migration
--    that could break a caller nobody has audited. If the web app turns out to
--    call any of these from a server action, re-grant that one specifically
--    rather than reverting the file.
revoke all on function kg_invoice_recalc(uuid) from public, anon, authenticated;
revoke all on function kg_apply_invoice_balance(uuid) from public, anon, authenticated;
revoke all on function kg_post_payment_to_ledger(uuid) from public, anon, authenticated;
revoke all on function kg_open_invoice_for_month(uuid, uuid, date) from public, anon, authenticated;
revoke all on function kg_category_id(uuid, text, kg_txn_kind) from public, anon, authenticated;

commit;

-- ---------------------------------------------------------------------------
-- After applying, this should raise 'forbidden' rather than return 16:
--
--   begin;
--   select set_config('request.jwt.claims', null, true);
--   set local role anon;
--   select kg_generate_monthly_invoices(
--     'fb050631-e62f-43f1-9e12-933e564974e8', date '2099-03-01', 'schedule');
--   rollback;
--
-- And the scheduled path should still work:
--
--   begin;
--   select kg_generate_all_tenants(date '2099-03-01');  -- as postgres
--   rollback;
-- ---------------------------------------------------------------------------
