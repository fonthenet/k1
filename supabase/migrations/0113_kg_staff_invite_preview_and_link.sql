-- 0113 — a staff invite is a bearer link that says nothing until after you
-- have created an account, binds to nobody, and duplicates the person it was
-- meant for.
--
-- ---------------------------------------------------------------------------
-- What is wrong
-- ---------------------------------------------------------------------------
--
-- Three things, all in kg_staff_invites / kg_accept_staff_invite (0006):
--
-- 1. The link cannot be previewed. /join/<token> shows the sign-up and sign-in
--    forms first and only learns the token is dead when kg_accept_staff_invite
--    raises — AFTER the person has created an account for nothing. The parent
--    claim flow solved exactly this with kg_claim_preview (0088); the staff
--    flow never got the same function.
--
-- 2. The dialog asks for an email and stores it, but nothing sends mail and
--    nothing compares the address with the account that accepts. Whoever
--    holds the link joins with the invite's role. The label "Invite by email"
--    was a promise the code did not keep.
--
-- 3. Accepting always INSERTs a membership (or, on conflict, overwrites the
--    existing row's role — a demotion if the invite role is lower). The
--    director had typed the cook into the team in 0044 as a name-only row;
--    when the cook finally gets a phone and accepts a link, the crèche ends
--    up with two memberships for one person: the old one carrying the
--    timesheets, payslips and door PIN, the new one carrying the login.
--    kg_link_member_account (0044) exists for precisely this and nothing calls
--    it.
--
-- Zero invites exist in production, so nothing needs repairing; the first
-- tenant to use the feature would have inherited all three.
--
-- ---------------------------------------------------------------------------
-- The fix
-- ---------------------------------------------------------------------------
--
-- kg_staff_invite_preview(token): status, crèche name, role, logo. Same
-- envelope as kg_claim_preview and public for the same reason — the page it
-- feeds renders before sign-in. Never the inviter, never the email, never the
-- tenant id.
--
-- email becomes optional and, when present, BINDING. The accepting account's
-- auth email must equal it. Phone sign-ups carry an alias address
-- (0555123456@phone.rawdatik.app, see src/lib/auth-identifier.ts), so a
-- director who wants to bind a phone user types the number and the app stores
-- the alias — the comparison stays a plain lower-cased equality here. Left
-- empty, the invite is an open link and the dialog says so in as many words.
--
-- membership_id: an invite can be minted FOR a name-only member. Accepting it
-- attaches the new login to that row instead of inserting another; the
-- person's history stays on the id it always had. An account that is already
-- a member of the crèche cannot claim a second row.
--
-- Accepting into an existing membership never demotes: the invite's role is
-- applied only when it outranks the current one (a parent becoming an
-- educator, an educator becoming an admin). Owner is no longer an invitable
-- role in the app; ownership is transferred deliberately, not mailed.

begin;

/* --------------------------------------------------------------- schema */

alter table kg_staff_invites alter column email drop not null;

alter table kg_staff_invites
  add column if not exists membership_id uuid references kg_memberships(id) on delete set null;

comment on column kg_staff_invites.email is
  'Optional. When set, only an account whose auth email equals it (phone users: their alias) may accept. Null means anyone holding the link.';
comment on column kg_staff_invites.membership_id is
  'When set, accepting links the login to this name-only membership (user_id null) instead of inserting a new one.';

/* -------------------------------------------------------------- preview */

create or replace function kg_staff_invite_preview(p_token text)
returns table (status text, tenant_name text, role text, logo_url text, bound boolean)
language plpgsql stable security definer set search_path = public as $$
declare v kg_staff_invites; v_name text; v_logo text;
begin
  select * into v from kg_staff_invites where token = btrim(coalesce(p_token, ''));

  if v.id is null then
    return query select 'unknown'::text, null::text, null::text, null::text, false;
    return;
  end if;
  if v.accepted_at is not null then
    return query select 'accepted'::text, null::text, null::text, null::text, false;
    return;
  end if;
  if v.expires_at <= now() then
    return query select 'expired'::text, null::text, null::text, null::text, false;
    return;
  end if;

  select t.name, t.logo_url into v_name, v_logo from kg_tenants t where t.id = v.tenant_id;
  return query select 'valid'::text, v_name, v.role::text, v_logo, (v.email is not null);
end $$;

-- Public on purpose: the page that shows it renders before sign-in. The token
-- is 32 hex characters from gen_random_bytes, so enumeration is not the risk.
revoke all on function kg_staff_invite_preview(text) from public;
grant execute on function kg_staff_invite_preview(text) to anon, authenticated;

/* --------------------------------------------------------------- accept */

create or replace function kg_accept_staff_invite(p_token text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v kg_staff_invites;
  v_uid uuid := auth.uid();
  v_email text;
  v_existing kg_memberships;
  v_member kg_memberships;
  v_rank_invite int;
  v_rank_existing int;
begin
  if v_uid is null then raise exception 'auth required'; end if;

  select * into v from kg_staff_invites where token = btrim(coalesce(p_token, ''));
  if v.id is null or v.accepted_at is not null or v.expires_at <= now() then
    raise exception 'invalid_invite';
  end if;

  -- A bound invite belongs to one address. The alias domain for phone
  -- sign-ups is an ordinary email string on auth.users, so one comparison
  -- covers both kinds of account.
  if v.email is not null then
    select lower(u.email) into v_email from auth.users u where u.id = v_uid;
    if v_email is distinct from lower(btrim(v.email)) then
      raise exception 'invite_email_mismatch';
    end if;
  end if;

  select * into v_existing from kg_memberships
   where tenant_id = v.tenant_id and user_id = v_uid;

  if v.membership_id is not null then
    -- Link path: the director minted this invite for a specific name-only row.
    if v_existing.id is not null then raise exception 'account_already_member'; end if;

    select * into v_member from kg_memberships where id = v.membership_id;
    if v_member.id is null or v_member.tenant_id <> v.tenant_id or v_member.user_id is not null then
      raise exception 'invite_member_taken';
    end if;

    update kg_memberships
       set user_id = v_uid, status = 'active', updated_at = now()
     where id = v_member.id;

    perform kg_bootstrap_profile(v_uid);
    -- The director's spelling of the name is better than an empty profile.
    update kg_profiles
       set full_name = v_member.full_name
     where id = v_uid and nullif(btrim(full_name), '') is null
       and nullif(btrim(v_member.full_name), '') is not null;

  elsif v_existing.id is null then
    insert into kg_memberships (tenant_id, user_id, role, job_title, status)
      values (v.tenant_id, v_uid, v.role, v.job_title, 'active');
    perform kg_bootstrap_profile(v_uid);

  else
    -- Already a member. Re-activate if needed; change the role only upward.
    v_rank_invite := case v.role
      when 'owner' then 50 when 'admin' then 40 when 'accountant' then 30
      when 'educator' then 20 when 'staff' then 10 else 0 end;
    v_rank_existing := case v_existing.role
      when 'owner' then 50 when 'admin' then 40 when 'accountant' then 30
      when 'educator' then 20 when 'staff' then 10 else 0 end;

    update kg_memberships
       set status = 'active',
           role = case when v_rank_invite > v_rank_existing then v.role else role end,
           job_title = coalesce(job_title, v.job_title),
           updated_at = now()
     where id = v_existing.id;
    perform kg_bootstrap_profile(v_uid);
  end if;

  update kg_staff_invites set accepted_at = now() where id = v.id;
  return v.tenant_id;
end $$;

-- Called after sign-in only; the body requires auth.uid(). 0006 revoked anon
-- without touching PUBLIC, so anon kept it — this time both go.
revoke all on function kg_accept_staff_invite(text) from public, anon;
grant execute on function kg_accept_staff_invite(text) to authenticated;

commit;
