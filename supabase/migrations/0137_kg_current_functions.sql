-- 0137 — the current definition of every function that was rewritten more
--        than once while structures and billing were being built.
--
-- Replaying five successive versions of kg_create_tenant on a fresh database
-- would land in the right place and teach a reader nothing. This file installs
-- the version that is actually live. The reasoning behind each one lives in
-- the migration that introduced it.
--
-- NOTE FOR ANYONE RENAMING A COLUMN LATER: ALTER TABLE ... RENAME does NOT
-- re-check function bodies. Five of these compiled perfectly while still
-- naming section_id and would have thrown at the first call — signup, the
-- public form, submission, approval and the billing run. After any rename,
-- query pg_get_functiondef for the old name before believing you are done.

-- ── signup ──────────────────────────────────────────────────────────────────
create or replace function kg_create_tenant(
  p_name text, p_slug text, p_phone text default null,
  p_wilaya text default 'Jijel', p_commune text default null,
  p_center_types kg_center_type[] default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid; v_uid uuid := auth.uid();
  v_types kg_center_type[]; v_type kg_center_type;
  v_i int := 0; v_plan uuid; v_trial_days constant int := 14; v_multi boolean;
begin
  if v_uid is null then raise exception 'auth required'; end if;
  if exists (select 1 from kg_tenants
     where lower(btrim(name)) = lower(btrim(p_name))
       and lower(btrim(coalesce(wilaya, ''))) = lower(btrim(coalesce(p_wilaya, '')))) then
    raise exception 'name_taken' using errcode = 'unique_violation';
  end if;
  if exists (select 1 from kg_tenants where slug = p_slug) then
    raise exception 'slug_taken' using errcode = 'unique_violation';
  end if;

  -- Deduplicated and never empty: a founder who ticks nothing still gets a
  -- working establishment rather than one with no structure at all.
  select coalesce(array_agg(distinct x), array['kindergarten'::kg_center_type])
    into v_types
    from unnest(coalesce(nullif(p_center_types, '{}'), array['kindergarten'::kg_center_type])) x;
  v_multi := array_length(v_types, 1) > 1;

  insert into kg_tenants (name, slug, phone, wilaya, commune, default_locale, center_type)
    values (p_name, p_slug, p_phone, p_wilaya, p_commune, 'ar', v_types[1])
    returning id into v_tenant;
  insert into kg_memberships (tenant_id, user_id, role) values (v_tenant, v_uid, 'owner');
  perform kg_bootstrap_profile(v_uid);

  -- One structure per vertical ticked. A single tick is named after the
  -- establishment — indistinguishable from having no structures at all, which
  -- is the point. Their enrolment links come from trg_kg_structures_enroll_link.
  foreach v_type in array v_types loop
    insert into kg_structures (tenant_id, name, name_ar, center_type, sort_order)
    values (v_tenant,
            case when v_multi then v_type::text else p_name end,
            case when v_multi then null else p_name end,
            v_type, v_i);
    v_i := v_i + 1;
  end loop;

  select id into v_plan from kg_plans where active and code = 'pro';
  if v_plan is null then
    select id into v_plan from kg_plans where active order by sort_order limit 1;
  end if;
  insert into kg_subscriptions (tenant_id, plan_id, status, trial_ends_at,
                                current_period_start, current_period_end)
    values (v_tenant, v_plan, 'trialing', current_date + v_trial_days,
            current_date, current_date + v_trial_days);

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
  return v_tenant;
end $$;
revoke all on function kg_create_tenant(text, text, text, text, text, kg_center_type[]) from public, anon;
grant execute on function kg_create_tenant(text, text, text, text, text, kg_center_type[]) to authenticated;

-- ── the public enrolment form ───────────────────────────────────────────────
create or replace function kg_get_enroll_link(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  select jsonb_build_object(
    'tenant_id', t.id, 'tenant_name', t.name, 'logo_url', t.logo_url,
    'wilaya', t.wilaya, 'commune', t.commune,
    'address', t.address, 'latitude', t.latitude, 'longitude', t.longitude,
    'link_id', l.id, 'label', l.label,
    'structure_id', l.structure_id,
    'structure_name', (select s.name from kg_structures s where s.id = l.structure_id),
    'structure_name_ar', (select s.name_ar from kg_structures s where s.id = l.structure_id),
    'activities', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'name_ar', a.name_ar,
        'category', a.category, 'fee_amount', a.fee_amount, 'fee_period', a.fee_period,
        'description', a.description))
      from kg_activities a where a.tenant_id = t.id and a.active
    ), '[]'::jsonb),
    'fee_plans', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'name_ar', p.name_ar,
        'amount', p.amount, 'description', p.description) order by p.amount)
      from kg_fee_plans p where p.tenant_id = t.id and p.active and p.period = 'monthly'
    ), '[]'::jsonb),
    'admission_fees', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'name_ar', p.name_ar,
        'amount', p.amount) order by p.amount desc)
      from kg_fee_plans p where p.tenant_id = t.id and p.active and p.period = 'once' and p.amount > 0
    ), '[]'::jsonb),
    -- A link with no structure lists the whole building, which is what every
    -- link did before structures existed and is right for a one-structure crèche.
    'classes', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'name_ar', c.name_ar,
        'age_min_months', c.age_min_months, 'age_max_months', c.age_max_months)
        order by c.age_min_months nulls last, c.name)
      from kg_classes c
      where c.tenant_id = t.id
        and (l.structure_id is null or c.structure_id = l.structure_id)
    ), '[]'::jsonb)
  ) into r
  from kg_enroll_links l join kg_tenants t on t.id = l.tenant_id
  where l.token = p_token and l.active
    and (l.expires_at is null or l.expires_at > now())
    and (l.max_uses is null or l.use_count < l.max_uses);
  if r is null then raise exception 'invalid_link'; end if;
  return r;
