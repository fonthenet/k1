-- 0049 — Everything that happens to a child reaches that child's family.
--
-- The audit behind this migration found ~35 writes that change a child's
-- record and 7 of them told the family nothing at all. The cause is one line
-- at the top of kg_notify_parent_edit (0016):
--
--     if not kg_actor_is_parent(p_tenant) then return; end if;
--
-- which makes every safety notification one-directional: a parent edits, the
-- office hears about it, and the reverse — staff editing allergies, health,
-- the pickup list, the guardian links — is silent. 0045 fixed that shape for
-- consents. This migration applies the same shape everywhere else and adds the
-- money and attendance events a family cannot discover by living their day.
--
-- The rule for what earns a notification: the family cannot find out by
-- turning up tomorrow, AND they would act differently if they knew. A swapped
-- photo fails that test. A deleted severe allergy passes it overwhelmingly.
--
-- Nothing here renders a sentence in SQL. Every payload is structured data —
-- an action verb, an enum, an amount — and the client renders it in the
-- reader's own language. Writing "allergie supprimée" into the database would
-- freeze one language into every family's history.

-- ── Shared fan-out to a child's family ───────────────────────────────────
-- Resolves the child once, adds the three keys every parent payload carries,
-- and lets kg_notify's actor-skip drop the person who made the change.
create or replace function kg_notify_family(
  p_tenant uuid, p_child uuid, p_type text, p_data jsonb default '{}'::jsonb,
  p_body text default null
) returns int language plpgsql security definer set search_path = public as $$
declare v_recipients uuid[]; v_child kg_children; v_name text;
begin
  select array_agg(u) into v_recipients from kg_parent_user_ids(p_child) u;
  if v_recipients is null then return 0; end if;

  select * into v_child from kg_children where id = p_child;
  v_name := coalesce(v_child.first_name || ' ' || v_child.last_name, '');

  return kg_notify(p_tenant, v_recipients, p_type, v_name, p_body,
    coalesce(p_data, '{}'::jsonb) || jsonb_build_object(
      'childId', p_child, 'childName', v_name, 'audience', 'parent'),
    auth.uid());
end $$;
revoke execute on function kg_notify_family(uuid, uuid, text, jsonb, text) from anon, authenticated;

-- ═════════════════════════════════════════════════════════════════════════
--  TIER A — safety and custody
-- ═════════════════════════════════════════════════════════════════════════

-- 1. Who may collect the child. The décret 19-253 register: the single
--    highest-stakes list in the product, and until now staff could edit it
--    without the family ever being told.
create or replace function kg_on_pickup_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record; v_action text; v_detail text;
begin
  r := case when tg_op = 'DELETE' then old else new end;

  -- A no-op UPDATE (a photo path, a re-save) is not news.
  if tg_op = 'UPDATE'
     and (new.name, new.relationship, new.phone, new.national_id)
      is not distinct from (old.name, old.relationship, old.phone, old.national_id) then
    return new;
  end if;

  v_action := case tg_op when 'INSERT' then 'added'
                         when 'UPDATE' then 'updated' else 'removed' end;
  v_detail := v_action || ': ' || coalesce(r.name, '');

  if kg_actor_is_parent(r.tenant_id) then
    -- Parent → staff. Unchanged from 0016.
    perform kg_notify_parent_edit(r.tenant_id, r.child_id, 'pickup', v_detail);
    return r;
  end if;

  -- Staff → parent.
  perform kg_notify_family(r.tenant_id, r.child_id, 'pickup_changed',
    jsonb_build_object('action', v_action, 'person', coalesce(r.name, ''),
                       'relation', coalesce(r.relationship, '')),
    v_detail);

  insert into kg_audit_log (tenant_id, user_id, action, entity, entity_id, data)
  values (r.tenant_id, auth.uid(), 'pickup.staff_change', 'kg_authorized_pickups',
          r.id::text, jsonb_build_object('detail', v_detail));
  return r;
end $$;

-- 2. Guardian links. Unlinking is the one change that conceals itself: it
--    deletes the row kg_parent_user_ids reads, so the family loses the portal
--    AND every future notification in the same statement. Two fan-outs,
--    because the person losing access is by then no longer in the family list.
create or replace function kg_on_guardian_link_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r record; v_tenant uuid; v_action text;
  v_guardian kg_guardians; v_person text; v_removed uuid[];
