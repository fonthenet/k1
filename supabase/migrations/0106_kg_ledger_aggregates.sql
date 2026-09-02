-- 0106 — the accountant's totals are computed from a capped read.
--
-- ---------------------------------------------------------------------------
-- What is wrong
-- ---------------------------------------------------------------------------
--
-- PostgREST answers any request with at most max-rows rows — 1 000 on this
-- project — and says nothing when it truncates. Three screens summed a
-- tenant's ledger in JavaScript from such a read:
--
--   accounting/page.tsx         select kind, amount, date, category_id
--                               from kg_transactions where tenant_id = ?
--                               -- no date bound, no ORDER BY, whole history
--   accounting/transactions     the "all months" view, and its three totals
--   accounting/categories       every category_id, to count per category
--
-- The demo tenant already holds 572 rows. A crèche of 40 children posts
-- roughly 80 payment rows a month (0055 splits one receipt into one row per
-- revenue category) plus salaries, advances and purchases — call it 120. It
-- crosses 1 000 rows inside a year, at which point the cash balance on the
-- overview, the net for "all months", and the counts on the categories page
-- are each computed from whichever 1 000 rows Postgres happened to return
-- first. No error, no note — a smaller number.
--
-- The 6-month bars and the current month's cards came out of the same read,
-- so once the cap bites they drift too, and without ORDER BY they drift
-- unpredictably.
--
-- ---------------------------------------------------------------------------
-- The fix
-- ---------------------------------------------------------------------------
--
-- Sum in Postgres. Three SECURITY INVOKER functions: they run as the caller,
-- so tx_sel (0036) still applies and a non-finance caller gets zeros, not
-- somebody else's ledger. Each returns a bounded result — one jsonb, or one
-- row per category — so max-rows cannot touch it. The list on the journal
-- page is paged separately by the application with .range().
--
--   kg_ledger_overview      the four cards, the 6-month series and the
--                           expense donut for one month, in one round trip
--   kg_ledger_totals        income / expense / count for any filter the
--                           journal page accepts
--   kg_category_txn_counts  rows per category, for the categories page

begin;

/* --------------------------------------------------------------- overview */

create or replace function kg_ledger_overview(p_tenant uuid, p_month date)
returns jsonb
language plpgsql
stable
security invoker
set search_path to 'public'
as $$
declare
  v_start  date := date_trunc('month', p_month)::date;
  v_end    date := (date_trunc('month', p_month) + interval '1 month')::date;
  v_from   date := (date_trunc('month', p_month) - interval '5 months')::date;
  v_month  jsonb;
  v_cash   numeric;
  v_series jsonb;
  v_cats   jsonb;
begin
  select jsonb_build_object(
           'income',  coalesce(sum(amount) filter (where kind = 'income'),  0),
           'expense', coalesce(sum(amount) filter (where kind = 'expense'), 0))
    into v_month
    from kg_transactions
   where tenant_id = p_tenant and date >= v_start and date < v_end;

  -- Since the opening of the books: the one figure that genuinely needs the
  -- whole history, and the one a capped read got most wrong.
  select coalesce(sum(case kind when 'income' then amount else -amount end), 0)
    into v_cash
    from kg_transactions
   where tenant_id = p_tenant;

  -- One entry per month whether or not anything was posted, so the bars keep
  -- their six slots and an empty month reads as zero rather than vanishing.
  select coalesce(jsonb_agg(jsonb_build_object(
           'month',   to_char(mo, 'YYYY-MM'),
           'income',  coalesce(s.income,  0),
           'expense', coalesce(s.expense, 0)) order by mo), '[]'::jsonb)
    into v_series
    from generate_series(v_from, v_start, interval '1 month') as mo
    left join lateral (
      select sum(amount) filter (where kind = 'income')  as income,
             sum(amount) filter (where kind = 'expense') as expense
        from kg_transactions t
       where t.tenant_id = p_tenant
         and t.date >= mo::date
         and t.date <  (mo + interval '1 month')::date) s on true;

  -- Expenses of the month by category. A null category is a real slice — the
  -- screen labels it "uncategorised" — so it is kept, not filtered.
  select coalesce(jsonb_agg(jsonb_build_object(
           'categoryId', c.id, 'name', c.name, 'color', c.color, 'amount', s.total)
           order by s.total desc), '[]'::jsonb)
    into v_cats
    from (select category_id, sum(amount) as total
            from kg_transactions
           where tenant_id = p_tenant and kind = 'expense'
             and date >= v_start and date < v_end
           group by category_id) s
    left join kg_txn_categories c on c.id = s.category_id;

  return jsonb_build_object(
    'monthIncome',  v_month->'income',
    'monthExpense', v_month->'expense',
    'cashBalance',  v_cash,
    'series',       v_series,
    'byCategory',   v_cats);
