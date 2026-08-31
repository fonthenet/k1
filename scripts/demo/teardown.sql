-- Remove the demo tenant, completely and reversibly-safely.
--
-- Every statement is scoped to the demo tenant id. The two asserts are the
-- point: this file runs against the SAME database as a live crèche, so it
-- refuses to proceed if the target looks wrong, and refuses to commit if the
-- real client's data moved.
begin;

do $$
declare v_demo uuid := '732bdf7d-775a-4ed7-875f-8c04ea4e4778';
        v_real uuid := 'fb050631-e62f-43f1-9e12-933e564974e8';
        v_real_before int;
begin
  -- Refuse to run unless the target is genuinely the flagged demo tenant.
  if not exists (select 1 from kg_tenants
                  where id = v_demo and settings->>'demo' = 'true') then
    raise exception 'target % is not a tenant flagged demo — refusing', v_demo;
  end if;
  select count(*) into v_real_before from kg_children where tenant_id = v_real;

  -- Children first: most tables cascade from kg_children or kg_tenants, but
  -- deleting explicitly keeps the order obvious and the counts checkable.
  delete from kg_payments          where tenant_id = v_demo;
  delete from kg_transactions      where tenant_id = v_demo;
  delete from kg_invoice_items     where tenant_id = v_demo;
  delete from kg_invoices          where tenant_id = v_demo;
  delete from kg_payroll_items     where tenant_id = v_demo;
  delete from kg_payroll_runs      where tenant_id = v_demo;
  delete from kg_attendance        where tenant_id = v_demo;
  delete from kg_timesheets        where tenant_id = v_demo;
  delete from kg_daily_reports     where tenant_id = v_demo;
  delete from kg_incidents         where tenant_id = v_demo;
  delete from kg_activity_enrollments where tenant_id = v_demo;
  delete from kg_child_allergies   where tenant_id = v_demo;
  delete from kg_child_fees        where tenant_id = v_demo;
  delete from kg_child_health where child_id in (select id from kg_children where tenant_id = v_demo);
  delete from kg_child_guardians where child_id in (select id from kg_children where tenant_id = v_demo);
  delete from kg_notifications     where tenant_id = v_demo;
  delete from kg_announcements     where tenant_id = v_demo;
  delete from kg_events            where tenant_id = v_demo;
  delete from kg_holidays          where tenant_id = v_demo;
  delete from kg_applications      where tenant_id = v_demo;
  delete from kg_enroll_links      where tenant_id = v_demo;
  delete from kg_guardian_claims   where tenant_id = v_demo;
  delete from kg_credentials       where tenant_id = v_demo;
  delete from kg_guardians         where tenant_id = v_demo;
  delete from kg_children          where tenant_id = v_demo;
  delete from kg_activities        where tenant_id = v_demo;
  delete from kg_fee_plans         where tenant_id = v_demo;
  delete from kg_classes           where tenant_id = v_demo;
  delete from kg_txn_categories    where tenant_id = v_demo;
  delete from kg_memberships       where tenant_id = v_demo;

  -- The six demo accounts. Deleting them also removes the rows the OTHER
  -- product's on_auth_user_created trigger created in public.profiles, which
  -- cascade from auth.users.
  delete from auth.users where email in (
    'directrice@rawdatik.com','comptable@rawdatik.com','educatrice@rawdatik.com',
    'parent1@rawdatik.com','parent2@rawdatik.com','parent3@rawdatik.com');

  delete from kg_tenants where id = v_demo;

  if (select count(*) from kg_children where tenant_id = v_real) <> v_real_before then
    raise exception 'real client child count changed — rolling back';
  end if;
end $$;

commit;
