-- 0139 — the dashboard reads through the structure switcher.
--
-- Added ALONGSIDE the one-argument version rather than replacing it. The live
-- site runs off this same database, and `create or replace` with an added
-- parameter creates a second function rather than replacing the first, so
-- dropping the old signature here would break the deployed build's dashboard
-- from the moment this ran until the new build shipped. The old signature
-- stays and delegates.
--
-- Two overloads are only a PostgREST hazard (PGRST203) when they differ by a
-- DEFAULTED argument, because then one call matches both. Neither of these
-- has a default, so {p_tenant} resolves to the first and {p_tenant,
-- p_structure} to the second, unambiguously.
--
-- SCOPING RULE, the same one the app uses: the structure's own rows plus the
-- building's. structure_id is nullable and NULL means the whole building — an
-- answer, not a gap — so `= p_structure` alone would hide every building-wide
-- transaction from both structures.

create or replace function kg_dashboard_stats(p_tenant uuid, p_structure uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_today date := kg_today(); v_fin boolean;
begin
  if not kg_is_staff(p_tenant) then raise exception 'forbidden'; end if;
  v_fin := kg_is_finance(p_tenant);

  return jsonb_build_object(
    'children_enrolled', (select count(*) from kg_children
       where tenant_id = p_tenant and status = 'enrolled'
         and (p_structure is null or structure_id = p_structure or structure_id is null)),

    -- Attendance carries no structure of its own; the child's is the truth,
    -- and it is kept current by trg_kg_children_structure_sync when a child
    -- moves class.
    --
    -- `late` is an arrival, not an absence: with it excluded the tile read 8
    -- while eleven children were on the premises.
    'children_present', (select count(*) from kg_attendance a
       join kg_children c on c.id = a.child_id
       where a.tenant_id = p_tenant and a.date = v_today
         and a.status in ('present','late')
         and a.check_in_at is not null and a.check_out_at is null
         and (p_structure is null or c.structure_id = p_structure or c.structure_id is null)),
    'children_checked_out', (select count(*) from kg_attendance a
       join kg_children c on c.id = a.child_id
       where a.tenant_id = p_tenant and a.date = v_today and a.check_out_at is not null
         and (p_structure is null or c.structure_id = p_structure or c.structure_id is null)),

    -- DELIBERATELY NOT SCOPED. Staff are shared across the building — the same
    -- three people cover the crèche and the école, and kg_timesheets has no
    -- structure because a person clocking in has not clocked in to one half of
    -- a building. Narrowing this would show "0 on duty" next to a register
    -- full of children.
    'staff_present', (select count(distinct membership_id) from kg_timesheets
       where tenant_id = p_tenant and date = v_today
         and clock_in_at is not null and clock_out_at is null),

    'pending_applications', (select count(*) from kg_applications
       where tenant_id = p_tenant and status in ('submitted','under_review')
         and (p_structure is null or structure_id = p_structure or structure_id is null)),

    -- An invoice belongs to a child, so it inherits the child's structure.
    'unpaid_invoices', case when v_fin then (select count(*) from kg_invoices i
       join kg_children c on c.id = i.child_id
       where i.tenant_id = p_tenant and i.status in ('unpaid','partial','overdue')
         and (p_structure is null or c.structure_id = p_structure or c.structure_id is null)) end,
    'unpaid_total', case when v_fin then coalesce((select sum(i.total - i.paid_amount)
       from kg_invoices i join kg_children c on c.id = i.child_id
       where i.tenant_id = p_tenant and i.status in ('unpaid','partial','overdue')
         and (p_structure is null or c.structure_id = p_structure or c.structure_id is null)), 0) end,
    'overdue_invoices', case when v_fin then (select count(*) from kg_invoices i
       join kg_children c on c.id = i.child_id
       where i.tenant_id = p_tenant and i.status in ('unpaid','partial','overdue')
         and i.total - i.paid_amount > 0 and i.due_date < v_today
         and (p_structure is null or c.structure_id = p_structure or c.structure_id is null)) end,
    'overdue_total', case when v_fin then coalesce((select sum(i.total - i.paid_amount)
       from kg_invoices i join kg_children c on c.id = i.child_id
       where i.tenant_id = p_tenant and i.status in ('unpaid','partial','overdue')
         and i.total - i.paid_amount > 0 and i.due_date < v_today
         and (p_structure is null or c.structure_id = p_structure or c.structure_id is null)), 0) end,

    'mtd_income', case when v_fin then coalesce((select sum(amount) from kg_transactions
       where tenant_id = p_tenant and kind = 'income'
         and date >= date_trunc('month', v_today)::date
         and (p_structure is null or structure_id = p_structure or structure_id is null)), 0) end,
    'mtd_expense', case when v_fin then coalesce((select sum(amount) from kg_transactions
       where tenant_id = p_tenant and kind = 'expense'
         and date >= date_trunc('month', v_today)::date
         and (p_structure is null or structure_id = p_structure or structure_id is null)), 0) end
  );
end $$;

-- The original signature, kept for the running build and for any caller that
-- has no structure to pass. One definition of the figures, not two.
create or replace function kg_dashboard_stats(p_tenant uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  return kg_dashboard_stats(p_tenant, null::uuid);
end $$;

revoke all on function kg_dashboard_stats(uuid, uuid) from public, anon;
revoke all on function kg_dashboard_stats(uuid) from public, anon;
grant execute on function kg_dashboard_stats(uuid, uuid) to authenticated;
grant execute on function kg_dashboard_stats(uuid) to authenticated;
