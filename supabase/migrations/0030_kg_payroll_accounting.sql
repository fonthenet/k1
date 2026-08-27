-- Money that moves must hit the ledger, exactly once.
--
-- Audit of the live books found three silent holes:
--   1. Salary ADVANCES never reached kg_transactions. 9 000 DA of cash left the
--      drawer with no record: actual cash to staff 193 000, books said 184 000.
--   2. The salary expense was written by APPLICATION code on "mark paid", so a
--      payroll settled by any other path (import, RPC, fix-up) recorded nothing.
--   3. kg_payments had INSERT triggers only. Deleting or amending a payment left
--      its income row behind, overstating revenue with no way to notice.
--
-- Cash-basis is the right model here (Algerian crèches run on cash): an expense
-- is recorded when money leaves. That makes the advance an expense on the day
-- it is handed over, and the payroll expense the NET only — together they equal
-- the full salary, counted once.

-- ── Pay configuration: monthly OR hourly ────────────────────────────────
do $$ begin
  create type kg_pay_type as enum ('monthly','hourly');
exception when duplicate_object then null; end $$;

alter table kg_memberships
  add column if not exists pay_type kg_pay_type not null default 'monthly',
  add column if not exists hourly_rate numeric(12,2);

comment on column kg_memberships.base_salary is
  'Monthly gross for pay_type = monthly. Ignored for hourly staff — see hourly_rate.';
comment on column kg_memberships.hourly_rate is
  'Rate per hour for pay_type = hourly. Ignored for monthly staff.';

-- ── Ledger linkage, so every row can be traced and reversed ─────────────
alter table kg_transactions
  add column if not exists related_payroll_item_id uuid references kg_payroll_items(id) on delete set null,
  add column if not exists related_advance_id uuid references kg_salary_advances(id) on delete set null;

create unique index if not exists kg_transactions_payroll_item_unique
  on kg_transactions (related_payroll_item_id) where related_payroll_item_id is not null;
create unique index if not exists kg_transactions_advance_unique
  on kg_transactions (related_advance_id) where related_advance_id is not null;
create unique index if not exists kg_transactions_payment_unique
  on kg_transactions (related_payment_id) where related_payment_id is not null;

-- ── What a person should be paid for a month ────────────────────────────
-- Monthly staff get their salary. Hourly staff get rate × hours actually
-- worked, read from the approved timesheets, so the door clock and the payslip
-- can never disagree.
create or replace function kg_expected_pay(p_membership uuid, p_month date)
returns numeric language plpgsql stable security definer set search_path = public as $$
declare m kg_memberships; v_hours numeric;
begin
  select * into m from kg_memberships where id = p_membership;
  if m.id is null then return 0; end if;

  if m.pay_type = 'hourly' then
    select coalesce(sum(
      extract(epoch from (t.clock_out_at - t.clock_in_at)) / 3600.0
    ), 0)
      into v_hours
      from kg_timesheets t
     where t.membership_id = p_membership
       and t.clock_in_at is not null and t.clock_out_at is not null
       and date_trunc('month', t.date) = date_trunc('month', p_month);
    return round(coalesce(m.hourly_rate, 0) * v_hours, 2);
  end if;

  return coalesce(m.base_salary, 0);
end $$;
grant execute on function kg_expected_pay(uuid, date) to authenticated;

-- Hours worked in a month — shown on the payslip so an hourly figure is auditable.
create or replace function kg_hours_worked(p_membership uuid, p_month date)
returns numeric language sql stable security definer set search_path = public as $$
  select round(coalesce(sum(
    extract(epoch from (clock_out_at - clock_in_at)) / 3600.0
  ), 0), 2)
  from kg_timesheets
  where membership_id = p_membership
    and clock_in_at is not null and clock_out_at is not null
    and date_trunc('month', date) = date_trunc('month', p_month)
$$;
grant execute on function kg_hours_worked(uuid, date) to authenticated;

-- ── Shared helper: find (or create) a system category ───────────────────
create or replace function kg_category_id(p_tenant uuid, p_name text, p_kind kg_txn_kind)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  select id into v_id from kg_txn_categories
   where tenant_id = p_tenant and name = p_name and kind = p_kind limit 1;
  if v_id is null then
    insert into kg_txn_categories (tenant_id, name, kind, is_system)
      values (p_tenant, p_name, p_kind, true) returning id into v_id;
  end if;
  return v_id;
end $$;

-- ── 1. An advance is cash leaving today ─────────────────────────────────
create or replace function kg_on_advance_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  if tg_op = 'DELETE' then
    delete from kg_transactions where related_advance_id = old.id;
    return old;
  end if;

  select p.full_name into v_name
    from kg_memberships m left join kg_profiles p on p.id = m.user_id
   where m.id = new.membership_id;

  insert into kg_transactions (tenant_id, kind, category_id, amount, date, method,
                               description, related_advance_id, created_by)
  values (new.tenant_id, 'expense',
          kg_category_id(new.tenant_id, 'Salaires', 'expense'),
          new.amount, new.date, 'cash',
          'Avance sur salaire — ' || coalesce(v_name, ''), new.id, new.created_by)
  on conflict (related_advance_id) where related_advance_id is not null
  do update set amount = excluded.amount, date = excluded.date;
  return new;
