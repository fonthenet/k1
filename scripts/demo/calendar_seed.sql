-- Demo tenant روضة الأمل (732bdf7d-775a-4ed7-875f-8c04ea4e4778) ONLY.
-- Run ONCE by the LEAD in the SQL editor AFTER 0157–0159 (A1 needs all_day,
-- A2 needs rsvp, D2 needs the session trigger), never as a migration.
-- Every row this file writes carries the id prefix a5f0b4c2-9d3e-4c1f-8b7a-0157
-- so calendar_teardown.sql removes exactly these rows (room/staff booking
-- ledgers cascade from the source).
--
-- REHEARSE FIRST: run the whole file once with the last line changed from
-- `commit;` to `rollback;` — the guards (kg_learning_guard, kg_session_closure,
-- sync_room_booking, sync_staff_booking) must accept every row before anything
-- persists — and read the two sanity blocks at the end.
--
-- In the SQL editor auth.uid() is NULL. The closure, session and task
-- triggers then write with actor NULL — safe since 0157 §0 (kg_notify drops
-- NULL user ids) and it means the OWNER is told too — while the event
-- triggers fall back to the row's created_by (0159), so the owner hears the
-- closure and the session she wrote but not her own events. Every row the
-- triggers write is stamped pushed_at below: nothing reaches a phone.
--
-- Calendar facts of September/October 2026: 1 Sept is a Tuesday; 13/20/27 Sept
-- and 4/11 Oct are Sundays; Friday+Saturday closed. Algiers = UTC+1 all year.
--
-- Who can be told (verified 2026-09-12): the crèche has 3 guardian accounts
-- (parent1 = Amrani: Adam in Petite Section, Ines in Grande Section), the
-- préscolaire 1 (parent3 = Slimani: Loudjaine), the école NONE. Rows aimed at
-- the école therefore write no notifications unless the optional step I is run.
--
-- Deliberately NOT seeded:
--   * a "tentative Mawlid": Mawlid 1448 fell ≈ 25 Aug 2026 and no Islamic date
--     falls in Sept–Oct 2026. The dashed-gold treatment is photographed on the
--     existing tentative whole-building closure "Journée pédagogique" 15 Sept
--     (0631d408-d259-47b5-b5c3-b1e272c76ca8). Do not fabricate a religious date.
--   * a birthday: Amira Saadi (2e année) turns 8 on 17 Sept; October has five
--     (Louai 10, Youcef 19, Mehdi 20, Sohaib 26, Adem 27). Nothing to add.
--   * an approved educator leave: ليلى مرابط already has one, 14–18 Sept
--     (231a715b-3dd8-4100-a292-0c786bd2bb55) — and teaches 8 lessons that week.
--     That collision is real demo data the calendar must surface; do not "fix"
--     it in the seed.
--   * menus: repeat weekly through 6 Dec already (kg_menus, structure null).
begin;

-- Lock the tenant we are allowed to touch; anything else is a bug.
do $$ begin
  if not exists (select 1 from kg_tenants where id = '732bdf7d-775a-4ed7-875f-8c04ea4e4778') then
    raise exception 'demo tenant missing';
  end if;
  if not exists (select 1 from information_schema.columns where table_name = 'kg_events' and column_name = 'rsvp') then
    raise exception 'apply 0157–0159 first';
  end if;
end $$;

-- ---- A. Events (trg_kg_event_insert → kg_on_event_insert notifies the audience)
-- A1  ALL-DAY outing, 1re année (école), Wed 23 Sept: [00:00, 00:00 next day)
--     Algiers per kg_events_all_day_span (0157). No room: an outing leaves the
--     building. The departure time lives in the description. École families
--     have no accounts → 0 notification rows.
insert into kg_events (id, tenant_id, title, description, start_at, end_at, all_day, audience, class_id, structure_id, room_id, created_by)
values ('a5f0b4c2-9d3e-4c1f-8b7a-015700000001', '732bdf7d-775a-4ed7-875f-8c04ea4e4778',
        'خرجة إلى المتحف الوطني للفنون الجميلة',
        'خرجة بيداغوجية طيلة اليوم. الانطلاق على 08:30، الغداء من المطعم، العودة قبل 15:30.',
        '2026-09-22 23:00:00+00', '2026-09-23 23:00:00+00', true,
        'class', '91453bbe-c35c-4f81-8c77-96459a15762b', null, null, 'd9485859-48e8-4aad-85e7-d09e1cd16f4d');

