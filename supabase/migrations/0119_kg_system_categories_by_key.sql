-- 0119 — the ledger's system categories are known by a French word, and only
--        by that word.
--
-- ---------------------------------------------------------------------------
-- What is wrong
-- ---------------------------------------------------------------------------
--
-- kg_create_tenant seeds eleven accounting categories per crèche — Scolarité,
-- Salaires, Loyer … — French only, in a product whose first language is
-- Arabic and where five of the six tenants default to 'ar'. An Arabic-speaking
-- accountant sees a French chart of accounts they never asked for.
--
-- Worse than the language: the name IS the identity. kg_category_id (0030)
-- finds a system category by its literal name and, when it finds none,
-- INSERTS a fresh one marked is_system. Every money trigger goes through it
-- with a hard-coded French literal — 'Salaires' from the payroll and advance
-- triggers (0030, 0082, 0101), 'Scolarité' / 'Frais d''inscription' /
-- 'Activités' / 'Autres revenus' from invoice routing (0031, 0055).
--
-- saveCategory in the web app renames any category freely; only DELETE is
-- guarded by is_system. So the day the accountant renames 'Salaires' to
-- 'الرواتب' — the most natural edit in the world — the next payslip creates a
-- brand-new 'Salaires' and books itself there. The ledger silently splits:
-- old salaries under the Arabic name, new ones under a French row that
-- reappeared from nowhere, and the category totals lie from then on.
--
-- And the seeded holidays are written as literal dates for 2026-27. A crèche
-- created in September 2027 gets Yennayer of January 2027, already past.
--
-- ---------------------------------------------------------------------------
-- The fix
-- ---------------------------------------------------------------------------
--
-- Identity moves out of the name into a stable `system_key` ('tuition',
-- 'salaries', 'rent', …) that a human never edits, and the name becomes what
-- it should always have been: a label, in two scripts (`name` and a new
-- `name_ar`), both free to change.
--
--   * kg_system_categories() is the single seed list: key, kind, French
--     name, Arabic name, colour. kg_create_tenant reads it; nothing else
--     spells a category name any more.
--   * kg_system_category_id(tenant, key) resolves by key and creates the row
--     from the seed when a tenant is missing it.
--   * kg_category_id keeps its signature — the triggers in 0031/0055/0082/0101
--     are not rewritten here — but now maps the French literal it is handed
--     to a key and delegates. A rename can no longer make it insert a
--     duplicate. Unknown names (nothing passes one) keep the old behaviour.
--   * A BEFORE UPDATE guard makes system_key, is_system and kind immutable on
--     a system row, so PostgREST cannot be used to detach one either.
--   * Holidays are seeded as the next occurrence of each fixed national date
--     from the day the crèche is created, whatever year that is.
--
-- The existing 66 system rows (11 × 6 tenants, one per name each — verified)
-- receive their key and Arabic name from the seed by their current French
-- name. Their French names are left as they are.
--
-- The web app still shows `name` only; the accounting pages need to select
-- name_ar and prefer it under the Arabic locale, and saveCategory needs a
-- name_ar field. Those edits are noted for the accounting module owner.

begin;

/* ---------------------------------------------------------------- columns */

alter table kg_txn_categories
  add column if not exists system_key text,
  add column if not exists name_ar text;

comment on column kg_txn_categories.system_key is
  'Stable identity of a seeded category (tuition, salaries, …). The money '
  'triggers resolve by this, never by name. NULL for categories people add.';
comment on column kg_txn_categories.name_ar is
  'Arabic label, shown under the Arabic locale; `name` stays the French one.';

/* ------------------------------------------------------------------- seed */

