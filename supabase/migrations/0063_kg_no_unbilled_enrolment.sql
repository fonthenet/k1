-- A child must not be creatable through the half of the chain that bills nothing.
--
-- kg_approve_application enrols a child and touches no money. kg_approve_and_bill
-- wraps it and then always calls kg_start_child_billing — since 0056 that call is
-- unconditional, so every approval leaves at least the admission fee.
--
-- Four children enrolled on 2026-08-27 carried no fee row and, decisively, no
-- 'registration' line either. Since the wrapper charges admission whether or not
-- a monthly plan was chosen, their absence proves the wrapper never ran: those
-- approvals reached the bare function. Two of them pre-date the wrapper existing
-- at all; the other two were approved three hours after it shipped, by a caller
-- that was not the current code — a stale client in a long-lived dev session is
-- the likeliest reading, and the reason this is closed at the database rather
-- than in the app.
--
-- The grant is the whole hole. kg_approve_application is SECURITY DEFINER and
-- was executable by PUBLIC and authenticated, so anything holding a session
-- could enrol a child over PostgREST and the crèche would never invoice them.
-- It still checks kg_is_admin internally, so this was never a privilege
-- escalation — only a way to enrol somebody for free, silently.
--
-- Revoking execute does not break the wrapper: SECURITY DEFINER runs as the
-- owner, which keeps its own rights. Verified before writing this: no
-- rpc("kg_approve_application") exists anywhere in src/ or in the compiled
-- build. From here that path fails loudly instead of enrolling silently.
revoke execute on function kg_approve_application(uuid, uuid, text) from public, anon, authenticated;

-- Same reasoning for the billing primitive: it is an internal step of the
-- wrapper, not something a client should be able to drive directly.
revoke execute on function kg_start_child_billing(uuid, uuid, uuid, numeric, numeric, boolean)
  from public, anon;

-- Enrolled children with no monthly fee, for the office to see and fix.
-- kg_generate_monthly_invoices bills from kg_child_fees and skips a child with
-- no row there, so without this list an unbilled child is invisible until
-- somebody notices the money never arrived. Admission-only rows are excluded
-- by the period filter: being charged to join is not being billed monthly.
create or replace function kg_children_without_fee(p_tenant uuid)
returns table (child_id uuid, first_name text, last_name text,
               first_name_ar text, last_name_ar text, class_name text,
               enrolled_on date)
language sql stable security definer set search_path = public as $$
  select c.id, c.first_name, c.last_name, c.first_name_ar, c.last_name_ar,
         cl.name, c.created_at::date
    from kg_children c
    left join kg_classes cl on cl.id = c.class_id
   where c.tenant_id = p_tenant
     and c.status = 'enrolled'
     and kg_is_finance(p_tenant)
     and not exists (
       select 1 from kg_child_fees f
       join kg_fee_plans p on p.id = f.fee_plan_id
       where f.child_id = c.id
         and p.period = 'monthly'
         and (f.end_date is null or f.end_date > current_date)
     )
   order by c.created_at desc
$$;
revoke execute on function kg_children_without_fee(uuid) from public, anon;
grant execute on function kg_children_without_fee(uuid) to authenticated;
