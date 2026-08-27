-- Center verticals: the platform is not kindergarten-only. Competitors position
-- across nurseries, Montessori, therapy/early-intervention, activity centres and camps.
create type kg_center_type as enum
  ('nursery','kindergarten','montessori','edu_center','therapy_center','activity_center','camp');

alter table kg_tenants
  add column if not exists center_type kg_center_type not null default 'kindergarten';

-- Admissions pipeline stages (they run: new -> awaiting interview -> accepted)
alter type kg_application_status add value if not exists 'interview' after 'under_review';
alter type kg_application_status add value if not exists 'offered' after 'interview';
