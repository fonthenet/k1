-- 0082 — a member of staff can ASK for a salary advance.
--
-- NOT YET APPLIED. Apply after 0081 and before 0083.
--
-- Read the "before you apply" note at the bottom: there is one line in the WEB
-- repo that must land with this file or the next payroll run deducts money
-- nobody has received.
--
-- ---------------------------------------------------------------------------
-- What is wrong
-- ---------------------------------------------------------------------------
--
-- kg_salary_advances only ever recorded a decision that had already been taken
-- off-app: finance typed the row, trg_kg_advance_ledger booked the expense, the
-- money was gone. There is nowhere to put "Karima would like 5 000 DA", and no
-- way for her to put it there — sa_all is the only write policy on the table
-- and it is kg_is_finance.
--
-- The whole change is one enum column plus who-decided-when. A second
-- kg_advance_requests table was rejected: it would duplicate tenant_id,
-- membership_id, amount, date and note, then need a foreign key back to the row
-- it becomes on approval — and every query that asks "what does this person owe
-- us" would have to union two tables and hope they agree. The advance and the
-- request for it are the same object at two points in its life.
--
-- The sharp edge is the ledger trigger. It books an expense on EVERY insert and
-- update, unconditionally, so the columns and the new trigger body cannot be
-- split across two deploys: a request filed against the old trigger takes cash
-- out of the box the instant it is typed, and refusing it leaves the expense
-- standing. Both halves are in this file for that reason.

begin;

/* ---------------------------------------------------------------- status */

do $$
begin
  create type kg_advance_status as enum ('requested', 'approved', 'rejected');
exception when duplicate_object then null;
end $$;

-- Deliberately no 'paid' member. "Paid out" is not a fourth state: it is what
-- 'approved' already means here, because approving is what books the expense —
-- the cash leaves the box in the same statement. And "paid back" is `repaid`,
-- which is a different axis entirely:
--
--   status  — did the school agree to hand the money OVER   (money going out)
--   repaid  — has the school got the money BACK             (money coming in)
--
-- Folding the two into one enum is what makes advances ambiguous: 'paid' would
-- read as "paid out" to the person granting it and "paid back" to the person
-- who owes it, and those mean opposite things about the balance.
alter table kg_salary_advances
  add column if not exists status        kg_advance_status not null default 'approved',
  add column if not exists decided_by    uuid references auth.users (id),
  add column if not exists decided_at    timestamptz,
  -- Finance's words, kept apart from `note`, which is the requester's. An
  -- approval for less than was asked, or a refusal, has to be explainable
  -- without overwriting the sentence the employee wrote.
  add column if not exists decision_note text;

-- The default is 'approved', not 'requested', and this is the one judgement
-- call in the file. Every writer this table has ever had is finance granting
-- money directly, and neither web nor mobile sends a status today; a
-- 'requested' default would silently turn live salary grants into pending
-- requests that never reach the ledger, in the window between this migration
-- landing and both clients shipping.
--
-- The permissive default is not a hole, because it is not what protects the
-- table: sa_ins_self below pins status = 'requested' in its WITH CHECK, so a
-- member who omits the column matches no policy and is refused with 42501
-- rather than defaulted into an approval. If the team would rather deny by
-- default, flip this to 'requested' and ship status:'approved' in web
-- addAdvance and mobile lib/finance.ts addAdvance IN THE SAME DEPLOY.
comment on column kg_salary_advances.status is
  'requested = asked for, no money has moved. approved = handed over, expense booked. rejected = never happened. Self-approval is prevented by the sa_ins_self policy, NOT by this default.';
comment on column kg_salary_advances.repaid is
  'Recovered by the school — a payroll deduction settling, or cash handed back. Orthogonal to status; only ever true on an approved row.';

/* ---------------------------------------------------------------- backfill */

-- Both live rows were typed by finance and both already have their expense in
-- kg_transactions, so they are approved by definition. decided_at is their own
-- created_at, not now(): claiming they were decided the day this migration ran
-- would be the first lie in the audit trail.
--
-- This MUST run before the check constraints below — ADD COLUMN leaves every
-- existing row status='approved' with decided_at null, which decision_chk
-- forbids.
update kg_salary_advances
   set status     = 'approved',
       decided_at = created_at,
       decided_by = created_by
 where decided_at is null;

/* ------------------------------------------------------------ invariants */

-- Decided iff there is a decision timestamp. Keeps the audit trail from
-- drifting away from the state it is supposed to explain.
alter table kg_salary_advances
  drop constraint if exists kg_salary_advances_decision_chk;
alter table kg_salary_advances
  add constraint kg_salary_advances_decision_chk
  check ((status = 'requested') = (decided_at is null));