create or replace function kg_system_categories()
returns table (system_key text, kind kg_txn_kind, name text, name_ar text, color text)
language sql immutable as $$
  values
    ('tuition',        'income'::kg_txn_kind,  'Scolarité',           'الرسوم الدراسية', '#22c55e'),
    ('enrollment_fee', 'income'::kg_txn_kind,  'Frais d''inscription', 'رسوم التسجيل',   '#10b981'),
    ('activities',     'income'::kg_txn_kind,  'Activités',           'الأنشطة',          '#14b8a6'),
    ('other_income',   'income'::kg_txn_kind,  'Autres revenus',      'إيرادات أخرى',    '#84cc16'),
    ('salaries',       'expense'::kg_txn_kind, 'Salaires',            'الرواتب',          '#ef4444'),
    ('rent',           'expense'::kg_txn_kind, 'Loyer',               'الإيجار',          '#f97316'),
    ('food',           'expense'::kg_txn_kind, 'Alimentation',        'التغذية',          '#f59e0b'),
    ('supplies',       'expense'::kg_txn_kind, 'Fournitures',         'اللوازم',          '#eab308'),
    ('maintenance',    'expense'::kg_txn_kind, 'Entretien',           'الصيانة',          '#a855f7'),
    ('transport',      'expense'::kg_txn_kind, 'Transport',           'النقل',            '#8b5cf6'),
    ('other_expense',  'expense'::kg_txn_kind, 'Autres dépenses',     'مصاريف أخرى',     '#64748b')
$$;
revoke all on function kg_system_categories() from public, anon;
grant execute on function kg_system_categories() to authenticated;

alter table kg_txn_categories drop constraint if exists kg_txn_categories_system_key_check;
alter table kg_txn_categories add constraint kg_txn_categories_system_key_check
  check (system_key is null or system_key in (
    'tuition', 'enrollment_fee', 'activities', 'other_income',
    'salaries', 'rent', 'food', 'supplies', 'maintenance', 'transport', 'other_expense'
  ));

/* --------------------------------------------------------------- backfill */

-- Before the unique index, so a duplicate would surface as a constraint
-- error on the index rather than silently claim the key on one of the two.
update kg_txn_categories c
   set system_key = s.system_key,
       name_ar    = coalesce(c.name_ar, s.name_ar)
  from kg_system_categories() s
 where c.is_system
   and c.system_key is null
   and c.kind = s.kind
   and c.name = s.name;

create unique index if not exists kg_txn_categories_system_key_unique
  on kg_txn_categories (tenant_id, system_key)
  where system_key is not null;

/* ------------------------------------------------------------- resolution */

