-- 0047 — Automate the invoice RUN, not the invoice ISSUE.
--
-- Six of eight childcare platforms generate on a schedule; five of seven keep a
-- real pre-visibility state. This takes the second half of that split, because
-- what Rawdati emits is a legally formed facture: défaut de facturation carries
-- a fine of 80% of the amount that should have been invoiced, and an auto-posted
-- wrong document cannot be corrected by editing it (see 0048's immutability
-- rule). A draft can.
--
-- Three changes, in dependency order:
--   1. `number` is assigned at ISSUE, not at generation. A discarded draft must
--      not gap the legally required per-tenant sequence.
--   2. Generation produces drafts and records the attempt — including the runs
--      that create nothing, which is the difference between "nobody was billed
--      this month" being visible and being silent.
--   3. pg_cron runs it. The button stays, and becomes the retry and catch-up.
--
-- Deliberately NOT decided here: billable-month set, tranche vs month, and the
-- anchor days. Algeria has two regimes with contradictory calendars and the
-- Jijel client's regime is unconfirmed, so those stay settings with defaults
-- rather than assumptions baked into a function.

-- ── 1. Number at issue ───────────────────────────────────────────────────
alter table kg_invoices alter column number drop not null;

-- No new index needed: the existing unique(tenant_id, number) treats every NULL
-- as distinct, so it keeps guarding issued rows while allowing any number of
-- unnumbered drafts.

create or replace function kg_assign_invoice_number() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- Drafts stay unnumbered. A number is spent only when the document becomes
  -- real, so deleting a draft cannot leave a hole in the sequence.
  if new.status = 'draft' then
    new.number := null;
    return new;
  end if;
  if new.number is null then
    select coalesce(max(number), 0) + 1 into new.number
      from kg_invoices where tenant_id = new.tenant_id;
  end if;
  return new;
end $$;

drop trigger if exists trg_kg_invoices_number on kg_invoices;
create trigger trg_kg_invoices_number
  before insert or update of status on kg_invoices
  for each row execute function kg_assign_invoice_number();

-- ── 2. The run log ───────────────────────────────────────────────────────
create table if not exists kg_invoice_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kg_tenants(id) on delete cascade,
  period_month date not null,
  trigger_source text not null default 'manual',
  triggered_by uuid references auth.users(id) on delete set null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running',
  created_count int not null default 0,
  skipped_count int not null default 0,
  unique (tenant_id, period_month)
);
alter table kg_invoice_runs enable row level security;
create policy invrun_sel on kg_invoice_runs for select using (kg_is_finance(tenant_id));

create table if not exists kg_invoice_run_exceptions (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references kg_invoice_runs(id) on delete cascade,
  child_id uuid references kg_children(id) on delete cascade,
  code text not null,
  detail text
);
alter table kg_invoice_run_exceptions enable row level security;
create policy invrunx_sel on kg_invoice_run_exceptions for select
  using (exists (select 1 from kg_invoice_runs r
                  where r.id = run_id and kg_is_finance(r.tenant_id)));

-- ── 3. Generation, now producing drafts and logging the attempt ──────────
create or replace function kg_generate_monthly_invoices(
  p_tenant uuid, p_month date, p_source text default 'manual'
) returns int language plpgsql security definer set search_path = public as $$
declare v_count int := 0; v_skipped int := 0; r record; a record; v_inv uuid;
        v_amount numeric; v_start date := date_trunc('month', p_month)::date;
        v_run uuid;
begin
  -- The scheduler calls this with p_source='schedule' and no auth.uid(); a
  -- human calls it from the button and must be finance.
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
    select c.id as child_id, cf.custom_amount, cf.discount_pct,
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
  loop
    if exists (select 1 from kg_invoices i
                where i.child_id = r.child_id and i.period_month = v_start
                  and i.status <> 'void') then
      v_skipped := v_skipped + 1;
      insert into kg_invoice_run_exceptions (run_id, child_id, code)
        values (v_run, r.child_id, 'already_invoiced');
      continue;
    end if;

    -- Drafts. An admin performs the issue step, which is when a number is spent
    -- and the parent can see it.
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
         created_count = v_count, skipped_count = v_skipped
   where id = v_run;
  return v_count;
end $$;

-- The old 2-arg signature would still resolve and bypass the run log.
drop function if exists kg_generate_monthly_invoices(uuid, date);
grant execute on function kg_generate_monthly_invoices(uuid, date, text) to authenticated;

/** Issues a draft: spends a number and makes it visible to the family. */
create or replace function kg_issue_invoices(p_tenant uuid, p_month date)
returns int language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  if not kg_is_finance(p_tenant) then raise exception 'forbidden'; end if;
  with issued as (
    update kg_invoices set status = 'unpaid', issue_date = current_date
     where tenant_id = p_tenant and period_month = date_trunc('month', p_month)::date
       and status = 'draft' and total > 0
    returning 1)
  select count(*) into v_count from issued;
  return v_count;
end $$;
grant execute on function kg_issue_invoices(uuid, date) to authenticated;

/** Every active tenant, for the scheduler. */
create or replace function kg_generate_all_tenants(p_month date default null)
returns int language plpgsql security definer set search_path = public as $$
declare t record; v_total int := 0; v_month date := coalesce(p_month,
  date_trunc('month', (now() at time zone 'Africa/Algiers')::date)::date);
begin
  for t in select id from kg_tenants where status = 'active' loop
    begin
      v_total := v_total + kg_generate_monthly_invoices(t.id, v_month, 'schedule');
    exception when others then
      -- One crèche's bad data must not stop the others being billed.
      update kg_invoice_runs set status = 'failed', finished_at = now()
       where tenant_id = t.id and period_month = v_month;
    end;
  end loop;
  return v_total;
end $$;
revoke execute on function kg_generate_all_tenants(date) from anon, authenticated;
