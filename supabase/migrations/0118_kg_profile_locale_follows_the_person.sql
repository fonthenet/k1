-- 0118 — every account is "French", because nobody ever wrote its language.
--
-- ---------------------------------------------------------------------------
-- What is wrong
-- ---------------------------------------------------------------------------
--
-- kg_profiles.locale is what the push dispatchers (0013 kg_pending_push,
-- 0075 kg_pending_native_push) read to pick the language of a notification.
-- Three things conspired to make it meaningless:
--
--   1. The column defaults to 'fr' (0001), in a product whose first language
--      is Arabic and whose tenants default to 'ar' (five of six do).
--   2. kg_bootstrap_profile — the only way a profile is born — never sets it,
--      so every profile inherits the schema default.
--   3. The UI language lives in the kg-locale cookie, and the switchers in
--      the topbar, the portal, the landing page and the auth pages only ever
--      wrote the cookie. Only the two profile forms wrote the column, and
--      they preselect what the column already says.
--
-- Result, today, in production: 21 profiles, 21 rows with locale = 'fr'.
-- The Jijel tenant is genuinely French-first, but the other five are Arabic
-- crèches whose staff and families read the app in Arabic — and the moment
-- the first phone registers for push, it will receive its backlog (210
-- notifications are queued unpushed) in French. The Settings language
-- selector shows the same wrong answer to the same people.
--
-- ---------------------------------------------------------------------------
-- The fix
-- ---------------------------------------------------------------------------
--
-- Four small pieces, all on the theme "the language follows the person":
--
--   * The default becomes 'ar'. Arabic is the product's first language and
--     the tenant default; French was an accident of the first migration.
--   * kg_bootstrap_profile takes an optional locale and writes it ON INSERT
--     ONLY. The on-conflict branch never touches locale, because a person who
--     already chose a language must not have it overwritten by joining a
--     second crèche. The two joining paths (staff invite, guardian account)
--     pass their tenant's default_locale; kg_create_tenant needs no change,
--     its one-argument call now lands on the 'ar' default, which is also the
--     default_locale it writes for the new tenant.
--   * The web action setLocale() (src/app/actions/locale.ts) now upserts the
--     column alongside the cookie, so every switcher keeps the two in step.
--     That is an app change, noted here because it is the other half.
--   * The dispatchers fall back to the notification's tenant default rather
--     than a global 'ar' when no profile row exists yet. After this file that
--     is a corner case (bootstrap now seeds the column), but a family with a
--     phone and no profile row is exactly the case where guessing wrong hurts.
--
-- Backfill: only the profiles nobody has ever saved through a form. A profile
-- whose updated_at moved more than a minute past created_at was written by
-- one of the two profile forms, which include the language selector — that
-- choice is kept even if it was only the preselected value, because there is
-- no way to tell the two apart after the fact. The other ten rows take the
-- default_locale of the tenant they joined first. One profile has no
-- membership at all; it is left alone and gets the new default semantics
-- through nothing (its row already exists, and it still says 'fr').

begin;

/* ---------------------------------------------------------------- default */

alter table kg_profiles alter column locale set default 'ar';

/* -------------------------------------------------------------- bootstrap */

-- The one-argument form must go, not coexist: with a defaulted second
-- parameter a call with one argument would match both and Postgres refuses
-- to choose. Every caller (0051's three birth places, 0052's kg_create_tenant)
-- keeps calling it with one argument and keeps working.
drop function if exists kg_bootstrap_profile(uuid);