begin
  r := case when tg_op = 'DELETE' then old else new end;

  -- This table carries no tenant_id; the child is the only route to it.
  select tenant_id into v_tenant from kg_children where id = r.child_id;
  if v_tenant is null then return r; end if;

  if tg_op = 'UPDATE'
     and new.can_pickup is not distinct from old.can_pickup
     and new.is_primary is not distinct from old.is_primary then
    return new;
  end if;

  v_action := case
    when tg_op = 'INSERT' then 'linked'
    when tg_op = 'DELETE' then 'unlinked'
    when new.can_pickup and not coalesce(old.can_pickup, false) then 'pickup_granted'
    when coalesce(old.can_pickup, false) and not new.can_pickup then 'pickup_revoked'
    else 'updated'
  end;

  select * into v_guardian from kg_guardians where id = r.guardian_id;
  v_person := coalesce(v_guardian.first_name || ' ' || v_guardian.last_name, '');

  if kg_actor_is_parent(v_tenant) then
    perform kg_notify_parent_edit(v_tenant, r.child_id, 'guardian',
                                  v_action || ': ' || v_person);
    return r;
  end if;

  -- (a) The family that remains.
  perform kg_notify_family(v_tenant, r.child_id, 'guardian_access_changed',
    jsonb_build_object('action', v_action, 'person', v_person,
                       'relation', coalesce(v_guardian.relationship::text, '')),
    v_action || ': ' || v_person);

  -- (b) The person who just lost the child, told directly — they are already
  --     out of kg_parent_user_ids by the time this AFTER trigger runs.
  if tg_op = 'DELETE' and v_guardian.user_id is not null then
    v_removed := array[v_guardian.user_id];
    perform kg_notify(v_tenant, v_removed, 'guardian_access_changed',
      v_person, null,
      jsonb_build_object('childId', r.child_id, 'audience', 'parent',
        'action', 'access_removed', 'person', v_person,
        'childName', (select coalesce(c.first_name || ' ' || c.last_name, '')
                        from kg_children c where c.id = r.child_id)),
      auth.uid());
  end if;

  insert into kg_audit_log (tenant_id, user_id, action, entity, entity_id, data)
  values (v_tenant, auth.uid(), 'guardian_link.staff_change', 'kg_child_guardians',
          r.child_id::text,
          jsonb_build_object('action', v_action, 'guardianId', r.guardian_id));
  return r;
end $$;
drop trigger if exists trg_kg_guardian_link_change on kg_child_guardians;
create trigger trg_kg_guardian_link_change
  after insert or update or delete on kg_child_guardians
  for each row execute function kg_on_guardian_link_change();

-- 3. Allergies. A deleted severe allergen must leave a trace the family can
--    see and contest — the audit row is written whether or not anybody in the
--    family has an account, exactly as 0045 does for consents.
create or replace function kg_on_allergy_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record; v_action text; v_detail text;
begin
  r := case when tg_op = 'DELETE' then old else new end;

  if tg_op = 'UPDATE'
     and (new.allergen, new.severity, new.reaction, new.action_plan)
      is not distinct from (old.allergen, old.severity, old.reaction, old.action_plan) then
    return new;
  end if;

  v_action := case tg_op when 'INSERT' then 'added'
                         when 'UPDATE' then 'updated' else 'removed' end;
  v_detail := v_action || ': ' || coalesce(r.allergen, '');

  if kg_actor_is_parent(r.tenant_id) then
    perform kg_notify_parent_edit(r.tenant_id, r.child_id, 'allergies', v_detail);
    return r;
  end if;

  perform kg_notify_family(r.tenant_id, r.child_id, 'allergy_changed',
    jsonb_build_object('action', v_action, 'allergen', coalesce(r.allergen, ''),
                       'severity', coalesce(r.severity::text, '')),
    v_detail);

  insert into kg_audit_log (tenant_id, user_id, action, entity, entity_id, data)
  values (r.tenant_id, auth.uid(), 'allergy.staff_change', 'kg_child_allergies',
          r.id::text, jsonb_build_object('detail', v_detail,
                                         'severity', r.severity::text));
  return r;
end $$;

