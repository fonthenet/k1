-- RLS: tenant isolation + role matrix.
-- Roles: owner/admin (full), accountant (money), educator/staff (operations), parent (own children only).

-- ===== Helper functions (security definer bypasses RLS internally) =====
create or replace function kg_my_tenants() returns setof uuid
language sql stable security definer set search_path = public as $$
  select tenant_id from kg_memberships where user_id = auth.uid() and status = 'active'
$$;

create or replace function kg_role_in(t uuid, roles kg_role[]) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from kg_memberships
    where tenant_id = t and user_id = auth.uid() and status = 'active' and role = any(roles)
  )
$$;

create or replace function kg_is_member(t uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from kg_memberships where tenant_id = t and user_id = auth.uid() and status = 'active')
$$;

create or replace function kg_is_staff(t uuid) returns boolean
language sql stable as $$ select kg_role_in(t, array['owner','admin','educator','staff','accountant']::kg_role[]) $$;

create or replace function kg_is_admin(t uuid) returns boolean
language sql stable as $$ select kg_role_in(t, array['owner','admin']::kg_role[]) $$;

create or replace function kg_is_finance(t uuid) returns boolean
language sql stable as $$ select kg_role_in(t, array['owner','admin','accountant']::kg_role[]) $$;

create or replace function kg_is_educator(t uuid) returns boolean
language sql stable as $$ select kg_role_in(t, array['owner','admin','educator','staff']::kg_role[]) $$;

create or replace function kg_is_parent_of(c uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from kg_child_guardians cg
    join kg_guardians g on g.id = cg.guardian_id
    where cg.child_id = c and g.user_id = auth.uid()
  )
$$;

create or replace function kg_is_my_membership(m uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from kg_memberships where id = m and user_id = auth.uid())
$$;

create or replace function kg_shares_tenant(other uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from kg_memberships a
    join kg_memberships b on a.tenant_id = b.tenant_id
    where a.user_id = auth.uid() and a.status = 'active'
      and b.user_id = other and b.status = 'active'
  )
$$;

create or replace function kg_is_parent_of_invoice(inv uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from kg_invoices i
    join kg_child_guardians cg on cg.child_id = i.child_id
    join kg_guardians g on g.id = cg.guardian_id
    where i.id = inv and g.user_id = auth.uid()
  )
$$;

create or replace function kg_can_see_thread(t uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from kg_threads th
    where th.id = t and (
      th.created_by = auth.uid()
      or kg_is_staff(th.tenant_id)
      or (th.child_id is not null and kg_is_parent_of(th.child_id))
    )
  )
$$;

-- ===== Enable RLS everywhere =====
do $$
declare t text;
begin
  for t in
    select tablename from pg_tables where schemaname = 'public' and tablename like 'kg\_%' escape '\'
  loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

-- ===== Policies =====
create policy t_sel on kg_tenants for select using (kg_is_member(id));
create policy t_upd on kg_tenants for update using (kg_is_admin(id));

create policy pr_sel on kg_profiles for select using (id = auth.uid() or kg_shares_tenant(id));
create policy pr_ins on kg_profiles for insert with check (id = auth.uid());
create policy pr_upd on kg_profiles for update using (id = auth.uid());

create policy m_sel on kg_memberships for select using (user_id = auth.uid() or kg_is_staff(tenant_id));
create policy m_ins on kg_memberships for insert with check (kg_is_admin(tenant_id));
create policy m_upd on kg_memberships for update using (kg_is_admin(tenant_id));
create policy m_del on kg_memberships for delete using (kg_is_admin(tenant_id));

create policy si_all on kg_staff_invites for all using (kg_is_admin(tenant_id)) with check (kg_is_admin(tenant_id));

create policy cl_sel on kg_classes for select using (kg_is_member(tenant_id));
create policy cl_ins on kg_classes for insert with check (kg_is_admin(tenant_id));
create policy cl_upd on kg_classes for update using (kg_is_admin(tenant_id));
create policy cl_del on kg_classes for delete using (kg_is_admin(tenant_id));

create policy cs_sel on kg_class_staff for select using (exists (select 1 from kg_classes c where c.id = class_id and kg_is_member(c.tenant_id)));
create policy cs_all on kg_class_staff for all using (exists (select 1 from kg_classes c where c.id = class_id and kg_is_admin(c.tenant_id)));

create policy ch_sel on kg_children for select using (kg_is_staff(tenant_id) or kg_is_parent_of(id));
create policy ch_ins on kg_children for insert with check (kg_is_educator(tenant_id));
create policy ch_upd on kg_children for update using (kg_is_educator(tenant_id));
create policy ch_del on kg_children for delete using (kg_is_admin(tenant_id));