end $$;

revoke all on function kg_ledger_overview(uuid, date) from public, anon;
grant execute on function kg_ledger_overview(uuid, date) to authenticated;

/* ----------------------------------------------------------------- totals */

-- Every filter is optional so the journal page can pass exactly what its URL
-- carries. Dates are [p_from, p_to) — the same half-open range the page uses
-- for the list, so the totals and the rows never disagree about a month end.
create or replace function kg_ledger_totals(
  p_tenant   uuid,
  p_from     date              default null,
  p_to       date              default null,
  p_kind     kg_txn_kind       default null,
  p_category uuid              default null,
  p_method   kg_payment_method default null
) returns jsonb
language sql
stable
security invoker
set search_path to 'public'
as $$
  select jsonb_build_object(
           'income',  coalesce(sum(amount) filter (where kind = 'income'),  0),
           'expense', coalesce(sum(amount) filter (where kind = 'expense'), 0),
           'count',   count(*))
    from kg_transactions
   where tenant_id = p_tenant
     and (p_from     is null or date >= p_from)
     and (p_to       is null or date <  p_to)
     and (p_kind     is null or kind = p_kind)
     and (p_category is null or category_id = p_category)
     and (p_method   is null or method = p_method)
$$;

revoke all on function kg_ledger_totals(uuid, date, date, kg_txn_kind, uuid, kg_payment_method)
  from public, anon;
grant execute on function kg_ledger_totals(uuid, date, date, kg_txn_kind, uuid, kg_payment_method)
  to authenticated;

/* ---------------------------------------------------------- category counts */

-- Bounded by the number of categories a tenant has, which is a few dozen at
-- most — never by the number of transactions.
create or replace function kg_category_txn_counts(p_tenant uuid)
returns table (category_id uuid, n bigint)
language sql
stable
security invoker
set search_path to 'public'
as $$
  select category_id, count(*)
    from kg_transactions
   where tenant_id = p_tenant and category_id is not null
   group by category_id
$$;

revoke all on function kg_category_txn_counts(uuid) from public, anon;
grant execute on function kg_category_txn_counts(uuid) to authenticated;

commit;

-- ---------------------------------------------------------------------------
-- Check afterwards, as a finance user of the demo tenant:
--
--   select kg_ledger_overview('fb050631-e62f-43f1-9e12-933e564974e8', date '2026-09-01');
--   -- cashBalance equals: select sum(case kind when 'income' then amount
--   --   else -amount end) from kg_transactions where tenant_id = ...
--
-- And as a member who is NOT finance: every function returns zeros and an
-- empty series — tx_sel hides the rows — never another tenant's money.
--
-- ROLLBACK of this migration:
--
--   drop function if exists kg_ledger_overview(uuid, date);
--   drop function if exists kg_ledger_totals(uuid, date, date, kg_txn_kind, uuid, kg_payment_method);
--   drop function if exists kg_category_txn_counts(uuid);
--
-- All three are new names; nothing else calls them.
-- ---------------------------------------------------------------------------