-- 4. Health record. The payload carries field NAMES, never a rendered list —
--    joining them in SQL would freeze French word order into an Arabic
--    family's history.
create or replace function kg_on_health_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_tenant uuid; v_fields text[];
begin
  select tenant_id into v_tenant from kg_children where id = new.child_id;
  if v_tenant is null then return new; end if;

  if tg_op = 'UPDATE' then
    v_fields := array_remove(array[
      case when new.medical_conditions   is distinct from old.medical_conditions   then 'medical_conditions' end,
      case when new.medications          is distinct from old.medications          then 'medications' end,
      case when new.vaccinations         is distinct from old.vaccinations         then 'vaccinations' end,
      case when new.dietary_restrictions is distinct from old.dietary_restrictions then 'dietary_restrictions' end,
      case when new.special_needs        is distinct from old.special_needs        then 'special_needs' end,
      case when new.doctor_name          is distinct from old.doctor_name          then 'doctor_name' end,
      case when new.doctor_phone         is distinct from old.doctor_phone         then 'doctor_phone' end,
      case when new.emergency_notes      is distinct from old.emergency_notes      then 'emergency_notes' end
    ], null);
    -- A touched updated_at on its own is not a change worth a push.
    if array_length(v_fields, 1) is null then return new; end if;
  else
    v_fields := array['medical_conditions'];
  end if;

  if kg_actor_is_parent(v_tenant) then
    perform kg_notify_parent_edit(v_tenant, new.child_id, 'health', null);
    return new;
  end if;

  perform kg_notify_family(v_tenant, new.child_id, 'health_changed',
    jsonb_build_object('fields', to_jsonb(v_fields)), null);

  insert into kg_audit_log (tenant_id, user_id, action, entity, entity_id, data)
  values (v_tenant, auth.uid(), 'health.staff_change', 'kg_child_health',
          new.child_id::text, jsonb_build_object('fields', to_jsonb(v_fields)));
  return new;
end $$;

-- 5. Consents — 0045 covered the flip but not the erase. A deleted consent
--    row wipes the decision entirely and was the last totally silent path.
create or replace function kg_on_consent_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record; v_state text; v_detail text;
begin
  r := case when tg_op = 'DELETE' then old else new end;

  if tg_op = 'UPDATE' and new.granted is not distinct from old.granted then
    return new;
  end if;

  v_state := case
    when tg_op = 'DELETE' then 'withdrawn'
    when r.granted is null then 'pending'
    when r.granted then 'granted'
    else 'refused'
  end;
  v_detail := r.consent_type || ': ' || v_state;

  if kg_actor_is_parent(r.tenant_id) then
    perform kg_notify_parent_edit(r.tenant_id, r.child_id, 'consent', v_detail);
    return r;
  end if;

  perform kg_notify_family(r.tenant_id, r.child_id, 'consent_changed',
    jsonb_build_object('consentType', r.consent_type, 'state', v_state),
    v_detail);

  insert into kg_audit_log (tenant_id, user_id, action, entity, entity_id, data)
  values (r.tenant_id, auth.uid(), 'consent.staff_change', 'kg_consents',
          r.id::text, jsonb_build_object('consentType', r.consent_type,
                                         'state', v_state));
  return r;
end $$;
-- 0045 registered this same function as trg_kg_consent_parent_edit. Widening it
-- to DELETE needs a new trigger definition, and leaving the old name in place
-- would fire the function twice for every consent change — a family told twice
-- that one permission moved. Drop it before creating the replacement.
drop trigger if exists trg_kg_consent_parent_edit on kg_consents;
drop trigger if exists trg_kg_consent_change on kg_consents;
create trigger trg_kg_consent_change
  after insert or update or delete on kg_consents
  for each row execute function kg_on_consent_change();

