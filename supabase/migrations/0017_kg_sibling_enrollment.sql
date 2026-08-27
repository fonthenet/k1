-- Existing parents enrolling another child (a sibling).
--
-- Deliberately NOT a second admissions path: a sibling application becomes an
-- ordinary kg_applications row, so it lands in the same /applications pipeline
-- staff already work, inherits the same stages, waitlist and approval RPC, and
-- fires the same "new application" notification to owner/admin.
--
-- Two things had to change to make that safe.

-- ── 1. Approval must LINK an existing guardian, never duplicate one ──────
-- kg_approve_application always INSERTed every guardian in the payload. For a
-- sibling that produced a second row for the same parent: contact details then
-- drift per child, the family fragments, and the one-family-one-balance model
-- breaks. Now: match the applicant by user_id, otherwise match by normalised
-- phone inside the tenant, and only insert when neither finds anyone.
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
    v_guardian := null;

    -- Same signed-in parent as an existing guardian in this tenant?
    if coalesce((g->>'is_applicant')::boolean, false) and a.applicant_user_id is not null then
      select id into v_guardian from kg_guardians
       where tenant_id = a.tenant_id and user_id = a.applicant_user_id
       limit 1;
    end if;

    -- Otherwise the same phone number is the same person (spaces/dashes ignored).
    if v_guardian is null and coalesce(g->>'phone','') <> '' then
      select id into v_guardian from kg_guardians
       where tenant_id = a.tenant_id
         and regexp_replace(coalesce(phone,''), '[^0-9]', '', 'g')
           = regexp_replace(g->>'phone', '[^0-9]', '', 'g')
       limit 1;
    end if;

    if v_guardian is null then
      insert into kg_guardians (tenant_id, user_id, first_name, last_name, first_name_ar, last_name_ar,
          relationship, phone, phone_alt, email, national_id, address, workplace, photo_path)
        values (a.tenant_id,
          case when coalesce((g->>'is_applicant')::boolean, false) then a.applicant_user_id else null end,
          g->>'first_name', g->>'last_name', g->>'first_name_ar', g->>'last_name_ar',
          coalesce((g->>'relationship')::kg_relationship, 'guardian'),
          coalesce(g->>'phone',''), g->>'phone_alt', g->>'email', g->>'national_id',
          g->>'address', g->>'workplace', g->>'photo_path')
        returning id into v_guardian;
    else
      -- Known guardian: adopt the account link if they had none before.
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

  if a.applicant_user_id is not null then
    insert into kg_memberships (tenant_id, user_id, role)
      values (a.tenant_id, a.applicant_user_id, 'parent')
      on conflict (tenant_id, user_id) do nothing;
  end if;

  update kg_applications set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(), created_child_id = v_child
    where id = p_app;
  return v_child;
end $$;

-- ── 2. A signed-in parent can apply without an enrolment link ────────────
-- kg_submit_application requires a public link token, which an existing family
-- should not have to hunt for. This variant authorises on membership instead,
-- and builds the guardian payload from their OWN record so the sibling links
-- back to the same family rather than to re-typed details.
create or replace function kg_submit_sibling_application(
  p_tenant uuid, p_child jsonb, p_health jsonb default '{}'::jsonb,
  p_activity_ids jsonb default '[]'::jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_g kg_guardians; v_app uuid; v_guardians jsonb;
begin
  if v_uid is null then raise exception 'auth required'; end if;

  -- Must already be a parent in this tenant.
  if not exists (
    select 1 from kg_memberships m
    where m.tenant_id = p_tenant and m.user_id = v_uid and m.status = 'active'
  ) then
    raise exception 'forbidden';
  end if;

  select * into v_g from kg_guardians
   where tenant_id = p_tenant and user_id = v_uid limit 1;
  if v_g.id is null then raise exception 'no_guardian_record'; end if;

  v_guardians := jsonb_build_array(jsonb_build_object(
    'first_name', v_g.first_name, 'last_name', v_g.last_name,
    'first_name_ar', v_g.first_name_ar, 'last_name_ar', v_g.last_name_ar,
    'relationship', v_g.relationship, 'phone', v_g.phone, 'phone_alt', v_g.phone_alt,
    'email', v_g.email, 'national_id', v_g.national_id, 'address', v_g.address,
    'workplace', v_g.workplace,
    'is_applicant', true, 'is_primary', true, 'is_financial', true, 'can_pickup', true
  ));

  insert into kg_applications (tenant_id, applicant_user_id, status, child, guardians, health, activity_ids, source)
    values (p_tenant, v_uid, 'submitted', p_child, v_guardians,
            coalesce(p_health,'{}'::jsonb), coalesce(p_activity_ids,'[]'::jsonb), 'sibling')
    returning id into v_app;
  return v_app;
end $$;

grant execute on function kg_submit_sibling_application(uuid, jsonb, jsonb, jsonb) to authenticated;