create policy g_sel on kg_guardians for select using (kg_is_staff(tenant_id) or user_id = auth.uid());
create policy g_ins on kg_guardians for insert with check (kg_is_educator(tenant_id));
create policy g_upd on kg_guardians for update using (kg_is_educator(tenant_id) or user_id = auth.uid());
create policy g_del on kg_guardians for delete using (kg_is_admin(tenant_id));

create policy cg_sel on kg_child_guardians for select using (kg_is_parent_of(child_id) or exists (select 1 from kg_children c where c.id = child_id and kg_is_staff(c.tenant_id)));
create policy cg_all on kg_child_guardians for all using (exists (select 1 from kg_children c where c.id = child_id and kg_is_educator(c.tenant_id)));

create policy ap_sel on kg_authorized_pickups for select using (kg_is_staff(tenant_id) or kg_is_parent_of(child_id));
create policy ap_ins on kg_authorized_pickups for insert with check (kg_is_educator(tenant_id) or kg_is_parent_of(child_id));
create policy ap_upd on kg_authorized_pickups for update using (kg_is_educator(tenant_id) or kg_is_parent_of(child_id));
create policy ap_del on kg_authorized_pickups for delete using (kg_is_educator(tenant_id) or kg_is_parent_of(child_id));

create policy chh_sel on kg_child_health for select using (kg_is_parent_of(child_id) or exists (select 1 from kg_children c where c.id = child_id and kg_is_staff(c.tenant_id)));
create policy chh_all on kg_child_health for all using (kg_is_parent_of(child_id) or exists (select 1 from kg_children c where c.id = child_id and kg_is_educator(c.tenant_id)));

create policy ca_sel on kg_child_allergies for select using (kg_is_staff(tenant_id) or kg_is_parent_of(child_id));
create policy ca_all on kg_child_allergies for all using (kg_is_educator(tenant_id) or kg_is_parent_of(child_id));

create policy cd_sel on kg_child_documents for select using (kg_is_staff(tenant_id) or kg_is_parent_of(child_id));
create policy cd_ins on kg_child_documents for insert with check (kg_is_educator(tenant_id) or kg_is_parent_of(child_id));
create policy cd_del on kg_child_documents for delete using (kg_is_admin(tenant_id) or uploaded_by = auth.uid());

create policy el_sel on kg_enroll_links for select using (kg_is_staff(tenant_id));
create policy el_all on kg_enroll_links for all using (kg_is_admin(tenant_id)) with check (kg_is_admin(tenant_id));

create policy app_sel on kg_applications for select using (kg_is_staff(tenant_id) or applicant_user_id = auth.uid());
create policy app_upd on kg_applications for update using (kg_is_admin(tenant_id) or (applicant_user_id = auth.uid() and status = 'submitted'));

create policy act_sel on kg_activities for select using (kg_is_member(tenant_id));
create policy act_all on kg_activities for all using (kg_is_admin(tenant_id)) with check (kg_is_admin(tenant_id));

create policy ae_sel on kg_activity_enrollments for select using (kg_is_staff(tenant_id) or kg_is_parent_of(child_id));
create policy ae_ins on kg_activity_enrollments for insert with check (kg_is_educator(tenant_id) or (kg_is_parent_of(child_id) and status = 'requested'));
create policy ae_upd on kg_activity_enrollments for update using (kg_is_educator(tenant_id));
create policy ae_del on kg_activity_enrollments for delete using (kg_is_educator(tenant_id) or (kg_is_parent_of(child_id) and status = 'requested'));

create policy att_sel on kg_attendance for select using (kg_is_staff(tenant_id) or kg_is_parent_of(child_id));
create policy att_ins on kg_attendance for insert with check (kg_is_educator(tenant_id));
create policy att_upd on kg_attendance for update using (kg_is_educator(tenant_id));
create policy att_del on kg_attendance for delete using (kg_is_admin(tenant_id));

create policy ts_sel on kg_timesheets for select using (kg_is_finance(tenant_id) or kg_is_my_membership(membership_id));
create policy ts_ins on kg_timesheets for insert with check (kg_is_admin(tenant_id) or (kg_is_staff(tenant_id) and kg_is_my_membership(membership_id)));
create policy ts_upd on kg_timesheets for update using (kg_is_admin(tenant_id) or (kg_is_my_membership(membership_id) and date = current_date));
create policy ts_del on kg_timesheets for delete using (kg_is_admin(tenant_id));

create policy fp_sel on kg_fee_plans for select using (kg_is_member(tenant_id));
create policy fp_all on kg_fee_plans for all using (kg_is_finance(tenant_id)) with check (kg_is_finance(tenant_id));

create policy cf_sel on kg_child_fees for select using (kg_is_finance(tenant_id) or kg_is_parent_of(child_id));
create policy cf_all on kg_child_fees for all using (kg_is_finance(tenant_id)) with check (kg_is_finance(tenant_id));

