-- 0107 — the ledger is locked by the calendar, not by the accountant.
--
-- ---------------------------------------------------------------------------
-- What is wrong
-- ---------------------------------------------------------------------------
--
-- The web app refuses to edit or delete a hand-written ledger row unless its
-- date falls in the current month. That test lives only in the server action,
-- and it reads the server's clock: at midnight UTC on the 1st every entry of
-- the month that just ended becomes untouchable, with no step a human took
-- and no way for one to undo it.
--
-- Today, 2 September, the Jijel tenant has 12 hand-written August entries
-- that nobody can correct — including four the director was still tidying up
-- last week. Meanwhile the INSERT path never checked the date at all, so the
-- same "closed" month happily accepts a new backdated row. A month that
-- cannot be corrected but can still be added to is the worst of both: the
-- books are neither fixable nor final.
--
-- And since RLS is the only permission layer, none of it held outside the
-- web app. tx_upd / tx_del (0036) refuse derived rows and nothing else; a
-- finance user on the phone, or anyone with PostgREST and a JWT, can rewrite
-- a manual entry from any year.
--
-- ---------------------------------------------------------------------------
-- The fix
-- ---------------------------------------------------------------------------
--
-- An explicit close. kg_tenants.ledger_closed_through is the last day whose
-- entries are final; null means nothing is closed and everything hand-written
-- is still editable. Finance closes a month deliberately, once it has ended,
-- with kg_close_ledger_month; the close is written to kg_audit_log with who
-- and when. Closing only moves forward. kg_reopen_ledger_month (admin only,
-- also audited) steps it back one month for the honest case of a month
-- closed too soon.
--
-- The rule is enforced where it holds for every client: a BEFORE trigger on
-- kg_transactions refuses INSERT, UPDATE and DELETE of a HAND-WRITTEN row
-- dated on or before the closed day, with its own SQLSTATE (KG010) so the
-- clients can say "that month is closed" instead of "error".
--
-- Derived rows are exempt on purpose. A payment reversed in January (0032's
-- cascade) must take its income row with it whatever the ledger says; the
-- question of whether that reversal should be allowed belongs to the
-- payment, not to the copy of it in the journal. The three link columns are
-- exactly the test tx_upd already makes.

begin;

/* ----------------------------------------------------------------- column */

alter table kg_tenants
  add column if not exists ledger_closed_through date;

comment on column kg_tenants.ledger_closed_through is
  'Last day whose hand-written ledger entries are final. NULL = nothing closed. '
  'Moved forward by kg_close_ledger_month, back by kg_reopen_ledger_month; '
  'both audited. Enforced by trg_kg_transactions_closed.';

/* ----------------------------------------------------------------- guard */

-- SECURITY DEFINER so the read of kg_tenants is not subject to that table's
-- own RLS: the answer is a date, never a row of somebody else's tenant.
create or replace function kg_ledger_is_closed(p_tenant uuid, p_date date)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from kg_tenants
     where id = p_tenant
       and ledger_closed_through is not null
       and ledger_closed_through >= p_date)
$$;

revoke all on function kg_ledger_is_closed(uuid, date) from public, anon;
grant execute on function kg_ledger_is_closed(uuid, date) to authenticated;

create or replace function kg_guard_closed_ledger() returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare r record;
begin
  -- The row being written, or the row being removed.
  r := case when tg_op = 'DELETE' then old else new end;

  -- Derived rows belong to their source record — see the header.
  if r.related_payment_id is not null
     or r.related_advance_id is not null
     or r.related_payroll_item_id is not null then
    return r;
  end if;

  -- An UPDATE is checked on both dates: the day the row sits on now, and the
  -- day it is being moved to. Either inside the closed period is a change to
  -- a closed month.
  if kg_ledger_is_closed(r.tenant_id, r.date)
     or (tg_op = 'UPDATE' and kg_ledger_is_closed(old.tenant_id, old.date)) then
    raise exception 'ledger month is closed' using errcode = 'KG010';
  end if;

  return r;
end $$;

