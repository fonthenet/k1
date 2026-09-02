-- 0105 — an invoice issued late must not be born overdue.
--
-- ---------------------------------------------------------------------------
-- What is wrong
-- ---------------------------------------------------------------------------
--
-- kg_generate_monthly_invoices (0047) creates DRAFTS, with due_date fixed at
-- the period start plus nine days — the 10th of the month. Issuing is a second
-- step, kg_issue_invoices, which stamps issue_date and flips status to
-- 'unpaid' but leaves due_date exactly where the run put it.
--
-- Until now nothing in the web app called that second step at all. The real
-- client has been sitting on 17 September drafts, 169 000 DA, that no parent
-- can see and no cashier can take money against. Today is the 2nd; by the
-- time the button that this migration accompanies is pressed it may well be
-- the 15th — and every one of those invoices would then be issued with a due
-- date already five days in the past. kg_apply_invoice_balance marks
-- `due_date < today` as 'overdue', the arrears alert lights up, the overdue
-- digest goes out, and the family receives its first notice of a bill and a
-- late notice in the same minute.
--
-- Two smaller things in the same function:
--
--   - issue_date = current_date is the server's UTC day. At 00:30 in Algiers
--     that is still yesterday, and the invoice number's year prefix (F-YYYY-)
--     is read off issue_date. Every other date in this schema that means "the
--     day in Algeria" is computed with `at time zone 'Africa/Algiers'`.
--
--   - The function raises 'forbidden' with the default errcode P0001, which
--     the web maps to a generic error. 42501 is what the rest of the finance
--     RPCs raise (0077, 0083) and what mapDbError already understands.
--
-- ---------------------------------------------------------------------------
-- The fix
-- ---------------------------------------------------------------------------
--
-- due_date becomes greatest(due_date, issue day + 9): an invoice issued on
-- time keeps the 10th; one issued after the 1st still gives the family the
-- same nine days it would have had. The +9 is the same interval 0047 uses, so
-- INVOICE_DUE_DAY in src/components/modules/billing/dates.ts stays the one
-- number the parent-facing wording follows.
--
-- The draft's own due_date is honoured when it is later than that (a manual
-- draft with a generous term), which is what the greatest() is for.

begin;

create or replace function kg_issue_invoices(p_tenant uuid, p_month date)
returns int
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_count int;
  v_today date := (now() at time zone 'Africa/Algiers')::date;
begin
  if not kg_is_finance(p_tenant) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  with issued as (
    update kg_invoices
       set status     = 'unpaid',
           issue_date = v_today,
           -- Nine days from issue at the least: the same term 0047 gave the
           -- draft, counted from the day the family can actually see the bill.
           due_date   = greatest(coalesce(due_date, v_today), v_today + 9)
     where tenant_id = p_tenant
       and period_month = date_trunc('month', p_month)::date
       and status = 'draft'
       and total > 0
    returning 1)
  select count(*) into v_count from issued;

  return v_count;
end $$;

revoke all on function kg_issue_invoices(uuid, date) from public, anon;
grant execute on function kg_issue_invoices(uuid, date) to authenticated;

commit;

-- ---------------------------------------------------------------------------
-- Check afterwards, inside a rolled-back transaction as a finance user of the
-- Jijel tenant:
--
--   begin;
--   select set_config('request.jwt.claims',
--     json_build_object('sub','<finance user id>','role','authenticated')::text, true);
--   set local role authenticated;
--   select kg_issue_invoices('<tenant>', date '2026-09-01');       -- expect 17
--   select min(due_date), min(number), count(*) from kg_invoices
--    where period_month = '2026-09-01' and status = 'unpaid';
--   -- due_date >= today + 9, every number non-null, 17 rows
--   rollback;
--
-- trg_kg_invoices_number (0047) fires on `update of status` and spends the
-- number; trg_kg_notify_invoice_issued (0049/0060) sends the family its
-- notification. Neither needs a change.
--
-- ROLLBACK of this migration: re-run the definition in 0047 lines 177-190.
-- ---------------------------------------------------------------------------
