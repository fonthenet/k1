-- Realtime for the notification bell.
--
-- Without the table in the supabase_realtime publication, a client's
-- postgres_changes subscription connects happily and then never fires — the
-- bell would look wired but only update on a page reload.
--
-- Realtime enforces RLS for authenticated subscribers, and n_sel restricts
-- kg_notifications to `user_id = auth.uid()`, so a subscriber receives only
-- their own rows. REPLICA IDENTITY stays DEFAULT (primary key only): the
-- payload we need is in the INSERT's new record, and full identity would put
-- every column of every change on the wire.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'kg_notifications'
  ) then
    alter publication supabase_realtime add table kg_notifications;
  end if;
end $$;
