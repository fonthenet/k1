-- The SECURITY DEFINER helpers were reachable from the internet.
--
-- APPLIED 2026-08-30. Verified afterwards: anon calls to kg_notify,
-- kg_staff_user_ids, kg_next_child_tag and kg_push_secret_ok all return
-- `permission denied`; kg_admission_fees and kg_tenant_name_available still
-- work for a signed-in staff user; and the application-status trigger still
-- delivers (kg_notifications 120 -> 121 on a rolled-back status change).
--
-- After 0077/0086 closed the money functions, an audit of what remained found
-- 125 SECURITY DEFINER functions still executable by `anon`. 50 are trigger
-- functions (PostgREST does not expose those as RPC) and 52 carry their own
-- authorization check. The other 23 had none, and this is what they did.
--
-- Every finding below was demonstrated against production as role `anon` with
-- NO JWT, inside a rolled-back transaction:
--
--   kg_notify              INSERTED 3 real notification rows (120 -> 123) with
--                          attacker-chosen type, title and body. Chained with
--                          kg_staff_user_ids, one tenant uuid reached all 5
--                          staff inboxes. That is phishing delivered inside the
--                          app's own notification feed, where it looks exactly
--                          like a real alert from the crèche.
--   kg_staff_user_ids      tenant uuid -> 5 staff user ids.
--   kg_parent_user_ids     child uuid  -> that child's parent user id.
--   kg_membership_for_code a valid staff badge code resolved to its membership,
--                          making the door credential a brute-force oracle.
--   kg_push_secret_ok      unlimited offline-style guesses at the push secret.
--   kg_bootstrap_profile   wrote/updated a REAL user's profile row.
--   kg_next_child_tag      returned K-018 — the next badge the scanner accepts.
--   kg_publish_due_announcements  callable, forcing the publish sweep early.
--
-- Two that looked bad and are NOT: kg_approve_and_bill delegates to
-- kg_approve_application, which raises `forbidden` (verified), and
-- kg_identity_seed fails on `permission denied for table users`.
--
-- None of these are called by any client. Verified by grepping every `.rpc(`
-- call site in both the web app and the phone app: the only genuinely
-- unauthenticated surfaces are the enrolment link (kg_get_enroll_link,
-- kg_submit_application) and the kiosk (kg_checkin_by_tag, kg_staff_clock_by_code,
-- kg_staff_clock_state) — none of which appear below. Everything here is called
-- by triggers or by other SECURITY DEFINER functions, which run as the owner and
-- therefore need no grant to any client role.

-- 1. Internal plumbing. No client role needs EXECUTE, so neither gets it.
revoke all on function kg_notify(uuid, uuid[], text, text, text, jsonb, uuid) from public, anon, authenticated;
revoke all on function kg_staff_user_ids(uuid, kg_role[]) from public, anon, authenticated;
revoke all on function kg_parent_user_ids(uuid) from public, anon, authenticated;
revoke all on function kg_identity_seed(uuid) from public, anon, authenticated;
revoke all on function kg_bootstrap_profile(uuid) from public, anon, authenticated;
revoke all on function kg_member_name(uuid) from public, anon, authenticated;
revoke all on function kg_membership_for_code(uuid, text) from public, anon, authenticated;
revoke all on function kg_credential_subject_live(uuid, kg_credential_subject, uuid) from public, anon, authenticated;
revoke all on function kg_push_secret_ok(text) from public, anon, authenticated;
revoke all on function kg_next_child_tag(uuid) from public, anon, authenticated;
revoke all on function kg_publish_due_announcements() from public, anon, authenticated;
revoke all on function kg_income_category_for_kind(uuid, text) from public, anon, authenticated;
revoke all on function kg_income_category_for_payment(uuid, uuid) from public, anon, authenticated;
revoke all on function kg_announcement_recipients(kg_announcements) from public, anon, authenticated;

-- 2. Called by a signed-in client, so `authenticated` stays; `anon` does not.
--    kg_admission_fees      — applications/[id] (dashboard, staff only)
--    kg_approve_and_bill    — the approve action; already guarded transitively
--    kg_tenant_*_available  — the onboarding wizard, which runs after sign-up
revoke all on function kg_admission_fees(uuid) from public, anon;
grant execute on function kg_admission_fees(uuid) to authenticated;

revoke all on function kg_approve_and_bill(uuid, uuid, text, uuid, numeric, numeric, boolean) from public, anon;
grant execute on function kg_approve_and_bill(uuid, uuid, text, uuid, numeric, numeric, boolean) to authenticated;

revoke all on function kg_tenant_name_available(text) from public, anon;
grant execute on function kg_tenant_name_available(text) to authenticated;
revoke all on function kg_tenant_slug_available(text) from public, anon;
grant execute on function kg_tenant_slug_available(text) to authenticated;

-- 3. Trigger functions. PostgREST will not expose a function returning
--    `trigger` as an RPC, so these were not reachable — but a grant that can
--    never be used is a grant nobody should have to reason about again. The
--    triggers themselves fire as the table owner and are unaffected.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      join pg_type t on t.oid = p.prorettype
     where n.nspname = 'public' and p.prosecdef and t.typname = 'trigger'
       and (has_function_privilege('anon', p.oid, 'EXECUTE')
            or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
  end loop;
end $$;
