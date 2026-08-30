-- 0083 — payroll transitions become one statement each.
--
-- NOT YET APPLIED. Apply after 0081 and 0082: kg_payroll_create below filters
-- advances on kg_salary_advances.status, which 0082 adds.
--
-- ---------------------------------------------------------------------------
-- What is wrong
-- ---------------------------------------------------------------------------
--
-- Creating a payroll run is four round trips (insert the run, insert the items,
-- claim each member's outstanding advances) and marking one paid is another
-- four (claim the run, stamp paid_at on the items, settle the claimed advances,
-- release the ones whose deduction was edited away). On the web those run
-- inside a server action, where a dropped connection is a failed request that
-- nobody's money noticed.
--
-- On a phone in Jijel it is not. Losing the connection between "set the run to
-- paid" and "stamp paid_at on the items" leaves a run reading `paid` with
-- ZERO ledger entries and unsettled advances — and it can never be marked paid
-- again, because the status guard now fails. The web already has to hand-roll a
-- compensating rollback for exactly this case.
--
-- So the transitions move into the database, one function per transition, each
-- atomic by construction.
--
-- ---------------------------------------------------------------------------
-- The one thing that must not be got wrong
-- ---------------------------------------------------------------------------
--
-- Setting kg_payroll_items.paid_at is the ENTIRE ledger posting. There is
-- exactly one trigger on that table, trg_kg_payroll_item_ledger, and it writes
-- one "Salaires" expense per payslip at net_amount, keyed on
-- related_payroll_item_id with `on conflict do update` — so it is idempotent
-- and self-reversing. Proven live inside a rolled-back transaction:
--
--   after insert        0 ledger rows
--   after finalize      0 ledger rows      <- finalizing is a LOCK, not a payment
--   after paid_at set   1 ledger row, 10 000.00, "Salaire 09/2026 — <name>"
--   after status='paid' 1 ledger row       <- run status posts nothing, ever
--   after clearing it   0 ledger rows
--
-- kg_payroll_runs has no triggers at all.
--
-- A reader glancing at status='paid' would naturally add one summary expense on
-- the mark-paid transition. That doubles the month's salary cost, and
-- kg_transactions.tx_del refuses to delete any row carrying
-- related_payroll_item_id, so it cannot be cleaned up from either client.
-- kg_payroll_mark_paid therefore inserts NOTHING into kg_transactions. Neither
-- may anything that calls it.
--
-- ---------------------------------------------------------------------------
-- Error codes
-- ---------------------------------------------------------------------------
--
-- The clients need to tell these apart to say something true, so each raise
-- carries its own SQLSTATE rather than a message the client would have to
-- pattern-match:
--
--   42501  forbidden       not finance, or the row does not exist
--   23505  exists          UNIQUE (tenant_id, month) — raised by Postgres itself
--   KG001  no_staff        nobody active to pay
--   KG002  not_draft       already finalized or paid
--   KG003  not_finalized   mark-paid asked of a draft
--
-- Every function checks kg_is_finance on the tenant it looked up FROM THE ROW,
-- never on a tenant the caller passed alongside a row id. An argument the
-- caller can type is an argument the caller can forge — the mistake 0077 was
-- written to remove.

begin;

/* ------------------------------------------------------------------ create */

-- Seeds one draft run for the month, one item per active non-parent member,
-- from kg_payroll_basis: base_amount = expected (base_salary for monthly,
-- hourly_rate × hours worked for hourly), advances_deducted = that member's
-- approved, unrepaid, unclaimed advances, net = base - advances.
--
-- Nothing here touches the ledger. The advances were expensed when they were
-- approved; the items have no paid_at. Claiming an advance (stamping
-- payroll_item_id) is not settling it — `repaid` stays false until the run is
-- paid, which is what lets a deleted draft hand the advance back through the
-- FK's ON DELETE SET NULL.
create or replace function kg_payroll_create(p_tenant uuid, p_month date)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_run   uuid;
  v_start date := date_trunc('month', p_month)::date;
  v_count int := 0;
  v_item  uuid;
  v_adv   numeric;
  b       record;
begin
  if not kg_is_finance(p_tenant) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- UNIQUE (tenant_id, month) raises 23505 here, which is the honest answer to
  -- "create a payroll for a month that already has one".
  insert into kg_payroll_runs (tenant_id, month, created_by)
  values (p_tenant, v_start, auth.uid())
  returning id into v_run;

  for b in select * from kg_payroll_basis(p_tenant, v_start) loop
    -- status = 'approved' is load-bearing: a merely-requested advance is not
    -- money anybody has received, so it must not shrink a salary.
    select coalesce(sum(a.amount), 0) into v_adv
      from kg_salary_advances a
     where a.tenant_id       = p_tenant
       and a.membership_id   = b.membership_id
       and a.status          = 'approved'
       and a.repaid          = false
       and a.payroll_item_id is null;

    insert into kg_payroll_items (
      run_id, tenant_id, membership_id,
      base_amount, bonuses, deductions, advances_deducted, net_amount, hours)
    values (
      v_run, p_tenant, b.membership_id,
      coalesce(b.expected, 0), 0, 0, v_adv, coalesce(b.expected, 0) - v_adv,
      -- Only meaningful for hourly staff, and null is how the payslip screen
      -- knows not to print an hourly basis line for a monthly salary.
      case when b.pay_type = 'hourly' then b.hours end);

    -- RETURNING into a variable rather than a second lookup: (run_id,
    -- membership_id) is unique, so there is exactly one row to claim against.
    select id into v_item
      from kg_payroll_items
     where run_id = v_run and membership_id = b.membership_id;

    update kg_salary_advances a
       set payroll_item_id = v_item
     where a.tenant_id       = p_tenant
       and a.membership_id   = b.membership_id
       and a.status          = 'approved'
       and a.repaid          = false
       and a.payroll_item_id is null;

    v_count := v_count + 1;
  end loop;

  if v_count = 0 then
    -- Raising rather than returning an empty run: a payroll with no lines is
    -- not a thing the crèche wants to look at, and the whole insert unwinds.
    raise exception 'no active staff' using errcode = 'KG001';
  end if;

  return v_run;
end $function$;

revoke all on function kg_payroll_create(uuid, date) from public, anon;
grant execute on function kg_payroll_create(uuid, date) to authenticated;

/* -------------------------------------------------------------- edit a line */

-- Draft-only editing, enforced here rather than in the screen.
--
-- This is not a UI convenience. pri_all lets any finance user UPDATE any item
-- from any client, and a rolled-back probe showed that changing net_amount on
-- an item whose paid_at is already set SILENTLY REWRITES the existing ledger
-- transaction in place — 10 000 became 9 000, no second row, no audit trace.
-- The run's status is the only thing standing between a booked expense and a
-- retroactive edit, so it is read here, in the same transaction as the write.
--
-- advances_deducted is deliberately NOT a parameter. It is computed by the run
-- from the advances it claimed; letting it be typed reopens the question of
-- what happens to an advance whose deduction was edited to something else, and
-- that question has no good answer. Bonuses and deductions cover every real
-- adjustment.
create or replace function kg_payroll_update_item(
  p_item       uuid,
  p_base       numeric,
  p_bonuses    numeric,
  p_deductions numeric
) returns numeric
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tenant uuid;
  v_status kg_payroll_status;
  v_adv    numeric;
  v_net    numeric;
begin
  select i.tenant_id, r.status, i.advances_deducted
    into v_tenant, v_status, v_adv
    from kg_payroll_items i
    join kg_payroll_runs  r on r.id = i.run_id
   where i.id = p_item;

  -- A missing row and a forbidden one answer the same way: nothing here should
  -- tell a caller which payslip ids exist.
  if v_tenant is null or not kg_is_finance(v_tenant) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_status <> 'draft' then
    raise exception 'payroll is not a draft' using errcode = 'KG002';
  end if;
  if p_base < 0 or p_bonuses < 0 or p_deductions < 0 then
    raise exception 'negative amount' using errcode = '22023';
  end if;

  v_net := p_base + p_bonuses - p_deductions - v_adv;

  update kg_payroll_items
     set base_amount = p_base,
         bonuses     = p_bonuses,
         deductions  = p_deductions,
         net_amount  = v_net
   where id = p_item;

  return v_net;
end $function$;

revoke all on function kg_payroll_update_item(uuid, numeric, numeric, numeric) from public, anon;
grant execute on function kg_payroll_update_item(uuid, numeric, numeric, numeric) to authenticated;

/* ---------------------------------------------------------------- finalize */

-- Locks the amounts. Posts nothing — see the header. The `and status = 'draft'`
-- predicate is the whole concurrency story: two taps on a slow connection, one
-- winner, and the loser is told the truth rather than finalizing twice.
create or replace function kg_payroll_finalize(p_run uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_tenant uuid; v_n int;
begin
  select tenant_id into v_tenant from kg_payroll_runs where id = p_run;
  if v_tenant is null or not kg_is_finance(v_tenant) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  update kg_payroll_runs
     set status = 'finalized', finalized_at = now()
   where id = p_run and status = 'draft';
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'payroll is not a draft' using errcode = 'KG002';
  end if;
end $function$;

revoke all on function kg_payroll_finalize(uuid) from public, anon;
grant execute on function kg_payroll_finalize(uuid) to authenticated;

/* --------------------------------------------------------------- mark paid */

-- Pays the month. Four statements that must all happen or none:
--
--   1. claim the run     — `and status = 'finalized'` serialises two taps
--   2. stamp paid_at     — THIS is the ledger posting, one expense per payslip
--   3. settle advances   — the deduction on the payslip has now been taken
--   4. release the rest  — a line whose deduction was edited away (on the web;
--                          mobile cannot do it) must hand its advance back to
--                          the pool, or that money is written off in silence
--
-- No summary transaction is inserted. Read the header before adding one.
create or replace function kg_payroll_mark_paid(p_run uuid, p_method kg_payment_method)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_tenant uuid; v_n int;
begin
  select tenant_id into v_tenant from kg_payroll_runs where id = p_run;
  if v_tenant is null or not kg_is_finance(v_tenant) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  update kg_payroll_runs
     set status = 'paid'
   where id = p_run and status = 'finalized';
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'payroll is not finalized' using errcode = 'KG003';
  end if;

  update kg_payroll_items
     set paid_at = now(), method = p_method
   where run_id = p_run and paid_at is null;

  update kg_salary_advances a
     set repaid = true
   where a.repaid = false
     and a.payroll_item_id in (
       select i.id from kg_payroll_items i
        where i.run_id = p_run and i.advances_deducted > 0);

  update kg_salary_advances a
     set payroll_item_id = null
   where a.repaid = false
     and a.payroll_item_id in (
       select i.id from kg_payroll_items i
        where i.run_id = p_run and i.advances_deducted <= 0);
end $function$;

revoke all on function kg_payroll_mark_paid(uuid, kg_payment_method) from public, anon;
grant execute on function kg_payroll_mark_paid(uuid, kg_payment_method) to authenticated;

commit;

-- ---------------------------------------------------------------------------
-- Deliberately NOT here
-- ---------------------------------------------------------------------------
--
-- Deleting a draft. `delete from kg_payroll_runs where id = ? and status =
-- 'draft'` is already one atomic statement, prr_all already gates it on
-- finance, and the foreign keys do the rest: items CASCADE, and the claimed
-- advances come back through ON DELETE SET NULL. An RPC would add a hop and
-- take that guarantee out of the FK where a reader can see it.
--
-- Un-finalizing (paid -> finalized, finalized -> draft). Clearing paid_at
-- DELETES the ledger row outright — a legitimate correction, but one that
-- erases an expense a director may already have reconciled. It stays a web
-- operation on a big screen, and neither client should offer it on a phone.
--
-- ---------------------------------------------------------------------------
-- Check afterwards, inside a rolled-back transaction as an owner:
--
--   begin;
--   select set_config('request.jwt.claims',
--     json_build_object('sub','00cdaf3f-...','role','authenticated')::text, true);
--   set local role authenticated;
--   select kg_payroll_create('fb050631-e62f-43f1-9e12-933e564974e8', date '2099-01-01') as run \gset
--   select count(*) from kg_transactions where date >= '2099-01-01';   -- expect 0
--   select kg_payroll_finalize(:'run');
--   select count(*) from kg_transactions where date >= '2099-01-01';   -- expect 0
--   select kg_payroll_mark_paid(:'run', 'cash');
--   select count(*) from kg_transactions
--    where related_payroll_item_id in (select id from kg_payroll_items where run_id = :'run');
--                                                                      -- expect 5
--   rollback;
--
-- And as a non-finance member, every one of the four must raise 42501.
--
-- ROLLBACK of this migration:
--
--   drop function if exists kg_payroll_create(uuid, date);
--   drop function if exists kg_payroll_update_item(uuid, numeric, numeric, numeric);
--   drop function if exists kg_payroll_finalize(uuid);
--   drop function if exists kg_payroll_mark_paid(uuid, kg_payment_method);
--
-- All four are new names; nothing existing calls them, and dropping them leaves
-- the tables exactly as they were.
-- ---------------------------------------------------------------------------
