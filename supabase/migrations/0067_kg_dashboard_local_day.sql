-- The dashboard's "today" is the crèche's today, and its money is finance-only.
--
-- Two faults, both visible on the same screen.
--
-- 1. current_date is UTC. Algeria is UTC+1 year round, so between midnight and
--    01:00 local the database's "today" is still yesterday. The page computes
--    its own date in Africa/Algiers and queried the 28th while this function
--    counted the 27th, so the dashboard said "2 children present" directly above
--    a check-in list reading "no check-ins yet" and an absent list naming all 16
--    children. Every night, for an hour, the screen contradicted itself. The
--    same slip moved the month boundary: on the 1st, "this month" income and
--    expenses showed the previous month until 01:00.
--
-- 2. The money was returned to anyone on staff. RLS hides kg_transactions and
--    kg_invoices from an educator on purpose — but this function is SECURITY
--    DEFINER, so it handed over the aggregates anyway: total owed, income, and
--    an expense figure that is mostly salaries. Null for anyone who is not
--    finance, so the page has nothing to render rather than something to hide.
--
-- Also splits the debt in two. The dashboard showed "61 700 DA outstanding" next
-- to an alert reading "46 200 DA total outstanding" — both correct (all unpaid
-- vs only past due) and neither labelled, which reads as one of them being wrong.
create or replace function kg_today() returns date
language sql stable set search_path = public as $fn$
  select (now() at time zone 'Africa/Algiers')::date;
$fn$;
grant execute on function kg_today() to authenticated;

create or replace function kg_dashboard_stats(p_tenant uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $fn$
declare v_today date := kg_today(); v_fin boolean;
begin
  if not kg_is_staff(p_tenant) then raise exception 'forbidden'; end if;
  v_fin := kg_is_finance(p_tenant);

  return jsonb_build_object(
    'children_enrolled', (select count(*) from kg_children
       where tenant_id = p_tenant and status = 'enrolled'),
    'children_present', (select count(*) from kg_attendance
       where tenant_id = p_tenant and date = v_today and status = 'present'
         and check_in_at is not null and check_out_at is null),
    'children_checked_out', (select count(*) from kg_attendance
       where tenant_id = p_tenant and date = v_today and check_out_at is not null),
    'staff_present', (select count(distinct membership_id) from kg_timesheets
       where tenant_id = p_tenant and date = v_today
         and clock_in_at is not null and clock_out_at is null),
    'pending_applications', (select count(*) from kg_applications
       where tenant_id = p_tenant and status in ('submitted','under_review')),

    'unpaid_invoices', case when v_fin then (select count(*) from kg_invoices
       where tenant_id = p_tenant and status in ('unpaid','partial','overdue')) end,
    'unpaid_total', case when v_fin then coalesce((select sum(total - paid_amount)
       from kg_invoices where tenant_id = p_tenant
        and status in ('unpaid','partial','overdue')), 0) end,
    'overdue_invoices', case when v_fin then (select count(*) from kg_invoices
       where tenant_id = p_tenant and status in ('unpaid','partial','overdue')
         and total - paid_amount > 0 and due_date < v_today) end,
    'overdue_total', case when v_fin then coalesce((select sum(total - paid_amount)
       from kg_invoices where tenant_id = p_tenant
        and status in ('unpaid','partial','overdue')
        and total - paid_amount > 0 and due_date < v_today), 0) end,
    'mtd_income', case when v_fin then coalesce((select sum(amount) from kg_transactions
       where tenant_id = p_tenant and kind = 'income'
         and date >= date_trunc('month', v_today)::date), 0) end,
    'mtd_expense', case when v_fin then coalesce((select sum(amount) from kg_transactions
       where tenant_id = p_tenant and kind = 'expense'
         and date >= date_trunc('month', v_today)::date), 0) end
  );
end $fn$;
