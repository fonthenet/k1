-- Reading a conversation is reading its notifications.
--
-- `kg_mark_thread_read` stamped `kg_thread_reads` and stopped there, so the
-- two places that count the same fact disagreed: you read a parent's message
-- in the inbox bubble, the thread's unread dot cleared, and the bell went on
-- claiming the message was new. Every message notification the reader had
-- already acted on stayed in the list until they opened it a second time from
-- the bell — which marked it read without telling them anything they had not
-- already read.
--
-- The two writes belong in one function rather than one-then-the-other in the
-- server action: a caller that fails between them leaves exactly the split
-- this fixes.
--
-- The return value still means "something changed, refresh" — now over both
-- writes. That keeps the caller's no-loop property: `markThreadRead`
-- revalidates only on true, and once the marker and the notifications are both
-- current this returns false, so a second call is inert.
--
-- Scoped to `auth.uid()` explicitly. SECURITY DEFINER bypasses RLS, so nothing
-- here may rely on `kg_notifications`' own policy to keep one reader out of
-- another's list.

create or replace function kg_mark_thread_read(p_thread uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_last timestamptz;
  v_prev timestamptz;
  v_changed boolean := false;
  v_notifs int;
begin
  -- Only for a thread the caller can actually see. SECURITY DEFINER bypasses
  -- RLS, so the visibility rule from kg_threads is restated here rather than
  -- assumed: without it anyone could stamp a read marker on any thread.
  select t.last_message_at into v_last
    from kg_threads t
   where t.id = p_thread
     and (t.created_by = auth.uid()
          or kg_is_staff(t.tenant_id)
          or (t.child_id is not null and kg_is_parent_of(t.child_id)));
  if v_last is null then return false; end if;

  select r.last_read_at into v_prev
    from kg_thread_reads r where r.thread_id = p_thread and r.user_id = auth.uid();

  if v_prev is null or v_prev < v_last then
    insert into kg_thread_reads (thread_id, user_id, last_read_at)
    values (p_thread, auth.uid(), now())
    on conflict (thread_id, user_id) do update set last_read_at = now();
    v_changed := true;
  end if;

  -- The reader's own message notifications for this thread. `threadId` is the
  -- key `kg_notify` writes for type 'message' and the same one the bell routes
  -- on, so matching it here cannot drift from what the notification links to.
  update kg_notifications n
     set read_at = now()
   where n.user_id = auth.uid()
     and n.type = 'message'
     and n.read_at is null
     and n.data->>'threadId' = p_thread::text;
  get diagnostics v_notifs = row_count;
  if v_notifs > 0 then v_changed := true; end if;

  return v_changed;
end $function$;
