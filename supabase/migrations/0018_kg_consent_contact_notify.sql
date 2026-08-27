-- Closes two gaps in 0016.
--
-- 0016 notified staff when a parent changed allergies, the health record or
-- the pickup list, but not when they changed a CONSENT or their own CONTACT
-- DETAILS. Revoking `medical_emergency` consent is exactly the kind of change
-- an educator must not discover at the moment they need it, and a new
-- emergency phone number is worthless if nobody knows it changed.

-- Consents: photos, outings, emergency medical.
create or replace function kg_on_consent_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_detail text;
begin
  v_detail := new.consent_type || ': ' || case
    when new.granted is null then 'pending'
    when new.granted then 'granted'
    else 'refused'
  end;
  perform kg_notify_parent_edit(new.tenant_id, new.child_id, 'consent', v_detail);
  return new;
end $$;
drop trigger if exists trg_kg_consent_parent_edit on kg_consents;
create trigger trg_kg_consent_parent_edit
  after insert or update on kg_consents
  for each row execute function kg_on_consent_change();

-- A guardian's own contact details. No child_id on this table, so notify once
-- naming the guardian rather than once per child, and only when a field staff
-- would actually act on has changed — not on every incidental row touch.
create or replace function kg_on_guardian_contact_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_recipients uuid[];
begin
  if not kg_actor_is_parent(new.tenant_id) then return new; end if;
  if new.phone is not distinct from old.phone
     and new.phone_alt is not distinct from old.phone_alt
     and new.address is not distinct from old.address
     and new.email is not distinct from old.email then
    return new;
  end if;

  select array_agg(u) into v_recipients
    from kg_staff_user_ids(new.tenant_id, array['owner','admin','educator']::kg_role[]) u;

  perform kg_notify(new.tenant_id, v_recipients, 'parent_update',
    trim(coalesce(new.first_name,'') || ' ' || coalesce(new.last_name,'')),
    'contact details updated',
    jsonb_build_object('guardianId', new.id, 'field', 'contact', 'audience', 'staff'),
    auth.uid());

  insert into kg_audit_log (tenant_id, user_id, action, entity, entity_id, data)
  values (new.tenant_id, auth.uid(), 'parent_update', 'contact', new.id::text,
          jsonb_build_object('phone', new.phone));
  return new;
end $$;
drop trigger if exists trg_kg_guardian_contact_edit on kg_guardians;
create trigger trg_kg_guardian_contact_edit
  after update on kg_guardians
  for each row execute function kg_on_guardian_contact_change();