-- 6. An incident edited after the fact. A severity downgraded from "serious"
--    after the family read it is precisely the change they would contest, and
--    the acknowledgement they already gave no longer covers what it says.
create or replace function kg_notify_incident_update() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_fields text[];
begin
  -- Must not fire on parent_ack_at / parent_notified_at, or acknowledging an
  -- incident would re-notify and re-clear the acknowledgement forever.
  if (new.severity, new.description, new.action_taken, new.location, new.occurred_at)
  is not distinct from
     (old.severity, old.description, old.action_taken, old.location, old.occurred_at) then
    return new;
  end if;

  v_fields := array_remove(array[
    case when new.severity    is distinct from old.severity    then 'severity' end,
    case when new.description is distinct from old.description then 'description' end,
    case when new.action_taken is distinct from old.action_taken then 'action_taken' end,
    case when new.location    is distinct from old.location    then 'location' end,
    case when new.occurred_at is distinct from old.occurred_at then 'occurred_at' end
  ], null);

  perform kg_notify_family(new.tenant_id, new.child_id, 'incident_updated',
    jsonb_build_object('incidentId', new.id, 'fields', to_jsonb(v_fields),
      'severity', new.severity::text, 'at', new.occurred_at,
      'downgraded', (new.severity::text = 'minor' and old.severity::text <> 'minor')
                 or (new.severity::text = 'moderate' and old.severity::text = 'serious')),
    left(coalesce(new.description, ''), 140));

  -- The family acknowledged the old text. Re-open it so the portal shows the
  -- card again and the new acknowledgement is the one on record.
  update kg_incidents set parent_ack_at = null, parent_ack_by = null
   where id = new.id and parent_ack_at is not null;
  return new;
end $$;
drop trigger if exists trg_kg_notify_incident_update on kg_incidents;
create trigger trg_kg_notify_incident_update after update on kg_incidents
  for each row execute function kg_notify_incident_update();

-- 7. Enrolment status. Withdrawing a child instantly kills their badge at the
--    door; without this the family finds out by being turned away.
create or replace function kg_notify_enrollment_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status is not distinct from old.status then return new; end if;

  perform kg_notify_family(new.tenant_id, new.id, 'enrollment_changed',
    jsonb_build_object('status', new.status::text,
      'date', coalesce(new.withdrawal_date, new.enrollment_date)),
    new.status::text);
  return new;
end $$;
drop trigger if exists trg_kg_notify_enrollment_change on kg_children;
create trigger trg_kg_notify_enrollment_change after update of status on kg_children
  for each row execute function kg_notify_enrollment_change();

-- ═════════════════════════════════════════════════════════════════════════
--  TIER B — money
-- ═════════════════════════════════════════════════════════════════════════
-- In a cash-at-the-office economy with no card rails, the receipt notification
-- is the family's only durable proof of payment, and an invoice they were
-- never told about is the sharpest finding in the audit. None of these reach
-- staff: kg_notify_family fans out to parents only, so an educator never sees
-- a family's money.

-- 8. An invoice becomes real — fired once, at the draft → issued edge (0047
--    generates drafts first, so INSERT alone is the wrong hook).
create or replace function kg_notify_invoice_issued() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not ( (tg_op = 'INSERT' and new.status <> 'draft')
        or (tg_op = 'UPDATE' and old.status = 'draft' and new.status <> 'draft') ) then
    return new;
  end if;
  if new.status = 'void' then return new; end if;

  perform kg_notify_family(new.tenant_id, new.child_id, 'invoice_issued',
    jsonb_build_object('invoiceId', new.id, 'amount', new.total,
      'invoiceNo', 'F-' || to_char(new.issue_date, 'YYYY') || '-' ||
                   lpad(new.number::text, 4, '0'),
      'due', new.due_date, 'period', new.period_month),
    null);
  return new;
end $$;
drop trigger if exists trg_kg_notify_invoice_issued on kg_invoices;
create trigger trg_kg_notify_invoice_issued after insert or update on kg_invoices
  for each row execute function kg_notify_invoice_issued();

-- 9. A payment taken at the desk. The receipt number is what the family holds.
create or replace function kg_notify_payment_recorded() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.child_id is null then return new; end if;

  perform kg_notify_family(new.tenant_id, new.child_id, 'payment_recorded',
    jsonb_build_object('paymentId', new.id, 'amount', new.amount,
      'receipt', coalesce(new.receipt_number, ''), 'method', new.method::text,
      'at', new.paid_at, 'invoiceId', new.invoice_id),
    null);
  return new;
end $$;
drop trigger if exists trg_kg_notify_payment_recorded on kg_payments;
create trigger trg_kg_notify_payment_recorded after insert on kg_payments
  for each row execute function kg_notify_payment_recorded();

