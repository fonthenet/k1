-- 0114 — the live kg_approve_application matches no file in this directory.
--
-- ---------------------------------------------------------------------------
-- What is wrong
-- ---------------------------------------------------------------------------
--
-- 0061 added a unique index on (child_id, lower(btrim(allergen))) and wrote
-- kg_copy_application_allergies so the two approval paths would collapse a
-- repeated allergen instead of aborting. Its "(3)" step — making
-- kg_approve_application call that helper — was done by hand against
-- production: the live body has an inline `on conflict (child_id,
-- lower(btrim(allergen))) do nothing` loop that appears in no migration.
-- The last file to define the function is 0017, whose allergy loop is a
-- plain insert.
--
-- So a replay of this directory — a fresh project, a point-in-time restore,
-- a staging database — ends with 0017's function and 0061's index, and the
-- next application that lists "Milk / Mild" twice (the real payload that
-- prompted 0061) raises unique_violation inside the approval and rolls the
-- whole enrolment back.
--
-- ---------------------------------------------------------------------------
-- The fix
-- ---------------------------------------------------------------------------
--
-- The live definition, reconstructed from pg_get_functiondef on 2026-09-02,
-- with the hand-patched loop replaced by the call 0061 intended. Behaviour is
-- identical: kg_copy_application_allergies skips blank allergens and collapses
-- duplicates the same way. 0063's revoke is re-asserted, because a `create or
-- replace` keeps existing grants but a drop-and-create somewhere in a replay
-- would not.
--
-- Idempotent: running it twice yields the same function and the same grants.

begin;

/* ---------------------------------------------------------- prerequisite

   kg_approve_application calls kg_copy_application_allergies, and that
   function is NOT in production: schema_migrations lists 0061 as applied and
   its kg_child_allergies unique index is present, but the function itself is
   absent — it was dropped or never created when 0061 ran. Reconstructing the
   approval path without it would make this file fail on the first approval,
   after the child row had already been written.

   Restored verbatim from 0061 so the two files cannot drift, and revoked from
   the API roles: it is called only from inside kg_approve_application, which
   is itself SECURITY DEFINER.                                             */

create or replace function kg_copy_application_allergies(
  p_tenant uuid, p_child uuid, p_health jsonb
) returns void language plpgsql security definer set search_path = public as $$
declare al jsonb;
begin
  for al in select * from jsonb_array_elements(coalesce(p_health->'allergies','[]'::jsonb)) loop
    if coalesce(btrim(al->>'allergen'), '') = '' then continue; end if;
    insert into kg_child_allergies (tenant_id, child_id, allergen, severity, reaction, action_plan)
      values (p_tenant, p_child, btrim(al->>'allergen'),
        coalesce((al->>'severity')::kg_allergy_severity,'mild'),
        al->>'reaction', al->>'action_plan')
      on conflict (child_id, lower(btrim(allergen))) do nothing;
  end loop;
end $$;

revoke execute on function kg_copy_application_allergies(uuid, uuid, jsonb)
  from public, anon, authenticated;

create or replace function kg_approve_application(p_app uuid, p_class uuid default null, p_tag_code text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare a kg_applications; v_child uuid; v_guardian uuid; g jsonb; act text;
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

    -- The applicant's own guardian row, if they already have one here (a
    -- second child at the same crèche).
    if coalesce((g->>'is_applicant')::boolean, false) and a.applicant_user_id is not null then
      select id into v_guardian from kg_guardians
       where tenant_id = a.tenant_id and user_id = a.applicant_user_id
       limit 1;
    end if;

    -- Otherwise match on the phone number, digits only.
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

  -- 0061: one allergen, one row, whatever the payload repeats.
  perform kg_copy_application_allergies(a.tenant_id, v_child, a.health);

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

-- 0063: only kg_approve_and_bill may reach this; a client that could call it
-- directly could enrol a child and never be invoiced.
revoke execute on function kg_approve_application(uuid, uuid, text) from public, anon, authenticated;

commit;
