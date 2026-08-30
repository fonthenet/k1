-- Who may call what, and why it is not symmetrical.
--
-- kg_register_push_device  → authenticated only (see 0074). A phone
--                            registering itself is a signed-in action;
--                            auth.uid() IS the security.
-- kg_pending_native_push   → anon too.
-- kg_drop_push_device      → anon too.
--
-- The last two look wrong and are not. `dispatchPendingPush()` connects with the
-- ANON key and nothing else, proving itself with PUSH_DISPATCH_SECRET inside the
-- function, so the caller's role really is `anon`. Locking them to authenticated
-- would leave the dispatcher unable to read its own queue — notifications would
-- sit unsent with no error anywhere.
--
-- kg_pending_push (0013) is anon-callable today for the same reason, though by
-- accident: its `revoke ... from anon, authenticated` never took effect because
-- the PUBLIC grant stood. Push works BECAUSE that revoke failed.
--
-- ⚠ Anyone sweeping the 0006-class revoke bug must skip these three, or push
--   stops product-wide with nothing in the logs to say why.

grant execute on function kg_pending_native_push(text, int) to anon, authenticated;
grant execute on function kg_drop_push_device(text, text)   to anon, authenticated;