-- Only money that actually went out can come back, or be netted off a payslip.
-- This is the constraint that makes it structurally impossible to deduct a
-- merely-requested advance from somebody's salary.
alter table kg_salary_advances
  drop constraint if exists kg_salary_advances_money_chk;
alter table kg_salary_advances
  add constraint kg_salary_advances_money_chk
  check (status = 'approved' or (repaid = false and payroll_item_id is null));

alter table kg_salary_advances
  drop constraint if exists kg_salary_advances_amount_chk;
alter table kg_salary_advances
  add constraint kg_salary_advances_amount_chk check (amount > 0);

-- The finance inbox badge runs on every accounting screen; pending rows are a
-- handful out of the whole history, so it should never read the rest.
create index if not exists kg_salary_advances_pending_idx
  on kg_salary_advances (tenant_id, created_at desc)
  where status = 'requested';

/* ------------------------------------------ making the default survivable */

-- Without this trigger the two guards above contradict each other, and the
-- contradiction breaks the one write this table already had.
--
-- `status` defaults to 'approved' so that an existing client, which sends no
-- status at all, keeps granting advances the way it always did. But
-- decision_chk demands that anything not 'requested' carries a decided_at, and
-- no existing client sends one of those either. A plain
--
--     insert into kg_salary_advances (tenant_id, membership_id, amount, date,
--                                     note, created_by) values (...)
--
-- -- which is verbatim what web addAdvance and mobile lib/finance.ts
-- addAdvance both send today -- therefore lands as status='approved' with
-- decided_at null and is refused with 23514. Verified against the live schema
-- inside a rolled-back transaction: rejected without this trigger, accepted
-- with it, ledger expense booked either way.
--
-- Stamping the decision here rather than in the two clients is deliberate: the
-- web repo is locked, so a fix that lives in client code cannot reach it, and
-- applying this migration would take "grant an advance" out of production on
-- the web the moment it lands. The invariant is kept exactly as decision_chk
-- states it; the trigger only fills in the timestamp the writer omitted.
--
-- BEFORE, so the stamped row is what both decision_chk and the RLS WITH CHECK
-- see. Clearing the decision on a 'requested' row is the other half: it costs
-- nothing (sa_ins_self already refuses a member who pre-stamps one) and it
-- means a request can never carry a decision it did not receive.
--
-- Self-approval is NOT reopened by this. A member inserting status='approved'
-- gets a decided_at stamped and is then refused by sa_ins_self's
-- `status = 'requested'` anyway -- confirmed live, still 42501.
create or replace function kg_normalize_advance_decision()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.status = 'requested' then
    new.decided_at := null;
    new.decided_by := null;
  elsif new.decided_at is null then
    new.decided_at := now();
    -- auth.uid() is null when payroll or another SECURITY DEFINER path is the
    -- writer; created_by is the last honest answer to "who did this".
    new.decided_by := coalesce(new.decided_by, auth.uid(), new.created_by);
  end if;
  return new;
end $function$;

drop trigger if exists trg_kg_advance_decision on kg_salary_advances;
create trigger trg_kg_advance_decision
  before insert or update on kg_salary_advances
  for each row execute function kg_normalize_advance_decision();

/* ------------------------------------------------------------------- RLS */

-- kg_is_my_membership(m) answers "is this membership mine" but says nothing
-- about which tenant the row claims to belong to. On a SELECT policy that is
-- harmless — the row already exists and carries its own tenant. On an INSERT
-- policy it is not: the caller supplies tenant_id, so a member of school A
-- could file a request carrying school B's tenant_id and B's finance would find
-- a stranger in their inbox. This pins both, and pins `active` as well: an
-- employee whose membership was suspended stops being able to ask for money.
--
-- Do not "simplify" the two helpers into one later. kg_is_my_membership stays
-- as it is for sa_sel and for the withdrawal policy below.
create or replace function kg_is_my_active_membership_in(m uuid, t uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1 from kg_memberships
     where id = m and tenant_id = t and user_id = auth.uid() and status = 'active'
  )
$function$;

revoke all on function kg_is_my_active_membership_in(uuid, uuid) from public, anon;
grant execute on function kg_is_my_active_membership_in(uuid, uuid) to authenticated;

-- Asking. Every column that could turn an ask into money is pinned: a member
-- who posts status = 'approved' matches no policy and is refused, and so is one
-- who pre-stamps a decision, a payslip link or a repayment.
drop policy if exists sa_ins_self on kg_salary_advances;
create policy sa_ins_self on kg_salary_advances
  for insert to authenticated
  with check (
    kg_is_my_active_membership_in(membership_id, tenant_id)
    and status = 'requested'
    and repaid = false
    and payroll_item_id is null
    and decided_by is null
    and decided_at is null
    and decision_note is null
    and created_by = auth.uid()
  );

