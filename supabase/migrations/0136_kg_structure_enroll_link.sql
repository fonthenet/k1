-- 0136 — a structure is born with a link families can already use.
--
-- Signing up left Settings → Liens d'inscription empty, so before accepting a
-- single family a director had to find a screen they had never seen and create
-- a thing they had no name for. The product's own guide lists "publish the
-- enrolment link" as step five of day one — the software may as well do it.
--
-- A TRIGGER rather than a line in the server action, because "a structure has
-- a link" is a fact about the data, not about one screen: the action, a bulk
-- import, a fix-up query and the seed script must all produce it, and only the
-- database sees all four.
--
-- ONE LINK PER STRUCTURE, not one per establishment. The structure decides
-- which classes the form offers and which register the child lands in, so a
-- building running a crèche and a jardin needs two links from the first
-- minute.
create or replace function kg_structure_gets_enroll_link()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_multi boolean; v_owner uuid;
begin
  select count(*) > 1 into v_multi from kg_structures where tenant_id = new.tenant_id;
  select user_id into v_owner from kg_memberships
   where tenant_id = new.tenant_id and role = 'owner' and status = 'active' limit 1;

  -- Generic label on purpose: a director renames it to "Rentrée 2026" when
  -- they mean a specific intake, and a name invented by the software should
  -- read as a starting point rather than as a decision.
  insert into kg_enroll_links (tenant_id, structure_id, label, created_by)
  values (new.tenant_id, new.id,
          case when v_multi then 'Inscriptions — ' || new.name else 'Inscriptions' end,
          v_owner);
  return null;
end $$;

drop trigger if exists trg_kg_structures_enroll_link on kg_structures;
create trigger trg_kg_structures_enroll_link after insert on kg_structures
  for each row execute function kg_structure_gets_enroll_link();

revoke all on function kg_structure_gets_enroll_link() from public, anon, authenticated;

-- Every structure that already exists and has no link of its own gets one, so
-- the chain is complete everywhere rather than only for whoever signs up next.
insert into kg_enroll_links (tenant_id, structure_id, label, created_by)
select s.tenant_id, s.id,
       case when (select count(*) from kg_structures x where x.tenant_id = s.tenant_id) > 1
            then 'Inscriptions — ' || s.name else 'Inscriptions' end,
       (select m.user_id from kg_memberships m
         where m.tenant_id = s.tenant_id and m.role = 'owner' limit 1)
  from kg_structures s
 where s.active
   and not exists (select 1 from kg_enroll_links l where l.structure_id = s.id);
