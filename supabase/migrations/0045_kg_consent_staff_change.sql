-- 0045 — A consent changed by staff has to reach the parent.
--
-- kg_notify_parent_edit (0016) opens with `if not kg_actor_is_parent then
-- return`, so consents only ever notified in one direction: parent edits,
-- staff hear about it. The reverse — an admin flipping "photos and videos" or
-- "medical emergency" from the child's file — told nobody at all.
--
-- These are the parent's decisions, not the crèche's. A refused photo consent
-- quietly re-granted, or an emergency-care consent switched without the family
-- knowing, is the kind of change that only surfaces when it is far too late to
-- argue about. Both directions now notify, and both are audited.

create or replace function kg_on_consent_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_state text;
  v_detail text;
  v_recipients uuid[];
  v_child kg_children;
begin
  -- Nothing to say when the decision itself did not move.
  if tg_op = 'UPDATE' and new.granted is not distinct from old.granted then
    return new;
  end if;

  v_state := case
    when new.granted is null then 'pending'
    when new.granted then 'granted'
    else 'refused'
  end;
  v_detail := new.consent_type || ': ' || v_state;

  if kg_actor_is_parent(new.tenant_id) then
    -- Parent → staff. Unchanged behaviour from 0018.
    perform kg_notify_parent_edit(new.tenant_id, new.child_id, 'consent', v_detail);
    return new;
  end if;

  -- Staff → parent. The family is told what was changed, to what, and by whom.
  select * into v_child from kg_children where id = new.child_id;
  select array_agg(u) into v_recipients from kg_parent_user_ids(new.child_id) u;

  if v_recipients is not null then
    perform kg_notify(
      new.tenant_id, v_recipients, 'consent_changed',
      coalesce(v_child.first_name || ' ' || v_child.last_name, ''),
      v_detail,
      jsonb_build_object(
        'childId', new.child_id,
        'childName', coalesce(v_child.first_name || ' ' || v_child.last_name, ''),
        'consentType', new.consent_type,
        'state', v_state,
        'audience', 'parent'),
      auth.uid());
  end if;

  -- Audited whether or not anybody was reachable: the record of who changed a
  -- consent must not depend on a parent having an account.
  insert into kg_audit_log (tenant_id, user_id, action, entity, entity_id, data)
  values (new.tenant_id, auth.uid(), 'consent.staff_change', 'kg_consents', new.id::text,
          jsonb_build_object('childId', new.child_id, 'consentType', new.consent_type,
                             'state', v_state,
                             'previous', case when tg_op = 'UPDATE' then old.granted end));
  return new;
end $$;

drop trigger if exists trg_kg_consent_parent_edit on kg_consents;
create trigger trg_kg_consent_parent_edit
  after insert or update on kg_consents
  for each row execute function kg_on_consent_change();