-- Withdrawing. Without this, a mistyped 50 000 DA sits in finance's inbox until
-- somebody else clears it. Only while still undecided — once finance has ruled,
-- the row is a record, not a draft.
drop policy if exists sa_del_own_request on kg_salary_advances;
create policy sa_del_own_request on kg_salary_advances
  for delete to authenticated
  using (kg_is_my_membership(membership_id) and status = 'requested');

-- No member UPDATE policy is added, and that omission IS the mechanism.
-- Approving, rejecting and changing the amount are all UPDATEs, so they remain
-- reachable only through sa_all (kg_is_finance). A member's
-- `update ... set status = 'approved'` matches zero rows — self-approval is
-- blocked twice over, once by the WITH CHECK above and once by there being no
-- path to promote a row afterwards.
--
-- Reading needs nothing new: sa_sel is already
--   kg_is_finance(tenant_id) or kg_is_my_membership(membership_id),
-- which lets the requester watch their own row through the decision, and lets
-- the `.select("id")` read-back that every write in lib/finance.ts depends on
-- return its row.

/* --------------------------------------------------------------- ledger */

-- The trigger booked an expense on every insert and update, unconditionally.
-- With requests in the table that would put money in the ledger the moment
-- somebody ASKED for it, and leave it there after a refusal. Approval is now
-- the event that moves the books, and losing approval takes the row back out.
--
-- The DELETE (rather than a bare `return new`) is what handles the
-- approved -> rejected path: an expense already booked has to be unbooked.
create or replace function kg_on_advance_change()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_name text;
begin
  if tg_op = 'DELETE' then
    delete from kg_transactions where related_advance_id = old.id;
    return old;
  end if;

  if new.status <> 'approved' then
    delete from kg_transactions where related_advance_id = new.id;
    return new;
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
end $function$;

commit;

-- ---------------------------------------------------------------------------
-- BEFORE YOU APPLY — one line in the web repo
-- ---------------------------------------------------------------------------
--
-- src/components/modules/accounting/actions.ts, createPayrollRun, the advances
-- select currently filtered only on
--
--     .eq("repaid", false).is("payroll_item_id", null)
--
-- must also carry
--
--     .eq("status", "approved")
--
-- Without it, the first payroll run created after this migration sums PENDING
-- requests into advances_deducted and shrinks real salaries by money nobody has
-- received. kg_salary_advances_money_chk turns the follow-up payroll_item_id
-- stamp into a 23514 error rather than a silent wrong deduction — but the
-- draft's advances_deducted and net_amount are already wrong by then, and that
-- error is not checked in the current code.
--
-- 0083's kg_payroll_create carries the filter already. This note is only about
-- the web's own path, which was locked while this was written.
--
-- ---------------------------------------------------------------------------
-- Check afterwards. Impersonate the real active educator and run the fifteen
-- cases this design was verified against inside a rolled-back transaction
-- (user 6f885045-e7ec-408e-9833-947499fe8bb6,
--  membership 9a22e47e-d0d0-452e-bbc6-8101ad75c1de). The load-bearing four:
--
--   insert ... status = 'approved'         -> 42501
--   insert ... status = 'requested'        -> accepted, and 0 ledger rows
--   update own row set status = 'approved' -> 0 rows
--   (as finance) update -> 'approved'      -> 1 ledger row appears
--   (as finance) update -> 'rejected'      -> that ledger row disappears
--
-- ROLLBACK of this migration:
--
--   begin;
--   -- restore the unconditional trigger body from 0083's header, or from
--   --   select pg_get_functiondef('kg_on_advance_change()'::regprocedure)
--   -- taken BEFORE applying (do that first, it is the only irreversible part).
--   drop policy if exists sa_ins_self on kg_salary_advances;
--   drop policy if exists sa_del_own_request on kg_salary_advances;
--   drop trigger if exists trg_kg_advance_decision on kg_salary_advances;
--   drop function if exists kg_normalize_advance_decision();
--   drop function if exists kg_is_my_active_membership_in(uuid, uuid);
--   drop index if exists kg_salary_advances_pending_idx;
--   alter table kg_salary_advances
--     drop constraint if exists kg_salary_advances_decision_chk,
--     drop constraint if exists kg_salary_advances_money_chk,
--     drop constraint if exists kg_salary_advances_amount_chk;
--   -- Dropping the columns discards every decision recorded since. Only do it
--   -- if nothing has used them yet.
--   alter table kg_salary_advances
--     drop column if exists status, drop column if exists decided_by,
--     drop column if exists decided_at, drop column if exists decision_note;
--   drop type if exists kg_advance_status;
--   commit;
-- ---------------------------------------------------------------------------
