-- 0140 — a child can be moved between the structures of a building, and the
--        move is ONE act rather than a side-effect of changing class.
--
-- Until now a child's structure was whatever their class's structure was, and
-- nothing else. That gave the crèche→école move no verb: the director changed
-- the class and hoped, a child with no class could not be moved at all, the
-- crèche tariff went on billing a child now sitting in the école, the crèche's
-- activity enrolments stayed open, the family was told nothing, and the DAS
-- register lost the crèche exit because nothing recorded one.
--
-- This file adds:
--   kg_child_transfers        — the record: who moved, from where, to where,
--                               as of when, by whom, why. The register reads
--                               exit/entry dates from it.
--   kg_move_child()           — the one verb. Sets class + structure together,
--                               closes the old structure's tariff and activity
--                               enrolments, writes the transfer, tells the
--                               family, all in one transaction.
--   transfer applications     — a parent asks to move an EXISTING child from
--                               the portal; the director approves from the
--                               same queue as every other request, and the
--                               approval calls kg_move_child rather than
--                               creating a second child.
--   structure on submission   — kg_submit_application and
--                               kg_submit_sibling_application record which
--                               structure the family chose, and validate the
--                               class / tariff / activities against it.
--   kg_get_enroll_link        — returns the building's structures and tags
--                               every tariff and activity with its structure,
--                               so the form can ask first and filter after.
--   kg_find_matching_child()  — the reviewer sees "this child already exists"
--                               before approving a duplicate.
--
-- SCOPING RULE, everywhere below: structure_id NULL means THE WHOLE BUILDING.
-- A building-wide tariff keeps billing across a move; a structure's own does
-- not. A building-wide activity survives a move; a crèche-only one ends.

-- ── 0. A new notification type has to be declared before it can be sent ────
-- kg_notifications_type_known enumerates every type the app knows how to
-- render; a family is told about a move in a sentence that names the
-- structure, so the type is its own.
alter table kg_notifications drop constraint if exists kg_notifications_type_known;
alter table kg_notifications add constraint kg_notifications_type_known check (type = any (array[
  'message','incident','announcement','application','checkin','checkout','daily_report','task',
  'activity_request','parent_update','payment_overdue','consent_changed','pickup_changed',
  'guardian_access_changed','allergy_changed','health_changed','incident_updated',
  'enrollment_changed','invoice_issued','payment_recorded','payment_reversed','fee_changed',
  'attendance_flagged','activity_decision','session_published','application_status','event',
  'advance_requested','advance_approved','advance_rejected',
  'structure_changed'
]));

-- ── 1. The trigger: a child with a class IS in that class's structure ───────
-- Previously only re-derived when class_id changed, which left a door open: a
-- direct write of structure_id beside an unchanged class was honoured, so a
-- child could sit in a crèche class while filed under the école. Now the class
-- always wins when it has a structure, on every write of either column, and
-- kg_move_child validates the pair BEFORE writing so nothing is ever silently
-- overridden.
create or replace function kg_sync_child_structure()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_class_structure uuid;
begin
  if new.class_id is not null then
    select c.structure_id into v_class_structure from kg_classes c where c.id = new.class_id;
    if v_class_structure is not null then
      new.structure_id := v_class_structure;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_kg_children_structure_sync on kg_children;
create trigger trg_kg_children_structure_sync
  before insert or update of class_id, structure_id on kg_children
  for each row execute function kg_sync_child_structure();

-- ── 2. The record ───────────────────────────────────────────────────────────
create table if not exists kg_child_transfers (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references kg_tenants(id) on delete cascade,
  child_id          uuid not null references kg_children(id) on delete cascade,
  from_structure_id uuid references kg_structures(id) on delete set null,
  to_structure_id   uuid references kg_structures(id) on delete set null,
  from_class_id     uuid references kg_classes(id) on delete set null,
  to_class_id       uuid references kg_classes(id) on delete set null,
  effective_date    date not null default current_date,
  reason            text,
  -- 'staff' when the director did it; 'parent_request' when it came through
  -- an approved transfer application. The register prints the difference.
  origin            text not null default 'staff' check (origin in ('staff', 'parent_request')),
  moved_by          uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now()
);
create index if not exists kg_child_transfers_child_idx on kg_child_transfers (child_id, effective_date desc);
create index if not exists kg_child_transfers_tenant_idx on kg_child_transfers (tenant_id, effective_date desc);

