-- 0123 — rooms become a thing the crèche configures, instead of free text
--        retyped on every class.
--
-- `kg_classes.room` was a text box. Nine rooms exist across the two live
-- tenants and every one of them was typed by hand into a class form — so
-- "القاعة 1" and "قاعة 1" are different rooms as far as the product is
-- concerned, a room cannot carry its own capacity, nothing can list the rooms
-- a crèche has, and renaming one means editing every class that sits in it.
--
-- ---------------------------------------------------------------------------
-- The text column STAYS, mirrored
-- ---------------------------------------------------------------------------
-- kg_classes.room is not dropped and not left to rot: a trigger keeps it equal
-- to the linked room's name. Two reasons, and the first is the one that matters
-- on deploy day:
--
--   1. The build running in production reads `room`. A migration that dropped
--      it would blank the room on every class card until the new build shipped,
--      and would break a rollback outright.
--   2. Reports and exports that select kg_classes.* keep working untouched.
--
-- So room_id is the truth and room is a denormalised copy of its name. A later
-- migration can drop the column once nothing reads it.

create table if not exists kg_rooms (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kg_tenants(id) on delete cascade,
  name text not null,
  name_ar text,
  -- How many children the ROOM holds, which is a fact about the building and
  -- is not the same as how many a class enrols. The UI warns when a class is
  -- sized above its room; it does not refuse, because the crèche knows things
  -- the floor plan does not.
  capacity int check (capacity is null or capacity > 0),
  floor text,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists kg_rooms_tenant_idx on kg_rooms (tenant_id);

-- Case- and space-insensitive, because "Salle A" and "salle a " are the same
-- door. Scoped per tenant.
create unique index if not exists kg_rooms_name_unique
  on kg_rooms (tenant_id, lower(btrim(name)));

create trigger trg_kg_rooms_touch before update on kg_rooms
  for each row execute function kg_touch_updated_at();

alter table kg_classes
  add column if not exists room_id uuid references kg_rooms(id) on delete set null;
create index if not exists kg_classes_room_idx on kg_classes (room_id);

comment on column kg_classes.room is
  'DENORMALISED mirror of kg_rooms.name for the linked room_id, maintained by '
  'kg_sync_class_room. room_id is the source of truth. Kept so the previously '
  'deployed build and existing exports keep rendering. See migration 0123.';

-- ---------------------------------------------------------------------------
-- RLS — exactly the shape kg_classes uses: any member reads, admins write.
-- ---------------------------------------------------------------------------
alter table kg_rooms enable row level security;

drop policy if exists rm_sel on kg_rooms;
drop policy if exists rm_ins on kg_rooms;
drop policy if exists rm_upd on kg_rooms;
drop policy if exists rm_del on kg_rooms;

create policy rm_sel on kg_rooms for select using (kg_is_member(tenant_id));
create policy rm_ins on kg_rooms for insert with check (kg_is_admin(tenant_id));
create policy rm_upd on kg_rooms for update using (kg_is_admin(tenant_id));
create policy rm_del on kg_rooms for delete using (kg_is_admin(tenant_id));

-- ---------------------------------------------------------------------------
-- Keep the mirror honest
-- ---------------------------------------------------------------------------
create or replace function kg_sync_class_room()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- A class linked to a room shows that room's name. A class with no room
  -- keeps whatever free text it already had, so nothing is silently erased
  -- for a crèche that has not adopted rooms yet.
  if new.room_id is not null then
    select r.name into new.room from kg_rooms r where r.id = new.room_id;
  end if;
  return new;
end $$;

drop trigger if exists trg_kg_classes_room_sync on kg_classes;
create trigger trg_kg_classes_room_sync
  before insert or update of room_id on kg_classes
  for each row execute function kg_sync_class_room();

-- Renaming a room renames it everywhere it is shown. This is the whole point
-- of the table: one edit, not one per class.
create or replace function kg_rename_room_mirror()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.name is distinct from old.name then
    update kg_classes set room = new.name where room_id = new.id;
  end if;
  return new;
end $$;

drop trigger if exists trg_kg_rooms_rename on kg_rooms;
create trigger trg_kg_rooms_rename after update on kg_rooms
  for each row execute function kg_rename_room_mirror();

-- Internal helpers: never callable from a browser.
revoke all on function kg_sync_class_room() from public, anon, authenticated;
revoke all on function kg_rename_room_mirror() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Backfill — every room a crèche already typed becomes a real room, linked.
-- ---------------------------------------------------------------------------
insert into kg_rooms (tenant_id, name)
select distinct c.tenant_id, btrim(c.room)
  from kg_classes c
 where btrim(coalesce(c.room, '')) <> ''
on conflict do nothing;

update kg_classes c
   set room_id = r.id
  from kg_rooms r
 where r.tenant_id = c.tenant_id
   and lower(btrim(r.name)) = lower(btrim(coalesce(c.room, '')))
   and c.room_id is null
   and btrim(coalesce(c.room, '')) <> '';
