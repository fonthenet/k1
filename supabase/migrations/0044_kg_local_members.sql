-- 0044 — Staff who have no email, and never will.
--
-- The only way to add a team member was an emailed invitation they had to
-- accept, which assumes every one of them has an email address and checks it.
-- In a Jijel crèche the cook, the driver and half the assistants do not. They
-- still need to exist: to be put on a class, to clock in at the door, to appear
-- on a payroll run, to be paid.
--
-- So kg_memberships.user_id becomes nullable. A membership is a JOB at a
-- crèche; an auth account is how somebody signs in to look at it. Most people
-- have both. A cook has the first and not the second.
--
-- The alternative — minting a shell auth.users row per cook with a fake address
-- — was rejected: it puts unusable logins in the auth system, muddies the user
-- list, and makes "has an account" unanswerable. A null is the honest answer.

alter table kg_memberships
  alter column user_id drop not null,
  add column if not exists full_name text;

comment on column kg_memberships.user_id is
  'Null for local staff who have no login. Their name lives in full_name instead of kg_profiles.';
comment on column kg_memberships.full_name is
  'Name for local staff with no auth account. When user_id is set, kg_profiles.full_name wins.';

-- The old `unique (tenant_id, user_id)` treats every null as distinct, so it
-- keeps doing its job for real accounts and stops constraining local staff.
-- Nothing else to change: a null user_id simply never equals auth.uid(), so
-- every "is this me?" policy already excludes local members correctly.

-- A membership must be able to say who it is, one way or the other.
alter table kg_memberships
  drop constraint if exists kg_memberships_identified;
alter table kg_memberships
  add constraint kg_memberships_identified
  check (user_id is not null or nullif(trim(full_name), '') is not null);

/** One place that answers "what is this person called?". */
create or replace function kg_member_name(p_membership uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select p.full_name from kg_memberships m
       join kg_profiles p on p.id = m.user_id where m.id = p_membership),
    (select nullif(trim(m.full_name), '') from kg_memberships m where m.id = p_membership)
  )
$$;
grant execute on function kg_member_name(uuid) to authenticated;

/**
 * Adds a team member who will never log in.
 *
 * Issues the door credentials in the same breath, because a cook with no
 * account has no other way to be recognised at the kiosk — the staff code and
 * PIN ARE their identity here. Both flow into kg_credentials via the mirror
 * trigger from 0040, so the card reader finds them immediately.
 */
create or replace function kg_create_local_member(
  p_tenant uuid,
  p_full_name text,
  p_role kg_role,
  p_job_title text default null,
  p_pay_type kg_pay_type default 'monthly',
  p_base_salary numeric default null,
  p_hourly_rate numeric default null,
  p_hire_date date default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_name text := nullif(trim(p_full_name), ''); v_id uuid;
        v_code text; v_pin text; v_try int := 0;
begin
  if not kg_is_admin(p_tenant) then raise exception 'forbidden'; end if;
  if v_name is null then raise exception 'name_required'; end if;
  if p_role = 'parent' then raise exception 'not_a_staff_role'; end if;

  -- Next free S-NNN for this crèche, mirroring how child tags are allocated.
  loop
    v_try := v_try + 1;
    select 'S-' || lpad((coalesce(max((substring(staff_code from '^S-([0-9]+)$'))::int), 0) + v_try)::text, 3, '0')
      into v_code
      from kg_memberships
     where tenant_id = p_tenant and staff_code ~ '^S-[0-9]+$';
    exit when not exists (
      select 1 from kg_credentials
       where tenant_id = p_tenant and value = v_code and active);
    if v_try >= 20 then
      v_code := 'S-' || upper(encode(extensions.gen_random_bytes(3), 'hex'));
      exit;
    end if;
  end loop;

  -- A PIN nobody can predict, and unique against every other live credential
  -- in this crèche — a collision would open the wrong person's shift.
  v_try := 0;
  loop
    v_try := v_try + 1;
    v_pin := lpad((floor(random() * 10000))::int::text, 4, '0');
    exit when not exists (
      select 1 from kg_credentials
       where tenant_id = p_tenant and value = v_pin and active);
    if v_try >= 50 then raise exception 'pin_space_exhausted'; end if;
  end loop;

  insert into kg_memberships (
    tenant_id, user_id, full_name, role, status, job_title, hire_date,
    pay_type, base_salary, hourly_rate, staff_code, pin_code
  ) values (
    p_tenant, null, v_name, p_role, 'active', nullif(trim(p_job_title), ''), p_hire_date,
    p_pay_type,
    case when p_pay_type = 'monthly' then p_base_salary end,
    case when p_pay_type = 'hourly' then p_hourly_rate end,
    v_code, v_pin
  ) returning id into v_id;

  -- The PIN is returned exactly once, to be handed over now. It is never
  -- shown again — same rule as guardian PINs in 0020.
  return jsonb_build_object('id', v_id, 'staff_code', v_code, 'pin_code', v_pin);
end $$;
grant execute on function kg_create_local_member(uuid, text, kg_role, text, kg_pay_type, numeric, numeric, date) to authenticated;

/**
 * Attaches a real account to a local member later — when the cook gets an
 * email, or an invited person turns out to already be on the payroll.
 * Their history (timesheets, payslips, door credentials) stays put, because
 * all of it hangs off the membership id, not the user id.
 */
create or replace function kg_link_member_account(p_membership uuid, p_email text)
returns void language plpgsql security definer set search_path = public as $$
declare m kg_memberships; v_user uuid;
begin
  select * into m from kg_memberships where id = p_membership;
  if m.id is null then raise exception 'unknown_member'; end if;
  if not kg_is_admin(m.tenant_id) then raise exception 'forbidden'; end if;
  if m.user_id is not null then raise exception 'already_linked'; end if;

  select id into v_user from auth.users where lower(email) = lower(trim(p_email));
  if v_user is null then raise exception 'no_such_account'; end if;
  if exists (select 1 from kg_memberships
              where tenant_id = m.tenant_id and user_id = v_user) then
    raise exception 'account_already_member';
  end if;

  update kg_memberships set user_id = v_user, updated_at = now() where id = p_membership;
  insert into kg_profiles (id, full_name)
    values (v_user, m.full_name)
    on conflict (id) do update
      set full_name = coalesce(nullif(trim(kg_profiles.full_name), ''), excluded.full_name);
end $$;
grant execute on function kg_link_member_account(uuid, text) to authenticated;
