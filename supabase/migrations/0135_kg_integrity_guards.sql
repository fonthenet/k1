-- 0135 — three rules the server actions already enforce, moved where nothing
--        can walk past them.
--
-- Each of these is guarded in a server action, and that guard is the one a
-- director meets. It is also the only one: a direct query, a future code path,
-- a bulk edit or a bug goes straight past it, and in all three cases the
-- damage is silent — nothing errors, the data simply stops meaning what it
-- says.

-- (1) Deleting a populated structure stranded its children on neither side of
--     the regulatory split — the precise failure structures exist to prevent.
create or replace function kg_structure_refuse_orphaning()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_classes int; v_children int;
begin
  select count(*) into v_classes  from kg_classes  where structure_id = old.id;
  select count(*) into v_children from kg_children where structure_id = old.id;
  if v_classes > 0 or v_children > 0 then
    raise exception
      'structure_in_use: % class(es) and % child(ren) still belong to this structure',
      v_classes, v_children
      using errcode = 'foreign_key_violation',
            hint = 'Move them first, or set the structure out of service instead of deleting it.';
  end if;
  return old;
end $$;

drop trigger if exists trg_kg_structures_no_orphan on kg_structures;
create trigger trg_kg_structures_no_orphan before delete on kg_structures
  for each row execute function kg_structure_refuse_orphaning();

-- (2) Same story one level down: a room is only a label, but a class is not.
create or replace function kg_room_refuse_orphaning()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_classes int;
begin
  select count(*) into v_classes from kg_classes where room_id = old.id;
  if v_classes > 0 then
    raise exception 'room_in_use: % class(es) still meet in this room', v_classes
      using errcode = 'foreign_key_violation',
            hint = 'Move them first, or set the room out of service instead of deleting it.';
  end if;
  return old;
end $$;

drop trigger if exists trg_kg_rooms_no_orphan on kg_rooms;
create trigger trg_kg_rooms_no_orphan before delete on kg_rooms
  for each row execute function kg_room_refuse_orphaning();

-- (3) kg_activity_enrollments.activity_id references kg_activities(id) with NO
--     tenant clause, so a uuid belonging to a DIFFERENT crèche passed the
--     foreign key: the row was written with this tenant's id pointing at
--     another tenant's activity, and the child billed at that crèche's price.
--     The enrolment form is public; anyone with a browser console can post to
--     it. A CHECK cannot hold a subquery and one routed through a function is
--     never re-validated, so this has to be a trigger.
create or replace function kg_activity_enrollment_same_tenant()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from kg_activities a
                  where a.id = new.activity_id and a.tenant_id = new.tenant_id) then
    raise exception 'activity_tenant_mismatch';
  end if;
  return new;
end $$;

drop trigger if exists trg_kg_activity_enrollment_tenant on kg_activity_enrollments;
create trigger trg_kg_activity_enrollment_tenant
  before insert or update of activity_id, tenant_id on kg_activity_enrollments
  for each row execute function kg_activity_enrollment_same_tenant();

revoke all on function kg_structure_refuse_orphaning() from public, anon, authenticated;
revoke all on function kg_room_refuse_orphaning() from public, anon, authenticated;
revoke all on function kg_activity_enrollment_same_tenant() from public, anon, authenticated;
