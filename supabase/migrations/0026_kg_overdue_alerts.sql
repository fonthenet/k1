-- Unpaid fees have to announce themselves.
--
-- An invoice becomes overdue because a date passed, not because anyone did
-- something, so no trigger can catch it — the billing pages were computing
-- "overdue" for display only and the status column never changed. Nothing ever
-- told the office. This adds the missing sweep: flip the status, then notify
-- the people allowed to see money.
--
-- Who is told matters. kg_invoices is readable only by owner/admin/accountant
-- (policy inv_sel), and an educator has no business knowing which families are
-- behind — that is how a child ends up treated differently at the door. The
-- fan-out below is deliberately finance-only.

create or replace function kg_refresh_overdue_invoices(p_tenant uuid default null)
returns int language plpgsql security definer set search_path = public as $$
declare v_flipped int; r record; v_recipients uuid[];
begin
  -- 1. Flip anything genuinely past its due date.
  update kg_invoices i
     set status = 'overdue'
   where (p_tenant is null or i.tenant_id = p_tenant)
     and i.status in ('unpaid', 'partial', 'sent')
     and i.due_date is not null
     and i.due_date < (now() at time zone 'Africa/Algiers')::date
     and i.total > i.paid_amount;
  get diagnostics v_flipped = row_count;

  -- 2. One digest per tenant that has arrears, not one alert per invoice —
  --    twelve separate notifications on the 10th of the month is noise, and
  --    noise gets muted.
  for r in
    select i.tenant_id,
           count(*) as overdue_count,
           sum(i.total - i.paid_amount) as outstanding
      from kg_invoices i
     where (p_tenant is null or i.tenant_id = p_tenant)
       and i.status = 'overdue'
       and i.total > i.paid_amount
     group by i.tenant_id
  loop
    select array_agg(u) into v_recipients
      from kg_staff_user_ids(r.tenant_id, array['owner','admin','accountant']::kg_role[]) u;

    perform kg_notify(r.tenant_id, v_recipients, 'payment_overdue',
      to_char(r.outstanding, 'FM999G999G999') || ' DZD',
      null,
      jsonb_build_object('count', r.overdue_count, 'amount', r.outstanding,
                         'audience', 'staff'),
      null);
  end loop;

  return v_flipped;
end $$;
revoke execute on function kg_refresh_overdue_invoices(uuid) from anon;
grant execute on function kg_refresh_overdue_invoices(uuid) to authenticated;

-- Live arrears for the dashboard: one row per family that owes money, oldest
-- debt first, so the office sees who to call rather than only a total.
create or replace function kg_arrears_summary(p_tenant uuid)
returns table (
  child_id uuid, child_name text, class_name text,
  invoice_count int, outstanding numeric,
  oldest_due date, days_overdue int,
  guardian_name text, guardian_phone text
) language plpgsql stable security definer set search_path = public as $$
begin
  if not kg_is_finance(p_tenant) then raise exception 'forbidden'; end if;
  return query
  select c.id,
         trim(c.first_name || ' ' || c.last_name),
         cl.name,
         count(i.*)::int,
         sum(i.total - i.paid_amount),
         min(i.due_date),
         greatest(0, ((now() at time zone 'Africa/Algiers')::date - min(i.due_date)))::int,
         g.first_name || ' ' || g.last_name,
         g.phone
    from kg_invoices i
    join kg_children c on c.id = i.child_id
    left join kg_classes cl on cl.id = c.class_id
    left join lateral (
      select gg.first_name, gg.last_name, gg.phone
        from kg_child_guardians cg
        join kg_guardians gg on gg.id = cg.guardian_id
       where cg.child_id = c.id
       order by cg.is_financial desc, cg.is_primary desc
       limit 1
    ) g on true
   where i.tenant_id = p_tenant
     and i.status in ('unpaid','partial','sent','overdue')
     and i.total > i.paid_amount
   group by c.id, c.first_name, c.last_name, cl.name, g.first_name, g.last_name, g.phone
   order by min(i.due_date) nulls last;
end $$;
grant execute on function kg_arrears_summary(uuid) to authenticated;