drop trigger if exists trg_kg_transactions_closed on kg_transactions;
create trigger trg_kg_transactions_closed
  before insert or update or delete on kg_transactions
  for each row execute function kg_guard_closed_ledger();

-- The rollup trigger (kg_transaction_items → parent amount) fires an UPDATE
-- on kg_transactions, so an itemised entry in a closed month is refused
-- through the same door when its lines are touched. Nothing extra needed.

/* ------------------------------------------------------------------ close */

-- Closes p_month and every month before it. Refused for a month that has not
-- ended: closing "so far" would freeze today's entries under the cashier.
create or replace function kg_close_ledger_month(p_tenant uuid, p_month date)
returns date
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_through date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  v_today   date := (now() at time zone 'Africa/Algiers')::date;
  v_before  date;
begin
  if not kg_is_finance(p_tenant) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_through >= v_today then
    raise exception 'month has not ended' using errcode = '22023';
  end if;

  select ledger_closed_through into v_before from kg_tenants where id = p_tenant;

  update kg_tenants
     set ledger_closed_through = greatest(coalesce(ledger_closed_through, v_through), v_through)
   where id = p_tenant;

  insert into kg_audit_log (tenant_id, user_id, action, entity, entity_id, data)
  values (p_tenant, auth.uid(), 'ledger.closed', 'kg_tenants', p_tenant::text,
          jsonb_build_object('from', v_before, 'through', v_through));

  return v_through;
end $$;

revoke all on function kg_close_ledger_month(uuid, date) from public, anon;
grant execute on function kg_close_ledger_month(uuid, date) to authenticated;

/* ----------------------------------------------------------------- reopen */

-- Steps the close back to the end of the previous month. Admin only: undoing
-- a close is the one thing an accountant should have to ask the director for.
create or replace function kg_reopen_ledger_month(p_tenant uuid)
returns date
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_before date; v_after date;
begin
  if not kg_is_admin(p_tenant) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select ledger_closed_through into v_before from kg_tenants where id = p_tenant;
  if v_before is null then
    return null;
  end if;

  -- Last day of the month before the one currently closed.
  v_after := (date_trunc('month', v_before) - interval '1 day')::date;

  update kg_tenants set ledger_closed_through = v_after where id = p_tenant;

  insert into kg_audit_log (tenant_id, user_id, action, entity, entity_id, data)
  values (p_tenant, auth.uid(), 'ledger.reopened', 'kg_tenants', p_tenant::text,
          jsonb_build_object('from', v_before, 'through', v_after));

  return v_after;
end $$;

revoke all on function kg_reopen_ledger_month(uuid) from public, anon;
grant execute on function kg_reopen_ledger_month(uuid) to authenticated;

commit;

-- ---------------------------------------------------------------------------
-- Check afterwards, inside a rolled-back transaction as a finance user:
--
--   begin;
--   select kg_close_ledger_month('<tenant>', date '2026-08-01');   -- 2026-08-31
--   update kg_transactions set amount = amount
--    where tenant_id = '<tenant>' and date = '2026-08-15'
--      and related_payment_id is null and related_advance_id is null
--      and related_payroll_item_id is null limit 1;                 -- KG010
--   insert into kg_transactions (tenant_id, kind, amount, date, method, description)
--   values ('<tenant>', 'expense', 1, '2026-08-15', 'cash', 'x');   -- KG010
--   delete from kg_payments where id = '<a January payment>';       -- allowed:
--   --   its ledger rows cascade regardless of the close
--   select kg_close_ledger_month('<tenant>', date '2026-09-01');    -- 22023 today
--   rollback;
--
-- ROLLBACK of this migration:
--
--   drop trigger if exists trg_kg_transactions_closed on kg_transactions;
--   drop function if exists kg_guard_closed_ledger();
--   drop function if exists kg_close_ledger_month(uuid, date);
--   drop function if exists kg_reopen_ledger_month(uuid);
--   drop function if exists kg_ledger_is_closed(uuid, date);
--   alter table kg_tenants drop column if exists ledger_closed_through;
-- ---------------------------------------------------------------------------