-- A2  Parents' meeting of Petite Section (Adam → parent1@rawdatik.com), Tue 22 Sept
--     17:00–18:00 Algiers, room Salle 1, RSVP asked. Gives the portal a class
--     event, a fresh "event" notification whose deep link the plan follows,
--     and the one row where "J'y serai" can be photographed.
insert into kg_events (id, tenant_id, title, description, start_at, end_at, audience, class_id, structure_id, room_id, rsvp, created_by)
values ('a5f0b4c2-9d3e-4c1f-8b7a-015700000002', '732bdf7d-775a-4ed7-875f-8c04ea4e4778',
        'اجتماع أولياء القسم الصغير',
        'عرض برنامج الفصل الأول والإجابة عن أسئلتكم.',
        '2026-09-22 16:00:00+00', '2026-09-22 17:00:00+00',
        'class', '276abb6b-8660-4dd7-8f77-20a2da44dc08', null, '25192ef3-cecd-4ac1-a390-3a0f753c3288', true, 'd9485859-48e8-4aad-85e7-d09e1cd16f4d');

-- A3  Structure-audience event: école open day, Thu 1 Oct 09:00–12:00, Cour.
--     (école families: 0 rows unless step I is run.)
insert into kg_events (id, tenant_id, title, description, start_at, end_at, audience, class_id, structure_id, room_id, created_by)
values ('a5f0b4c2-9d3e-4c1f-8b7a-015700000003', '732bdf7d-775a-4ed7-875f-8c04ea4e4778',
        'Journée portes ouvertes de l''école',
        'Visite des classes et rencontre avec l''équipe pédagogique.',
        '2026-10-01 08:00:00+00', '2026-10-01 11:00:00+00',
        'structure', null, 'e1eadc36-2c75-4910-b35d-d3d116227097', '8fb6d13d-6e27-4fe1-bd48-3f039b97a269', 'd9485859-48e8-4aad-85e7-d09e1cd16f4d');

-- A4  Staff-only event on a day the école is closed (B1): the team meets while
--     the pupils are away. Mon 28 Sept 13:00–14:00, Salle 2. Staff with
--     accounts: educatrice, comptable → 2 rows (the directrice is created_by,
--     which the event actor rule reads as the author when no one is signed in).
insert into kg_events (id, tenant_id, title, description, start_at, end_at, audience, class_id, structure_id, room_id, created_by)
values ('a5f0b4c2-9d3e-4c1f-8b7a-015700000004', '732bdf7d-775a-4ed7-875f-8c04ea4e4778',
        'اجتماع الفريق — تقييم الشهر الأول',
        null,
        '2026-09-28 12:00:00+00', '2026-09-28 13:00:00+00',
        'staff', null, null, '775e3c9e-8f75-4ac8-b72d-7bac1ee23419', 'd9485859-48e8-4aad-85e7-d09e1cd16f4d');

-- ---- B. Holidays ------------------------------------------------------------
-- B1  Two-day closure of the ÉCOLE only, Sun 27 – Mon 28 Sept, kind 'closure'.
--     The crèche and the préscolaire stay open: the crèche scope must NOT show
--     it; the whole-building scope shows it with the école's dot; parent1
--     (crèche) must not see it on the portal (finding F03). kg_holiday_notify
--     (0159) tells the école's families (none) and the staff (3 rows, pushed
--     at once since it is under 30 days away → stamped below).
insert into kg_holidays (id, tenant_id, date, end_date, name, name_ar, tentative, closure, kind, structure_id)
values ('a5f0b4c2-9d3e-4c1f-8b7a-015700000011', '732bdf7d-775a-4ed7-875f-8c04ea4e4778',
        '2026-09-27', '2026-09-28', 'Fermeture de l''école — travaux', 'غلق المدرسة — أشغال', false, true, 'closure',
        'e1eadc36-2c75-4910-b35d-d3d116227097');

