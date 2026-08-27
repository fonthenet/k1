-- 0052 — Two crèches cannot share a name.
--
-- Only `slug` was unique, so nothing stopped a second "Les Petits Génies de
-- Jijel" from being created. On a multi-tenant platform that is not a cosmetic
-- problem: the name is what a parent reads on the portal header, on an invoice,
-- and on the enrolment link they were sent. Two identical names is how a family
-- signs into the wrong crèche.
--
-- Case- and whitespace-insensitive, because "petits génies" and "Petits Génies "
-- are the same establishment to everybody except a byte comparison.
create unique index if not exists kg_tenants_name_unique
  on kg_tenants (lower(btrim(name)));

-- Creation now fails with a distinct, catchable reason for each collision, so
-- the wizard can point at the field that is actually wrong instead of saying
-- "something went wrong" and making the person guess which of the two it was.
create or replace function kg_create_tenant(
  p_name text, p_slug text, p_phone text default null,
  p_wilaya text default 'Jijel', p_commune text default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_tenant uuid; v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'auth required'; end if;

  if exists (select 1 from kg_tenants where lower(btrim(name)) = lower(btrim(p_name))) then
    raise exception 'name_taken' using errcode = 'unique_violation';
  end if;
  if exists (select 1 from kg_tenants where slug = p_slug) then
    raise exception 'slug_taken' using errcode = 'unique_violation';
  end if;

  insert into kg_tenants (name, slug, phone, wilaya, commune, default_locale)
    values (p_name, p_slug, p_phone, p_wilaya, p_commune, 'ar') returning id into v_tenant;
  insert into kg_memberships (tenant_id, user_id, role) values (v_tenant, v_uid, 'owner');
  perform kg_bootstrap_profile(v_uid);
  insert into kg_txn_categories (tenant_id, name, kind, is_system, color) values
    (v_tenant, 'Scolarité', 'income', true, '#22c55e'),
    (v_tenant, 'Frais d''inscription', 'income', true, '#10b981'),
    (v_tenant, 'Activités', 'income', true, '#14b8a6'),
    (v_tenant, 'Autres revenus', 'income', true, '#84cc16'),
    (v_tenant, 'Salaires', 'expense', true, '#ef4444'),
    (v_tenant, 'Loyer', 'expense', true, '#f97316'),
    (v_tenant, 'Alimentation', 'expense', true, '#f59e0b'),
    (v_tenant, 'Fournitures', 'expense', true, '#eab308'),
    (v_tenant, 'Entretien', 'expense', true, '#a855f7'),
    (v_tenant, 'Transport', 'expense', true, '#8b5cf6'),
    (v_tenant, 'Autres dépenses', 'expense', true, '#64748b');
  insert into kg_holidays (tenant_id, date, name, name_ar, tentative) values
    (v_tenant, date '2027-01-01', 'Jour de l''an', 'رأس السنة الميلادية', false),
    (v_tenant, date '2027-01-12', 'Yennayer', 'يناير', false),
    (v_tenant, date '2026-11-01', 'Anniversaire de la Révolution', 'عيد الثورة', false),
    (v_tenant, date '2027-05-01', 'Fête du travail', 'عيد العمال', false),
    (v_tenant, date '2027-07-05', 'Fête de l''indépendance', 'عيد الاستقلال', false);
  return v_tenant;
end $$;

-- Renaming an existing crèche has to answer to the same rule. The unique index
-- already enforces it; this only turns the raw index error into the same word
-- the creation path uses, so one message covers both.
create or replace function kg_guard_tenant_name() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and lower(btrim(new.name)) is not distinct from lower(btrim(old.name)) then
    return new;
  end if;
  if exists (
    select 1 from kg_tenants t
     where lower(btrim(t.name)) = lower(btrim(new.name)) and t.id <> new.id
  ) then
    raise exception 'name_taken' using errcode = 'unique_violation';
  end if;
  return new;
end $$;
drop trigger if exists trg_kg_guard_tenant_name on kg_tenants;
create trigger trg_kg_guard_tenant_name before insert or update of name on kg_tenants
  for each row execute function kg_guard_tenant_name();

-- Lets the wizard say "that name is taken" while the person is still typing,
-- without exposing anything about the crèche that holds it. Boolean only.
create or replace function kg_tenant_name_available(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (
    select 1 from kg_tenants where lower(btrim(name)) = lower(btrim(p_name))
  )
$$;
grant execute on function kg_tenant_name_available(text) to authenticated;

create or replace function kg_tenant_slug_available(p_slug text) returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from kg_tenants where slug = lower(btrim(p_slug)))
$$;
grant execute on function kg_tenant_slug_available(text) to authenticated;
