-- Stop the overdue digest repeating, and restore a lost grant.
--
-- kg_refresh_overdue_invoices emitted a notification on EVERY call that found
-- arrears, not only when something changed. The arrears page calls it on open,
-- so three staff opening the page meant three identical alerts — and an alert
-- that repeats is one people learn to swipe away. Now: at most one digest per
-- tenant per Algiers day.
--
-- Also re-applies the anon revoke that 0006 established. A newly created
-- overload is EXECUTE-to-PUBLIC by default, so 0019/0027 silently dropped that
-- layer when they created new signatures.

create or replace function kg_refresh_overdue_invoices(p_tenant uuid default null)
returns int language plpgsql security definer set search_path = public as $$
declare v_flipped int; r record; v_recipients uuid[]; v_already boolean;
begin
  update kg_invoices i
     set status = 'overdue'
   where (p_tenant is null or i.tenant_id = p_tenant)
     and i.status in ('unpaid', 'partial', 'sent')
     and i.due_date is not null
     and i.due_date < (now() at time zone 'Africa/Algiers')::date
     and i.total > i.paid_amount;
  get diagnostics v_flipped = row_count;

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
    select exists (
      select 1 from kg_notifications n
       where n.tenant_id = r.tenant_id
         and n.type = 'payment_overdue'
         and (n.created_at at time zone 'Africa/Algiers')::date
             = (now() at time zone 'Africa/Algiers')::date
    ) into v_already;
    if v_already then continue; end if;

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

revoke execute on function kg_checkin_by_tag(uuid, text, text, kg_checkin_method, text, uuid, boolean) from anon;
grant execute on function kg_checkin_by_tag(uuid, text, text, kg_checkin_method, text, uuid, boolean) to authenticated;
