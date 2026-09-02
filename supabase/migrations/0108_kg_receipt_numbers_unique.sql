-- 0108 — two payments can be handed the same receipt number.
--
-- ---------------------------------------------------------------------------
-- What is wrong
-- ---------------------------------------------------------------------------
--
-- kg_assign_receipt_number (0002) builds the number as
--
--   'R-' || to_char(now(), 'YYYY') || '-' || lpad(count(*) + 1, 5, '0')
--
-- counting the tenant's payments whose paid_at falls in the current year.
-- Nothing makes that unique, and three ordinary events break it:
--
--   1. Two cashiers at once. Both READ COMMITTED transactions count 17 rows,
--      both write R-2026-00018, both commit. There is no index to stop them.
--
--   2. A reversed payment (rank 12 makes that a button). Delete R-2026-00012
--      and the count drops to 16; the next payment is numbered R-2026-00017 —
--      which already exists.
--
--   3. A back-dated payment (rank 5 makes that routine). The PREFIX uses
--      now() while the COUNT uses paid_at: a payment for 30 December keyed on
--      2 January lands in the 2027 series with a count taken from 2026. And
--      once a year straddles, count(*) and the highest number diverge for
--      good.
--
-- A receipt number is the one thing the family holds. Two families holding
-- the same one is an argument at the desk that the software started.
--
-- Zero duplicates exist today (checked live: Jijel is at R-2026-00017, the
-- demo at R-2026-00261, every number matches ^R-\d{4}-\d+$). This is the last
-- moment that is cheap to guarantee.
--
-- ---------------------------------------------------------------------------
-- The fix
-- ---------------------------------------------------------------------------
--
-- (a) A partial unique index on (tenant_id, receipt_number) as the backstop.
--     Whatever the trigger gets wrong, two rows can no longer share a number;
--     the loser gets 23505, and recordPayment retries once.
--
-- (b) The trigger takes a transaction-scoped advisory lock keyed on the
--     tenant and the year before it reads. Two cashiers now queue for a few
--     milliseconds instead of colliding; the second one reads the number the
--     first one already wrote. max()+1 alone would not do this — both would
--     still read max = 17 — which is why the lock and the index both exist.
--
-- (c) The number is max(existing)+1, not count+1, so a reversed payment leaves
--     a gap rather than a repeat. A gap in a receipt series is normal
--     bookkeeping (the reversal is in kg_audit_log); a repeat is not.
--
-- (d) ONE date for both the prefix and the series: paid_at, in Algiers. The
--     year the money was received is the year the receipt belongs to.

begin;

create unique index if not exists kg_payments_receipt_unique
  on kg_payments (tenant_id, receipt_number)
  where receipt_number is not null;

create or replace function kg_assign_receipt_number() returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_year text;
  v_next int;
begin
  if new.receipt_number is not null then
    return new;
  end if;

  -- The year the cash was received, in Algeria — the same day the ledger
  -- books it on (0055). now() would put a payment keyed after midnight UTC on
  -- New Year's Eve into next year's series.
  v_year := to_char((coalesce(new.paid_at, now()) at time zone 'Africa/Algiers')::date, 'YYYY');

  -- Serialise number assignment per tenant and year for the rest of this
  -- transaction. hashtext is stable across sessions; the lock is released at
  -- commit or rollback, so a failed insert never wedges the series.
  perform pg_advisory_xact_lock(hashtext(new.tenant_id::text || ':receipt:' || v_year));

  select coalesce(max((substring(receipt_number from '^R-\d{4}-(\d+)$'))::int), 0) + 1
    into v_next
    from kg_payments
   where tenant_id = new.tenant_id
     and receipt_number like 'R-' || v_year || '-%';

  new.receipt_number := 'R-' || v_year || '-' || lpad(v_next::text, 5, '0');
  return new;
end $$;

-- 0006 revoked direct execution of this trigger function from the API roles;
-- CREATE OR REPLACE keeps the grants, but say so rather than rely on it.
revoke execute on function kg_assign_receipt_number() from public, anon, authenticated;

commit;

-- ---------------------------------------------------------------------------
-- Check afterwards, inside a rolled-back transaction:
--
--   begin;
--   insert into kg_payments (tenant_id, invoice_id, child_id, amount, method, paid_at)
--   select tenant_id, id, child_id, 1, 'cash', '2026-12-31 23:30+00'
--     from kg_invoices where status = 'unpaid' limit 1
--   returning receipt_number;          -- expect R-2027-00001: 00:30 in Algiers
--   rollback;
--
-- And the race, from two psql sessions: BEGIN in both, INSERT in both — the
-- second blocks on the advisory lock until the first COMMITs, then receives
-- the next number. Before this migration both would have returned the same
-- receipt_number.
--
-- ROLLBACK of this migration:
--
--   drop index if exists kg_payments_receipt_unique;
--   -- then re-run the definition in 0002 lines 106-117.
-- ---------------------------------------------------------------------------