-- 10. A payment amended or deleted silently restores a balance the family
--     believed settled (0030). They are told, with the old figure.
create or replace function kg_notify_payment_reversed() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  r := case when tg_op = 'DELETE' then old else new end;
  if r.child_id is null then return r; end if;
  if tg_op = 'UPDATE' and new.amount is not distinct from old.amount then
    return new;
  end if;

  perform kg_notify_family(r.tenant_id, r.child_id, 'payment_reversed',
    jsonb_build_object(
      'action', case when tg_op = 'DELETE' then 'removed' else 'amended' end,
      'amount', case when tg_op = 'DELETE' then 0 else new.amount end,
      'previousAmount', old.amount,
      'receipt', coalesce(old.receipt_number, '')),
    null);
  return r;
end $$;
drop trigger if exists trg_kg_notify_payment_reversed on kg_payments;
create trigger trg_kg_notify_payment_reversed after update or delete on kg_payments
  for each row execute function kg_notify_payment_reversed();

-- 11. The standing fee — what the family owes every month, as opposed to any
--     one invoice. Ships together with the fee section on /portal/payments;
--     without that surface the notification would land nowhere.
create or replace function kg_notify_fee_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record; v_plan kg_fee_plans; v_action text;
begin
  r := case when tg_op = 'DELETE' then old else new end;

  if tg_op = 'UPDATE'
     and (new.custom_amount, new.discount_pct, new.end_date, new.fee_plan_id)
      is not distinct from (old.custom_amount, old.discount_pct, old.end_date, old.fee_plan_id) then
    return new;
  end if;

  select * into v_plan from kg_fee_plans where id = r.fee_plan_id;

  v_action := case
    when tg_op = 'INSERT' then 'assigned'
    when tg_op = 'DELETE' then 'ended'
    when new.end_date is not null and old.end_date is null then 'ended'
    else 'changed'
  end;

  perform kg_notify_family(r.tenant_id, r.child_id, 'fee_changed',
    jsonb_build_object('action', v_action, 'plan', coalesce(v_plan.name, ''),
      'amount', coalesce(r.custom_amount, v_plan.amount),
      'discountPct', coalesce(r.discount_pct, 0),
      'date', coalesce(r.end_date, r.start_date)),
    null);
  return r;
end $$;
drop trigger if exists trg_kg_notify_fee_change on kg_child_fees;
create trigger trg_kg_notify_fee_change after insert or update or delete on kg_child_fees
  for each row execute function kg_notify_fee_change();

-- ═════════════════════════════════════════════════════════════════════════
--  TIER C — the day
-- ═════════════════════════════════════════════════════════════════════════

-- 12. "Your child arrived" without "your child did not arrive" is worse than
--     neither. Rewritten wholesale: the old function fell through to a bare
--     `else return new` for every status change, and re-pushed a corrected
--     arrival time as if the child had just walked in a second time.
create or replace function kg_notify_attendance() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_kind text; v_at timestamptz; v_data jsonb; v_corrected boolean := false;
begin
  if tg_op = 'INSERT' then
    if new.check_in_at is not null then
      v_kind := 'checkin'; v_at := new.check_in_at;
    elsif new.status in ('absent', 'sick', 'excused', 'late') then
      v_kind := 'attendance_flagged';
    else
      return new;
    end if;
  else
    if new.check_out_at is not null and old.check_out_at is distinct from new.check_out_at then
      v_kind := 'checkout'; v_at := new.check_out_at;
      v_corrected := old.check_out_at is not null;
    elsif new.check_in_at is not null and old.check_in_at is distinct from new.check_in_at then
      v_kind := 'checkin'; v_at := new.check_in_at;
      v_corrected := old.check_in_at is not null;
    elsif new.status is distinct from old.status
      and new.status in ('absent', 'sick', 'excused', 'late') then
      v_kind := 'attendance_flagged';
    else
      return new;
    end if;
  end if;

  -- A family reporting their own child sick does not need telling about it.
  if v_kind = 'attendance_flagged' and kg_actor_is_parent(new.tenant_id) then
    return new;
  end if;

  v_data := jsonb_build_object('childId', new.child_id, 'audience', 'parent',
    'childName', (select coalesce(c.first_name || ' ' || c.last_name, '')
                    from kg_children c where c.id = new.child_id));

  if v_kind = 'attendance_flagged' then
    -- Timestamped by the day it describes, never by when the row was written:
    -- an 18:00 push about an 11:00 event is how this type becomes worthless.
    v_data := v_data || jsonb_build_object('status', new.status::text,
      'date', new.date, 'reason', coalesce(new.absence_reason, ''));
  else
    v_data := v_data || jsonb_build_object('at', v_at,
      'by', new.picked_up_by, 'corrected', v_corrected);
  end if;

  perform kg_notify_family(new.tenant_id, new.child_id, v_kind, v_data,
    case when v_at is not null
      then to_char(v_at at time zone 'Africa/Algiers', 'HH24:MI') end);
  return new;
