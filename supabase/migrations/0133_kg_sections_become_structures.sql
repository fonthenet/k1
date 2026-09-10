-- 0133 — "section" was the wrong word, and the product itself said so.
--
-- In French crèche vocabulary a SECTION is an age group: petite section,
-- moyenne section, grande section. Those are literally the names of the
-- classes in this database. The word already meant "class" to every director
-- who would read it, and calling a wing of the establishment by the same name
-- guaranteed the two would be confused forever.
--
-- STRUCTURE is what the product already calls this. The pricing page says "Un
-- seul prix par structure" and "par structure, quel que soit l'effectif" — the
-- billing language had the right word before the concept existed.
--
-- A rename, not a parallel model: nothing keeps the old name, so there is
-- never a moment where both exist and a reader must work out which is live.

alter table kg_sections rename to kg_structures;

alter table kg_classes      rename column section_id to structure_id;
alter table kg_children     rename column section_id to structure_id;
alter table kg_enroll_links rename column section_id to structure_id;
alter table kg_applications rename column section_id to structure_id;

alter index if exists kg_sections_tenant_idx      rename to kg_structures_tenant_idx;
alter index if exists kg_sections_name_unique     rename to kg_structures_name_unique;
alter index if exists kg_sections_pkey            rename to kg_structures_pkey;
alter index if exists kg_classes_section_idx      rename to kg_classes_structure_idx;
alter index if exists kg_children_section_idx     rename to kg_children_structure_idx;
alter index if exists kg_enroll_links_section_idx rename to kg_enroll_links_structure_idx;

comment on column kg_children.structure_id is
  'Which structure of the establishment this child belongs to. Follows the '
  'class when one is assigned (kg_sync_child_structure) but is a real column '
  'so a child with no class yet still lands on one side of the regulatory '
  'split — otherwise they would be missing from BOTH inspection registers.';
comment on column kg_applications.structure_id is
  'The structure this family applied to, copied from the link at submission. '
  'Drives which classes the approve dialog offers and which structure the '
  'enrolled child inherits.';

drop policy if exists sec_sel on kg_structures;
drop policy if exists sec_ins on kg_structures;
drop policy if exists sec_upd on kg_structures;
drop policy if exists sec_del on kg_structures;
create policy str_sel on kg_structures for select using (kg_is_member(tenant_id));
create policy str_ins on kg_structures for insert with check (kg_is_admin(tenant_id));
create policy str_upd on kg_structures for update using (kg_is_admin(tenant_id));
create policy str_del on kg_structures for delete using (kg_is_admin(tenant_id));

drop trigger if exists trg_kg_children_section_sync on kg_children;
drop trigger if exists trg_kg_classes_section_move on kg_classes;
drop trigger if exists trg_kg_sections_no_orphan on kg_structures;
drop trigger if exists trg_kg_sections_touch on kg_structures;
drop function if exists kg_sync_child_section();
drop function if exists kg_move_class_section();
drop function if exists kg_section_refuse_orphaning();

create trigger trg_kg_structures_touch before update on kg_structures
  for each row execute function kg_touch_updated_at();

create or replace function kg_sync_child_structure()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.class_id is not null
     and new.class_id is distinct from coalesce(old.class_id, '00000000-0000-0000-0000-000000000000'::uuid) then
    select c.structure_id into new.structure_id from kg_classes c where c.id = new.class_id;
  end if;
  return new;
end $$;

create trigger trg_kg_children_structure_sync
  before insert or update of class_id on kg_children
  for each row execute function kg_sync_child_structure();

create or replace function kg_move_class_structure()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.structure_id is distinct from old.structure_id then
    update kg_children set structure_id = new.structure_id where class_id = new.id;
  end if;
  return new;
end $$;

create trigger trg_kg_classes_structure_move after update of structure_id on kg_classes
  for each row execute function kg_move_class_structure();

revoke all on function kg_sync_child_structure() from public, anon, authenticated;
revoke all on function kg_move_class_structure() from public, anon, authenticated;

-- Each structure is a structure on a price list that charges per structure.
-- Never less than one, so an establishment mid-setup is billed as one rather
-- than free.
create or replace function kg_billable_structures(p_tenant uuid)
returns int language sql stable security definer set search_path = public as $$
  select greatest(1, (select count(*)::int from kg_structures
                       where tenant_id = p_tenant and active))
$$;
revoke all on function kg_billable_structures(uuid) from public, anon;
grant execute on function kg_billable_structures(uuid) to authenticated;
