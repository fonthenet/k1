-- 0134 — a structure runs through the whole product, not just the class list.
--
-- Structures were added under classes and children and stopped there, so a
-- building running a crèche and a jardin still shared ONE tariff list, ONE
-- activity programme, ONE holiday calendar, ONE set of opening hours, ONE menu
-- and ONE ledger. Each is wrong for two establishments that share a door: the
-- jardin closes for the school holidays while the crèche stays open through
-- them — most of why a crèche exists — and the door enforces whichever
-- calendar happened to be typed in.
--
-- NULL MEANS THE WHOLE BUILDING. Every column here is nullable, and null is
-- not "unassigned" — it is a real and usually correct answer: the national
-- holidays, the one kitchen, a price everyone pays. That is what keeps a
-- single-structure crèche from ever seeing the word.
--
-- ON DELETE SET NULL throughout: retiring a structure widens its rows to the
-- building, never deletes a tariff, a holiday or a ledger entry.

alter table kg_fee_plans     add column if not exists structure_id uuid references kg_structures(id) on delete set null;
alter table kg_activities    add column if not exists structure_id uuid references kg_structures(id) on delete set null;
alter table kg_holidays      add column if not exists structure_id uuid references kg_structures(id) on delete set null;
alter table kg_menus         add column if not exists structure_id uuid references kg_structures(id) on delete set null;
alter table kg_transactions  add column if not exists structure_id uuid references kg_structures(id) on delete set null;
alter table kg_announcements add column if not exists structure_id uuid references kg_structures(id) on delete set null;
alter table kg_events        add column if not exists structure_id uuid references kg_structures(id) on delete set null;
alter table kg_incidents     add column if not exists structure_id uuid references kg_structures(id) on delete set null;

create index if not exists kg_fee_plans_structure_idx     on kg_fee_plans (structure_id);
create index if not exists kg_activities_structure_idx    on kg_activities (structure_id);
create index if not exists kg_holidays_structure_idx      on kg_holidays (structure_id);
create index if not exists kg_menus_structure_idx         on kg_menus (structure_id);
create index if not exists kg_transactions_structure_idx  on kg_transactions (structure_id);
create index if not exists kg_announcements_structure_idx on kg_announcements (structure_id);
create index if not exists kg_events_structure_idx        on kg_events (structure_id);

comment on column kg_fee_plans.structure_id is
  'The structure this tariff belongs to. NULL = the whole building, which is '
  'right for a crèche running one thing and for a price everyone pays.';
comment on column kg_holidays.structure_id is
  'The structure this closure applies to. NULL = the whole building — correct '
  'for national holidays, wrong for the jardin''s school vacations, through '
  'which the crèche stays open.';

-- One menu row per day per tenant cannot hold the crèche's purée AND the
-- jardin's couscous. The sentinel uuid stands in for "whole building" so a
-- null structure still collides with itself.
alter table kg_menus drop constraint if exists kg_menus_tenant_id_date_key;
create unique index if not exists kg_menus_tenant_date_structure_key
  on kg_menus (tenant_id, date, coalesce(structure_id, '00000000-0000-0000-0000-000000000000'::uuid));

alter table kg_structures add column if not exists opening_hours jsonb;
comment on column kg_structures.opening_hours is
  'This structure''s own days and hours, same shape as kg_tenants.opening_hours. '
  'NULL inherits the establishment''s — what every structure does until set.';

create or replace function kg_structure_hours(p_structure uuid, p_tenant uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(
    (select s.opening_hours from kg_structures s
      where s.id = p_structure and s.opening_hours is not null),
    (select t.opening_hours from kg_tenants t where t.id = p_tenant)
  )
$$;
revoke all on function kg_structure_hours(uuid, uuid) from public, anon;
grant execute on function kg_structure_hours(uuid, uuid) to authenticated;

-- A closure with no structure shuts the building. kg_holidays dates the start
-- in `date`, not `start_date`.
create or replace function kg_structure_closed_on(p_structure uuid, p_tenant uuid, p_date date)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from kg_holidays h
     where h.tenant_id = p_tenant and h.closure
       and p_date between h.date and coalesce(h.end_date, h.date)
       and (h.structure_id is null or h.structure_id = p_structure)
  )
$$;
revoke all on function kg_structure_closed_on(uuid, uuid, date) from public, anon;
grant execute on function kg_structure_closed_on(uuid, uuid, date) to authenticated;

-- Income posted from a payment already knows its structure: the payment names
-- the child and the child names the structure. It was thrown away at posting,
-- so "which side makes the money" had no answer. kg_transactions has no
-- child_id of its own; it reaches one through related_payment_id.
create or replace function kg_transaction_infer_structure()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.structure_id is null and new.related_payment_id is not null then
    select c.structure_id into new.structure_id
      from kg_payments p join kg_children c on c.id = p.child_id
     where p.id = new.related_payment_id;
  end if;
  return new;
end $$;

drop trigger if exists trg_kg_transactions_structure on kg_transactions;
create trigger trg_kg_transactions_structure
  before insert or update of related_payment_id on kg_transactions
  for each row execute function kg_transaction_infer_structure();

revoke all on function kg_transaction_infer_structure() from public, anon, authenticated;

update kg_transactions t set structure_id = c.structure_id
  from kg_payments p join kg_children c on c.id = p.child_id
 where t.related_payment_id = p.id and t.structure_id is null
   and c.structure_id is not null;
