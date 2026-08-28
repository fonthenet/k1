-- The invoice notification told every family they owed 0.00 DA.
--
-- kg_approve_and_bill builds an invoice in three steps: open the row, add the
-- line items, then kg_invoice_recalc totals it. The row is opened already
-- non-draft, so trg_kg_notify_invoice_issued fired on that INSERT — before a
-- single item existed — and captured new.total, which was still 0. Every
-- invoice_issued notification in the table carries "amount": "0.00", including
-- the ones for children approved this week.
--
-- Nothing about the ordering is wrong: the invoice genuinely is not priced
-- until its items are in. The trigger was watching the wrong moment.
--
-- So it now fires when the invoice is BOTH real and priced — non-draft, not
-- void, total > 0 — which for the approval path is the recalc UPDATE rather
-- than the INSERT. Firing on a later edge means it could fire twice (once at
-- recalc, again if the total is edited), so it checks for its own prior
-- notification and stays silent if one exists. That check is also what makes
-- this safe to run against invoices that already notified.
--
-- An invoice that legitimately totals zero never notifies, which is correct:
-- there is nothing to tell the family.
create or replace function kg_notify_invoice_issued() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- Not something a family should hear about yet.
  if new.status in ('draft', 'void') then return new; end if;
  if coalesce(new.total, 0) <= 0 then return new; end if;

  -- Already announced. Dedupes the INSERT-then-recalc pair, and any later
  -- edit of the total.
  if exists (
    select 1 from kg_notifications
    where type = 'invoice_issued'
      and data ->> 'invoiceId' = new.id::text
  ) then
    return new;
  end if;

  perform kg_notify_family(new.tenant_id, new.child_id, 'invoice_issued',
    jsonb_build_object('invoiceId', new.id, 'amount', new.total,
      'invoiceNo', 'F-' || to_char(new.issue_date, 'YYYY') || '-' ||
                   lpad(new.number::text, 4, '0'),
      'due', new.due_date, 'period', new.period_month),
    null);
  return new;
end $$;

drop trigger if exists trg_kg_notify_invoice_issued on kg_invoices;
create trigger trg_kg_notify_invoice_issued after insert or update on kg_invoices
  for each row execute function kg_notify_invoice_issued();

-- Repair the ones already sent. They named the right child and the right
-- invoice, so the family was told something true; only the figure was wrong,
-- and a stale "0.00 DA" in the bell is worse than no figure at all.
update kg_notifications n
   set data = n.data || jsonb_build_object(
         'amount', i.total,
         'due', i.due_date,
         'invoiceNo', 'F-' || to_char(i.issue_date, 'YYYY') || '-' ||
                      lpad(i.number::text, 4, '0'))
  from kg_invoices i
 where n.type = 'invoice_issued'
   and n.data ->> 'invoiceId' = i.id::text
   and coalesce((n.data ->> 'amount')::numeric, 0) <> i.total;
