-- Removes everything calendar_seed.sql wrote, and nothing else. Booking
-- ledgers cascade from their source rows (0150, 0155). Notifications are not
-- FK'd: the rows the triggers wrote for the seeded ids are removed LAST, after
-- the deletes, so the 'cancelled' rows kg_on_event_delete, the session
-- delete trigger and (0161) the closure delete trigger write for a future
-- row go in the same sweep. Rehearse with `rollback;` first.
begin;

-- I. the optional école link (harmless when it was never made): unlink first so
--    the guardian_access_changed rows and the audit lines are all swept below
delete from kg_child_guardians
 where child_id = '57349c3f-6b95-482b-9b11-42065bd4b367' and guardian_id = '2f4c5af0-23aa-443a-8b0a-8f924b1429c5';

delete from kg_event_responses      where tenant_id='732bdf7d-775a-4ed7-875f-8c04ea4e4778' and event_id::text like 'a5f0b4c2-9d3e-4c1f-8b7a-0157%';
delete from kg_learning_lessons     where tenant_id='732bdf7d-775a-4ed7-875f-8c04ea4e4778' and id::text like 'a5f0b4c2-9d3e-4c1f-8b7a-0157%';
delete from kg_learning_assessments where tenant_id='732bdf7d-775a-4ed7-875f-8c04ea4e4778' and id::text like 'a5f0b4c2-9d3e-4c1f-8b7a-0157%';
delete from kg_sessions             where tenant_id='732bdf7d-775a-4ed7-875f-8c04ea4e4778' and id::text like 'a5f0b4c2-9d3e-4c1f-8b7a-0157%';
delete from kg_tasks                where tenant_id='732bdf7d-775a-4ed7-875f-8c04ea4e4778' and id::text like 'a5f0b4c2-9d3e-4c1f-8b7a-0157%';
delete from kg_leave_requests       where tenant_id='732bdf7d-775a-4ed7-875f-8c04ea4e4778' and id::text like 'a5f0b4c2-9d3e-4c1f-8b7a-0157%';
delete from kg_holidays             where tenant_id='732bdf7d-775a-4ed7-875f-8c04ea4e4778' and id::text like 'a5f0b4c2-9d3e-4c1f-8b7a-0157%';
delete from kg_events               where tenant_id='732bdf7d-775a-4ed7-875f-8c04ea4e4778' and id::text like 'a5f0b4c2-9d3e-4c1f-8b7a-0157%';

update kg_applications set status='under_review', interview_at=null
 where id='70805df0-2f60-44d0-b5b4-1c7273c4e21a' and tenant_id='732bdf7d-775a-4ed7-875f-8c04ea4e4778';

delete from kg_notifications
 where tenant_id = '732bdf7d-775a-4ed7-875f-8c04ea4e4778'
   and (   data->>'eventId'      like 'a5f0b4c2-9d3e-4c1f-8b7a-0157%'
        or data->>'taskId'       like 'a5f0b4c2-9d3e-4c1f-8b7a-0157%'
        or data->>'sessionId'    like 'a5f0b4c2-9d3e-4c1f-8b7a-0157%'
        or data->>'assessmentId' like 'a5f0b4c2-9d3e-4c1f-8b7a-0157%'
        or data->>'holidayId'    like 'a5f0b4c2-9d3e-4c1f-8b7a-0157%'
        or (type = 'guardian_access_changed' and data->>'childId' = '57349c3f-6b95-482b-9b11-42065bd4b367'
            and data->>'person' = 'Hichem Slimani'));
delete from kg_audit_log
 where tenant_id = '732bdf7d-775a-4ed7-875f-8c04ea4e4778' and entity = 'kg_child_guardians'
   and entity_id = '57349c3f-6b95-482b-9b11-42065bd4b367'
   and data->>'guardianId' = '2f4c5af0-23aa-443a-8b0a-8f924b1429c5';

select count(*) as leftovers
  from (select id from kg_events union all select id from kg_holidays union all select id from kg_sessions
        union all select id from kg_tasks union all select id from kg_leave_requests
        union all select id from kg_learning_lessons union all select id from kg_learning_assessments) x
 where id::text like 'a5f0b4c2-9d3e-4c1f-8b7a-0157%';   -- expected 0
-- The calendar prefix only: the daily-journal seed (…-0152…) left six pushed
-- event rows under the shorter a5f0b4c2 stem that are not this file's to sweep.
select count(*) as notification_leftovers from kg_notifications
 where tenant_id = '732bdf7d-775a-4ed7-875f-8c04ea4e4778'
   and (data->>'eventId' like 'a5f0b4c2-9d3e-4c1f-8b7a-0157%' or data->>'sessionId' like 'a5f0b4c2-9d3e-4c1f-8b7a-0157%'
        or data->>'holidayId' like 'a5f0b4c2-9d3e-4c1f-8b7a-0157%' or data->>'taskId' like 'a5f0b4c2-9d3e-4c1f-8b7a-0157%'
        or data->>'assessmentId' like 'a5f0b4c2-9d3e-4c1f-8b7a-0157%');   -- expected 0
-- the real client never moves:
select count(*) from kg_events where tenant_id = 'fb050631-e62f-43f1-9e12-933e564974e8' and id::text like 'a5f0b4c2%';  -- expected 0

commit;   -- rehearsal: rollback;
