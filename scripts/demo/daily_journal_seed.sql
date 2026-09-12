-- The daily journal of Thursday 2026-09-10 on the demo tenant, as if the
-- evening sender had run at 17:03.
--
-- Run ONCE by the owner in the SQL editor, after migration 0152 is applied,
-- never through the UI. Demo tenant only; the real client (fb050631-…) is
-- named once below, to assert that it did not move.
--
-- Why 2026-09-10: an open Thursday on which the demo already holds one block
-- for Adam's class (Petite Section) and a published building-wide menu, so
-- the composed day carries an activity, the menu, the journal and Adam's
-- one incident — every section the screens are photographed with. What this
-- file writes, in the order the sender would have:
--   attendance   present 08:06–16:30 for the children of the four crèche
--                classes, absent for two of them (the Journal screen shows
--                the "Non envoyé · absent" reason);
--   journals     published, with a lunch line, a 13:00–14:00 nap, a mood and
--                one note each — written under the sender's session flag so
--                the 0012 trigger stays quiet, exactly as the sender does;
--   consent      photos granted for Adam, so his photos dialog opens ready
--                while every other child's opens in its explaining state;
--   ledger       one row per child: `sent` for the families with an account,
--                `skipped_no_account` for the others, `skipped_absent` for
--                the two absent — all decided at 17:03, the time the Journal
--                rows and the settings footer display;
--   digests      one daily_report notification per guardian account, composed
--                by kg_child_day_compose / kg_daily_journal_data like the
--                sender's, then stamped created_at 17:03 and pushed_at, since
--                nothing written to the demo may ever reach a phone
--                (README, "Rules for whoever demos it").
--
-- Idempotent: every insert either does nothing on its unique key or restates
-- the same values; the digest is deduplicated by the partial unique index
-- kg_notifications_daily_digest_once. Running it twice changes nothing.
-- The block at the bottom removes everything it wrote.
begin;
set local kg.journal_sender = 'on';

do $$
declare
  v_demo uuid := '732bdf7d-775a-4ed7-875f-8c04ea4e4778';
begin
  if not exists (select 1 from public.kg_tenants
                  where id = v_demo and settings ->> 'demo' = 'true') then
    raise exception 'target % is not a tenant flagged demo — refusing', v_demo;
  end if;
  if to_regclass('public.kg_daily_journal_ledger') is null
     or to_regprocedure('public.kg_child_day_compose(uuid, date, boolean)') is null then
    raise exception 'migration 0152_kg_daily_journal.sql is not applied — apply it first';
  end if;
end $$;

-- The children of the four crèche classes, numbered in a stable order so the
-- moods, meals and notes below vary from child to child the same way on
-- every run. The two absent children are the first two of the Crèche class
-- without a guardian account, so every family that can log in is told.
create temp table seed_children on commit drop as
select ch.id, ch.class_id, ch.structure_id,
       exists (select 1 from public.kg_parent_user_ids(ch.id)) as has_account,
       row_number() over (order by c.name, ch.last_name, ch.first_name, ch.id)::int as n
  from public.kg_children ch
  join public.kg_classes c on c.id = ch.class_id
  join public.kg_structures s on s.id = c.structure_id
 where ch.tenant_id = '732bdf7d-775a-4ed7-875f-8c04ea4e4778'
   and ch.status = 'enrolled' and s.center_type = 'nursery';
alter table seed_children add column absent boolean not null default false;
update seed_children set absent = true
 where id in (select id from seed_children
               where class_id = '94fdfd08-927f-419c-9ccd-2a8b41bec6bd' and not has_account
               order by n limit 2);

insert into public.kg_attendance
  (tenant_id, child_id, date, status, check_in_at, check_out_at, check_in_method, check_out_method)
select '732bdf7d-775a-4ed7-875f-8c04ea4e4778', id, date '2026-09-10',
       case when absent then 'absent' else 'present' end::public.kg_attendance_status,
       case when absent then null else (timestamp '2026-09-10 08:06') at time zone 'Africa/Algiers' end,
       case when absent then null else (timestamp '2026-09-10 16:30') at time zone 'Africa/Algiers' end,
       case when absent then null else 'manual' end::public.kg_checkin_method,
       case when absent then null else 'manual' end::public.kg_checkin_method
  from seed_children
on conflict (child_id, date) do nothing;

insert into public.kg_daily_reports
  (tenant_id, child_id, date, mood, meals, nap, notes, published, created_by)
select '732bdf7d-775a-4ed7-875f-8c04ea4e4778', id, date '2026-09-10',
       (array['happy', 'calm', 'happy', 'tired', 'calm', 'upset', 'happy'])[1 + n % 7],
       jsonb_build_array(jsonb_build_object(
         'meal', 'lunch',
         'eaten', (array['all', 'all', 'half', 'all', 'little', 'all', 'half'])[1 + n % 7])),
       jsonb_build_object('start', '13:00', 'end', '14:00'),
       (array['لعب في الساحة ورسم بالألوان.',
              'استمع إلى القصة بانتباه.',
              'شارك في أنشودة الصباح مع أصدقائه.',
              'بنى برجا من المكعبات ثم رتّب مكانه.',
              'يوم هادئ، أكل ونام في وقته.'])[1 + n % 5],
       true,
       (select u.id from auth.users u where u.email = 'directrice@rawdatik.com')
  from seed_children
 where not absent
