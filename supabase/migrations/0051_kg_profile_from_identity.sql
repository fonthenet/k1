-- 0051 — A profile keeps whatever the person actually gave us at signup.
--
-- Signing up with a phone number instead of an email (see lib/auth-identifier.ts)
-- exposed a gap that predates it: every place that bootstraps a kg_profiles row
-- from auth.users copies `full_name` out of the metadata and drops `phone` on the
-- floor. For an email signup that lost an optional field. For a phone signup it
-- loses the ONE contact detail the person supplied — the crèche ends up with an
-- owner it cannot ring.
--
-- Note this project shares its Supabase instance with a legacy prototype whose
-- own `handle_auth_user_created` trigger writes to `public.profiles`, NOT to
-- `kg_profiles`. Nothing populates kg_profiles automatically on signup; the row
-- is created by whichever RPC first needs it. So the fix belongs in those RPCs.

-- Everything a new profile can be seeded with, read once from the auth record.
-- The phone comes from the signup metadata, or is decoded from the phone-login
-- alias — for `0555119977@phone.rawdati.app` the address IS the number.
create or replace function kg_identity_seed(p_user uuid)
returns table (full_name text, phone text)
language plpgsql stable security definer set search_path = public as $$
declare v_meta jsonb; v_email text; v_phone text;
begin
  select raw_user_meta_data, u.email into v_meta, v_email
    from auth.users u where u.id = p_user;

  v_phone := nullif(btrim(coalesce(v_meta->>'phone', '')), '');
  if v_phone is null and lower(split_part(coalesce(v_email, ''), '@', 2)) = 'phone.rawdati.app' then
    v_phone := split_part(v_email, '@', 1);
  end if;

  return query select
    coalesce(nullif(btrim(coalesce(v_meta->>'full_name', '')), ''), ''),
    kg_normalize_phone(v_phone);
end $$;
revoke execute on function kg_identity_seed(uuid) from anon;

-- Seeds (or tops up) the profile. `coalesce` on update, never overwrite: a
-- person who has since corrected their number in their profile must not have
-- the signup value put back on top of it.
create or replace function kg_bootstrap_profile(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_name text; v_phone text;
begin
  select s.full_name, s.phone into v_name, v_phone from kg_identity_seed(p_user) s;
  insert into kg_profiles (id, full_name, phone)
  values (p_user, coalesce(v_name, ''), v_phone)
  on conflict (id) do update set
    full_name = case
      when nullif(btrim(kg_profiles.full_name), '') is null then excluded.full_name
      else kg_profiles.full_name end,
    phone = coalesce(kg_profiles.phone, excluded.phone);
end $$;
revoke execute on function kg_bootstrap_profile(uuid) from anon;

-- ── The three places a profile is born ───────────────────────────────────

-- 1. Creating a crèche (0007's kg_create_tenant, five-argument form).
--    Body is 0007's verbatim apart from the profile line — the seeded holiday
--    list and everything else must not drift because of an unrelated fix.
create or replace function kg_create_tenant(
  p_name text, p_slug text, p_phone text default null,
  p_wilaya text default 'Jijel', p_commune text default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_tenant uuid; v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'auth required'; end if;
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

-- 2. Accepting a staff invite (0004). The row was created with nothing on it.
create or replace function kg_accept_staff_invite(p_token text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v kg_staff_invites; v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'auth required'; end if;
  select * into v from kg_staff_invites where token = p_token and accepted_at is null and expires_at > now();
  if v.id is null then raise exception 'invalid_invite'; end if;
  insert into kg_memberships (tenant_id, user_id, role, job_title, status)
    values (v.tenant_id, v_uid, v.role, v.job_title, 'active')
    on conflict (tenant_id, user_id) do update set role = excluded.role, status = 'active';
  perform kg_bootstrap_profile(v_uid);
  update kg_staff_invites set accepted_at = now() where id = v.id;
  return v.tenant_id;
end $$;

-- 3. A guardian gaining an account (0008).
create or replace function kg_ensure_parent_membership() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.user_id is not null then
    insert into kg_memberships (tenant_id, user_id, role)
      values (new.tenant_id, new.user_id, 'parent')
      on conflict (tenant_id, user_id) do nothing;
    perform kg_bootstrap_profile(new.user_id);
  end if;
  return new;
end $$;

-- Backfill: every profile that has no phone but whose auth record does.
do $$
declare r record;
begin
  for r in select id from kg_profiles where phone is null loop
    perform kg_bootstrap_profile(r.id);
  end loop;
end $$;