create or replace function kg_bootstrap_profile(p_user uuid, p_locale text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_name text; v_phone text;
begin
  select s.full_name, s.phone into v_name, v_phone from kg_identity_seed(p_user) s;
  insert into kg_profiles (id, full_name, phone, locale)
  values (p_user, coalesce(v_name, ''), v_phone,
          case when p_locale in ('ar', 'en', 'fr') then p_locale else 'ar' end)
  on conflict (id) do update set
    full_name = case
      when nullif(btrim(kg_profiles.full_name), '') is null then excluded.full_name
      else kg_profiles.full_name end,
    phone = coalesce(kg_profiles.phone, excluded.phone);
    -- locale deliberately absent: a language already chosen is never reset.
end $$;

comment on function kg_bootstrap_profile(uuid, text) is
  'Creates the profile row for a user the first time they belong somewhere. '
  'p_locale seeds the notification language on INSERT only; an existing row '
  'keeps whatever the person chose.';

-- 0087 revoked the old signature; a dropped-and-recreated function starts
-- with the PUBLIC grant again (0102's lesson), so the revoke is re-applied.
revoke all on function kg_bootstrap_profile(uuid, text) from public, anon, authenticated;

/* --------------------------------------------------- the two joining paths */

-- 0051's body verbatim, plus the tenant's language on the bootstrap call.
create or replace function kg_accept_staff_invite(p_token text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v kg_staff_invites; v_uid uuid := auth.uid(); v_locale text;
begin
  if v_uid is null then raise exception 'auth required'; end if;
  select * into v from kg_staff_invites where token = p_token and accepted_at is null and expires_at > now();
  if v.id is null then raise exception 'invalid_invite'; end if;
  insert into kg_memberships (tenant_id, user_id, role, job_title, status)
    values (v.tenant_id, v_uid, v.role, v.job_title, 'active')
    on conflict (tenant_id, user_id) do update set role = excluded.role, status = 'active';
  select default_locale into v_locale from kg_tenants where id = v.tenant_id;
  perform kg_bootstrap_profile(v_uid, v_locale);
  update kg_staff_invites set accepted_at = now() where id = v.id;
  return v.tenant_id;
end $$;

-- 0051's body verbatim, plus the tenant's language on the bootstrap call.
create or replace function kg_ensure_parent_membership() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_locale text;
begin
  if new.user_id is not null then
    insert into kg_memberships (tenant_id, user_id, role)
      values (new.tenant_id, new.user_id, 'parent')
      on conflict (tenant_id, user_id) do nothing;
    select default_locale into v_locale from kg_tenants where id = new.tenant_id;
    perform kg_bootstrap_profile(new.user_id, v_locale);
  end if;
  return new;
end $$;

/* ------------------------------------------------------------ dispatchers */

-- Same bodies as 0013 / 0075 with one change: the fallback for a missing
-- profile is the tenant's default_locale, then 'ar'. CREATE OR REPLACE keeps
-- the existing ACLs (kg_pending_native_push is reachable by anon on purpose,
-- see 0076; kg_pending_push carries the PUBLIC grant the dispatcher relies
-- on), so no grant is touched here.
create or replace function kg_pending_push(p_secret text, p_limit int default 200)
returns table (
  notification_id uuid, user_id uuid, locale text, type text,
  title text, body text, data jsonb, created_at timestamptz,
  endpoint text, p256dh text, auth text
) language plpgsql stable security definer set search_path = public as $$
begin
  if not kg_push_secret_ok(p_secret) then raise exception 'forbidden'; end if;
  return query
    select n.id, n.user_id, coalesce(pr.locale, t.default_locale, 'ar'), n.type,
           n.title, n.body, n.data, n.created_at,
           s.endpoint, s.p256dh, s.auth
      from kg_notifications n
      join kg_push_subscriptions s on s.user_id = n.user_id
      left join kg_profiles pr on pr.id = n.user_id
      left join kg_tenants t on t.id = n.tenant_id
     where n.pushed_at is null
       -- A notification older than a day is stale news; don't wake a phone for it.
       and n.created_at > now() - interval '1 day'
     order by n.created_at
     limit p_limit;
end $$;

create or replace function kg_pending_native_push(p_secret text, p_limit int default 200)
returns table (
  notification_id uuid, user_id uuid, locale text, type text,
  title text, body text, data jsonb, created_at timestamptz,
  token text, platform text
) language plpgsql stable security definer set search_path = public as $$
begin
  if not kg_push_secret_ok(p_secret) then raise exception 'forbidden'; end if;
  return query
    select n.id, n.user_id, coalesce(pr.locale, t.default_locale, 'ar'), n.type,
           n.title, n.body, n.data, n.created_at,
           d.token, d.platform
      from kg_notifications n
      join kg_push_devices d on d.user_id = n.user_id
      left join kg_profiles pr on pr.id = n.user_id
      left join kg_tenants t on t.id = n.tenant_id
     where n.pushed_at is null
       -- A notification older than a day is stale news; don't wake a phone for it.
       and n.created_at > now() - interval '1 day'
     order by n.created_at
     limit p_limit;
end $$;

/* --------------------------------------------------------------- backfill */

-- Profiles never saved through a form take the language of the crèche they
-- joined first. Re-runnable: a row this touches gets its updated_at bumped by
-- the kg_touch trigger and so falls out of the predicate next time, and a
-- row already equal to the tenant default is a no-op update either way.
update kg_profiles p
   set locale = first_tenant.default_locale
  from (
    select distinct on (m.user_id) m.user_id, t.default_locale
      from kg_memberships m
      join kg_tenants t on t.id = m.tenant_id
     order by m.user_id, m.created_at
  ) first_tenant
 where first_tenant.user_id = p.id
   and p.updated_at <= p.created_at + interval '1 minute'
   and p.locale is distinct from first_tenant.default_locale;

commit;

-- ---------------------------------------------------------------------------
-- After applying:
--
--   select locale, count(*) from kg_profiles group by 1;
--   -- expect the ten never-edited rows on 'ar' (or 'fr' for the Jijel-first
--   -- ones), the eleven form-saved rows unchanged.
--
--   select column_default from information_schema.columns
--    where table_name = 'kg_profiles' and column_name = 'locale';   -- 'ar'
--
-- Then switch the language in the topbar as any signed-in user and confirm
-- their kg_profiles.locale follows.
