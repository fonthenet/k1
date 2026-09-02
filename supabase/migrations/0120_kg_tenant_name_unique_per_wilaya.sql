-- 0120 — an establishment name is reserved within its wilaya, not across Algeria.
--
-- ---------------------------------------------------------------------------
-- What is wrong
-- ---------------------------------------------------------------------------
--
-- 0052 made kg_tenants.name unique for the whole platform, case- and
-- whitespace-insensitively, and enforced it in four places at once: the index
-- kg_tenants_name_unique, a predicate inside kg_create_tenant, the trigger
-- trg_kg_guard_tenant_name on rename, and kg_tenant_name_available for the
-- wizard's live check.
--
-- Its stated reason — two identical names is how a family signs into the wrong
-- crèche — does not hold. A parent never picks a crèche by name: they redeem a
-- claim code the crèche gave them (0053), or accept an enrolment link, and the
-- membership row that results is what routes them. Nothing in login reads the
-- tenant name.
--
-- What the rule does do is block honest signups. "Rawda" is a test tenant in
-- Jijel today, and روضة / Rawda / "Les Petits Anges" are what a great many
-- crèches in this country are called. Every one of them after the first is
-- told "that name is taken" by a stranger in another wilaya, and has no way
-- to find out why. A rename from Settings fails the same way and surfaces as
-- 'generic' — the owner sees "something went wrong" with no hint that the
-- name is the field to change.
--
-- ---------------------------------------------------------------------------
-- The fix
-- ---------------------------------------------------------------------------
--
-- Keep a uniqueness rule, because two crèches with the same name in the same
-- town IS confusing on an invoice or an enrolment poster, but scope it to the
-- wilaya. Two Rawdas in Jijel still collide; a Rawda in Jijel and a Rawda in
-- Oran do not. The slug stays globally unique — it is the URL, and that rule
-- is untouched.
--
-- All four enforcement points move together; leaving any one of them on the
-- old rule would keep refusing the very signups this is meant to allow.
-- kg_tenant_name_available gains a p_wilaya argument (defaulting to null so an
-- older client that sends only p_name still gets an answer — the conservative,
-- all-wilayas one).
--
-- No existing row collides under the new key: six tenants, all distinct on
-- (name, wilaya), so the index rebuild is safe to run against production.

begin;

/* ---------------------------------------------------------------- index */

drop index if exists kg_tenants_name_unique;

-- coalesce so a tenant without a wilaya (the column is nullable, default
-- 'Jijel') still takes part in the rule instead of being exempt from it —
-- NULL never equals NULL in a unique index.
create unique index if not exists kg_tenants_name_wilaya_unique
  on kg_tenants (lower(btrim(name)), lower(btrim(coalesce(wilaya, ''))));

/* ------------------------------------------------------------- creation */

-- Same body as 0052; only the name predicate now looks inside the wilaya it
-- is being created in. p_wilaya was already an argument.
create or replace function kg_create_tenant(
  p_name text, p_slug text, p_phone text default null,
  p_wilaya text default 'Jijel', p_commune text default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_tenant uuid; v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'auth required'; end if;

  if exists (
    select 1 from kg_tenants
     where lower(btrim(name)) = lower(btrim(p_name))
       and lower(btrim(coalesce(wilaya, ''))) = lower(btrim(coalesce(p_wilaya, '')))
  ) then
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

/* --------------------------------------------------------------- rename */

-- A rename — or a move to another wilaya, which can now create a collision
-- of its own — answers to the same rule. The index enforces it; the trigger
-- only turns the raw index error into the word the creation path raises, so
-- settings/actions.ts can name the field instead of saying "something went
-- wrong". The trigger therefore also fires on UPDATE OF wilaya.
create or replace function kg_guard_tenant_name() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE'
     and lower(btrim(new.name)) is not distinct from lower(btrim(old.name))
     and lower(btrim(coalesce(new.wilaya, ''))) is not distinct from lower(btrim(coalesce(old.wilaya, '')))
  then
    return new;
  end if;
  if exists (
    select 1 from kg_tenants t
     where lower(btrim(t.name)) = lower(btrim(new.name))
       and lower(btrim(coalesce(t.wilaya, ''))) = lower(btrim(coalesce(new.wilaya, '')))
       and t.id <> new.id
  ) then
    raise exception 'name_taken' using errcode = 'unique_violation';
  end if;
  return new;
end $$;
drop trigger if exists trg_kg_guard_tenant_name on kg_tenants;
create trigger trg_kg_guard_tenant_name before insert or update of name, wilaya on kg_tenants
  for each row execute function kg_guard_tenant_name();

/* ----------------------------------------------------------- live check */

-- Dropped rather than overloaded: PostgREST resolves an RPC by its argument
-- names, and keeping both (p_name) and (p_name, p_wilaya) would make a call
-- with only p_name ambiguous. The default covers that caller instead.
drop function if exists kg_tenant_name_available(text);

create or replace function kg_tenant_name_available(p_name text, p_wilaya text default null)
returns boolean language sql stable security definer set search_path = public as $$
  select not exists (
    select 1 from kg_tenants
     where lower(btrim(name)) = lower(btrim(p_name))
       and (p_wilaya is null
            or lower(btrim(coalesce(wilaya, ''))) = lower(btrim(p_wilaya)))
  )
$$;

comment on function kg_tenant_name_available(text, text) is
  'Is this establishment name still free in this wilaya? Boolean only, so a '
  'stranger learns nothing about who holds it. With p_wilaya null it answers '
  'for the whole platform, which is the conservative reading for an older client.';

-- Same grants as 0087: never anon.
revoke all on function kg_tenant_name_available(text, text) from public, anon;
grant execute on function kg_tenant_name_available(text, text) to authenticated;

commit;
