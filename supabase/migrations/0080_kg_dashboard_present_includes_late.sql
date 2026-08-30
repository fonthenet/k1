-- The dashboard's "children present" tile did not count late arrivals.
--
-- `children_present` asked for status = 'present' only, so a child marked
-- `late` at the door — in the building, coat off, sitting in the room — was
-- absent from the figure a manager glances at. With four late arrivals today
-- the tile read 8 when eleven children were on the premises, and the number is
-- the one a manager would quote to a parent or to an inspector.
--
-- It also broke the arithmetic between screens: the register counts fourteen
-- marked in, the dashboard shows "present" plus "gone home", and 8 + 3 does
-- not make 14. With `late` counted, 11 + 3 = 14 and every screen agrees.
--
-- Nothing else in the function changes; no rows are touched.
create or replace function public.kg_dashboard_stats(p_tenant uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare v_today date := kg_today(); v_fin boolean;
begin
  if not kg_is_staff(p_tenant) then raise exception 'forbidden'; end if;
  v_fin := kg_is_finance(p_tenant);

  return jsonb_build_object(
    'children_enrolled', (select count(*) from kg_children
       where tenant_id = p_tenant and status = 'enrolled'),
    -- In the building right now. `late` is an arrival, not an absence.
    'children_present', (select count(*) from kg_attendance
       where tenant_id = p_tenant and date = v_today
         and status in ('present','late')
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
end $function$;
