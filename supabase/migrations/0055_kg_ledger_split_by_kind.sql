-- 0055 — A mixed invoice must not post entirely to one accounting category.
--
-- kg_income_category_for_payment picks the SINGLE largest item kind on the
-- invoice and posts the whole payment there. A 14 200 DA payment covering
-- 9 000 tuition + 3 000 registration + 2 200 activities landed 14 200 in
-- "Scolarité" and nothing anywhere else. The totals were right and every
-- category was wrong — the worst kind of accounting error, because it
-- reconciles perfectly and still misstates the books.
--
-- Now one ledger row per revenue CATEGORY, proportional to that category's
-- share of the invoice. Category, not item kind: the kind→category map is
-- many-to-one (meal, transport, uniform and every unknown kind all collapse to
-- "Autres revenus"), so grouping by kind would emit duplicate rows for one
-- receipt. A partial payment splits on the same ratios, so category totals
-- converge to exactly the invoice's own mix the moment it is settled —
-- order-independent, no allocation state, nothing to argue about at the desk.
--
-- ROUNDING. Every category but the largest is rounded to the centime; the
-- largest takes the remainder, so the rows always sum to the payment exactly
-- and the noise lands where it is proportionally smallest.
--
-- Reviewed adversarially before applying; the review found the two facts that
-- reshaped it: the live 1:1 unique index below, and the category collapse.

-- ── The invariant changes: one row per payment PER CATEGORY ──────────────
-- 0030 pinned the ledger to one row per payment. That is the premise this
-- migration retires. The replacement index still forbids double-posting — it
-- counts per category — and creating it BEFORE the backfill makes the
-- backfill self-verifying. kg_transactions_advance_unique and
-- kg_transactions_payroll_item_unique stay: 0030 uses them as ON CONFLICT
-- arbiters.
drop index if exists kg_transactions_payment_unique;
create unique index if not exists kg_transactions_payment_category_unique
  on kg_transactions (related_payment_id, category_id)
  where related_payment_id is not null;

-- The category one item kind belongs to. VOLATILE, deliberately:
-- kg_category_id INSERTs the category row when a tenant is missing it, and a
-- STABLE label on a writing function is a planner landmine.
create or replace function kg_income_category_for_kind(p_tenant uuid, p_kind text)
returns uuid language sql security definer set search_path = public as $$
  select kg_category_id(p_tenant, case coalesce(p_kind, 'tuition')
    when 'tuition'      then 'Scolarité'
    when 'registration' then 'Frais d''inscription'
    when 'activity'     then 'Activités'
    else 'Autres revenus' end, 'income');
$$;
revoke execute on function kg_income_category_for_kind(uuid, text) from anon, authenticated;

