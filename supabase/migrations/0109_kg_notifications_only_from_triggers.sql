-- 0109 — a notification could be forged by any member of staff, or by anyone
-- holding the anon key.
--
-- ---------------------------------------------------------------------------
-- What is wrong
-- ---------------------------------------------------------------------------
--
-- Two doors into kg_notifications were left open in 0003 and 0049 and nobody
-- walks through either of them legitimately:
--
--   n_ins   INSERT  WITH CHECK (kg_is_staff(tenant_id))
--
-- lets any educator, accountant or assistant insert a row addressed to ANY
-- user_id — a parent's, the owner's — with a type, title and body of their
-- choosing. Every real notification is written by kg_notify() from a trigger
-- or a SECURITY DEFINER function owned by postgres, which needs no policy at
-- all. The web app has no `.from("kg_notifications").insert(` anywhere; the
-- policy exists only for an attacker.
--
--   kg_notify_family(uuid, uuid, text, jsonb, text)   EXECUTE by anon
--
-- 0049 revoked it "from anon, authenticated" but not from PUBLIC, and both API
-- roles inherit PUBLIC. So the grant stood, and the function has no caller
-- check of its own — it fans out to a child's parents whatever type and body it
-- is handed. With a child uuid (printed in every portal URL) and the anon key
-- (shipped in the browser bundle), anyone can push "invoice_issued — 45 000 DA"
-- or a pickup_changed alert to a Jijel family, rendered by the app exactly like
-- a real one. kg_notify_parent_edit (0016) has the same shape and the same
-- exposure. Both are called only from triggers and definer functions.
--
-- A third, quieter gap: `type` is free text. The client renders an unknown
-- type through a fallback that shows the stored title verbatim, so a forged
-- type is not even filtered out on display.
--
-- ---------------------------------------------------------------------------
-- The fix
-- ---------------------------------------------------------------------------
--
-- Drop n_ins: nothing in the web app inserts here, and the triggers that do
-- run as the table owner. NOTE FOR THE OWNER: the phone app is a separate
-- repository not visible from here. Grep it for `kg_notifications` + insert
-- before applying; if a client insert exists there it must move behind a
-- definer RPC that checks the caller, not keep the policy.
--
-- Revoke the two fan-out helpers from PUBLIC as well as the API roles, the way
-- 0074 and 0087 learned to. The triggers that call them run as postgres and
-- keep the right.
--
-- Pin `type` to the closed list the client knows how to render. The list is
-- the union of NOTIFICATION_TYPES in src/lib/notifications.ts and every type a
-- migration actually writes (advance_requested from 0084 is in the database
-- but missing from the TypeScript list — noted for that file's owner). The
-- column default 'info' goes: no writer relies on it, and a default that the
-- check would reject is a trap.
--
-- Finally, an audit that can be re-run: a list of every SECURITY DEFINER
-- function anon may EXECUTE, compared with the deliberate allowlist. It warns
-- rather than aborting, because a migration that refuses to apply on account
-- of a grant made by some OTHER migration in the same batch is worse than a
-- warning the owner reads. Re-run the DO block on its own after any batch.

begin;

/* ------------------------------------------------------------ the policy */

drop policy if exists n_ins on kg_notifications;

/* ------------------------------------------------------- the two helpers */

revoke all on function kg_notify_family(uuid, uuid, text, jsonb, text)
  from public, anon, authenticated;
revoke all on function kg_notify_parent_edit(uuid, uuid, text, text)
  from public, anon, authenticated;

comment on function kg_notify_family(uuid, uuid, text, jsonb, text) is
  'INTERNAL. Fans a notification out to a child''s parents; trusts its arguments and must never be granted to an API role. See 0109.';
comment on function kg_notify_parent_edit(uuid, uuid, text, text) is
  'INTERNAL. Tells staff about a parent''s edit; trusts its arguments and must never be granted to an API role. See 0109.';

/* ------------------------------------------------------------ the type */

alter table kg_notifications alter column type drop default;

alter table kg_notifications drop constraint if exists kg_notifications_type_known;
alter table kg_notifications add constraint kg_notifications_type_known check (
  type in (
    'message', 'incident', 'announcement', 'application',
    'checkin', 'checkout', 'daily_report', 'task', 'activity_request',
    'parent_update', 'payment_overdue', 'consent_changed',
    'pickup_changed', 'guardian_access_changed', 'allergy_changed', 'health_changed',
    'incident_updated', 'enrollment_changed',
    'invoice_issued', 'payment_recorded', 'payment_reversed', 'fee_changed',
    'attendance_flagged', 'activity_decision', 'session_published',
    'application_status', 'event',
    -- 0084: written by kg_on_advance_change, absent from the client list.
    -- All THREE are needed. kg_notify_advance builds its type as
    -- 'advance_' || new.status, so approving or rejecting a salary advance
    -- writes advance_approved / advance_rejected. Only advance_requested has
    -- appeared in production so far — because nobody has approved a phone
    -- request yet — and listing only what the table happens to contain would
    -- have made the first approval fail with a constraint violation, inside
    -- the trigger, aborting the approval itself.
    'advance_requested', 'advance_approved', 'advance_rejected'
  )
) not valid;

-- Every row in production today already satisfies the list (22 distinct
-- types, all above). Validate separately so that, should a stray row exist in
-- another environment, the constraint still lands and the row is reported by
-- name rather than the whole file failing.
alter table kg_notifications validate constraint kg_notifications_type_known;

/* --------------------------------------------------------------- audit */

-- Re-runnable. Lists every definer function anon can call that is not on the
-- allowlist below. The allowlist is what was reviewed and left alone, each for
-- a reason: public-by-design (enrol link, claim/invite previews, the lead
-- form, opening hours), the push dispatcher (gated on a shared secret in the
-- body), the RLS helpers (a policy evaluated as anon must be able to call
-- them, or an anonymous SELECT errors instead of returning nothing), and the
-- signed-in RPCs whose bodies check auth.uid() or a kg_is_* predicate.
-- 0115 narrows the last group further.
do $$
declare r record; v_unexpected text[] := '{}';
begin
  for r in
    select p.oid::regprocedure::text as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      join pg_type t on t.oid = p.prorettype
     where n.nspname = 'public' and p.prosecdef and p.proname like 'kg\_%'
       and t.typname <> 'trigger'
       and has_function_privilege('anon', p.oid, 'EXECUTE')
  loop
    if r.sig not in (
      -- public by design
      'kg_get_enroll_link(text)', 'kg_claim_preview(text)',
      'kg_staff_invite_preview(text)', 'kg_submit_lead(text,text,text,text,text,text,text)',
      'kg_is_open_on(uuid,date)',
      -- push dispatcher, secret-gated in the body (0076)
      'kg_pending_push(text,integer)', 'kg_pending_native_push(text,integer)',
      'kg_mark_pushed(text,uuid[])', 'kg_drop_push_device(text,text)',
      'kg_drop_push_subscription(text,text)',
      -- RLS helpers
      'kg_is_member(uuid)', 'kg_role_in(uuid,kg_role[])', 'kg_my_tenants()',
      'kg_shares_tenant(uuid)', 'kg_actor_is_parent(uuid)', 'kg_can_see_thread(uuid)',
      'kg_is_my_membership(uuid)', 'kg_is_parent_of(uuid)', 'kg_is_parent_of_invoice(uuid)',
      'kg_is_platform_admin()', 'kg_storage_access(text,boolean)', 'kg_tenant_active(uuid)',
      -- kiosk, each checks kg_is_educator / a staff code in the body
      'kg_checkin_by_tag(uuid,text,text,kg_checkin_method,text,uuid,boolean)',
      'kg_staff_clock_by_code(uuid,text,text)', 'kg_staff_clock_state(uuid,text)',
      'kg_resolve_credential(uuid,text)',
      -- signed-in RPCs with their own check; 0115 revokes anon from these
      'kg_accept_staff_invite(text)', 'kg_ack_incident(uuid)', 'kg_arrears_summary(uuid)',
      'kg_create_local_member(uuid,text,kg_role,text,kg_pay_type,numeric,numeric,date)',
      'kg_create_tenant(text,text,text,text,text)', 'kg_dashboard_stats(uuid)',
      'kg_issue_credential(uuid,kg_credential_subject,uuid,kg_credential_kind,text,text)',
      'kg_issue_guardian_claim(uuid,uuid)', 'kg_issue_guardian_credentials(uuid)',
      'kg_issue_invoices(uuid,date)', 'kg_link_member_account(uuid,text)',
      'kg_mark_notifications_read(uuid[])', 'kg_my_applications()', 'kg_payroll_basis(uuid,date)',
      'kg_platform_stats()', 'kg_platform_tenants()', 'kg_redeem_guardian_claim(text)',
      'kg_revoke_credential(uuid,uuid)', 'kg_revoke_guardian_credentials(uuid)',
      'kg_set_child_photo(uuid,text)', 'kg_set_lead_status(uuid,kg_lead_status,text)',
      'kg_set_tenant_status(uuid,text)', 'kg_staff_clock(uuid,text,kg_checkin_method)',
      'kg_submit_application(text,jsonb,jsonb,jsonb,jsonb,uuid)',
      'kg_submit_sibling_application(uuid,jsonb,jsonb,jsonb)'
    ) then
      v_unexpected := v_unexpected || r.sig;
    end if;
  end loop;

  if array_length(v_unexpected, 1) > 0 then
    raise warning 'kg definer functions executable by anon and NOT on the 0109 allowlist: %',
      array_to_string(v_unexpected, ', ');
  else
    raise notice '0109 audit: every anon-executable kg definer function is on the allowlist.';
  end if;
end $$;

commit;