-- ---- C. Assessments (kg_learning_guard: test/exam only on private_* classes,
--         inside the programme's dates; kg_assessment_scheduled tells the
--         class's families with accounts) ---------------------------------------
-- C1  Exam for 1re année, Tue 29 Sept, draft (not published) → staff see it;
--     a 1re année family would see the DATE (none has an account → 0 rows).
insert into kg_learning_assessments (id, tenant_id, class_id, program_id, title, kind, scheduled_on, max_score, published)
values ('a5f0b4c2-9d3e-4c1f-8b7a-015700000021', '732bdf7d-775a-4ed7-875f-8c04ea4e4778',
        '91453bbe-c35c-4f81-8c77-96459a15762b', 'a957137b-e111-4f0a-b780-8d584600d820',
        'Contrôle de lecture — septembre', 'exam', '2026-09-29', 20, false);

-- C2  Observation for Petite Section, Wed 23 Sept, PUBLISHED → staff only on
--     the calendar (observations never reach a family calendar, 0158); the
--     results stay readable on the child page as today.
insert into kg_learning_assessments (id, tenant_id, class_id, program_id, title, kind, scheduled_on, max_score, published)
values ('a5f0b4c2-9d3e-4c1f-8b7a-015700000022', '732bdf7d-775a-4ed7-875f-8c04ea4e4778',
        '276abb6b-8660-4dd7-8f77-20a2da44dc08', 'ae94e062-a15c-401d-91dd-ad5f56799ed3',
        'ملاحظة — التعرّف على الألوان', 'observation', '2026-09-23', 20, true);

-- ---- D. Therapy sessions (sync_staff_booking + sync_room_booking +
--         kg_session_closure + kg_session_scheduled) ---------------------------
-- D1  Zakaria Merzouki (école, no account), behavioural, Mon 21 Sept 11:15
--     Algiers, Salle 6, therapist كريمة زموري → 0 rows.
insert into kg_sessions (id, tenant_id, child_id, session_type, therapist_id, scheduled_at, duration_min, status, published, room_id, created_by)
values ('a5f0b4c2-9d3e-4c1f-8b7a-015700000031', '732bdf7d-775a-4ed7-875f-8c04ea4e4778',
        '3bca7a8c-d91f-4f7c-a443-b4705b42b4ca', 'behavioral', '791ee0f0-6451-47e3-8b3a-1b064fb81333',
        '2026-09-21 10:15:00+00', 45, 'scheduled', false, '76b4acc9-08b8-4381-a507-cfe2e1923f60', 'd9485859-48e8-4aad-85e7-d09e1cd16f4d');

-- D2  Adam Amrani (parent1), speech, Wed 23 Sept 13:30 Algiers, Salle 6, NOT
--     published (no outcome yet): the appointment reaches parent1 through
--     kg_family_appointments (0158) and kg_session_scheduled (0159) writes one
--     'created' row for parent1 — stamped pushed_at below.
insert into kg_sessions (id, tenant_id, child_id, session_type, therapist_id, scheduled_at, duration_min, status, published, room_id, created_by)
values ('a5f0b4c2-9d3e-4c1f-8b7a-015700000032', '732bdf7d-775a-4ed7-875f-8c04ea4e4778',
        '809202b0-ab41-4523-8f4c-298aae11fa5e', 'speech', '791ee0f0-6451-47e3-8b3a-1b064fb81333',
        '2026-09-23 12:30:00+00', 45, 'scheduled', false, '76b4acc9-08b8-4381-a507-cfe2e1923f60', 'd9485859-48e8-4aad-85e7-d09e1cd16f4d');

-- ---- E. Tasks (trg_kg_notify_task notifies the assignee: ليلى and the owner)
insert into kg_tasks (id, tenant_id, title, description, assignee_id, due_date, status, priority, created_by)
values ('a5f0b4c2-9d3e-4c1f-8b7a-015700000041', '732bdf7d-775a-4ed7-875f-8c04ea4e4778',
        'Préparer les fiches de rentrée de la 1re année', 'Compléter les fiches de renseignements manquantes avant la réunion des parents.',
        '98b14d98-a898-4c62-8f90-b5607ae281c8', '2026-09-30', 'todo', 'normal', 'd9485859-48e8-4aad-85e7-d09e1cd16f4d'),
       ('a5f0b4c2-9d3e-4c1f-8b7a-015700000042', '732bdf7d-775a-4ed7-875f-8c04ea4e4778',
        'Commander les gâteaux des anniversaires d''octobre', null,
        '7ae0edc5-6a5a-4ffe-8b2d-f95330e05d05', '2026-10-05', 'todo', 'low', 'd9485859-48e8-4aad-85e7-d09e1cd16f4d');

-- ---- F. Leave: one PENDING request for نادية شريف (2e année) on Thu 1 Oct ----
--         (dashed gold "needs a decision" on the calendar; the approved one
--         already exists). No account behind that membership: a decision would
--         tell nobody, which is fine for the demo. Her timetable stops on
--         24 Sept and the October clone below lands on 4–8 Oct, so
--         kg_leave_conflicts reads ZERO cours for 1 Oct and the approve dialog
--         must say so without a warning line (verified 2026-09-12); a leave
--         on 4–8 Oct would be the shot with a real conflict.
insert into kg_leave_requests (id, tenant_id, membership_id, leave_type, start_date, end_date, reason, status)
values ('a5f0b4c2-9d3e-4c1f-8b7a-015700000051', '732bdf7d-775a-4ed7-875f-8c04ea4e4778',
        'aab22583-14a5-491f-9569-b17ffdcf02a5', 'personal', '2026-10-01', '2026-10-01', 'موعد إداري', 'pending');

-- ---- G. Interview: move سلمى هارون (under_review, préscolaire) to an interview
--         on Mon 21 Sept 09:30 Algiers. applicant_user_id is null → no
--         notification is written. Teardown restores under_review / null.
update kg_applications
   set status = 'interview', interview_at = '2026-09-21 08:30:00+00'
 where id = '70805df0-2f60-44d0-b5b4-1c7273c4e21a'
   and tenant_id = '732bdf7d-775a-4ed7-875f-8c04ea4e4778'
   and status = 'under_review';

-- ---- H. October lessons: the école/préscolaire timetable stops on 24 Sept, so
--         October would photograph empty. Clone the week of 20–24 Sept +14 days
--         (4–8 Oct). Deterministic ids under the same prefix (…0157 1xxxxxxx).
insert into kg_learning_lessons (id, tenant_id, class_id, program_id, membership_id, title, kind, starts_at, ends_at, status, room_id)
select ('a5f0b4c2-9d3e-4c1f-8b7a-01571' || lpad(to_hex(row_number() over (order by l.starts_at, l.id)), 7, '0'))::uuid,
       l.tenant_id, l.class_id, l.program_id, l.membership_id, l.title, l.kind,
       l.starts_at + interval '14 days', l.ends_at + interval '14 days', 'scheduled', l.room_id
  from kg_learning_lessons l
 where l.tenant_id = '732bdf7d-775a-4ed7-875f-8c04ea4e4778'
   and l.status <> 'cancelled'
   and l.starts_at >= '2026-09-20 00:00:00+01' and l.starts_at < '2026-09-25 00:00:00+01';

-- ---- I. OPTIONAL — école-family shots only (parent3 sees the open day, the
--         27–28 closure, the 1re année/2e année exam dates). Links parent3's
--         guardian (Hichem Slimani, 2f4c5af0…) to Amira Saadi (2e année) for
--         the length of the capture cycle. The link trigger tells Amira's
--         family (guardian_access_changed) and writes an audit line; both are
--         removed by the teardown's block I. Leave commented unless those
--         shots are being taken; A3/B1/C1 rows written BEFORE this link never
--         reach parent3 (no retroactive notification) — the shots read the
--         calendar, not the bell.
-- insert into kg_child_guardians (child_id, guardian_id, is_primary, can_pickup, is_financial)
-- values ('57349c3f-6b95-482b-9b11-42065bd4b367', '2f4c5af0-23aa-443a-8b0a-8f924b1429c5', false, false, false);

-- ---- Nothing written to the demo may reach a phone (README): every row the
--      triggers above wrote is marked pushed, and stays in the bell. ----------
update kg_notifications set pushed_at = coalesce(pushed_at, now())
 where tenant_id = '732bdf7d-775a-4ed7-875f-8c04ea4e4778'
   and pushed_at is null
   and (data->>'eventId' like 'a5f0b4c2-9d3e-4c1f-8b7a-0157%'
     or data->>'sessionId' like 'a5f0b4c2-9d3e-4c1f-8b7a-0157%'
     or data->>'taskId' like 'a5f0b4c2-9d3e-4c1f-8b7a-0157%'
     or data->>'assessmentId' like 'a5f0b4c2-9d3e-4c1f-8b7a-0157%'
     or data->>'holidayId' like 'a5f0b4c2-9d3e-4c1f-8b7a-0157%'
     or (type = 'guardian_access_changed' and data->>'childId' = '57349c3f-6b95-482b-9b11-42065bd4b367' and created_at > now() - interval '5 minutes'));

-- ---- Sanity 1: what the month must now contain -----------------------------
select 'events'   as k, count(*) from kg_events   where id::text like 'a5f0b4c2-9d3e-4c1f-8b7a-0157%'
union all select 'holidays',   count(*) from kg_holidays where id::text like 'a5f0b4c2-9d3e-4c1f-8b7a-0157%'
union all select 'assessments',count(*) from kg_learning_assessments where id::text like 'a5f0b4c2-9d3e-4c1f-8b7a-0157%'
union all select 'sessions',   count(*) from kg_sessions where id::text like 'a5f0b4c2-9d3e-4c1f-8b7a-0157%'
union all select 'tasks',      count(*) from kg_tasks where id::text like 'a5f0b4c2-9d3e-4c1f-8b7a-0157%'
union all select 'leave',      count(*) from kg_leave_requests where id::text like 'a5f0b4c2-9d3e-4c1f-8b7a-0157%'
union all select 'lessons_oct',count(*) from kg_learning_lessons where id::text like 'a5f0b4c2-9d3e-4c1f-8b7a-01571%'
union all select 'interview',  count(*) from kg_applications where id='70805df0-2f60-44d0-b5b4-1c7273c4e21a' and status='interview';
-- expected: 4, 1, 2, 2, 2, 1, 17, 1

-- ---- Sanity 2: what the triggers told, and that no phone will ring ---------
select type, data->>'kind' as kind, count(*), count(*) filter (where pushed_at is null) as unpushed
  from kg_notifications
 where tenant_id = '732bdf7d-775a-4ed7-875f-8c04ea4e4778' and created_at > now() - interval '5 minutes'
 group by 1, 2 order by 1, 2;
-- expected (unpushed always 0), rehearsed rolled back on 2026-09-12:
--   event / created            3 — A2 → parent1 (the one Petite Section account); A4 → educatrice,
--                              comptable (the owner is created_by, so the actor rule skips her);
--                              A1, A3 → 0 (école: no accounts).
--   closure / created          3 — B1 → directrice, educatrice, comptable (actor NULL); no family row.
--   session_scheduled / created  1 — D2 → parent1. D1 → 0.
--   assessment_scheduled / created  0 — C1 is the école's (no accounts); C2 is an observation → never.
--   task / -                   1 — E → ليلى (educatrice); the owner's own task tells nobody (0010
--                              skips the creator).
-- Any other row here means a trigger fired on demo data that is not this seed's: read it before committing.

commit;   -- rehearsal: rollback;