create policy inv_sel on kg_invoices for select using (kg_is_finance(tenant_id) or kg_is_parent_of(child_id));
create policy inv_all on kg_invoices for all using (kg_is_finance(tenant_id)) with check (kg_is_finance(tenant_id));

create policy ii_sel on kg_invoice_items for select using (kg_is_finance(tenant_id) or kg_is_parent_of_invoice(invoice_id));
create policy ii_all on kg_invoice_items for all using (kg_is_finance(tenant_id)) with check (kg_is_finance(tenant_id));

create policy pay_sel on kg_payments for select using (kg_is_finance(tenant_id) or (child_id is not null and kg_is_parent_of(child_id)));
create policy pay_all on kg_payments for all using (kg_is_finance(tenant_id)) with check (kg_is_finance(tenant_id));

create policy tc_all on kg_txn_categories for all using (kg_is_finance(tenant_id)) with check (kg_is_finance(tenant_id));
create policy tx_all on kg_transactions for all using (kg_is_finance(tenant_id)) with check (kg_is_finance(tenant_id));
create policy prr_all on kg_payroll_runs for all using (kg_is_finance(tenant_id)) with check (kg_is_finance(tenant_id));

create policy pri_sel on kg_payroll_items for select using (kg_is_finance(tenant_id) or kg_is_my_membership(membership_id));
create policy pri_all on kg_payroll_items for all using (kg_is_finance(tenant_id)) with check (kg_is_finance(tenant_id));

create policy sa_sel on kg_salary_advances for select using (kg_is_finance(tenant_id) or kg_is_my_membership(membership_id));
create policy sa_all on kg_salary_advances for all using (kg_is_finance(tenant_id)) with check (kg_is_finance(tenant_id));

create policy ann_sel on kg_announcements for select using (kg_is_member(tenant_id));
create policy ann_all on kg_announcements for all using (kg_is_educator(tenant_id)) with check (kg_is_educator(tenant_id));

create policy th_sel on kg_threads for select using (kg_can_see_thread(id));
create policy th_ins on kg_threads for insert with check (kg_is_member(tenant_id) and created_by = auth.uid());
create policy th_upd on kg_threads for update using (kg_is_staff(tenant_id) or created_by = auth.uid());

create policy tm_sel on kg_thread_messages for select using (kg_can_see_thread(thread_id));
create policy tm_ins on kg_thread_messages for insert with check (kg_can_see_thread(thread_id) and sender_id = auth.uid());

create policy dr_sel on kg_daily_reports for select using (kg_is_staff(tenant_id) or (published and kg_is_parent_of(child_id)));
create policy dr_all on kg_daily_reports for all using (kg_is_educator(tenant_id)) with check (kg_is_educator(tenant_id));

create policy ev_sel on kg_events for select using (kg_is_member(tenant_id));
create policy ev_all on kg_events for all using (kg_is_educator(tenant_id)) with check (kg_is_educator(tenant_id));

create policy n_sel on kg_notifications for select using (user_id = auth.uid());
create policy n_upd on kg_notifications for update using (user_id = auth.uid());
create policy n_ins on kg_notifications for insert with check (kg_is_staff(tenant_id));

create policy al_sel on kg_audit_log for select using (kg_is_admin(tenant_id));
create policy al_ins on kg_audit_log for insert with check (kg_is_member(tenant_id));

create policy inc_sel on kg_incidents for select using (kg_is_staff(tenant_id) or kg_is_parent_of(child_id));
create policy inc_ins on kg_incidents for insert with check (kg_is_educator(tenant_id));
create policy inc_upd on kg_incidents for update using (kg_is_educator(tenant_id));

create policy con_sel on kg_consents for select using (kg_is_staff(tenant_id) or kg_is_parent_of(child_id));
create policy con_ins on kg_consents for insert with check (kg_is_educator(tenant_id) or kg_is_parent_of(child_id));
create policy con_upd on kg_consents for update using (kg_is_educator(tenant_id) or kg_is_parent_of(child_id));

create policy td_all on kg_tenant_documents for all using (kg_is_admin(tenant_id)) with check (kg_is_admin(tenant_id));

create policy lr_sel on kg_leave_requests for select using (kg_is_admin(tenant_id) or kg_is_my_membership(membership_id));
create policy lr_ins on kg_leave_requests for insert with check (kg_is_staff(tenant_id) and kg_is_my_membership(membership_id));
create policy lr_upd on kg_leave_requests for update using (kg_is_admin(tenant_id) or (kg_is_my_membership(membership_id) and status = 'pending'));

create policy mn_sel on kg_menus for select using (kg_is_member(tenant_id));
create policy mn_all on kg_menus for all using (kg_is_educator(tenant_id)) with check (kg_is_educator(tenant_id));

create policy h_sel on kg_holidays for select using (kg_is_member(tenant_id));
create policy h_all on kg_holidays for all using (kg_is_admin(tenant_id)) with check (kg_is_admin(tenant_id));
