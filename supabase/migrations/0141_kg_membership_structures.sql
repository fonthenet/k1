-- 0141 — a member of staff belongs to one or more structures directly.
--
-- Until now the only link between a person and a structure ran through the
-- classes they teach. That works for educators and for nobody else: the cook
-- who feeds both sides, the cleaner who does the crèche only, the secretary
-- at the école's desk — none of them has a class, so none of them belonged
-- anywhere. The Équipe page could not filter them, the register per structure
-- could not list them, and the rail opened them on the whole building.
--
-- This is a plain many-to-many. It does not replace the class link — an
-- educator's structures are still wherever their classes are — it sits beside
-- it, and readers take the UNION of the two. Assigning a person here says
-- "this is where they work"; assigning them to a class says what they do.

create table if not exists kg_membership_structures (
  membership_id uuid not null references kg_memberships(id) on delete cascade,
  structure_id  uuid not null references kg_structures(id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (membership_id, structure_id)
);
create index if not exists kg_membership_structures_structure_idx
  on kg_membership_structures (structure_id);

-- The two sides must be the same establishment. The FKs alone would let a
-- membership at one crèche be filed under another crèche's structure.
create or replace function kg_membership_structure_same_tenant()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select tenant_id from kg_memberships where id = new.membership_id)
     is distinct from
     (select tenant_id from kg_structures where id = new.structure_id) then
    raise exception 'structure_not_in_tenant';
  end if;
  return new;
end $$;
drop trigger if exists trg_kg_membership_structures_tenant on kg_membership_structures;
create trigger trg_kg_membership_structures_tenant
  before insert or update on kg_membership_structures
  for each row execute function kg_membership_structure_same_tenant();
revoke all on function kg_membership_structure_same_tenant() from public, anon, authenticated;

alter table kg_membership_structures enable row level security;
drop policy if exists ms_sel on kg_membership_structures;
drop policy if exists ms_ins on kg_membership_structures;
drop policy if exists ms_del on kg_membership_structures;
-- Every member of the establishment can see who works where (the kiosk and
-- the register need it); only admins change it.
create policy ms_sel on kg_membership_structures for select
  using (exists (select 1 from kg_memberships m
                  where m.id = membership_id and kg_is_member(m.tenant_id)));
create policy ms_ins on kg_membership_structures for insert
  with check (exists (select 1 from kg_memberships m
                       where m.id = membership_id and kg_is_admin(m.tenant_id)));
create policy ms_del on kg_membership_structures for delete
  using (exists (select 1 from kg_memberships m
                  where m.id = membership_id and kg_is_admin(m.tenant_id)));

-- The union, in one place, so the rail, the Équipe page and the register
-- agree on where a person works: their direct structures plus the structures
-- of their classes.
create or replace function kg_member_structures(p_membership uuid)
returns setof uuid language sql stable security definer set search_path = public as $$
  select ms.structure_id from kg_membership_structures ms where ms.membership_id = p_membership
  union
  select c.structure_id from kg_class_staff cs join kg_classes c on c.id = cs.class_id
   where cs.membership_id = p_membership and c.structure_id is not null
$$;
revoke all on function kg_member_structures(uuid) from public, anon;
grant execute on function kg_member_structures(uuid) to authenticated;