end $$;

-- ── submission ──────────────────────────────────────────────────────────────
create or replace function kg_submit_application(
  p_token text, p_child jsonb, p_guardians jsonb, p_health jsonb,
  p_activity_ids jsonb default '[]'::jsonb,
  p_fee_plan_id uuid default null,
  p_class_id uuid default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_link kg_enroll_links; v_app uuid; v_uid uuid := auth.uid(); v_ok boolean;
  v_activities jsonb;
begin
  if v_uid is null then raise exception 'auth required'; end if;
  select * into v_link from kg_enroll_links
    where token = p_token and active
      and (expires_at is null or expires_at > now())
      and (max_uses is null or use_count < max_uses);
  if v_link.id is null then raise exception 'invalid_link'; end if;

  -- Every id below is DROPPED rather than raised when it does not check out:
  -- a rejected submission costs the family the whole form they just spent ten
  -- minutes on; a dropped preference costs the reviewer one dropdown.
  if p_fee_plan_id is not null then
    select exists (select 1 from kg_fee_plans
      where id = p_fee_plan_id and tenant_id = v_link.tenant_id
        and active and period = 'monthly') into v_ok;
    if not v_ok then p_fee_plan_id := null; end if;
  end if;

  if p_class_id is not null then
    select exists (select 1 from kg_classes
      where id = p_class_id and tenant_id = v_link.tenant_id
        and (v_link.structure_id is null or structure_id = v_link.structure_id)) into v_ok;
    if not v_ok then p_class_id := null; end if;
  end if;

  -- The regex guard means a malformed uuid cannot abort the submission with a
  -- cast error either.
  select coalesce(jsonb_agg(to_jsonb(a.id)), '[]'::jsonb) into v_activities
    from kg_activities a
   where a.tenant_id = v_link.tenant_id and a.active
     and a.id::text in (
       select x from jsonb_array_elements_text(coalesce(p_activity_ids, '[]'::jsonb)) x
        where x ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     );

  insert into kg_applications (tenant_id, link_id, applicant_user_id, child, guardians,
                               health, activity_ids, fee_plan_id, class_id, structure_id)
    values (v_link.tenant_id, v_link.id, v_uid, p_child, p_guardians, p_health,
            v_activities, p_fee_plan_id, p_class_id, v_link.structure_id)
    returning id into v_app;
  update kg_enroll_links set use_count = use_count + 1 where id = v_link.id;
  insert into kg_profiles (id, full_name, phone)
    values (v_uid, coalesce(p_guardians->0->>'first_name','') || ' ' ||
                   coalesce(p_guardians->0->>'last_name',''), p_guardians->0->>'phone')
    on conflict (id) do update set phone = coalesce(excluded.phone, kg_profiles.phone);
  return v_app;
end $$;
revoke all on function kg_submit_application(text, jsonb, jsonb, jsonb, jsonb, uuid, uuid) from public, anon;
grant execute on function kg_submit_application(text, jsonb, jsonb, jsonb, jsonb, uuid, uuid) to authenticated;

-- ── approval ────────────────────────────────────────────────────────────────
create or replace function kg_approve_application(
  p_app uuid, p_class uuid default null, p_tag_code text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare a kg_applications; v_child uuid; v_guardian uuid; g jsonb; al jsonb; act text;
begin
  select * into a from kg_applications where id = p_app;
  if a.id is null then raise exception 'not_found'; end if;
  if not kg_is_admin(a.tenant_id) then raise exception 'forbidden'; end if;
  if a.status = 'approved' then raise exception 'already_approved'; end if;

  -- a.structure_id is the FALLBACK: trg_kg_children_structure_sync overrides it
  -- from the class whenever one is given. Approving with "no class for now" is
  -- common, and such a child was landing on neither side of the regulatory
  -- split — missing from both inspection registers.
  insert into kg_children (tenant_id, class_id, structure_id, first_name, last_name,
      first_name_ar, last_name_ar, dob, gender, photo_path, blood_type, status, tag_code, notes)
    values (a.tenant_id, p_class, a.structure_id,
      a.child->>'first_name', a.child->>'last_name', a.child->>'first_name_ar', a.child->>'last_name_ar',
      (a.child->>'dob')::date, (a.child->>'gender')::kg_gender, a.child->>'photo_path',
      a.child->>'blood_type', 'enrolled', p_tag_code, a.child->>'notes')
    returning id into v_child;

  for g in select * from jsonb_array_elements(a.guardians) loop
    v_guardian := null;
    if coalesce((g->>'is_applicant')::boolean, false) and a.applicant_user_id is not null then
      select id into v_guardian from kg_guardians
       where tenant_id = a.tenant_id and user_id = a.applicant_user_id limit 1;
    end if;
    if v_guardian is null and coalesce(g->>'phone','') <> '' then
      select id into v_guardian from kg_guardians
       where tenant_id = a.tenant_id
         and regexp_replace(coalesce(phone,''), '[^0-9]', '', 'g')
           = regexp_replace(g->>'phone', '[^0-9]', '', 'g') limit 1;
    end if;
    if v_guardian is null then
      insert into kg_guardians (tenant_id, user_id, first_name, last_name, first_name_ar,
          last_name_ar, relationship, phone, phone_alt, email, national_id, address,
          workplace, photo_path)
        values (a.tenant_id,
          case when coalesce((g->>'is_applicant')::boolean, false) then a.applicant_user_id else null end,
          g->>'first_name', g->>'last_name', g->>'first_name_ar', g->>'last_name_ar',
          coalesce((g->>'relationship')::kg_relationship, 'guardian'),
          coalesce(g->>'phone',''), g->>'phone_alt', g->>'email', g->>'national_id',
          g->>'address', g->>'workplace', g->>'photo_path')
        returning id into v_guardian;
    else
      update kg_guardians
         set user_id = coalesce(user_id,
               case when coalesce((g->>'is_applicant')::boolean, false) then a.applicant_user_id end)
       where id = v_guardian;
    end if;
    insert into kg_child_guardians (child_id, guardian_id, is_primary, can_pickup, is_financial)
      values (v_child, v_guardian,
        coalesce((g->>'is_primary')::boolean, false),
        coalesce((g->>'can_pickup')::boolean, true),
        coalesce((g->>'is_financial')::boolean, false))
      on conflict do nothing;
  end loop;

  insert into kg_child_health (child_id, medical_conditions, medications, vaccinations,
      dietary_restrictions, special_needs, doctor_name, doctor_phone, emergency_notes)
    values (v_child,
      coalesce(a.health->'medical_conditions','[]'::jsonb), coalesce(a.health->'medications','[]'::jsonb),
      coalesce(a.health->'vaccinations','[]'::jsonb), a.health->>'dietary_restrictions',
      a.health->>'special_needs', a.health->>'doctor_name', a.health->>'doctor_phone',
      a.health->>'emergency_notes');

  for al in select * from jsonb_array_elements(coalesce(a.health->'allergies','[]'::jsonb)) loop
    insert into kg_child_allergies (tenant_id, child_id, allergen, severity, reaction, action_plan)
      values (a.tenant_id, v_child, al->>'allergen',
        coalesce((al->>'severity')::kg_allergy_severity,'mild'), al->>'reaction', al->>'action_plan')
      on conflict (child_id, lower(btrim(allergen))) do nothing;
  end loop;

  for act in select jsonb_array_elements_text(a.activity_ids) loop
    insert into kg_activity_enrollments (tenant_id, activity_id, child_id, status)
      values (a.tenant_id, act::uuid, v_child, 'active')
      on conflict do nothing;
  end loop;

  if a.applicant_user_id is not null then
    insert into kg_memberships (tenant_id, user_id, role)
      values (a.tenant_id, a.applicant_user_id, 'parent')
      on conflict (tenant_id, user_id) do nothing;
  end if;

  update kg_applications set status = 'approved', reviewed_by = auth.uid(),
         reviewed_at = now(), created_child_id = v_child
    where id = p_app;
  return v_child;
end $$;

-- ── the monthly billing cycle ───────────────────────────────────────────────
-- Idempotent: safe to run twice on the same day, by cron, by a button or by
-- hand after a bad night. The unique index on (tenant_id, period_start) is the
-- backstop. A crèche is not switched off the morning an invoice falls due —
-- a transfer takes days and a slip has to be photographed — hence the grace.
create or replace function kg_platform_billing_run(
  p_grace_days int default 14, p_due_days int default 15
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_issued int := 0; v_overdue int := 0; v_suspended int := 0; v_qty int; r record;
begin
  if not kg_is_platform_admin() then raise exception 'forbidden'; end if;

  for r in
    select s.*, p.price_monthly, p.currency
      from kg_subscriptions s join kg_plans p on p.id = s.plan_id
     where s.status in ('trialing', 'active', 'past_due')
       and s.current_period_end is not null and s.current_period_end <= current_date
       and (s.cancel_at is null or s.cancel_at > current_date)
  loop
    v_qty := kg_billable_structures(r.tenant_id);
    insert into kg_platform_invoices
      (tenant_id, subscription_id, period_start, period_end, quantity, amount, currency, due_date)
    values
      (r.tenant_id, r.id, r.current_period_end, (r.current_period_end + interval '1 month')::date,
       v_qty, r.price_monthly * v_qty, r.currency, current_date + p_due_days)
    on conflict (tenant_id, period_start) do nothing;
    if found then v_issued := v_issued + 1; end if;

    update kg_subscriptions
       set status = case when status = 'trialing' then 'active'::kg_subscription_status else status end,
           current_period_start = r.current_period_end,
           current_period_end = (r.current_period_end + interval '1 month')::date
     where id = r.id;
  end loop;

  update kg_subscriptions s set status = 'past_due'
   where s.status = 'active'
     and exists (select 1 from kg_platform_invoices i
                  where i.subscription_id = s.id and i.status = 'unpaid'
                    and i.due_date < current_date);
  get diagnostics v_overdue = row_count;

  for r in
    select s.id, s.tenant_id from kg_subscriptions s
     where s.status = 'past_due'
       and exists (select 1 from kg_platform_invoices i
                    where i.subscription_id = s.id and i.status = 'unpaid'
                      and i.due_date < current_date - p_grace_days)
  loop
    update kg_subscriptions set status = 'suspended' where id = r.id;
    update kg_tenants set status = 'suspended' where id = r.tenant_id;
    v_suspended := v_suspended + 1;
  end loop;

  return jsonb_build_object('issued', v_issued, 'past_due', v_overdue, 'suspended', v_suspended);
end $$;
revoke all on function kg_platform_billing_run(int, int) from public, anon;
grant execute on function kg_platform_billing_run(int, int) to authenticated;

-- Paying reopens the doors by itself: leaving that to the platform owner to
-- remember means a crèche that paid on Friday stays locked out all weekend
-- with children arriving on Sunday.
create or replace function kg_platform_reinstate()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_tenant uuid; v_outstanding int;
begin
  select tenant_id into v_tenant from kg_platform_invoices where id = new.id;
  select count(*) into v_outstanding from kg_platform_invoices
   where tenant_id = v_tenant and status = 'unpaid' and due_date < current_date;

  if v_outstanding = 0 then
    update kg_subscriptions set status = 'active'
     where tenant_id = v_tenant and status in ('past_due', 'suspended');
    -- Only lift a suspension this system imposed. A tenant switched off by
    -- hand for another reason stays off.
    update kg_tenants t set status = 'active'
     where t.id = v_tenant and t.status = 'suspended'
       and exists (select 1 from kg_subscriptions s
                    where s.tenant_id = t.id and s.status = 'active');
  end if;
  return null;
end $$;

drop trigger if exists trg_kg_platform_reinstate on kg_platform_invoices;
create trigger trg_kg_platform_reinstate after update of status on kg_platform_invoices
  for each row when (new.status = 'paid') execute function kg_platform_reinstate();

revoke all on function kg_platform_reinstate() from public, anon, authenticated;
