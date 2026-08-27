-- Business-logic RPCs (security definer, validate authorization internally)

-- Create a tenant + owner membership + sensible defaults (signup flow)
create or replace function kg_create_tenant(p_name text, p_slug text, p_phone text default null, p_wilaya text default 'Jijel')
returns uuid language plpgsql security definer set search_path = public as $$
declare v_tenant uuid; v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'auth required'; end if;
  insert into kg_tenants (name, slug, phone, wilaya)
    values (p_name, p_slug, p_phone, p_wilaya) returning id into v_tenant;
  insert into kg_memberships (tenant_id, user_id, role) values (v_tenant, v_uid, 'owner');
  insert into kg_profiles (id, full_name)
    values (v_uid, coalesce((select raw_user_meta_data->>'full_name' from auth.users where id = v_uid), ''))
    on conflict (id) do nothing;
  insert into kg_txn_categories (tenant_id, name, kind, is_system, color) values
    (v_tenant, 'Scolarité', 'income', true, '#22c55e'),
    (v_tenant, 'Frais d''inscription', 'income', true, '#10b981'),
    (v_tenant, 'Activités', 'income', true, '#14b8a6'),
    (v_tenant, 'Autres revenus', 'income', true, '#84cc16'),
    (v_tenant, 'Salaires', 'expense', true, '#ef4444'),
    (v_tenant, 'Loyer', 'expense', true, '#f97316'),
    (v_tenant, 'Alimentation', 'expense', true, '#f59e0b'),
    (v_tenant, 'Fournitures', 'expense', true, '#eab308'),
    (v_tenant, 'Entretien', 'expense', true, '#a855f7'),
    (v_tenant, 'Transport', 'expense', true, '#8b5cf6'),
    (v_tenant, 'Autres dépenses', 'expense', true, '#64748b');
  insert into kg_holidays (tenant_id, date, name, name_ar, tentative) values
    (v_tenant, date '2027-01-01', 'Jour de l''an', 'رأس السنة الميلادية', false),
    (v_tenant, date '2027-01-12', 'Yennayer', 'يناير', false),
    (v_tenant, date '2026-11-01', 'Anniversaire de la Révolution', 'عيد الثورة', false),
    (v_tenant, date '2027-05-01', 'Fête du travail', 'عيد العمال', false),
    (v_tenant, date '2027-07-05', 'Fête de l''indépendance', 'عيد الاستقلال', false);
  return v_tenant;
end $$;

-- Public info for an enrollment link (called by anon/parents from the public page)
create or replace function kg_get_enroll_link(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  select jsonb_build_object(
    'tenant_id', t.id, 'tenant_name', t.name, 'logo_url', t.logo_url,
    'wilaya', t.wilaya, 'commune', t.commune, 'link_id', l.id, 'label', l.label,
    'activities', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'name_ar', a.name_ar,
        'category', a.category, 'fee_amount', a.fee_amount, 'fee_period', a.fee_period, 'description', a.description))
      from kg_activities a where a.tenant_id = t.id and a.active
    ), '[]'::jsonb)
  ) into r
  from kg_enroll_links l join kg_tenants t on t.id = l.tenant_id
  where l.token = p_token and l.active
    and (l.expires_at is null or l.expires_at > now())
    and (l.max_uses is null or l.use_count < l.max_uses);
  if r is null then raise exception 'invalid_link'; end if;
  return r;
end $$;

