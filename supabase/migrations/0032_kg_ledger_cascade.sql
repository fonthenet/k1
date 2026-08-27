-- 0032 — The ledger link must cascade, not null out.
--
-- Caught by deleting a real payment against 0031: the income row survived with
-- related_payment_id = null. Postgres implements ON DELETE SET NULL as an
-- internal AFTER trigger named RI_ConstraintTrigger_a_<oid>, and AFTER ROW
-- triggers fire in name order — uppercase 'R' sorts before 'trg_'. So the FK
-- had already severed the link by the time trg_kg_payment_removed looked for
-- "the transaction belonging to this payment", and it found nothing. Every
-- deleted payment, advance and payroll line was leaving a permanent orphan in
-- the ledger: cash that no longer happened, still counted.
--
-- A ledger row derived from a payment has no meaning without it, so the
-- correct action was cascade all along.

alter table kg_transactions
  drop constraint kg_transactions_related_payment_id_fkey,
  add constraint kg_transactions_related_payment_id_fkey
    foreign key (related_payment_id) references kg_payments(id) on delete cascade,
  drop constraint kg_transactions_related_advance_id_fkey,
  add constraint kg_transactions_related_advance_id_fkey
    foreign key (related_advance_id) references kg_salary_advances(id) on delete cascade,
  drop constraint kg_transactions_related_payroll_item_id_fkey,
  add constraint kg_transactions_related_payroll_item_id_fkey
    foreign key (related_payroll_item_id) references kg_payroll_items(id) on delete cascade;

-- The FK now removes the row; these triggers only have to settle what the FK
-- cannot see — the invoice balance.
create or replace function kg_on_payment_removed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.invoice_id is not null then
    perform kg_apply_invoice_balance(old.invoice_id);
  end if;
  return old;
end $$;

-- Sweep orphans left behind before the cascade existed: income/expense rows
-- that carry a receipt or payroll description but no live link.
delete from kg_transactions
 where related_payment_id is null
   and related_payroll_item_id is null
   and related_advance_id is null
   and (description like 'Paiement %'
     or description like 'Salaire %'
     or description like 'Avance sur salaire %');
