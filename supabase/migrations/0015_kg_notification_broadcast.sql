-- Live notifications over Realtime Broadcast (not postgres_changes).
--
-- This project's Realtime only starts replication for
-- supabase_realtime_messages_publication — the Broadcast path — so a
-- postgres_changes subscription connects and then never fires. Broadcast is
-- also the direction Supabase recommends: postgres_changes re-evaluates RLS
-- per subscriber per row, while a broadcast is written once to a private,
-- per-user topic.
--
-- Topic is `user:<uuid>`, marked private, so authorisation is a policy on
-- realtime.messages rather than a filter the client asks for politely.

create or replace function kg_broadcast_notification() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform realtime.send(
    jsonb_build_object(
      'id', new.id, 'type', new.type, 'title', new.title, 'body', new.body,
      'data', new.data, 'created_at', new.created_at, 'read_at', new.read_at,
      'tenant_id', new.tenant_id, 'user_id', new.user_id
    ),
    'notification',
    'user:' || new.user_id::text,
    true   -- private topic
  );
  return new;
end $$;

drop trigger if exists trg_kg_broadcast_notification on kg_notifications;
create trigger trg_kg_broadcast_notification
  after insert on kg_notifications
  for each row execute function kg_broadcast_notification();

-- Authorisation for private channels: a user may only listen on their own topic.
-- realtime.messages already has RLS enabled by the platform.
drop policy if exists kg_user_reads_own_topic on realtime.messages;
create policy kg_user_reads_own_topic on realtime.messages
  for select to authenticated
  using (realtime.topic() = 'user:' || auth.uid()::text);

-- postgres_changes is no longer the delivery path, so keep the table out of
-- that publication rather than paying for replication nothing consumes.
do $$
begin
  if exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'kg_notifications'
  ) then
    alter publication supabase_realtime drop table kg_notifications;
  end if;
end $$;