-- Parent submits an application through an enrollment link
create or replace function kg_submit_application(p_token text, p_child jsonb, p_guardians jsonb, p_health jsonb, p_activity_ids jsonb default '[]'::jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_link kg_enroll_links; v_app uuid; v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'auth required'; end if;
  select * into v_link from kg_enroll_links
    where token = p_token and active
      and (expires_at is null or expires_at > now())
      and (max_uses is null or use_count < max_uses);
  if v_link.id is null then raise exception 'invalid_link'; end if;
  insert into kg_applications (tenant_id, link_id, applicant_user_id, child, guardians, health, activity_ids)
    values (v_link.tenant_id, v_link.id, v_uid, p_child, p_guardians, p_health, p_activity_ids)
    returning id into v_app;
  update kg_enroll_links set use_count = use_count + 1 where id = v_link.id;
  insert into kg_profiles (id, full_name, phone)
    values (v_uid, coalesce(p_guardians->0->>'first_name','') || ' ' || coalesce(p_guardians->0->>'last_name',''), p_guardians->0->>'phone')
    on conflict (id) do update set phone = coalesce(excluded.phone, kg_profiles.phone);
  return v_app;
end $$;

-- Admin approves an application: creates child + guardians + health + activities in one shot
create or replace function kg_approve_application(p_app uuid, p_class uuid default null, p_tag_code text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare a kg_applications; v_child uuid; v_guardian uuid; g jsonb; al jsonb; act text;
begin
  select * into a from kg_applications where id = p_app;
  if a.id is null then raise exception 'not_found'; end if;
  if not kg_is_admin(a.tenant_id) then raise exception 'forbidden'; end if;
  if a.status = 'approved' then raise exception 'already_approved'; end if;

  insert into kg_children (tenant_id, class_id, first_name, last_name, first_name_ar, last_name_ar,
      dob, gender, photo_path, blood_type, status, tag_code, notes)
    values (a.tenant_id, p_class,
      a.child->>'first_name', a.child->>'last_name', a.child->>'first_name_ar', a.child->>'last_name_ar',
      (a.child->>'dob')::date, (a.child->>'gender')::kg_gender, a.child->>'photo_path',
      a.child->>'blood_type', 'enrolled', p_tag_code, a.child->>'notes')
    returning id into v_child;

  for g in select * from jsonb_array_elements(a.guardians) loop
    insert into kg_guardians (tenant_id, user_id, first_name, last_name, first_name_ar, last_name_ar,
        relationship, phone, phone_alt, email, national_id, address, workplace, photo_path)
      values (a.tenant_id,
        case when coalesce((g->>'is_applicant')::boolean, false) then a.applicant_user_id else null end,
        g->>'first_name', g->>'last_name', g->>'first_name_ar', g->>'last_name_ar',
        coalesce((g->>'relationship')::kg_relationship, 'guardian'),
        coalesce(g->>'phone',''), g->>'phone_alt', g->>'email', g->>'national_id',
        g->>'address', g->>'workplace', g->>'photo_path')
      returning id into v_guardian;
    insert into kg_child_guardians (child_id, guardian_id, is_primary, can_pickup, is_financial)
      values (v_child, v_guardian,
        coalesce((g->>'is_primary')::boolean, false),
        coalesce((g->>'can_pickup')::boolean, true),
        coalesce((g->>'is_financial')::boolean, false));
  end loop;

  insert into kg_child_health (child_id, medical_conditions, medications, vaccinations, dietary_restrictions, special_needs, doctor_name, doctor_phone, emergency_notes)
    values (v_child,
      coalesce(a.health->'medical_conditions','[]'::jsonb), coalesce(a.health->'medications','[]'::jsonb),
      coalesce(a.health->'vaccinations','[]'::jsonb), a.health->>'dietary_restrictions',
      a.health->>'special_needs', a.health->>'doctor_name', a.health->>'doctor_phone', a.health->>'emergency_notes');

  for al in select * from jsonb_array_elements(coalesce(a.health->'allergies','[]'::jsonb)) loop
    insert into kg_child_allergies (tenant_id, child_id, allergen, severity, reaction, action_plan)
      values (a.tenant_id, v_child, al->>'allergen',
        coalesce((al->>'severity')::kg_allergy_severity,'mild'), al->>'reaction', al->>'action_plan');
  end loop;

  for act in select jsonb_array_elements_text(a.activity_ids) loop
    insert into kg_activity_enrollments (tenant_id, activity_id, child_id, status)
      values (a.tenant_id, act::uuid, v_child, 'active')
      on conflict do nothing;
  end loop;

  -- Parent membership so the applicant sees the parent portal
  if a.applicant_user_id is not null then
    insert into kg_memberships (tenant_id, user_id, role)
      values (a.tenant_id, a.applicant_user_id, 'parent')
      on conflict (tenant_id, user_id) do nothing;
  end if;

  update kg_applications set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(), created_child_id = v_child
    where id = p_app;
  return v_child;
end $$;

-- Tag/kiosk check-in or check-out for a child
create or replace function kg_checkin_by_tag(p_tenant uuid, p_tag text, p_direction text default 'in', p_method kg_checkin_method default 'tag', p_picked_up_by text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_child kg_children; v_att kg_attendance;
begin
  if not kg_is_educator(p_tenant) then raise exception 'forbidden'; end if;
  select * into v_child from kg_children where tenant_id = p_tenant and tag_code = p_tag and status = 'enrolled';
  if v_child.id is null then raise exception 'unknown_tag'; end if;

  insert into kg_attendance (tenant_id, child_id, date, status, check_in_at, check_in_method, checked_in_by)
    values (p_tenant, v_child.id, current_date, 'present',
      case when p_direction = 'in' then now() end, case when p_direction = 'in' then p_method end,
      case when p_direction = 'in' then auth.uid() end)
    on conflict (child_id, date) do update set
      status = 'present',
      check_in_at = coalesce(kg_attendance.check_in_at, excluded.check_in_at),
      check_in_method = coalesce(kg_attendance.check_in_method, excluded.check_in_method),
      checked_in_by = coalesce(kg_attendance.checked_in_by, excluded.checked_in_by),
      check_out_at = case when p_direction = 'out' then now() else kg_attendance.check_out_at end,
      check_out_method = case when p_direction = 'out' then p_method else kg_attendance.check_out_method end,
      checked_out_by = case when p_direction = 'out' then auth.uid() else kg_attendance.checked_out_by end,
      picked_up_by = case when p_direction = 'out' then coalesce(p_picked_up_by, kg_attendance.picked_up_by) else kg_attendance.picked_up_by end
    returning * into v_att;

  return jsonb_build_object('child_id', v_child.id,
    'first_name', v_child.first_name, 'last_name', v_child.last_name, 'photo_path', v_child.photo_path,
    'direction', p_direction, 'at', case when p_direction = 'in' then v_att.check_in_at else v_att.check_out_at end);
end $$;

-- Staff clocks themselves in/out
create or replace function kg_staff_clock(p_tenant uuid, p_direction text default 'in', p_method kg_checkin_method default 'manual')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_m kg_memberships; v_ts kg_timesheets;
begin
  select * into v_m from kg_memberships
    where tenant_id = p_tenant and user_id = auth.uid() and status = 'active'
      and role in ('owner','admin','educator','staff','accountant');
  if v_m.id is null then raise exception 'forbidden'; end if;

  if p_direction = 'in' then
    insert into kg_timesheets (tenant_id, membership_id, date, clock_in_at, method)
      values (p_tenant, v_m.id, current_date, now(), p_method) returning * into v_ts;
  else
    select * into v_ts from kg_timesheets
      where membership_id = v_m.id and date = current_date and clock_out_at is null
      order by clock_in_at desc limit 1;
    if v_ts.id is null then raise exception 'not_clocked_in'; end if;
    update kg_timesheets set clock_out_at = now() where id = v_ts.id returning * into v_ts;
  end if;
  return to_jsonb(v_ts);
end $$;

-- Staff clock by staff tag/PIN at the kiosk (an educator device is signed in; identifies colleague by code)
create or replace function kg_staff_clock_by_code(p_tenant uuid, p_code text, p_direction text default 'in')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_m kg_memberships; v_ts kg_timesheets; v_name text;
begin
  if not kg_is_educator(p_tenant) then raise exception 'forbidden'; end if;
  select * into v_m from kg_memberships
    where tenant_id = p_tenant and status = 'active' and (staff_code = p_code or pin_code = p_code)
      and role in ('owner','admin','educator','staff','accountant');
  if v_m.id is null then raise exception 'unknown_code'; end if;
  select full_name into v_name from kg_profiles where id = v_m.user_id;

  if p_direction = 'in' then
    insert into kg_timesheets (tenant_id, membership_id, date, clock_in_at, method)
      values (p_tenant, v_m.id, current_date, now(), 'kiosk') returning * into v_ts;
  else
    select * into v_ts from kg_timesheets
      where membership_id = v_m.id and date = current_date and clock_out_at is null
      order by clock_in_at desc limit 1;
    if v_ts.id is null then raise exception 'not_clocked_in'; end if;
    update kg_timesheets set clock_out_at = now() where id = v_ts.id returning * into v_ts;
  end if;
  return to_jsonb(v_ts) || jsonb_build_object('staff_name', v_name);
end $$;

-- Parent acknowledges an incident report
create or replace function kg_ack_incident(p_incident uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v kg_incidents;
begin
  select * into v from kg_incidents where id = p_incident;
  if v.id is null or not kg_is_parent_of(v.child_id) then raise exception 'forbidden'; end if;
  update kg_incidents set parent_ack_at = now(), parent_ack_by = auth.uid() where id = p_incident and parent_ack_at is null;
end $$;

-- Accept a staff invite
create or replace function kg_accept_staff_invite(p_token text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v kg_staff_invites; v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'auth required'; end if;
  select * into v from kg_staff_invites where token = p_token and accepted_at is null and expires_at > now();
  if v.id is null then raise exception 'invalid_invite'; end if;
  insert into kg_memberships (tenant_id, user_id, role, job_title, status)
    values (v.tenant_id, v_uid, v.role, v.job_title, 'active')
    on conflict (tenant_id, user_id) do update set role = excluded.role, status = 'active';
  insert into kg_profiles (id) values (v_uid) on conflict (id) do nothing;
  update kg_staff_invites set accepted_at = now() where id = v.id;
  return v.tenant_id;
end $$;

-- Generate monthly tuition invoices from fee assignments (skips children already invoiced for the month)
create or replace function kg_generate_monthly_invoices(p_tenant uuid, p_month date)
returns int language plpgsql security definer set search_path = public as $$
declare v_count int := 0; r record; v_inv uuid; v_amount numeric;
begin
  if not kg_is_finance(p_tenant) then raise exception 'forbidden'; end if;
  for r in
    select cf.child_id, cf.fee_plan_id, cf.custom_amount, cf.discount_pct, fp.name as plan_name, fp.amount as plan_amount
    from kg_child_fees cf
    join kg_fee_plans fp on fp.id = cf.fee_plan_id and fp.period = 'monthly'
    join kg_children c on c.id = cf.child_id and c.status = 'enrolled'
    where cf.tenant_id = p_tenant
      and cf.start_date <= (date_trunc('month', p_month) + interval '1 month - 1 day')::date
      and (cf.end_date is null or cf.end_date >= date_trunc('month', p_month)::date)
      and not exists (
        select 1 from kg_invoices i
        where i.child_id = cf.child_id and i.period_month = date_trunc('month', p_month)::date and i.status <> 'void'
      )
  loop
    v_amount := round(coalesce(r.custom_amount, r.plan_amount) * (1 - r.discount_pct / 100.0), 2);
    insert into kg_invoices (tenant_id, child_id, period_month, issue_date, due_date, status, subtotal, discount, total, created_by)
      values (p_tenant, r.child_id, date_trunc('month', p_month)::date, current_date,
        (date_trunc('month', p_month) + interval '9 days')::date, 'unpaid',
        coalesce(r.custom_amount, r.plan_amount),
        coalesce(r.custom_amount, r.plan_amount) - v_amount, v_amount, auth.uid())
      returning id into v_inv;
    insert into kg_invoice_items (invoice_id, tenant_id, kind, description, qty, unit_amount, amount)
      values (v_inv, p_tenant, 'tuition',
        r.plan_name || ' — ' || to_char(p_month, 'MM/YYYY'), 1,
        coalesce(r.custom_amount, r.plan_amount), v_amount);
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

-- Dashboard aggregates in one round trip
create or replace function kg_dashboard_stats(p_tenant uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not kg_is_staff(p_tenant) then raise exception 'forbidden'; end if;
  return jsonb_build_object(
    'children_enrolled', (select count(*) from kg_children where tenant_id = p_tenant and status = 'enrolled'),
    'children_present', (select count(*) from kg_attendance where tenant_id = p_tenant and date = current_date and status = 'present' and check_in_at is not null and check_out_at is null),
    'children_checked_out', (select count(*) from kg_attendance where tenant_id = p_tenant and date = current_date and check_out_at is not null),
    'staff_present', (select count(distinct membership_id) from kg_timesheets where tenant_id = p_tenant and date = current_date and clock_in_at is not null and clock_out_at is null),
    'pending_applications', (select count(*) from kg_applications where tenant_id = p_tenant and status in ('submitted','under_review')),
    'unpaid_invoices', (select count(*) from kg_invoices where tenant_id = p_tenant and status in ('unpaid','partial','overdue')),
    'unpaid_total', coalesce((select sum(total - paid_amount) from kg_invoices where tenant_id = p_tenant and status in ('unpaid','partial','overdue')), 0),
    'mtd_income', coalesce((select sum(amount) from kg_transactions where tenant_id = p_tenant and kind = 'income' and date >= date_trunc('month', current_date)::date), 0),
    'mtd_expense', coalesce((select sum(amount) from kg_transactions where tenant_id = p_tenant and kind = 'expense' and date >= date_trunc('month', current_date)::date), 0)
  );
end $$;

-- Payments auto-sync: update invoice totals + mirror into the accounting ledger
create or replace function kg_on_payment_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_cat uuid;
begin
  if new.invoice_id is not null then
    update kg_invoices i set
      paid_amount = paid_amount + new.amount,
      status = case
        when paid_amount + new.amount >= total then 'paid'
        when paid_amount + new.amount > 0 then 'partial'
        else i.status end
      where i.id = new.invoice_id;
  end if;
  select id into v_cat from kg_txn_categories
    where tenant_id = new.tenant_id and kind = 'income' and is_system order by name limit 1;
  insert into kg_transactions (tenant_id, kind, category_id, amount, date, method, description, related_payment_id, created_by)
    values (new.tenant_id, 'income', v_cat, new.amount, new.paid_at::date, new.method,
      'Paiement ' || coalesce(new.receipt_number, ''), new.id, new.received_by);
  return new;
end $$;
create trigger trg_kg_payments_sync after insert on kg_payments
  for each row execute function kg_on_payment_insert();

grant execute on function kg_get_enroll_link(text) to anon, authenticated;