end $$;
drop trigger if exists trg_kg_notify_attendance on kg_attendance;
create trigger trg_kg_notify_attendance after insert or update on kg_attendance
  for each row execute function kg_notify_attendance();

-- 13. The answer to a family's activity request — the one request/response
--     loop the product opens and, until now, never closed. Staff enrolling a
--     child directly counts too: 0033 attaches a fee line to that enrolment.
create or replace function kg_notify_activity_decision() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_activity kg_activities; v_decision text;
begin
  -- A fresh request is the office's business (0012 already handles it).
  if tg_op = 'INSERT' and new.status = 'requested' then return new; end if;
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then return new; end if;
  -- The family cancelling their own request does not need an answer.
  if kg_actor_is_parent(new.tenant_id) then return new; end if;

  select * into v_activity from kg_activities where id = new.activity_id;
  v_decision := case
    when tg_op = 'UPDATE' and old.status = 'requested' then 'answer' else 'staff' end;

  perform kg_notify_family(new.tenant_id, new.child_id, 'activity_decision',
    jsonb_build_object('activityId', new.activity_id,
      'activityName', coalesce(v_activity.name, ''),
      'status', new.status::text, 'decision', v_decision,
      'amount', v_activity.fee_amount, 'date', new.start_date),
    coalesce(v_activity.name, ''));
  return new;
end $$;
drop trigger if exists trg_kg_notify_activity_decision on kg_activity_enrollments;
create trigger trg_kg_notify_activity_decision
  after insert or update on kg_activity_enrollments
  for each row execute function kg_notify_activity_decision();

-- 14. A session summary written expressly for the family. kg_daily_reports
--     already notifies on the identical publish; sessions did not.
create or replace function kg_notify_session_published() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not new.published then return new; end if;
  if tg_op = 'UPDATE' and old.published then return new; end if;
  -- The action promises the summary is for the parent; an empty one is not.
  if coalesce(btrim(new.parent_summary), '') = '' then return new; end if;

  perform kg_notify_family(new.tenant_id, new.child_id, 'session_published',
    jsonb_build_object('sessionId', new.id, 'at', new.scheduled_at),
    left(new.parent_summary, 140));
  return new;
end $$;
drop trigger if exists trg_kg_notify_session_published on kg_sessions;
create trigger trg_kg_notify_session_published
  after insert or update on kg_sessions
  for each row execute function kg_notify_session_published();

-- ═════════════════════════════════════════════════════════════════════════
--  FIXES to types that already shipped
-- ═════════════════════════════════════════════════════════════════════════

-- A. A staff reply on a thread with no child attached reached NOBODY: the
--    recipient list was only ever built inside `if child_id is not null`.
create or replace function kg_notify_thread_message() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_thread kg_threads; v_child kg_children; v_recipients uuid[]; v_sender_is_staff boolean;
begin
  select * into v_thread from kg_threads where id = new.thread_id;
  if v_thread.id is null then return new; end if;

  select exists (
    select 1 from kg_memberships m
    where m.tenant_id = v_thread.tenant_id and m.user_id = new.sender_id
      and m.status = 'active' and m.role <> 'parent'
  ) into v_sender_is_staff;

  if v_sender_is_staff then
    -- Staff replied → the family. A general thread (no child) still has one:
    -- everybody who has posted in it, minus the staff.
    if v_thread.child_id is not null then
      select array_agg(u) into v_recipients from kg_parent_user_ids(v_thread.child_id) u;
    else
      select array_agg(distinct tm.sender_id) into v_recipients
        from kg_thread_messages tm
       where tm.thread_id = new.thread_id
         and not exists (
           select 1 from kg_memberships m
           where m.tenant_id = v_thread.tenant_id and m.user_id = tm.sender_id
             and m.status = 'active' and m.role <> 'parent');
    end if;
  else
    select array_agg(u) into v_recipients
      from kg_staff_user_ids(v_thread.tenant_id, array['owner','admin','educator']::kg_role[]) u;
  end if;

  if v_thread.child_id is not null then
    select * into v_child from kg_children where id = v_thread.child_id;
  end if;

  perform kg_notify(
    v_thread.tenant_id, v_recipients, 'message',
    coalesce(nullif(v_thread.subject, ''), 'رسالة جديدة'),
    left(new.body, 140),
    jsonb_build_object(
      'threadId', v_thread.id, 'childId', v_thread.child_id,
      'childName', coalesce(v_child.first_name || ' ' || v_child.last_name, ''),
      'audience', case when v_sender_is_staff then 'parent' else 'staff' end
    ),
    new.sender_id
  );
  return new;
