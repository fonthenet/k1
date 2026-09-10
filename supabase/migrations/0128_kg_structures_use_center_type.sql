-- 0128 — one list, not two. A section IS a centre type.
--
-- 0125 invented kg_section_kind beside the kg_center_type the product already
-- had. Two lists that overlap and answer almost the same question is one list
-- too many, and it showed the moment the founder wizard needed to say "we run
-- a crèche AND a jardin d'enfants": the signup picker speaks in centre types
-- and the sections spoke in kinds, so neither could produce the other.
--
-- Whether a section belongs in the DAS registers is now DERIVED from its type
-- rather than asked as a second question (see SOLIDARITY_CENTER_TYPES in
-- src/components/modules/settings/center-types.ts).
alter table kg_sections add column if not exists center_type kg_center_type;

-- preschool folds into kindergarten: jardin d'enfants covers 3–6 including the
-- تحضيري year, which is how Algerian crèches are licensed anyway. 'primary'
-- has no equivalent, so it maps to the nearest vertical rather than inventing
-- a type the product cannot actually run (no marks, no bulletins).
update kg_sections set center_type =
  case kind::text
    when 'nursery'      then 'nursery'::kg_center_type
    when 'kindergarten' then 'kindergarten'::kg_center_type
    when 'preschool'    then 'kindergarten'::kg_center_type
    when 'primary'      then 'edu_center'::kg_center_type
    else 'activity_center'::kg_center_type
  end
 where center_type is null;

alter table kg_sections alter column center_type set default 'kindergarten';
alter table kg_sections alter column center_type set not null;
alter table kg_sections drop column if exists kind;
drop type if exists kg_section_kind;
