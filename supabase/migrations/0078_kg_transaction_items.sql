-- Itemised spending: what was actually in the shopping bag.
--
-- ---------------------------------------------------------------------------
-- Why
-- ---------------------------------------------------------------------------
--
-- A crèche's real expense pattern is a daily or weekly shop — bread, milk,
-- vegetables, cleaning things — and today the whole trip collapses into one
-- kg_transactions row with a single free-text description and a total. That is
-- enough for a monthly total and useless for the question anybody actually
-- asks, which is "why was food 39 900 DZD last month".
--
-- So: an optional line-item child table, the same relationship kg_invoices and
-- kg_invoice_items already have. Optional is the important word — an
-- electricity bill is one number and forcing it into a line item would be
-- ceremony. A transaction with no items behaves exactly as it does today.
--
-- ---------------------------------------------------------------------------
-- The amount is derived, once there are items
-- ---------------------------------------------------------------------------
--
-- Two sources of truth for one number is how ledgers drift. When a transaction
-- has items, its `amount` is the sum of them and is maintained by trigger; when
-- it has none, `amount` is whatever was typed. Client code never adds up the
-- items and writes the total back — that race is exactly what the trigger
-- exists to prevent, and two people shopping on the same phone would hit it.
--
-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------
--
-- Items inherit their parent's rules through kg_can_edit_txn(), including the
-- one that matters: a transaction the system generated from a payment, an
-- advance or a payslip is read-only, and so are its items. Nobody itemises a
-- salary payment.
--
-- Note the parent's UPDATE/DELETE policies FILTER rather than refuse — a
-- blocked write comes back as HTTP 200 with an empty body. The same is true
-- here, which is why both clients must count returned rows and not just check
-- for an error.

begin;

create table if not exists kg_transaction_items (
  id             uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references kg_transactions(id) on delete cascade,
  tenant_id      uuid not null references kg_tenants(id) on delete cascade,
  name           text not null,
  qty            numeric(12,3) not null default 1,
  unit_amount    numeric(12,2) not null default 0,
  amount         numeric(12,2) not null default 0,
  note           text,
  position       integer not null default 0,
  created_at     timestamptz not null default now(),

  constraint kg_txn_items_name_not_blank check (length(btrim(name)) > 0),
  constraint kg_txn_items_qty_positive   check (qty > 0),
  constraint kg_txn_items_unit_positive  check (unit_amount >= 0),
  constraint kg_txn_items_amount_positive check (amount >= 0)
);

create index if not exists kg_transaction_items_txn_idx
  on kg_transaction_items (transaction_id, position);
create index if not exists kg_transaction_items_tenant_idx
  on kg_transaction_items (tenant_id);

comment on table kg_transaction_items is
  'Optional line items for a ledger entry — the contents of a shopping trip. '
  'When present, kg_transactions.amount is their sum and is trigger-maintained.';

-- ---------------------------------------------------------------------------
-- amount = qty * unit_amount, and the parent = sum(items)
-- ---------------------------------------------------------------------------

create or replace function kg_txn_item_amount()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  -- The line's own total is never supplied by a client: two numbers that must
  -- agree are one number too many.
  new.amount := round(new.qty * new.unit_amount, 2);
  return new;
end $$;

drop trigger if exists kg_txn_item_amount_trg on kg_transaction_items;
create trigger kg_txn_item_amount_trg
  before insert or update of qty, unit_amount on kg_transaction_items
  for each row execute function kg_txn_item_amount();

create or replace function kg_txn_rollup()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_txn uuid := coalesce(new.transaction_id, old.transaction_id);
        v_sum numeric;
        v_n   integer;
begin
  select coalesce(sum(amount), 0), count(*) into v_sum, v_n
    from kg_transaction_items where transaction_id = v_txn;

  -- The last item being removed hands the total back to whatever it was; it
  -- does not zero the entry, because an entry with no items is a valid entry
  -- that simply was not itemised.
  if v_n > 0 then
    -- kg_transactions carries its own touch trigger for updated_at.
    update kg_transactions set amount = v_sum where id = v_txn;
  end if;

  return null;
end $$;

drop trigger if exists kg_txn_rollup_trg on kg_transaction_items;
create trigger kg_txn_rollup_trg
  after insert or update or delete on kg_transaction_items
  for each row execute function kg_txn_rollup();

-- ---------------------------------------------------------------------------
-- RLS — mirrors the parent, including the derived-row lock
-- ---------------------------------------------------------------------------

create or replace function kg_can_edit_txn(t uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from kg_transactions x
     where x.id = t
       and kg_is_finance(x.tenant_id)
       and x.related_payment_id is null
       and x.related_advance_id is null
       and x.related_payroll_item_id is null
  )
$$;

create or replace function kg_can_see_txn(t uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from kg_transactions x
     where x.id = t and kg_is_finance(x.tenant_id)
  )
$$;

alter table kg_transaction_items enable row level security;

drop policy if exists txi_sel on kg_transaction_items;
create policy txi_sel on kg_transaction_items for select
  using (kg_can_see_txn(transaction_id));

drop policy if exists txi_ins on kg_transaction_items;
create policy txi_ins on kg_transaction_items for insert
  with check (kg_can_edit_txn(transaction_id) and kg_is_finance(tenant_id));

drop policy if exists txi_upd on kg_transaction_items;
create policy txi_upd on kg_transaction_items for update
  using (kg_can_edit_txn(transaction_id))
  with check (kg_can_edit_txn(transaction_id));

drop policy if exists txi_del on kg_transaction_items;
create policy txi_del on kg_transaction_items for delete
  using (kg_can_edit_txn(transaction_id));

-- Match the grants the other kg_ tables carry, so PostgREST can reach it.
grant select, insert, update, delete on kg_transaction_items to authenticated;
revoke all on kg_transaction_items from anon;

revoke all on function kg_can_edit_txn(uuid) from public, anon;
revoke all on function kg_can_see_txn(uuid) from public, anon;
grant execute on function kg_can_edit_txn(uuid) to authenticated;
grant execute on function kg_can_see_txn(uuid) to authenticated;

commit;
