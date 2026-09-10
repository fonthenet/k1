-- 0142 — a family's own dossier list says which structure and which child.
--
-- 0058 made kg_applications staff-only and gave families kg_my_applications(),
-- which returns nothing internal — and that rule stands: no status, no stage,
-- no waitlist position. But the STRUCTURE the family asked for, the CLASS they
-- picked and, for a transfer, WHICH of their children it concerns are the
-- family's own words, typed into the form by them. Handing those back is not
-- a leak; without them the portal could only say "a request is pending"
-- and had to guess which child by matching names.
--
-- Same function, same privacy: approved dossiers still excluded (the child
-- card is the good news), `closed` still the only word for a refusal.
drop function if exists kg_my_applications();
create or replace function kg_my_applications()
returns table (
  id uuid,
  tenant_name text,
  child_first_name text,
  child_last_name text,
  created_at timestamptz,
  closed boolean,
  source text,
  existing_child_id uuid,
  structure_id uuid,
  class_id uuid
) language sql stable security definer set search_path = public as $$
  select a.id, t.name,
         a.child->>'first_name', a.child->>'last_name',
         a.created_at,
         (a.status = 'rejected') as closed,
         a.source, a.existing_child_id, a.structure_id, a.class_id
    from kg_applications a
    join kg_tenants t on t.id = a.tenant_id
   where a.applicant_user_id = auth.uid()
     and a.status <> 'approved'
   order by a.created_at desc
$$;
revoke all on function kg_my_applications() from public, anon;
grant execute on function kg_my_applications() to authenticated;
