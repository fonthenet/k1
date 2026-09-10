-- 0127 — give the backfilled rooms a capacity to start from.
--
-- 0123 created rooms out of the free text on kg_classes, which carried a name
-- and nothing else, so every room landed with a null capacity and the rooms
-- tab read "no details" for all nine of them.
--
-- The crèche has already stated how many children fit in each of these rooms:
-- it is the capacity of the class that sits there. Applied ONLY where a room
-- holds exactly one class, so the number is never a guess between two — and
-- only where capacity is still null, so nothing anyone typed is overwritten.
--
-- This is a starting point, not a survey of the building: room capacity is a
-- fact about walls and class capacity is a decision about enrolment, and the
-- two can legitimately differ. Both are editable on the rooms tab.
update kg_rooms r
   set capacity = sole.capacity
  from (
    select c.room_id, min(c.capacity) as capacity
      from kg_classes c
     where c.room_id is not null
     group by c.room_id
    having count(*) = 1
  ) sole
 where sole.room_id = r.id
   and r.capacity is null;
