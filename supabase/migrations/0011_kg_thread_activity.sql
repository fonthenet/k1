-- Thread activity must be stamped by the database, not the client.
--
-- kg_threads.th_upd is `kg_is_staff(tenant_id) or created_by = auth.uid()`, so a
-- parent replying to a thread the kindergarten opened cannot bump
-- last_message_at: the UPDATE matches zero rows and returns NO error. The reply
-- is stored but the thread keeps a stale activity time, so it never floats to
-- the top of the staff inbox and a parent's message can sit buried.
--
-- A security-definer trigger stamps it on insert instead, which fixes both
-- directions at the source and removes the need for any client-side bump.

create or replace function kg_touch_thread_activity() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update kg_threads
     set last_message_at = greatest(coalesce(last_message_at, new.created_at), new.created_at)
   where id = new.thread_id;
  return new;
end $$;

revoke execute on function kg_touch_thread_activity() from anon, authenticated;

drop trigger if exists trg_kg_thread_message_activity on kg_thread_messages;
create trigger trg_kg_thread_message_activity
  after insert on kg_thread_messages
  for each row execute function kg_touch_thread_activity();

-- Repair threads whose activity time drifted before the trigger existed.
update kg_threads t
   set last_message_at = m.newest
  from (
    select thread_id, max(created_at) as newest
      from kg_thread_messages group by thread_id
  ) m
 where m.thread_id = t.id
   and t.last_message_at < m.newest;
