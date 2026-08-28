-- A parent could not start a conversation. "Something went wrong."
--
-- The insert was fine. The RETURNING was not.
--
-- startConversation does .insert({...}).select("id").single(), which is
-- INSERT ... RETURNING id, and Postgres checks a row returned that way against
-- the SELECT policy as well as the INSERT one. th_sel was
--
--   using (kg_can_see_thread(id))
--
-- and kg_can_see_thread is a STABLE function whose body does
-- `select 1 from kg_threads where id = t ...` — it goes back to the table. A
-- STABLE function runs on the snapshot from the start of the statement, so the
-- row the very same statement is inserting is not there to be found. The
-- predicate returned false for a row the caller had just legitimately written,
-- and the whole statement was refused with 42501.
--
-- Proven by isolating the clause: a plain INSERT succeeded, the identical
-- INSERT ... RETURNING failed.
--
-- The fix is to say the same thing about the row itself rather than about a
-- row looked up by id. Identical semantics — its own author, staff of its
-- tenant, or a parent of the child it concerns — but evaluated against the
-- NEW row's columns, so it holds during RETURNING and drops a correlated
-- subquery from every read of the table.
--
-- kg_can_see_thread stays: kg_thread_messages genuinely needs to ask about a
-- DIFFERENT table's row, where the self-reference problem does not arise.
drop policy if exists th_sel on kg_threads;
create policy th_sel on kg_threads for select using (
  created_by = auth.uid()
  or kg_is_staff(tenant_id)
  or (child_id is not null and kg_is_parent_of(child_id))
);
