-- 0043 — Platform operator: leads, tenant oversight, and a hard privacy line.
--
-- Every role until now belonged to a crèche. Running Rawdati as a business
-- needs a role that sits OUTSIDE any crèche: someone who can see that twelve
-- centres signed up, chase the people who filled in the landing-page quiz, and
-- suspend an account that stops paying.
--
-- THE LINE THIS MIGRATION DRAWS, and the reason it is drawn in SQL rather than
-- left to the UI: a platform admin gets counts and billing metadata, never a
-- child's record. This product holds allergies, medical notes, custody flags
-- and parents' phone numbers. The person selling the software has no business
-- reading any of it, and "the page just doesn't show it" is not a control.
-- kg_platform_admins therefore grants NOTHING on the tenant tables — no RLS
-- policy anywhere references it. The panel can only call the two aggregate
-- functions at the bottom of this file, and those return numbers.

create table kg_platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  note text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);
alter table kg_platform_admins enable row level security;

create or replace function kg_is_platform_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from kg_platform_admins where user_id = auth.uid())
$$;
grant execute on function kg_is_platform_admin() to authenticated;

-- Readable by the operators themselves; never writable from the app. Adding an
-- operator is a deliberate act at the database, so a compromised session cannot
-- promote itself.
create policy pa_sel on kg_platform_admins for select using (kg_is_platform_admin());

-- ── Leads ────────────────────────────────────────────────────────────────
create type kg_lead_status as enum ('new', 'contacted', 'converted', 'lost', 'spam');

create table kg_leads (
  id uuid primary key default gen_random_uuid(),
  -- No tenant_id: a lead is someone who is not a customer yet. That is the
  -- whole point of the table.
  created_at timestamptz not null default now(),
  centre_type text,
  size text,
  priority text,
  wilaya text,
  phone text not null,
  locale text not null default 'ar',
  recommended_plan text,
  status kg_lead_status not null default 'new',
  note text,
  contacted_at timestamptz,
  contacted_by uuid references auth.users(id) on delete set null
);
create index kg_leads_created on kg_leads (created_at desc);
create index kg_leads_status on kg_leads (status, created_at desc);
alter table kg_leads enable row level security;

-- Only operators read leads. There is deliberately no INSERT policy: the
-- public form goes through kg_submit_lead, which is the only thing that gets
-- to write here and carries the rate limiting.
create policy leads_sel on kg_leads for select using (kg_is_platform_admin());
create policy leads_upd on kg_leads for update using (kg_is_platform_admin())
  with check (kg_is_platform_admin());

/**
 * The landing-page quiz posts here. Callable by anon by design — the person
 * filling it in has no account yet, which is why they are a lead.
 *
 * Two limits, because this is a public write endpoint on a public URL:
 * the same phone cannot pile up rows (a double-tap returns the first one
 * instead of erroring, so the visitor never sees a failure they caused), and a
 * global hourly ceiling blunts a flood without needing infrastructure.
 */
create or replace function kg_submit_lead(
  p_phone text,
  p_wilaya text default null,
  p_centre_type text default null,
  p_size text default null,
  p_priority text default null,
  p_recommended_plan text default null,
  p_locale text default 'ar'
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_phone text; v_digits text; v_existing kg_leads; v_id uuid;
begin
  v_phone := nullif(trim(p_phone), '');
  if v_phone is null then raise exception 'phone_required'; end if;
  if length(v_phone) > 32 then raise exception 'phone_invalid'; end if;
  v_digits := regexp_replace(v_phone, '\D', '', 'g');
  if length(v_digits) < 9 then raise exception 'phone_invalid'; end if;

  -- Same caller, same afternoon: hand back what we already have.
  select * into v_existing from kg_leads
   where regexp_replace(phone, '\D', '', 'g') = v_digits
     and created_at > now() - interval '6 hours'
   order by created_at desc limit 1;
  if v_existing.id is not null then
    return jsonb_build_object('id', v_existing.id, 'duplicate', true);
  end if;

  if (select count(*) from kg_leads where created_at > now() - interval '1 hour') >= 60 then
    raise exception 'rate_limited';
  end if;

  insert into kg_leads (phone, wilaya, centre_type, size, priority, recommended_plan, locale)
  values (v_phone, nullif(trim(p_wilaya), ''), nullif(trim(p_centre_type), ''),
          nullif(trim(p_size), ''), nullif(trim(p_priority), ''),
          nullif(trim(p_recommended_plan), ''), coalesce(nullif(trim(p_locale), ''), 'ar'))
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'duplicate', false);
end $$;
grant execute on function kg_submit_lead(text, text, text, text, text, text, text) to anon, authenticated;