alter table kg_child_transfers enable row level security;
drop policy if exists ctr_sel on kg_child_transfers;
-- Staff read their building's history; a parent reads their own child's.
create policy ctr_sel on kg_child_transfers for select
  using (kg_is_staff(tenant_id) or kg_is_parent_of(child_id));
-- No insert/update/delete policy: the only writer is kg_move_child, which is
-- SECURITY DEFINER. A transfer record that could be edited is not a record.

-- ── 3. The verb ─────────────────────────────────────────────────────────────
-- Admin-only. Moving a child between the two businesses of a building is a
-- director's decision — it changes what is billed and which register the
-- child is on. Changing class WITHIN a structure stays an educator's act and
-- goes through the class page as before.
create or replace function kg_move_child(
  p_child uuid,
  p_structure uuid,
  p_class uuid default null,
  p_effective date default null,
  p_fee_plan uuid default null,
  p_reason text default null,
  p_origin text default 'staff'
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_child kg_children; v_class kg_classes; v_target uuid; v_effective date;
  v_transfer uuid; v_structure kg_structures; v_plan kg_fee_plans;
begin
  select * into v_child from kg_children where id = p_child;
  if v_child.id is null then raise exception 'not_found'; end if;
  if not kg_is_admin(v_child.tenant_id) then raise exception 'forbidden'; end if;

  v_effective := coalesce(p_effective, kg_today());

  -- The class decides the structure when it has one; the caller's structure
  -- must agree. Checked here, loudly, rather than let the trigger fix it
  -- quietly downstream.
  if p_class is not null then
    select * into v_class from kg_classes where id = p_class and tenant_id = v_child.tenant_id;
    if v_class.id is null then raise exception 'unknown_class'; end if;
    if v_class.structure_id is not null and p_structure is not null
       and v_class.structure_id <> p_structure then
      raise exception 'class_not_in_structure';
    end if;
    v_target := coalesce(v_class.structure_id, p_structure);
  else
    v_target := p_structure;
  end if;

  if v_target is not null then
    select * into v_structure from kg_structures
     where id = v_target and tenant_id = v_child.tenant_id and active;
    if v_structure.id is null then raise exception 'unknown_structure'; end if;
  end if;

  if v_target is not distinct from v_child.structure_id
     and p_class is not distinct from v_child.class_id then
    raise exception 'no_change';
  end if;

  if p_fee_plan is not null then
    select * into v_plan from kg_fee_plans
     where id = p_fee_plan and tenant_id = v_child.tenant_id and active and period = 'monthly'
       and (structure_id is null or structure_id = v_target);
    if v_plan.id is null then raise exception 'fee_plan_not_in_structure'; end if;
  end if;

  update kg_children
     set class_id = p_class, structure_id = v_target
   where id = p_child;

  -- The old structure's OWN tariff stops the day before; a building-wide
  -- tariff carries on, because it was never the crèche's to begin with.
  if v_child.structure_id is distinct from v_target then
    update kg_child_fees f
       set end_date = v_effective - 1
      from kg_fee_plans p
     where f.child_id = p_child and f.fee_plan_id = p.id
       and p.period = 'monthly' and p.structure_id is not null
       and p.structure_id is distinct from v_target
       and (f.end_date is null or f.end_date >= v_effective)
       and f.start_date < v_effective;
    -- A row that had not even started yet is simply gone.
    delete from kg_child_fees f
     using kg_fee_plans p
     where f.child_id = p_child and f.fee_plan_id = p.id
       and p.period = 'monthly' and p.structure_id is not null
       and p.structure_id is distinct from v_target
       and f.start_date >= v_effective;

    -- Likewise the old structure's own activities.
    update kg_activity_enrollments e
       set status = 'ended', end_date = v_effective - 1
      from kg_activities a
     where e.child_id = p_child and a.id = e.activity_id
       and a.structure_id is not null and a.structure_id is distinct from v_target
       and e.status in ('active', 'requested');
  end if;

  if p_fee_plan is not null then
    insert into kg_child_fees (tenant_id, child_id, fee_plan_id, start_date)
    values (v_child.tenant_id, p_child, p_fee_plan, v_effective);
  end if;

  insert into kg_child_transfers (tenant_id, child_id, from_structure_id, to_structure_id,
                                  from_class_id, to_class_id, effective_date, reason,
                                  origin, moved_by)
  values (v_child.tenant_id, p_child, v_child.structure_id, v_target,
          v_child.class_id, p_class, v_effective, nullif(btrim(p_reason), ''),
          case when p_origin = 'parent_request' then 'parent_request' else 'staff' end,
          auth.uid())
  returning id into v_transfer;

  -- Told by structure name, in both scripts, because "your child's class is
  -- now Préscolaire" is not the news; "your child is now in the école" is.
  if v_child.structure_id is distinct from v_target then
    perform kg_notify_family(v_child.tenant_id, p_child, 'structure_changed',
      jsonb_build_object(
        'structureName', v_structure.name, 'structureNameAr', v_structure.name_ar,
        'className', v_class.name, 'classNameAr', v_class.name_ar,
        'date', v_effective),
      coalesce(v_structure.name, ''));
  end if;

  return v_transfer;
end $$;
revoke all on function kg_move_child(uuid, uuid, uuid, date, uuid, text, text) from public, anon;
grant execute on function kg_move_child(uuid, uuid, uuid, date, uuid, text, text) to authenticated;

-- ── 4. Transfer applications ────────────────────────────────────────────────
-- A parent's request to move a child they already have here. It is an
-- application like any other — same queue, same review page, same approve
-- button — with one difference: it points at the child that already exists,
-- so approving it MOVES that child instead of creating a second one with a
-- second badge and a second admission fee.
alter table kg_applications
  add column if not exists existing_child_id uuid references kg_children(id) on delete cascade;
create index if not exists kg_applications_existing_child_idx
  on kg_applications (existing_child_id) where existing_child_id is not null;

create or replace function kg_request_transfer(
  p_child uuid, p_structure uuid, p_class uuid default null, p_note text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_child kg_children; v_app uuid; v_g kg_guardians;
begin
  if auth.uid() is null then raise exception 'auth required'; end if;
  select * into v_child from kg_children where id = p_child;
  if v_child.id is null or not kg_is_parent_of(p_child) then raise exception 'forbidden'; end if;
  if v_child.status <> 'enrolled' then raise exception 'not_enrolled'; end if;

  if not exists (select 1 from kg_structures
                  where id = p_structure and tenant_id = v_child.tenant_id and active) then
    raise exception 'unknown_structure';
  end if;
  if p_structure is not distinct from v_child.structure_id then raise exception 'same_structure'; end if;

  -- A class preference is kept only if it belongs to the requested structure;
  -- a wrong one is dropped, not fatal, the same rule as the public form.
  if p_class is not null and not exists (
    select 1 from kg_classes
     where id = p_class and tenant_id = v_child.tenant_id
       and (structure_id is null or structure_id = p_structure)) then
    p_class := null;
  end if;

  if exists (select 1 from kg_applications
              where existing_child_id = p_child
                and status not in ('approved', 'rejected')) then
    raise exception 'transfer_pending';
  end if;

  select * into v_g from kg_guardians
   where tenant_id = v_child.tenant_id and user_id = auth.uid() limit 1;

  insert into kg_applications (tenant_id, applicant_user_id, status, source,
                               existing_child_id, structure_id, class_id, note,
                               child, guardians, health, activity_ids)
  values (v_child.tenant_id, auth.uid(), 'submitted', 'transfer',
          p_child, p_structure, p_class, nullif(btrim(p_note), ''),
          jsonb_build_object(
            'first_name', v_child.first_name, 'last_name', v_child.last_name,
            'first_name_ar', v_child.first_name_ar, 'last_name_ar', v_child.last_name_ar,
            'dob', v_child.dob, 'gender', v_child.gender),
          coalesce(jsonb_build_array(jsonb_build_object(
            'first_name', v_g.first_name, 'last_name', v_g.last_name,
            'phone', v_g.phone, 'relationship', v_g.relationship,
            'is_applicant', true, 'is_primary', true)), '[]'::jsonb),
          '{}'::jsonb, '[]'::jsonb)
  returning id into v_app;
  return v_app;
end $$;
revoke all on function kg_request_transfer(uuid, uuid, uuid, text) from public, anon;
grant execute on function kg_request_transfer(uuid, uuid, uuid, text) to authenticated;

-- ── 5. Approval: a transfer moves, everything else creates ──────────────────
create or replace function kg_approve_application(
  p_app uuid, p_class uuid default null, p_tag_code text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare a kg_applications; v_child uuid; v_guardian uuid; g jsonb; al jsonb; act text;
begin
  select * into a from kg_applications where id = p_app;
  if a.id is null then raise exception 'not_found'; end if;
  if not kg_is_admin(a.tenant_id) then raise exception 'forbidden'; end if;
  if a.status = 'approved' then raise exception 'already_approved'; end if;

  -- The transfer branch. The reviewer may override the class the family
  -- asked for (p_class), never the structure: that is what they asked for.
  if a.existing_child_id is not null then
    perform kg_move_child(a.existing_child_id, a.structure_id,
                          coalesce(p_class, a.class_id), kg_today(), null,
                          a.note, 'parent_request');
    update kg_applications
       set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(),
           created_child_id = a.existing_child_id
     where id = p_app;
    return a.existing_child_id;
  end if;

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

-- ── 6. Admission fees follow the structure the child enters ─────────────────
-- Every active one-off plan in the building was being charged at every
-- approval; with two structures that is the école's admission fee on a crèche
-- child, and on a transfer the crèche's fee a second time. Now: the plans of
-- the whole building plus the plans of the child's structure, and never one
-- already charged.
create or replace function kg_start_child_billing(
  p_tenant uuid, p_child uuid, p_fee_plan uuid, p_discount_pct numeric default 0,
  p_custom_amount numeric default null, p_bill_first_month boolean default true
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_plan kg_fee_plans;
  v_month date := date_trunc('month', (now() at time zone 'Africa/Algiers')::date)::date;
  v_inv uuid;
  v_amount numeric;
  v_once kg_fee_plans;
  v_charged boolean := false;
  v_structure uuid;
begin
  if not kg_is_admin(p_tenant) then raise exception 'forbidden'; end if;
  select structure_id into v_structure from kg_children where id = p_child;

  if p_fee_plan is not null then
    select * into v_plan from kg_fee_plans
     where id = p_fee_plan and tenant_id = p_tenant and period = 'monthly';
    if v_plan.id is null then raise exception 'unknown_fee_plan'; end if;

    -- Not duplicated when the same plan is already running — a transfer
    -- approved with the tariff the child already had must not double it.
    if not exists (select 1 from kg_child_fees
                    where child_id = p_child and fee_plan_id = p_fee_plan
                      and (end_date is null or end_date >= current_date)) then
      insert into kg_child_fees (tenant_id, child_id, fee_plan_id, custom_amount,
                                 discount_pct, start_date)
      values (p_tenant, p_child, p_fee_plan, p_custom_amount,
              coalesce(p_discount_pct, 0), current_date);
    end if;
  end if;

  for v_once in
    select * from kg_fee_plans
     where tenant_id = p_tenant and active and period = 'once'
       and (structure_id is null or structure_id = v_structure)
     order by amount desc
  loop
    if exists (select 1 from kg_child_fees
                where child_id = p_child and fee_plan_id = v_once.id) then
      continue;
    end if;
    if v_once.amount <= 0 then continue; end if;

    if v_inv is null then v_inv := kg_open_invoice_for_month(p_tenant, p_child, v_month); end if;

    insert into kg_invoice_items (invoice_id, tenant_id, kind, description,
                                  qty, unit_amount, amount)
    values (v_inv, p_tenant, 'registration', v_once.name, 1, v_once.amount, v_once.amount);

    insert into kg_child_fees (tenant_id, child_id, fee_plan_id, start_date, end_date)
    values (p_tenant, p_child, v_once.id, current_date, current_date);

    v_charged := true;
  end loop;

  if coalesce(p_bill_first_month, true) and v_plan.id is not null then
    if v_inv is null then v_inv := kg_open_invoice_for_month(p_tenant, p_child, v_month); end if;

    v_amount := round(coalesce(p_custom_amount, v_plan.amount)
                      * (1 - coalesce(p_discount_pct, 0) / 100.0), 2);
    insert into kg_invoice_items (invoice_id, tenant_id, kind, description,
                                  qty, unit_amount, amount)
    values (v_inv, p_tenant, 'tuition',
            v_plan.name || ' — ' || to_char(v_month, 'MM/YYYY'), 1,
            coalesce(p_custom_amount, v_plan.amount), v_amount);
    v_charged := true;
  end if;

  if v_inv is not null and v_charged then
    perform kg_invoice_recalc(v_inv);
  end if;
  return v_inv;
end $$;

-- ── 7. The reviewer sees a duplicate before approving one ───────────────────
create or replace function kg_find_matching_child(
  p_tenant uuid, p_first_name text, p_last_name text, p_dob date
) returns table (id uuid, first_name text, last_name text, status kg_child_status,
                 structure_id uuid, class_id uuid)
language sql stable security definer set search_path = public as $$
  select c.id, c.first_name, c.last_name, c.status, c.structure_id, c.class_id
    from kg_children c
   where c.tenant_id = p_tenant and kg_is_staff(p_tenant)
     and c.dob = p_dob
     and lower(btrim(c.first_name)) = lower(btrim(p_first_name))
     and lower(btrim(c.last_name)) = lower(btrim(p_last_name))
   limit 3
$$;
revoke all on function kg_find_matching_child(uuid, text, text, date) from public, anon;
grant execute on function kg_find_matching_child(uuid, text, text, date) to authenticated;

-- ── 8. The public form records which structure the family chose ─────────────
-- The old signature is DROPPED, not kept beside the new one: with a defaulted
-- trailing argument the two would both match a seven-argument call and
-- PostgREST would refuse to choose (PGRST203). One function, one extra
-- optional argument — the deployed build's seven-argument call still resolves.
drop function if exists kg_submit_application(text, jsonb, jsonb, jsonb, jsonb, uuid, uuid);
create or replace function kg_submit_application(
  p_token text, p_child jsonb, p_guardians jsonb, p_health jsonb,
  p_activity_ids jsonb default '[]'::jsonb,
  p_fee_plan_id uuid default null,
  p_class_id uuid default null,
  p_structure_id uuid default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_link kg_enroll_links; v_app uuid; v_uid uuid := auth.uid(); v_ok boolean;
  v_activities jsonb; v_structure uuid; v_class_structure uuid;
begin
  if v_uid is null then raise exception 'auth required'; end if;
  select * into v_link from kg_enroll_links
    where token = p_token and active
      and (expires_at is null or expires_at > now())
      and (max_uses is null or use_count < max_uses);
  if v_link.id is null then raise exception 'invalid_link'; end if;

  -- The link's structure wins where it has one — that is what the link is
  -- FOR. A whole-building link takes the family's choice, checked against the
  -- building; anything else is dropped rather than raised, so a stale form
  -- never costs the family the ten minutes they just spent.
  v_structure := v_link.structure_id;
  if v_structure is null and p_structure_id is not null then
    if exists (select 1 from kg_structures
                where id = p_structure_id and tenant_id = v_link.tenant_id and active) then
      v_structure := p_structure_id;
    end if;
  end if;

  if p_fee_plan_id is not null then
    select exists (select 1 from kg_fee_plans
      where id = p_fee_plan_id and tenant_id = v_link.tenant_id
        and active and period = 'monthly'
        and (structure_id is null or v_structure is null or structure_id = v_structure)) into v_ok;
    if not v_ok then p_fee_plan_id := null; end if;
  end if;

  if p_class_id is not null then
    select c.structure_id into v_class_structure from kg_classes c
     where c.id = p_class_id and c.tenant_id = v_link.tenant_id
       and (v_structure is null or c.structure_id is null or c.structure_id = v_structure);
    if not found then
      p_class_id := null;
    elsif v_structure is null then
      -- A class chosen on a whole-building link says which structure the
      -- family meant, so the application lands on a register.
      v_structure := v_class_structure;
    end if;
  end if;

  select coalesce(jsonb_agg(to_jsonb(a.id)), '[]'::jsonb) into v_activities
    from kg_activities a
   where a.tenant_id = v_link.tenant_id and a.active
     and (a.structure_id is null or v_structure is null or a.structure_id = v_structure)
     and a.id::text in (
       select x from jsonb_array_elements_text(coalesce(p_activity_ids, '[]'::jsonb)) x
        where x ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     );

  insert into kg_applications (tenant_id, link_id, applicant_user_id, child, guardians,
                               health, activity_ids, fee_plan_id, class_id, structure_id)
    values (v_link.tenant_id, v_link.id, v_uid, p_child, p_guardians, p_health,
            v_activities, p_fee_plan_id, p_class_id, v_structure)
    returning id into v_app;
  update kg_enroll_links set use_count = use_count + 1 where id = v_link.id;
  insert into kg_profiles (id, full_name, phone)
    values (v_uid, coalesce(p_guardians->0->>'first_name','') || ' ' ||
                   coalesce(p_guardians->0->>'last_name',''), p_guardians->0->>'phone')
    on conflict (id) do update set phone = coalesce(excluded.phone, kg_profiles.phone);
  return v_app;
end $$;
revoke all on function kg_submit_application(text, jsonb, jsonb, jsonb, jsonb, uuid, uuid, uuid) from public, anon;
grant execute on function kg_submit_application(text, jsonb, jsonb, jsonb, jsonb, uuid, uuid, uuid) to authenticated;

-- ── 9. A sibling from the portal says which structure, class and tariff ─────
drop function if exists kg_submit_sibling_application(uuid, jsonb, jsonb, jsonb);
create or replace function kg_submit_sibling_application(
  p_tenant uuid, p_child jsonb, p_health jsonb, p_activity_ids jsonb,
  p_structure_id uuid default null, p_class_id uuid default null, p_fee_plan_id uuid default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_g kg_guardians; v_app uuid; v_guardians jsonb;
        v_structure uuid; v_class_structure uuid; v_activities jsonb;
begin
  if v_uid is null then raise exception 'auth required'; end if;

  if not exists (
    select 1 from kg_memberships m
    where m.tenant_id = p_tenant and m.user_id = v_uid and m.status = 'active'
  ) then
    raise exception 'forbidden';
  end if;

  select * into v_g from kg_guardians
   where tenant_id = p_tenant and user_id = v_uid limit 1;
  if v_g.id is null then raise exception 'no_guardian_record'; end if;

  -- Same rules as the public form: an unknown structure is dropped; a class
  -- must sit in it; a class on its own names the structure.
  if p_structure_id is not null and exists (
    select 1 from kg_structures where id = p_structure_id and tenant_id = p_tenant and active) then
    v_structure := p_structure_id;
  end if;

  if p_class_id is not null then
    select c.structure_id into v_class_structure from kg_classes c
     where c.id = p_class_id and c.tenant_id = p_tenant
       and (v_structure is null or c.structure_id is null or c.structure_id = v_structure);
    if not found then p_class_id := null;
    elsif v_structure is null then v_structure := v_class_structure; end if;
  end if;

  if p_fee_plan_id is not null and not exists (
    select 1 from kg_fee_plans
     where id = p_fee_plan_id and tenant_id = p_tenant and active and period = 'monthly'
       and (structure_id is null or v_structure is null or structure_id = v_structure)) then
    p_fee_plan_id := null;
  end if;

  select coalesce(jsonb_agg(to_jsonb(a.id)), '[]'::jsonb) into v_activities
    from kg_activities a
   where a.tenant_id = p_tenant and a.active
     and (a.structure_id is null or v_structure is null or a.structure_id = v_structure)
     and a.id::text in (
       select x from jsonb_array_elements_text(coalesce(p_activity_ids, '[]'::jsonb)) x
        where x ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     );

  v_guardians := jsonb_build_array(jsonb_build_object(
    'first_name', v_g.first_name, 'last_name', v_g.last_name,
    'first_name_ar', v_g.first_name_ar, 'last_name_ar', v_g.last_name_ar,
    'relationship', v_g.relationship, 'phone', v_g.phone, 'phone_alt', v_g.phone_alt,
    'email', v_g.email, 'national_id', v_g.national_id, 'address', v_g.address,
    'workplace', v_g.workplace,
    'is_applicant', true, 'is_primary', true, 'is_financial', true, 'can_pickup', true
  ));

  insert into kg_applications (tenant_id, applicant_user_id, status, child, guardians, health,
                               activity_ids, source, structure_id, class_id, fee_plan_id)
    values (p_tenant, v_uid, 'submitted', p_child, v_guardians,
            coalesce(p_health,'{}'::jsonb), v_activities, 'sibling',
            v_structure, p_class_id, p_fee_plan_id)
    returning id into v_app;
  return v_app;
end $$;
revoke all on function kg_submit_sibling_application(uuid, jsonb, jsonb, jsonb, uuid, uuid, uuid) from public, anon;
grant execute on function kg_submit_sibling_application(uuid, jsonb, jsonb, jsonb, uuid, uuid, uuid) to authenticated;

-- ── 10. The form learns the building's structures, and what belongs to which ─
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
    -- Every active structure, so a whole-building link can ask the family
    -- which one they mean before showing them a class list.
    'structures', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'name_ar', s.name_ar,
        'center_type', s.center_type, 'color', s.color) order by s.sort_order, s.name)
      from kg_structures s where s.tenant_id = t.id and s.active
    ), '[]'::jsonb),
    -- Each tagged with its structure (null = the whole building) so the form
    -- can narrow after the choice without another round trip.
    'activities', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'name_ar', a.name_ar,
        'category', a.category, 'fee_amount', a.fee_amount, 'fee_period', a.fee_period,
        'description', a.description, 'structure_id', a.structure_id))
      from kg_activities a where a.tenant_id = t.id and a.active
        and (l.structure_id is null or a.structure_id is null or a.structure_id = l.structure_id)
    ), '[]'::jsonb),
    'fee_plans', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'name_ar', p.name_ar,
        'amount', p.amount, 'description', p.description, 'structure_id', p.structure_id) order by p.amount)
      from kg_fee_plans p where p.tenant_id = t.id and p.active and p.period = 'monthly'
        and (l.structure_id is null or p.structure_id is null or p.structure_id = l.structure_id)
    ), '[]'::jsonb),
    'admission_fees', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'name_ar', p.name_ar,
        'amount', p.amount, 'structure_id', p.structure_id) order by p.amount desc)
      from kg_fee_plans p where p.tenant_id = t.id and p.active and p.period = 'once' and p.amount > 0
        and (l.structure_id is null or p.structure_id is null or p.structure_id = l.structure_id)
    ), '[]'::jsonb),
    'classes', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'name_ar', c.name_ar,
        'age_min_months', c.age_min_months, 'age_max_months', c.age_max_months,
        'structure_id', c.structure_id)
        order by c.age_min_months nulls last, c.name)
      from kg_classes c
      where c.tenant_id = t.id
        and (l.structure_id is null or c.structure_id is null or c.structure_id = l.structure_id)
    ), '[]'::jsonb)
  ) into r
  from kg_enroll_links l join kg_tenants t on t.id = l.tenant_id
  where l.token = p_token and l.active
    and (l.expires_at is null or l.expires_at > now())
    and (l.max_uses is null or l.use_count < l.max_uses);
  if r is null then raise exception 'invalid_link'; end if;
  return r;
end $$;
