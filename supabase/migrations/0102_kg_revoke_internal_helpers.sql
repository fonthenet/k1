-- 0102 — two internal helpers were callable by anyone holding the anon key.
--
-- ---------------------------------------------------------------------------
-- What is wrong
-- ---------------------------------------------------------------------------
--
-- Postgres grants EXECUTE on every new function to PUBLIC, and Supabase's
-- `anon` and `authenticated` roles both inherit from PUBLIC. A SECURITY
-- DEFINER function therefore runs as its owner — here `postgres`, a superuser,
-- for whom RLS does not exist — for whoever calls it, unless the migration
-- that created it revoked the grant or the body checks the caller itself.
--
-- An audit of every kg_ definer function executable by anon (57 of them)
-- found exactly two that neither revoke nor check:
--
--   kg_apply_staff_clock(p_tenant, p_membership, p_direction, p_method)
--     Inserts and updates kg_timesheets for ANY membership in ANY tenant,
--     with the tenant and membership taken from the caller's arguments.
--     Anyone with the anon key — which ships in the browser bundle — could
--     clock any employee of any crèche in or out, start their break, or
--     close their day. Timesheets feed payroll.
--
--   kg_sync_credential(p_tenant, p_subject, p_subject_id, p_kind, p_value)
--     Revokes and re-issues the door PIN / QR tag behind kg_credentials for
--     ANY child, guardian or staff member in ANY tenant. Anyone with the
--     anon key could revoke a parent's pick-up credential, or mint a new
--     one whose value they chose.
--
-- Neither is ever called from application code. Both are plumbing:
-- kg_apply_staff_clock is the shared body behind kg_staff_clock (self,
-- authenticated) and kg_staff_clock_by_code (kiosk, by staff code), and
-- kg_sync_credential is called from the triggers that mirror pin_code /
-- tag_code columns into kg_credentials. Those callers are themselves
-- SECURITY DEFINER and owned by postgres, so they keep the right to call
-- these after the grant is removed from everybody else.
--
-- Migration 0038 DID revoke kg_apply_staff_clock from anon and authenticated
-- when it created the function. The live database nonetheless reported
-- has_function_privilege('anon', …) = true, which means a later change
-- recreated the function without re-applying the revoke — a grant is lost
-- whenever a function is dropped and created rather than replaced. That is
-- the second lesson of this file: a revoke in the creating migration is not
-- durable. The hygiene below is applied unconditionally and can be re-run.
--
-- The rest of the anon-executable set was reviewed and left alone, each for
-- a reason: kg_get_enroll_link, kg_claim_preview, kg_submit_lead and
-- kg_is_open_on are meant to be public and are read-only or rate-limited;
-- kg_pending_push, kg_mark_pushed and kg_drop_push_* are gated on a shared
-- secret checked in the body; every other definer function checks
-- auth.uid() or a kg_is_* predicate before writing.

begin;

-- The two that matter.
revoke execute on function kg_apply_staff_clock(uuid, uuid, text, kg_checkin_method)
  from public, anon, authenticated;
revoke execute on function kg_sync_credential(uuid, kg_credential_subject, uuid, kg_credential_kind, text)
  from public, anon, authenticated;

-- Trigger functions cannot usefully be invoked by hand, but there is no
-- reason for an API role to hold EXECUTE on them either. Same hygiene.
revoke execute on function kg_on_event_insert() from public, anon, authenticated;
revoke execute on function kg_on_event_update() from public, anon, authenticated;
revoke execute on function kg_on_event_delete() from public, anon, authenticated;

comment on function kg_apply_staff_clock(uuid, uuid, text, kg_checkin_method) is
  'INTERNAL. Shared body of kg_staff_clock and kg_staff_clock_by_code; trusts its arguments and must never be granted to an API role. See 0102.';
comment on function kg_sync_credential(uuid, kg_credential_subject, uuid, kg_credential_kind, text) is
  'INTERNAL. Called by the pin/tag mirror triggers; trusts its arguments and must never be granted to an API role. See 0102.';

commit;