create or replace function kg_set_lead_status(p_id uuid, p_status kg_lead_status, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not kg_is_platform_admin() then raise exception 'forbidden'; end if;
  update kg_leads
     set status = p_status,
         note = coalesce(nullif(trim(p_note), ''), note),
         contacted_at = case when p_status = 'new' then null else coalesce(contacted_at, now()) end,
         contacted_by = case when p_status = 'new' then null else coalesce(contacted_by, auth.uid()) end
   where id = p_id;
end $$;
grant execute on function kg_set_lead_status(uuid, kg_lead_status, text) to authenticated;

-- ── Oversight, in aggregate only ─────────────────────────────────────────
create or replace function kg_platform_stats()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not kg_is_platform_admin() then raise exception 'forbidden'; end if;
  return jsonb_build_object(
    'tenants', (select count(*) from kg_tenants),
    'tenants_active', (select count(*) from kg_tenants where status = 'active'),
    'children', (select count(*) from kg_children where status = 'enrolled'),
    'staff', (select count(*) from kg_memberships where role <> 'parent' and status = 'active'),
    'families', (select count(*) from kg_guardians),
    'leads_new', (select count(*) from kg_leads where status = 'new'),
    'leads_total', (select count(*) from kg_leads),
    'signups_30d', (select count(*) from kg_tenants where created_at > now() - interval '30 days')
  );
end $$;
grant execute on function kg_platform_stats() to authenticated;

/**
 * One row per crèche: who they are, how big, when they were last used.
 * Deliberately no child, guardian or staff NAMES — see the header. If an
 * operator needs to see inside an account to support it, that is a
 * conversation with the crèche, not a column here.
 */
create or replace function kg_platform_tenants()
returns table (
  id uuid, name text, wilaya text, commune text, status text,
  created_at timestamptz, children int, staff int, last_activity timestamptz
) language plpgsql stable security definer set search_path = public as $$
begin
  if not kg_is_platform_admin() then raise exception 'forbidden'; end if;
  return query
    select t.id, t.name, t.wilaya, t.commune, t.status, t.created_at,
           (select count(*)::int from kg_children c
             where c.tenant_id = t.id and c.status = 'enrolled'),
           (select count(*)::int from kg_memberships m
             where m.tenant_id = t.id and m.role <> 'parent' and m.status = 'active'),
           greatest(
             (select max(a.check_in_at) from kg_attendance a where a.tenant_id = t.id),
             (select max(p.paid_at) from kg_payments p where p.tenant_id = t.id)
           )
      from kg_tenants t
     order by t.created_at desc;
end $$;
grant execute on function kg_platform_tenants() to authenticated;

create or replace function kg_set_tenant_status(p_tenant uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not kg_is_platform_admin() then raise exception 'forbidden'; end if;
  if p_status not in ('active', 'suspended') then raise exception 'invalid_status'; end if;
  update kg_tenants set status = p_status, updated_at = now() where id = p_tenant;
end $$;
grant execute on function kg_set_tenant_status(uuid, text) to authenticated;

-- ── Bootstrap ────────────────────────────────────────────────────────────
-- The first operator cannot be granted through the app, because nothing in the
-- app is allowed to write kg_platform_admins. But keying the grant on user_id
-- means the account has to exist first, and the founder's usually does not yet.
-- So the grant is made against an EMAIL and redeemed when that address signs
-- up. An address sitting here is a promise, not access: it grants nothing until
-- a real confirmed user owns it.
create table kg_platform_admin_invites (
  email text primary key,
  note text,
  created_at timestamptz not null default now()
);
alter table kg_platform_admin_invites enable row level security;
create policy pai_sel on kg_platform_admin_invites for select using (kg_is_platform_admin());

create or replace function kg_redeem_platform_admin_invite() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_note text;
begin
  select note into v_note from kg_platform_admin_invites
   where lower(email) = lower(new.email);
  if found then
    insert into kg_platform_admins (user_id, note)
      values (new.id, coalesce(v_note, 'redeemed invite'))
      on conflict (user_id) do nothing;
    delete from kg_platform_admin_invites where lower(email) = lower(new.email);
  end if;
  return new;
end $$;
drop trigger if exists trg_kg_redeem_platform_admin on auth.users;
create trigger trg_kg_redeem_platform_admin
  after insert on auth.users
  for each row execute function kg_redeem_platform_admin_invite();

-- The founder. Redeemed the moment this address signs up; already an admin if
-- it has. To add another operator later:
--   insert into kg_platform_admin_invites (email, note) values ('them@x.com', 'ops');
insert into kg_platform_admin_invites (email, note)
values ('f.onthenet@gmail.com', 'founder')
on conflict (email) do nothing;

insert into kg_platform_admins (user_id, note)
select id, 'founder' from auth.users where lower(email) = 'f.onthenet@gmail.com'
on conflict (user_id) do nothing;

-- Deliberately NOT bootstrapping the demo crèche owner. Running a crèche and
-- running the platform are incompatible roles: the demo account is shared,
-- weakly protected and handed around, and it must never be able to read every
-- tenant's totals or the leads table. The panel stays unreachable until a real
-- operator signs up and redeems the invite above — which is the correct state,
-- not a gap.