create or replace function kg_system_category_id(p_tenant uuid, p_key text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; s record;
begin
  select id into v_id from kg_txn_categories
   where tenant_id = p_tenant and system_key = p_key;
  if v_id is not null then return v_id; end if;

  select * into s from kg_system_categories() where system_key = p_key;
  if s.system_key is null then
    raise exception 'unknown system category %', p_key;
  end if;

  -- A tenant older than this file whose row was renamed before the backfill
  -- could run would otherwise gain a second row here; adopt a same-named,
  -- keyless system row first.
  update kg_txn_categories
     set system_key = p_key, name_ar = coalesce(name_ar, s.name_ar)
   where tenant_id = p_tenant and is_system and system_key is null
     and kind = s.kind and name = s.name
  returning id into v_id;
  if v_id is not null then return v_id; end if;

  insert into kg_txn_categories (tenant_id, name, name_ar, kind, is_system, system_key, color)
  values (p_tenant, s.name, s.name_ar, s.kind, true, p_key, s.color)
  returning id into v_id;
  return v_id;
end $$;
revoke all on function kg_system_category_id(uuid, text) from public, anon, authenticated;

-- Same signature as 0030 so its callers stand. The French literal is now a
-- lookup into the seed, not a row identity.
create or replace function kg_category_id(p_tenant uuid, p_name text, p_kind kg_txn_kind)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_key text; v_id uuid;
begin
  select s.system_key into v_key from kg_system_categories() s
   where s.name = p_name and s.kind = p_kind;
  if v_key is not null then
    return kg_system_category_id(p_tenant, v_key);
  end if;

  -- Not a seeded name. Nothing in the schema passes one; kept as 0030 wrote
  -- it so an unforeseen caller degrades to the old behaviour, not an error.
  select id into v_id from kg_txn_categories
   where tenant_id = p_tenant and name = p_name and kind = p_kind limit 1;
  if v_id is null then
    insert into kg_txn_categories (tenant_id, name, kind, is_system)
      values (p_tenant, p_name, p_kind, true) returning id into v_id;
  end if;
  return v_id;
end $$;
-- 0077 closed this to every client role; a replaced function keeps its ACL,
-- but the revoke is cheap and this file is where someone will look.
revoke all on function kg_category_id(uuid, text, kg_txn_kind) from public, anon, authenticated;

/* ------------------------------------------------------------------ guard */

-- tc_all lets finance UPDATE any column over PostgREST. Names and colours
-- are theirs to change; the identity is not. Deletion is already refused by
-- the app and left to RLS here, because a BEFORE DELETE guard would also fire
-- inside the cascade that removes a whole tenant.
create or replace function kg_guard_system_category() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.system_key is not null and (
       new.system_key is distinct from old.system_key
    or new.is_system is distinct from old.is_system
    or new.kind is distinct from old.kind
  ) then
    raise exception 'system_category_locked';
  end if;
  return new;
end $$;
drop trigger if exists trg_kg_guard_system_category on kg_txn_categories;
create trigger trg_kg_guard_system_category
  before update on kg_txn_categories
  for each row execute function kg_guard_system_category();

/* --------------------------------------------------------------- holidays */

-- The next calendar date with this month and day, counting from p_from
-- (today by default). A crèche created on 2 September 2026 gets 1 November
-- 2026 and 12 January 2027; one created in February 2027 gets 1 November
-- 2027 and 12 January 2028, instead of dates already behind it.
create or replace function kg_next_annual_date(p_month int, p_day int, p_from date default current_date)
returns date language sql stable as $$
  select case
    when make_date(extract(year from p_from)::int, p_month, p_day) < p_from
    then make_date(extract(year from p_from)::int + 1, p_month, p_day)
    else make_date(extract(year from p_from)::int, p_month, p_day)
  end
$$;
revoke all on function kg_next_annual_date(int, int, date) from public, anon;
grant execute on function kg_next_annual_date(int, int, date) to authenticated;

/* ---------------------------------------------------------- create tenant */

-- 0052's body, with the two seeds now read from their tables. The explicit
-- 'ar' on the bootstrap call is the tenant default written two lines above
-- (0118 made kg_bootstrap_profile take a locale).
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
  perform kg_bootstrap_profile(v_uid, 'ar');

  insert into kg_txn_categories (tenant_id, name, name_ar, kind, is_system, system_key, color)
  select v_tenant, s.name, s.name_ar, s.kind, true, s.system_key, s.color
    from kg_system_categories() s;

  -- Fixed-date national holidays only. The two Eids and Mawlid move with the
  -- lunar calendar and are announced late; the director adds them as
  -- tentative rows and confirms them from Settings (confirmHoliday) when
  -- the date is official.
  insert into kg_holidays (tenant_id, date, name, name_ar, tentative)
  select v_tenant, kg_next_annual_date(h.m, h.d), h.name, h.name_ar, false
    from (values
      (1,  1,  'Jour de l''an',                 'رأس السنة الميلادية'),
      (1,  12, 'Yennayer',                      'يناير'),
      (5,  1,  'Fête du travail',               'عيد العمال'),
      (7,  5,  'Fête de l''indépendance',       'عيد الاستقلال'),
      (11, 1,  'Anniversaire de la Révolution', 'عيد الثورة')
    ) as h(m, d, name, name_ar);

  return v_tenant;
end $$;

commit;

-- ---------------------------------------------------------------------------
-- After applying:
--
--   select count(*) from kg_txn_categories where is_system and system_key is null;
--   -- expect 0
--
--   begin;
--   update kg_txn_categories set name = 'الرواتب'
--    where system_key = 'salaries' and tenant_id = '<demo tenant>';
--   select kg_category_id('<demo tenant>', 'Salaires', 'expense');
--   -- expect the SAME id as before the rename, and no new row
--   rollback;
--
--   begin;
--   update kg_txn_categories set system_key = null where system_key = 'salaries';
--   -- expect: system_category_locked
--   rollback;
