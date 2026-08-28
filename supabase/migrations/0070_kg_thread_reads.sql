-- Read state for message threads.
--
-- The messages list showed an "unread" dot computed as `last message was not
-- sent by me`. Nothing recorded that anyone had opened anything, so the dot
-- could not be cleared by reading the thread — only by replying to it. Open a
-- conversation, read every word, come back, and it still claimed to be unread.
--
-- One row per person per thread, holding when they last opened it. A thread is
-- unread when somebody else's message arrived after that moment.
create table if not exists kg_thread_reads (
  thread_id    uuid not null references kg_threads(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (thread_id, user_id)
);

alter table kg_thread_reads enable row level security;

-- Your own read state, and nobody else's. There is no reason for one person to
-- see when another opened a conversation, and a read receipt visible across a
-- crèche is a different product decision than the one being made here.
drop policy if exists tr_own on kg_thread_reads;
create policy tr_own on kg_thread_reads for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

comment on table kg_thread_reads is
  'When each person last opened each thread. The messages list previously marked a thread unread whenever the newest message was not yours, which never cleared by reading it — only by replying.';

-- Marks the thread read for the caller, and reports whether that changed
-- anything so the client can refresh the list only when it actually needs to.
create or replace function kg_mark_thread_read(p_thread uuid)
returns boolean language plpgsql security definer set search_path = public as $fn$
declare v_last timestamptz; v_prev timestamptz;
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

  -- Already up to date: say so, so the caller does not refresh for nothing.
  if v_prev is not null and v_prev >= v_last then return false; end if;

  insert into kg_thread_reads (thread_id, user_id, last_read_at)
  values (p_thread, auth.uid(), now())
  on conflict (thread_id, user_id) do update set last_read_at = now();
  return true;
end $fn$;

revoke execute on function kg_mark_thread_read(uuid) from public, anon;
grant execute on function kg_mark_thread_read(uuid) to authenticated;
