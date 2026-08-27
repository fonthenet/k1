-- Defense-in-depth: pin search_path on all kg functions and restrict anon execution
alter function kg_is_staff(uuid) set search_path = public;
alter function kg_is_admin(uuid) set search_path = public;
alter function kg_is_finance(uuid) set search_path = public;
alter function kg_is_educator(uuid) set search_path = public;
alter function kg_touch_updated_at() set search_path = public;

-- Trigger functions: no direct execution by API roles
revoke execute on function kg_touch_updated_at() from anon, authenticated;
revoke execute on function kg_assign_receipt_number() from anon, authenticated;
revoke execute on function kg_assign_invoice_number() from anon, authenticated;
revoke execute on function kg_on_payment_insert() from anon, authenticated;

-- Action RPCs: authenticated only (they still validate roles internally)
revoke execute on function kg_create_tenant(text, text, text, text) from anon;
revoke execute on function kg_submit_application(text, jsonb, jsonb, jsonb, jsonb) from anon;
revoke execute on function kg_approve_application(uuid, uuid, text) from anon;
revoke execute on function kg_checkin_by_tag(uuid, text, text, kg_checkin_method, text) from anon;
revoke execute on function kg_staff_clock(uuid, text, kg_checkin_method) from anon;
revoke execute on function kg_staff_clock_by_code(uuid, text, text) from anon;
revoke execute on function kg_ack_incident(uuid) from anon;
revoke execute on function kg_accept_staff_invite(text) from anon;
revoke execute on function kg_generate_monthly_invoices(uuid, date) from anon;
revoke execute on function kg_dashboard_stats(uuid) from anon;
-- kg_get_enroll_link stays anon-executable by design (public enrollment landing).
