-- 0129 — an enrolment link belongs to a section.
--
-- kg_get_enroll_link returned EVERY class in the building, so a two-section
-- establishment offered a parent enrolling a three-year-old the classes of the
-- other section. One link for a whole building also has no answer to "which
-- register does this child end up in".
--
-- Directors already make a link per intake ("Rentrée 2026"), so attaching a
-- section to it costs them nothing and fixes the chain at the root: the public
-- form lists that section's classes, the application records it, and the
-- approve dialog narrows its dropdown without being told separately.
--
-- ON DELETE SET NULL: deleting a section must not delete the links that
-- pointed at it. A link with no section behaves as every link did before —
-- the whole building — which is also right for a single-section crèche.
alter table kg_enroll_links add column if not exists section_id uuid
  references kg_sections(id) on delete set null;
alter table kg_applications  add column if not exists section_id uuid
  references kg_sections(id) on delete set null;

create index if not exists kg_enroll_links_section_idx on kg_enroll_links (section_id);

-- Existing links join the single section their tenant already has. A tenant
-- with several is left null (= whole building): guessing which intake an old
-- link belonged to would be inventing history.
update kg_enroll_links l set section_id = s.id
  from kg_sections s
 where s.tenant_id = l.tenant_id
   and l.section_id is null
   and (select count(*) from kg_sections x where x.tenant_id = l.tenant_id) = 1;
