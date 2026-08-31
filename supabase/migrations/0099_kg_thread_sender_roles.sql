-- Who is speaking in a conversation, so a bubble can say "Leïla Merabet ·
-- Éducatrice" instead of a bare name.
--
-- WHY A FUNCTION. `kg_memberships.m_sel` is `user_id = auth.uid() OR
-- kg_is_staff(tenant_id)`: a parent may read their own membership row and
-- nothing else. Staff therefore get roles from a plain select and parents get
-- an empty map — which is backwards, because the parent is the one who cannot
-- otherwise tell the director from the accountant. Relaxing that policy would
-- hand every parent the full staff roster, so instead this returns the roles
-- of the people who have actually written in ONE thread the caller can
-- already read. Nothing is revealed that the thread did not already reveal:
-- the caller can see these messages and these senders' names via `pr_sel`;
-- this only adds what each sender's role is.
--
-- The guard is `kg_can_see_thread`, the same predicate `tm_sel` uses for the
-- messages themselves, so visibility of a role can never outrun visibility of
-- the message it labels.

create or replace function kg_thread_sender_roles(t uuid)
returns table (user_id uuid, role text)
language sql
stable
security definer
set search_path to 'public'
as $$
  select distinct m.user_id, m.role::text
  from kg_thread_messages tm
  join kg_memberships m
    on m.user_id = tm.sender_id
   and m.tenant_id = (select th.tenant_id from kg_threads th where th.id = t)
  where tm.thread_id = t
    and kg_can_see_thread(t)
$$;

-- Definer functions are executable by PUBLIC unless told otherwise, and this
-- one takes a uuid an anonymous caller could guess at. The guard already
-- returns nothing for a caller with no visible thread, but a signed-out
-- caller has no business reaching the function at all.
revoke all on function kg_thread_sender_roles(uuid) from public, anon;
grant execute on function kg_thread_sender_roles(uuid) to authenticated;
