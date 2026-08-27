-- 0031 — Income routing + invoice balance as a single source of truth.
--
-- Two defects this fixes, both found by auditing the live ledger:
--
-- 1. kg_on_payment_insert picked the income category with
--    `order by name limit 1`, so every payment landed in "Activités" — the
--    first name alphabetically. 62 200 DA of tuition was reported as activity
--    revenue and "Scolarité" read zero. Category now follows what the invoice
--    is actually for.
-- 2. Invoice status was computed from a delta (paid_amount ± the payment) and
--    never knew about 'overdue'. Removing a payment from an overdue invoice
--    silently downgraded it to 'unpaid' and it dropped out of the arrears
--    alert; amending a payment down from full left the invoice 'paid'.
--    Both now recompute from the payments themselves.

-- Recompute an invoice from its payments. Authoritative, not incremental:
-- any path that touches kg_payments converges on the same answer.
create or replace function kg_apply_invoice_balance(p_invoice uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_inv kg_invoices; v_paid numeric; v_today date;
begin
  select * into v_inv from kg_invoices where id = p_invoice;
  if v_inv.id is null or v_inv.status = 'void' then return; end if;

  select coalesce(sum(amount), 0) into v_paid
    from kg_payments where invoice_id = p_invoice;
  v_today := (now() at time zone 'Africa/Algiers')::date;

  update kg_invoices set
    paid_amount = v_paid,
    status = case
      when v_paid >= v_inv.total then 'paid'
      -- Past due with a balance outranks 'partial': the arrears alert and the
      -- overdue digest both key off this status, and a half-paid late invoice
      -- is still late.
      when v_inv.due_date is not null and v_inv.due_date < v_today then 'overdue'
      when v_paid > 0 then 'partial'
      -- An unsent invoice with no payment stays where the office put it.
      when v_inv.status in ('draft','sent') then v_inv.status
      else 'unpaid' end
  where id = p_invoice;
end $$;

-- Which revenue line a payment belongs on. Driven by the invoice's items;
-- a payment with no invoice is tuition, which is what a walk-in cash payment
-- at an Algerian crèche almost always is.
create or replace function kg_income_category_for_payment(p_tenant uuid, p_invoice uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_kind text;
begin
  if p_invoice is not null then
    -- Dominant line wins. A cash book books a payment to one revenue account;
    -- splitting a single receipt across accounts is accrual bookkeeping the
    -- rest of this module does not do.
    select kind into v_kind
      from kg_invoice_items
     where invoice_id = p_invoice
     group by kind
     order by sum(amount) desc
     limit 1;
  end if;

  return kg_category_id(p_tenant, case coalesce(v_kind, 'tuition')
    when 'tuition'      then 'Scolarité'
    when 'registration' then 'Frais d''inscription'
    when 'activity'     then 'Activités'
    else 'Autres revenus' end, 'income');
end $$;

create or replace function kg_on_payment_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into kg_transactions (tenant_id, kind, category_id, amount, date, method,
                               description, related_payment_id, created_by)
  values (new.tenant_id, 'income',
          kg_income_category_for_payment(new.tenant_id, new.invoice_id),
          new.amount, new.paid_at::date, new.method,
          'Paiement ' || coalesce(new.receipt_number, ''), new.id, new.received_by);

  if new.invoice_id is not null then
    perform kg_apply_invoice_balance(new.invoice_id);
  end if;
  return new;
end $$;

create or replace function kg_on_payment_removed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from kg_transactions where related_payment_id = old.id;
  if old.invoice_id is not null then
    perform kg_apply_invoice_balance(old.invoice_id);
  end if;
  return old;
end $$;

create or replace function kg_on_payment_amended() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update kg_transactions
     set amount = new.amount,
         date = new.paid_at::date,
         method = new.method,
         category_id = kg_income_category_for_payment(new.tenant_id, new.invoice_id),
         description = 'Paiement ' || coalesce(new.receipt_number, '')
   where related_payment_id = new.id;

  -- Both sides: moving a payment between invoices must settle the one it left.
  if old.invoice_id is not null then perform kg_apply_invoice_balance(old.invoice_id); end if;
  if new.invoice_id is not null and new.invoice_id is distinct from old.invoice_id then
    perform kg_apply_invoice_balance(new.invoice_id);
  end if;
  return new;
end $$;

-- Backfill: move existing income rows onto the right revenue line.
update kg_transactions t
   set category_id = kg_income_category_for_payment(t.tenant_id, p.invoice_id)
  from kg_payments p
 where p.id = t.related_payment_id and t.kind = 'income';

-- Backfill: re-derive every invoice from its payments.
do $$
declare r record;
begin
  for r in select id from kg_invoices loop
    perform kg_apply_invoice_balance(r.id);
  end loop;
end $$;