end $$;
drop trigger if exists trg_kg_advance_ledger on kg_salary_advances;
create trigger trg_kg_advance_ledger
  after insert or update or delete on kg_salary_advances
  for each row execute function kg_on_advance_change();

-- ── 2. Payroll expense belongs to the database, not one code path ───────
-- NET only: the advance was already expensed on the day it was handed over.
create or replace function kg_on_payroll_item_paid() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_name text; v_month date;
begin
  if tg_op = 'DELETE' then
    delete from kg_transactions where related_payroll_item_id = old.id;
    return old;
  end if;

  -- Unpaid again → the money came back; so must the ledger row.
  if new.paid_at is null then
    delete from kg_transactions where related_payroll_item_id = new.id;
    return new;
  end if;

  select p.full_name into v_name
    from kg_memberships m left join kg_profiles p on p.id = m.user_id
   where m.id = new.membership_id;
  select month into v_month from kg_payroll_runs where id = new.run_id;

  insert into kg_transactions (tenant_id, kind, category_id, amount, date, method,
                               description, related_payroll_item_id)
  values (new.tenant_id, 'expense',
          kg_category_id(new.tenant_id, 'Salaires', 'expense'),
          new.net_amount, new.paid_at::date, coalesce(new.method, 'cash'),
          'Salaire ' || to_char(coalesce(v_month, new.paid_at::date), 'MM/YYYY')
            || ' — ' || coalesce(v_name, ''),
          new.id)
  on conflict (related_payroll_item_id) where related_payroll_item_id is not null
  do update set amount = excluded.amount, date = excluded.date,
                method = excluded.method, description = excluded.description;
  return new;
end $$;
drop trigger if exists trg_kg_payroll_item_ledger on kg_payroll_items;
create trigger trg_kg_payroll_item_ledger
  after insert or update or delete on kg_payroll_items
  for each row execute function kg_on_payroll_item_paid();

-- ── 3. A reversed payment must reverse its income ───────────────────────
create or replace function kg_on_payment_removed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from kg_transactions where related_payment_id = old.id;
  -- Give the invoice its balance back, or it stays falsely settled.
  if old.invoice_id is not null then
    update kg_invoices i
       set paid_amount = greatest(0, i.paid_amount - old.amount),
           status = case
             when greatest(0, i.paid_amount - old.amount) >= i.total then 'paid'
             when greatest(0, i.paid_amount - old.amount) > 0 then 'partial'
             else 'unpaid' end
     where i.id = old.invoice_id;
  end if;
  return old;
end $$;
drop trigger if exists trg_kg_payment_removed on kg_payments;
create trigger trg_kg_payment_removed
  after delete on kg_payments
  for each row execute function kg_on_payment_removed();

-- Keep the income row honest if a payment amount is corrected.
create or replace function kg_on_payment_amended() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.amount is distinct from old.amount or new.paid_at is distinct from old.paid_at
     or new.method is distinct from old.method then
    update kg_transactions
       set amount = new.amount, date = new.paid_at::date, method = new.method
     where related_payment_id = new.id;
    if new.invoice_id is not null then
      update kg_invoices i
         set paid_amount = greatest(0, i.paid_amount - old.amount + new.amount)
       where i.id = new.invoice_id;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_kg_payment_amended on kg_payments;
create trigger trg_kg_payment_amended
  after update on kg_payments
  for each row execute function kg_on_payment_amended();

-- ── Backfill: put the missing advances into the books ───────────────────
insert into kg_transactions (tenant_id, kind, category_id, amount, date, method,
                             description, related_advance_id, created_by)
select a.tenant_id, 'expense',
       kg_category_id(a.tenant_id, 'Salaires', 'expense'),
       a.amount, a.date, 'cash',
       'Avance sur salaire — ' || coalesce(p.full_name, ''), a.id, a.created_by
from kg_salary_advances a
left join kg_memberships m on m.id = a.membership_id
left join kg_profiles p on p.id = m.user_id
where not exists (select 1 from kg_transactions t where t.related_advance_id = a.id);

-- Link the seed's hand-written lump-sum salary row to nothing and replace it
-- with per-item rows, so every future payroll is traceable to a person.
delete from kg_transactions
 where kind = 'expense'
   and related_payroll_item_id is null
   and related_advance_id is null
   and description like 'Salaires — %';

insert into kg_transactions (tenant_id, kind, category_id, amount, date, method,
                             description, related_payroll_item_id)
select pi.tenant_id, 'expense',
       kg_category_id(pi.tenant_id, 'Salaires', 'expense'),
       pi.net_amount, pi.paid_at::date, coalesce(pi.method, 'cash'),
       'Salaire ' || to_char(r.month, 'MM/YYYY') || ' — ' || coalesce(p.full_name, ''),
       pi.id
from kg_payroll_items pi
join kg_payroll_runs r on r.id = pi.run_id
left join kg_memberships m on m.id = pi.membership_id
left join kg_profiles p on p.id = m.user_id
where pi.paid_at is not null
  and not exists (select 1 from kg_transactions t where t.related_payroll_item_id = pi.id);