end $$;

-- B. A scheduled announcement never emitted at all: the AFTER INSERT trigger
--    returns early when publish_at is in the future and nothing ever re-runs.
--    The audience rules were inline in that trigger, so they are lifted into a
--    function first — a sweep with its own copy of them would drift.
create or replace function kg_announcement_recipients(a kg_announcements)
returns uuid[] language plpgsql stable security definer set search_path = public as $$
declare v_recipients uuid[];
begin
  if a.audience = 'staff' then
    select array_agg(u) into v_recipients from kg_staff_user_ids(a.tenant_id) u;
  elsif a.audience = 'class' and a.class_id is not null then
    select array_agg(distinct p) into v_recipients
      from kg_children c, lateral kg_parent_user_ids(c.id) p
     where c.class_id = a.class_id and c.status = 'enrolled';
  else -- all | parents
    select array_agg(distinct p) into v_recipients
      from kg_children c, lateral kg_parent_user_ids(c.id) p
     where c.tenant_id = a.tenant_id and c.status = 'enrolled';
    if a.audience = 'all' then
      v_recipients := v_recipients || coalesce(
        (select array_agg(u) from kg_staff_user_ids(a.tenant_id) u), '{}'::uuid[]);
    end if;
  end if;
  return v_recipients;
end $$;
revoke execute on function kg_announcement_recipients(kg_announcements) from anon, authenticated;

create or replace function kg_notify_announcement() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.publish_at > now() then return new; end if;
  perform kg_notify(new.tenant_id, kg_announcement_recipients(new), 'announcement',
    new.title, left(coalesce(new.body, ''), 140),
    jsonb_build_object('announcementId', new.id, 'audience',
      case when new.audience = 'staff' then 'staff' else 'both' end),
    new.created_by);
  return new;
end $$;

-- Swept every 15 minutes by 0048. Deduped on the notification rows themselves
-- rather than a flag column, so a re-scheduled announcement cannot double-send
-- and no backfill is needed for the ones already sitting in the table.
create or replace function kg_publish_due_announcements() returns int
language plpgsql security definer set search_path = public as $$
declare a kg_announcements; v_sent int := 0;
begin
  for a in
    select * from kg_announcements ann
     where ann.publish_at is not null
       and ann.publish_at <= now()
       -- A window, not "all of history": switching this on must not fire every
       -- announcement ever scheduled at the whole crèche at once.
       and ann.publish_at > now() - interval '2 days'
       and not exists (
         select 1 from kg_notifications n
          where n.type = 'announcement'
            and n.data->>'announcementId' = ann.id::text)
  loop
    v_sent := v_sent + kg_notify(a.tenant_id, kg_announcement_recipients(a),
      'announcement', a.title, left(coalesce(a.body, ''), 140),
      jsonb_build_object('announcementId', a.id, 'audience',
        case when a.audience = 'staff' then 'staff' else 'both' end),
      a.created_by);
  end loop;
  return v_sent;
end $$;
revoke execute on function kg_publish_due_announcements() from anon, authenticated;

-- The sweep itself, alongside the two jobs 0048 registered.
select cron.unschedule('kg-publish-due-announcements')
 where exists (select 1 from cron.job where jobname = 'kg-publish-due-announcements');
select cron.schedule(
  'kg-publish-due-announcements', '*/15 * * * *',
  $$select kg_publish_due_announcements()$$);