on conflict (child_id, date) do nothing;

-- Adam's family granted the photos consent; the row carries a note naming
-- this seed so the teardown removes it and no other decision.
insert into public.kg_consents (tenant_id, child_id, consent_type, granted, decided_by, decided_at, note)
values ('732bdf7d-775a-4ed7-875f-8c04ea4e4778', '809202b0-ab41-4523-8f4c-298aae11fa5e', 'photos', true,
        (select u.id from auth.users u where u.email = 'parent1@rawdatik.com'),
        (timestamp '2026-09-01 09:00') at time zone 'Africa/Algiers', 'demo seed 2026-09-10')
on conflict (child_id, consent_type) do update
  set granted = excluded.granted, decided_by = excluded.decided_by,
      decided_at = excluded.decided_at, note = excluded.note;

-- The ledger is the sender's alone in production (0152 gives it no write
-- policy); the demo writes it here once, as the SQL editor, to show a day
-- that went out.
insert into public.kg_daily_journal_ledger
  (tenant_id, child_id, structure_id, day, status, recipients, decided_at, note)
select '732bdf7d-775a-4ed7-875f-8c04ea4e4778', id, structure_id, date '2026-09-10',
       case when absent then 'skipped_absent'
            when has_account then 'sent'
            else 'skipped_no_account' end,
       case when not absent and has_account
            then (select count(*) from public.kg_parent_user_ids(seed_children.id)) else 0 end,
       (timestamp '2026-09-10 17:03') at time zone 'Africa/Algiers',
       null
  from seed_children
on conflict (child_id, day) do update
  set status = excluded.status, recipients = excluded.recipients,
      structure_id = excluded.structure_id, decided_at = excluded.decided_at, note = null;

-- The digests, composed after the rows above exist (the composer reads
-- them), one per guardian account; then dated to the moment the ledger says
-- and marked pushed.
do $$
declare
  v_demo uuid := '732bdf7d-775a-4ed7-875f-8c04ea4e4778';
  v_real uuid := 'fb050631-e62f-43f1-9e12-933e564974e8';
  v_day date := date '2026-09-10';
  v_at timestamptz := (timestamp '2026-09-10 17:03') at time zone 'Africa/Algiers';
  v_real_before int; v_child uuid; v_rows int := 0; v_n int;
begin
  select count(*) into v_real_before from public.kg_children where tenant_id = v_real;

  for v_child in select id from seed_children where not absent and has_account order by n loop
    v_n := public.kg_notify_family(v_demo, v_child, 'daily_report',
      public.kg_daily_journal_data(public.kg_child_day_compose(v_child, v_day, false)) - 'tellable', null);
    v_rows := v_rows + coalesce(v_n, 0);
  end loop;
  update public.kg_notifications
     set created_at = v_at, pushed_at = v_at
   where tenant_id = v_demo and type = 'daily_report'
     and data ->> 'source' = 'digest' and data ->> 'date' = v_day::text
     and pushed_at is null;

  if (select count(*) from public.kg_children where tenant_id = v_real) <> v_real_before then
    raise exception 'real client child count changed — rolling back';
  end if;
  raise notice 'daily journal of % seeded: % children, % sent, % without account, % absent, % new digest row(s)',
    v_day,
    (select count(*) from seed_children),
    (select count(*) from public.kg_daily_journal_ledger where tenant_id = v_demo and day = v_day and status = 'sent'),
    (select count(*) from public.kg_daily_journal_ledger where tenant_id = v_demo and day = v_day and status = 'skipped_no_account'),
    (select count(*) from public.kg_daily_journal_ledger where tenant_id = v_demo and day = v_day and status = 'skipped_absent'),
    v_rows;
end $$;

commit;

-- ── Teardown ────────────────────────────────────────────────────────────────
-- Paste this block alone to remove what the seed wrote and nothing else: the
-- ledger and the digests of that day, the journals and the attendance of that
-- day (the demo held none before the seed), and the consent row the seed
-- signed. A delete never fires the journal trigger, so no family is told.
/*
begin;
delete from public.kg_daily_journal_ledger
 where tenant_id = '732bdf7d-775a-4ed7-875f-8c04ea4e4778' and day = date '2026-09-10';
delete from public.kg_notifications
 where tenant_id = '732bdf7d-775a-4ed7-875f-8c04ea4e4778' and type = 'daily_report'
   and data ->> 'date' = '2026-09-10' and data ->> 'source' = 'digest';
delete from public.kg_daily_reports
 where tenant_id = '732bdf7d-775a-4ed7-875f-8c04ea4e4778' and date = date '2026-09-10';
delete from public.kg_attendance
 where tenant_id = '732bdf7d-775a-4ed7-875f-8c04ea4e4778' and date = date '2026-09-10';
delete from public.kg_consents
 where tenant_id = '732bdf7d-775a-4ed7-875f-8c04ea4e4778' and note = 'demo seed 2026-09-10';
commit;
*/