-- Rebuilds every ledger row for one payment. Idempotent: it clears what it
-- previously wrote before writing again — that delete is safety-critical now,
-- not housekeeping, because it is what makes re-posting safe. 0036's RLS keeps
-- derived rows human-uneditable, so nothing hand-written can be caught by it.
create or replace function kg_post_payment_to_ledger(p_payment uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_pay kg_payments;
  v_items_total numeric;
  v_cats int;
  v_i int := 0;
  v_running numeric := 0;
  v_alloc numeric;
  r record;
  v_desc text;
  v_date date;
begin
  select * into v_pay from kg_payments where id = p_payment;
  if v_pay.id is null then return; end if;

  delete from kg_transactions where related_payment_id = p_payment;
  v_desc := 'Paiement ' || coalesce(v_pay.receipt_number, '');
  -- Booked on the Algiers day the money changed hands. The server runs UTC, so
  -- a bare ::date shifts a 00:30 payment onto yesterday — and on the 1st, into
  -- last month's revenue. Same idiom 0031 already uses.
  v_date := (v_pay.paid_at at time zone 'Africa/Algiers')::date;

  -- A payment with no invoice has nothing to split by.
  if v_pay.invoice_id is null then
    insert into kg_transactions (tenant_id, kind, category_id, amount, date, method,
                                 description, related_payment_id, created_by)
    values (v_pay.tenant_id, 'income',
            kg_income_category_for_kind(v_pay.tenant_id, null),
            v_pay.amount, v_date, v_pay.method, v_desc, v_pay.id, v_pay.received_by);
    return;
  end if;

  select coalesce(sum(cat_total), 0), count(*)
    into v_items_total, v_cats
    from (select kg_income_category_for_kind(v_pay.tenant_id, kind) as cat,
                 sum(amount) as cat_total
            from kg_invoice_items
           where invoice_id = v_pay.invoice_id
           group by 1) s;

  -- An invoice with no lines (or a zero total) cannot be apportioned; fall
  -- back to the default category rather than dropping the money on the floor.
  if coalesce(v_items_total, 0) <= 0 then
    insert into kg_transactions (tenant_id, kind, category_id, amount, date, method,
                                 description, related_payment_id, created_by)
    values (v_pay.tenant_id, 'income',
            kg_income_category_for_kind(v_pay.tenant_id, null),
            v_pay.amount, v_date, v_pay.method, v_desc, v_pay.id, v_pay.received_by);
    return;
  end if;

  -- Ascending, so the LAST iteration is the largest category and therefore the
  -- one that absorbs the rounding remainder.
  for r in
    select kg_income_category_for_kind(v_pay.tenant_id, kind) as cat,
           sum(amount) as cat_total
      from kg_invoice_items
     where invoice_id = v_pay.invoice_id
     group by 1
     order by 2 asc, 1 asc
  loop
    v_i := v_i + 1;
    if v_i = v_cats then
      v_alloc := v_pay.amount - v_running;
    else
      v_alloc := round(v_pay.amount * r.cat_total / v_items_total, 2);
      v_running := v_running + v_alloc;
    end if;

    if v_alloc <> 0 then
      -- The category name in the description: one receipt is now N rows, and
      -- an accountant reading "Paiement R-0042" three times with no hint of
      -- what each covers is a regression a 1-row ledger never had.
      insert into kg_transactions (tenant_id, kind, category_id, amount, date, method,
                                   description, related_payment_id, created_by)
      values (v_pay.tenant_id, 'income', r.cat, v_alloc, v_date, v_pay.method,
              v_desc || ' — ' || (select name from kg_txn_categories where id = r.cat),
              v_pay.id, v_pay.received_by);
    end if;
  end loop;
end $$;
revoke execute on function kg_post_payment_to_ledger(uuid) from anon, authenticated;

create or replace function kg_on_payment_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform kg_post_payment_to_ledger(new.id);
  if new.invoice_id is not null then
    perform kg_apply_invoice_balance(new.invoice_id);
  end if;
  return new;
end $$;

-- Amending rebuilds rather than updating in place: the number of rows can
-- change when the payment moves to an invoice with a different mix of lines,
-- and an UPDATE cannot add or remove rows.
create or replace function kg_on_payment_amended() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform kg_post_payment_to_ledger(new.id);
  if old.invoice_id is not null then perform kg_apply_invoice_balance(old.invoice_id); end if;
  if new.invoice_id is not null and new.invoice_id is distinct from old.invoice_id then
    perform kg_apply_invoice_balance(new.invoice_id);
  end if;
  return new;
end $$;

-- Deletion needs no handling: 0032 made the ledger FK ON DELETE CASCADE.

-- ── The ratios must stay honest when the invoice changes ─────────────────
-- Proportional splitting converges to the invoice's true mix ONLY if the mix
-- is stable. It is not: 0033 appends an activity line to an already-paid
-- invoice, 0056 appends registration. 9 000 tuition paid, swimming added,
-- 2 200 paid, and the ledger reads Scolarité 10 767,86 / Activités 432,14
-- against a truth of 9 000 / 2 200 — reconciles to the dinar, 80 % wrong on
-- Activités. So any change to an invoice's lines re-posts every payment on
-- it, reusing the idempotence above. The trade, accepted: a receipt dated the
-- 5th can have its category mix restated on the 12th. Categories are
-- reporting; the dated total never moves.
create or replace function kg_repost_invoice_payments() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_invoice uuid; p record;
begin
  v_invoice := coalesce(new.invoice_id, old.invoice_id);
  for p in select id from kg_payments where invoice_id = v_invoice loop
    perform kg_post_payment_to_ledger(p.id);
  end loop;
  return coalesce(new, old);
end $$;
drop trigger if exists trg_kg_repost_on_item_change on kg_invoice_items;
create trigger trg_kg_repost_on_item_change
  after insert or update or delete on kg_invoice_items
  for each row execute function kg_repost_invoice_payments();

-- Re-post every existing payment so history matches the new rule. Safe to run
-- twice, and the per-category unique index above turns any double-posting bug
-- into an abort instead of silently corrupt books.
do $$
declare p record;
begin
  for p in select id from kg_payments loop
    perform kg_post_payment_to_ledger(p.id);
  end loop;
end $$;
