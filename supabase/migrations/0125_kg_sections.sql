-- 0125 — one building, two establishments.
--
-- A crèche and a small school under one roof is an ordinary Algerian
-- arrangement, and the product had no word for it: everything hangs off
-- kg_tenants, fifty tables carry tenant_id, and there is nothing between the
-- establishment and a class. The only way to run both was two tenants — which
-- is right about the paperwork and wrong about everything the two halves
-- actually share. Two tenants means the same front door needs two kiosks, a
-- family with a child on each side is two guardian records and two portals,
-- badge codes restart so K-001 exists twice, invoices run two numbering series,
-- and every staff member switches workspace all day.
--
-- A SECTION is a wing of one establishment. It shares the door, the families,
-- the building and the owner's view; what it does NOT share is the regulator.
--
-- ---------------------------------------------------------------------------
-- Why `kind` is its own enum and not kg_center_type
-- ---------------------------------------------------------------------------
-- The two halves answer to different ministries: crèche and jardin d'enfants
-- to Solidarité Nationale (the DAS inspector these registers are printed for),
-- a primary school to Éducation Nationale. That split is the reason the
-- registers must not simply list every child in the building, and it is a
-- different question from "what kind of business is this tenant", which
-- kg_center_type already answers for the establishment as a whole. Reusing
-- that enum would also have put "primary school" in the onboarding picker,
-- promising an academic model — marks, coefficients, trimesters, bulletins —
-- that this product does not have.
create type kg_section_kind as enum (
  'nursery',      -- crèche, 0–3
  'kindergarten', -- jardin d'enfants / روضة, 3–5
  'preschool',    -- préscolaire / تحضيري, the year before primary
  'primary',      -- école primaire — Éducation Nationale
  'other'
);

create table if not exists kg_sections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kg_tenants(id) on delete cascade,
  name text not null,
  name_ar text,
  kind kg_section_kind not null default 'kindergarten',
  color text not null default '#19819A',
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists kg_sections_tenant_idx on kg_sections (tenant_id);
create unique index if not exists kg_sections_name_unique
  on kg_sections (tenant_id, lower(btrim(name)));

drop trigger if exists trg_kg_sections_touch on kg_sections;
create trigger trg_kg_sections_touch before update on kg_sections
  for each row execute function kg_touch_updated_at();

-- ON DELETE SET NULL everywhere: removing a section must never take classes or
-- children with it. An unsectioned class is a visible gap, a cascade is not.
alter table kg_classes  add column if not exists section_id uuid references kg_sections(id) on delete set null;
alter table kg_children add column if not exists section_id uuid references kg_sections(id) on delete set null;
create index if not exists kg_classes_section_idx  on kg_classes (section_id);
create index if not exists kg_children_section_idx on kg_children (section_id);

comment on column kg_children.section_id is
  'Which wing of the establishment this child belongs to. Follows the class '
  'when one is assigned (kg_sync_child_section) but is a real column so a '
  'child with no class yet still lands on one side of the regulatory split — '
  'otherwise they would be missing from BOTH inspection registers. See 0125.';

-- ---------------------------------------------------------------------------
-- RLS — the shape kg_classes uses: any member reads, admins write.
-- ---------------------------------------------------------------------------
alter table kg_sections enable row level security;
drop policy if exists sec_sel on kg_sections;
drop policy if exists sec_ins on kg_sections;
drop policy if exists sec_upd on kg_sections;
drop policy if exists sec_del on kg_sections;
create policy sec_sel on kg_sections for select using (kg_is_member(tenant_id));
create policy sec_ins on kg_sections for insert with check (kg_is_admin(tenant_id));
create policy sec_upd on kg_sections for update using (kg_is_admin(tenant_id));
create policy sec_del on kg_sections for delete using (kg_is_admin(tenant_id));

-- ---------------------------------------------------------------------------
-- A child follows their class into a section
-- ---------------------------------------------------------------------------
-- Assignment sets it; MOVING a class to another section moves its children
-- with it. A child placed by hand into a section and left without a class
-- keeps that placement, because the class is not there to argue with it.
create or replace function kg_sync_child_section()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.class_id is not null and new.class_id is distinct from coalesce(old.class_id, '00000000-0000-0000-0000-000000000000'::uuid) then
    select c.section_id into new.section_id from kg_classes c where c.id = new.class_id;
  end if;
  return new;
end $$;

drop trigger if exists trg_kg_children_section_sync on kg_children;
create trigger trg_kg_children_section_sync
  before insert or update of class_id on kg_children
  for each row execute function kg_sync_child_section();

create or replace function kg_move_class_section()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.section_id is distinct from old.section_id then
    update kg_children set section_id = new.section_id where class_id = new.id;
  end if;
  return new;
end $$;

drop trigger if exists trg_kg_classes_section_move on kg_classes;
create trigger trg_kg_classes_section_move after update of section_id on kg_classes
  for each row execute function kg_move_class_section();

revoke all on function kg_sync_child_section() from public, anon, authenticated;
revoke all on function kg_move_class_section() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Backfill — every existing establishment becomes one section of itself.
-- ---------------------------------------------------------------------------
-- Nothing changes for a crèche that only ever runs one thing: it gets a single
-- section named after itself, every class and child joins it, and the section
-- filter is a no-op until a second one is created. The kind is taken from the
-- tenant's own center_type so the registers keep meaning what they meant.
insert into kg_sections (tenant_id, name, name_ar, kind, sort_order)
select t.id, t.name, t.name,
       case t.center_type::text
         when 'nursery' then 'nursery'::kg_section_kind
         when 'kindergarten' then 'kindergarten'::kg_section_kind
         else 'other'::kg_section_kind
       end,
       0
  from kg_tenants t
 where not exists (select 1 from kg_sections s where s.tenant_id = t.id);

update kg_classes c set section_id = s.id
  from kg_sections s where s.tenant_id = c.tenant_id and c.section_id is null;

update kg_children ch set section_id = s.id
  from kg_sections s where s.tenant_id = ch.tenant_id and ch.section_id is null;
