-- Close the half 0073 missed.
--
-- Locking a function down takes TWO revokes, and each catches a different
-- mistake:
--
--   revoke ... from public;   -- Postgres' own default grant on CREATE
--   revoke ... from anon;     -- Supabase's ALTER DEFAULT PRIVILEGES grant
--
-- 0073 did the first and left the second, so `anon` kept an explicit EXECUTE.
-- The body already refuses when auth.uid() is null, but an unauthenticated role
-- should not be able to reach a SECURITY DEFINER function at all — the guard
-- inside is the second line, not the first.

revoke execute on function kg_register_push_device(text, text) from anon;
