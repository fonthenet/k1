-- 0115 — three revokes written in 0006, 0007 and 0057 never took.
--
-- ---------------------------------------------------------------------------
-- What is wrong
-- ---------------------------------------------------------------------------
--
-- 0006 wrote
--
--   revoke execute on function kg_create_tenant(...)      from anon;
--   revoke execute on function kg_submit_application(...) from anon;
--   revoke execute on function kg_accept_staff_invite(text) from anon;
--
-- and 0007 / 0057 repeated the first two for the functions' new signatures.
-- All five statements succeeded and changed nothing observable: Postgres
-- grants EXECUTE on a new function to PUBLIC, `anon` inherits PUBLIC, and a
-- revoke from `anon` removes a grant anon never held directly. On 2026-09-02
-- has_function_privilege('anon', ...) is still true for all three. 0074
-- discovered the pattern (`revoke ... from public, anon`) and 0087 and 0102
-- applied it; these three predate the lesson.
--
-- This is defence in depth, not a live hole: each body starts with
-- `if auth.uid() is null then raise exception 'auth required'`, so an
-- anonymous call fails one line in. It is still the wrong grant, and the
-- 0109 audit lists it every time it runs.
--
-- ---------------------------------------------------------------------------
-- The fix
-- ---------------------------------------------------------------------------
--
-- The two-role form, for every RPC that is only ever called after sign-in
-- and says so in its body. `authenticated` keeps EXECUTE; the enrolment
-- wizard signs the family up before it calls kg_submit_application, and the
-- onboarding wizard runs after sign-up. The kiosk functions, the push
-- dispatcher, the public previews and the RLS helpers are deliberately left
-- as they are — see the 0109 allowlist for why each one stays.
--
-- The platform functions are included: 0043 granted them "to authenticated"
-- and meant that as the whole audience, but PUBLIC kept its default grant.
-- kg_link_member_account (0044) is admin-only in the body and now has a
-- caller in the app.
--
-- Deliberately NOT a blanket revoke over every definer function. 0102 kept the
-- guarded ones on purpose, and 0076 warns that kg_pending_native_push and the
-- kg_drop_push_* family must keep anon.

begin;

revoke all on function kg_create_tenant(text, text, text, text, text) from public, anon;
grant execute on function kg_create_tenant(text, text, text, text, text) to authenticated;

revoke all on function kg_submit_application(text, jsonb, jsonb, jsonb, jsonb, uuid) from public, anon;
grant execute on function kg_submit_application(text, jsonb, jsonb, jsonb, jsonb, uuid) to authenticated;

revoke all on function kg_submit_sibling_application(uuid, jsonb, jsonb, jsonb) from public, anon;
grant execute on function kg_submit_sibling_application(uuid, jsonb, jsonb, jsonb) to authenticated;

-- 0113 recreates this one and revokes there too; repeated so this file is a
-- complete statement of the intent on its own.
revoke all on function kg_accept_staff_invite(text) from public, anon;
grant execute on function kg_accept_staff_invite(text) to authenticated;

revoke all on function kg_link_member_account(uuid, text) from public, anon;
grant execute on function kg_link_member_account(uuid, text) to authenticated;

revoke all on function kg_platform_stats() from public, anon;
grant execute on function kg_platform_stats() to authenticated;
revoke all on function kg_platform_tenants() from public, anon;
grant execute on function kg_platform_tenants() to authenticated;
revoke all on function kg_set_tenant_status(uuid, text) from public, anon;
grant execute on function kg_set_tenant_status(uuid, text) to authenticated;
revoke all on function kg_set_lead_status(uuid, kg_lead_status, text) from public, anon;
grant execute on function kg_set_lead_status(uuid, kg_lead_status, text) to authenticated;

commit;
