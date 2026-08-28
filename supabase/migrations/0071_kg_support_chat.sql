-- Support chat between the platform operator and each crèche.
--
-- One conversation per crèche, not per person: a crèche that writes in with a
-- billing question expects the answer to reach whoever is at the desk, and the
-- operator should see one thread per client rather than one per employee.
--
-- Deliberately separate from kg_threads. That table is the crèche talking to
-- its own families, governed by tenant RLS; this is the crèche talking to its
-- vendor, and the operator sits outside every tenant. Sharing one table would
-- mean one policy trying to express both relationships.
create table if not exists kg_support_threads (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null unique references kg_tenants(id) on delete cascade,
  last_message_at timestamptz not null default now(),
  created_at      timestamptz not null default now()
);

create table if not exists kg_support_messages (
  id            uuid primary key default gen_random_uuid(),
  thread_id     uuid not null references kg_support_threads(id) on delete cascade,
  tenant_id     uuid not null references kg_tenants(id) on delete cascade,
  sender_id     uuid references auth.users(id) on delete set null,
  from_platform boolean not null,
  body          text not null check (btrim(body) <> '' and length(body) <= 4000),
  created_at    timestamptz not null default now()
);
create index if not exists kg_support_messages_thread_idx
  on kg_support_messages (thread_id, created_at desc);

create table if not exists kg_support_reads (
  thread_id    uuid not null references kg_support_threads(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (thread_id, user_id)
);

alter table kg_support_threads  enable row level security;
alter table kg_support_messages enable row level security;
alter table kg_support_reads    enable row level security;

-- Only the crèche's own admins, and the operator. An educator or a parent has
-- no business in the vendor relationship, and a support thread is where prices
-- and contracts get discussed.
drop policy if exists sup_th_sel on kg_support_threads;
create policy sup_th_sel on kg_support_threads for select to authenticated
  using (kg_is_admin(tenant_id) or kg_is_platform_admin());

drop policy if exists sup_msg_sel on kg_support_messages;
create policy sup_msg_sel on kg_support_messages for select to authenticated
  using (kg_is_admin(tenant_id) or kg_is_platform_admin());

-- `from_platform` is checked against who is actually writing, never trusted
-- from the payload: without this a crèche admin could post a message that
-- renders in their own widget as if Rawdati had sent it.
drop policy if exists sup_msg_ins on kg_support_messages;
create policy sup_msg_ins on kg_support_messages for insert to authenticated
  with check (
    sender_id = auth.uid()
    and (
      (from_platform = false and kg_is_admin(tenant_id))
      or (from_platform = true and kg_is_platform_admin())
    )
  );

drop policy if exists sup_read_own on kg_support_reads;
create policy sup_read_own on kg_support_reads for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create or replace function kg_support_touch_thread() returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  update kg_support_threads set last_message_at = new.created_at where id = new.thread_id;
  return new;
end $fn$;
drop trigger if exists trg_kg_support_touch on kg_support_messages;
create trigger trg_kg_support_touch after insert on kg_support_messages
  for each row execute function kg_support_touch_thread();

-- Live delivery, same mechanism as notifications (0015): Broadcast to a private
-- topic, because postgres_changes never fires on this project. One topic per
-- crèche rather than per user, so the operator and every admin of that crèche
-- see the conversation move without the trigger enumerating recipients.
create or replace function kg_broadcast_support_message() returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  perform realtime.send(
    jsonb_build_object(
      'id', new.id, 'thread_id', new.thread_id, 'tenant_id', new.tenant_id,
      'sender_id', new.sender_id, 'from_platform', new.from_platform,
      'body', new.body, 'created_at', new.created_at
    ),
    'support_message',
    'support:' || new.tenant_id::text,
    true
  );
  return new;
end $fn$;
drop trigger if exists trg_kg_broadcast_support on kg_support_messages;
create trigger trg_kg_broadcast_support after insert on kg_support_messages
  for each row execute function kg_broadcast_support_message();

-- Who may listen on a support topic. Permissive, so it ORs with the per-user
-- policy from 0015 rather than replacing it.
drop policy if exists kg_support_topic on realtime.messages;
create policy kg_support_topic on realtime.messages
  for select to authenticated
  using (
    realtime.topic() like 'support:%'
    and (
      kg_is_platform_admin()
      or exists (
        select 1 from kg_tenants t
         where realtime.topic() = 'support:' || t.id::text
           and kg_is_admin(t.id)
      )
    )
  );

-- The crèche's conversation, created on first use. Returns null rather than
-- raising for anyone who has no business opening one, so the widget can simply
-- not render instead of handling an error.
create or replace function kg_support_thread_for(p_tenant uuid)
returns uuid language plpgsql security definer set search_path = public as $fn$
declare v_id uuid;
begin
  if not (kg_is_admin(p_tenant) or kg_is_platform_admin()) then return null; end if;
  select id into v_id from kg_support_threads where tenant_id = p_tenant;
  if v_id is null then
    insert into kg_support_threads (tenant_id) values (p_tenant)
    on conflict (tenant_id) do update set tenant_id = excluded.tenant_id
    returning id into v_id;
  end if;
  return v_id;
end $fn$;
revoke execute on function kg_support_thread_for(uuid) from public, anon;
grant execute on function kg_support_thread_for(uuid) to authenticated;

create or replace function kg_mark_support_read(p_thread uuid)
returns boolean language plpgsql security definer set search_path = public as $fn$
declare v_last timestamptz; v_prev timestamptz;
begin
  select t.last_message_at into v_last
    from kg_support_threads t
   where t.id = p_thread and (kg_is_admin(t.tenant_id) or kg_is_platform_admin());
  if v_last is null then return false; end if;

  select last_read_at into v_prev from kg_support_reads
   where thread_id = p_thread and user_id = auth.uid();
  if v_prev is not null and v_prev >= v_last then return false; end if;

  insert into kg_support_reads (thread_id, user_id, last_read_at)
  values (p_thread, auth.uid(), now())
  on conflict (thread_id, user_id) do update set last_read_at = now();
  return true;
end $fn$;
revoke execute on function kg_mark_support_read(uuid) from public, anon;
grant execute on function kg_mark_support_read(uuid) to authenticated;
