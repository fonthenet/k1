-- 0171 — the profile number: a third way to sign in, for everyone.
--
-- The owner's ask: "add profile number to login along with the email — for
-- business owners and parents, staff." An address is long to type at a
-- gate, a phone number is not everyone's, and a grandmother who collects
-- twice a week has neither in her head. So every account gets ONE short
-- number — 8 digits, the first never 0 (an Algerian phone is 10 digits and
-- starts with 0, so the two never read alike) — shown on their profile
-- page, and the sign-in field takes it like an address or a phone.
--
-- The number is not a second identity in GoTrue (there is one e-mail per
-- account, and phone sign-in already rides on an alias address). It is a
-- lookup: number → the account's e-mail, then the usual password sign-in.
-- The lookup must not hand an anonymous caller an e-mail for a number —
-- that would be an address book by enumeration — so it answers ONLY with
-- the password: kg_login_email_for_number(number, password) checks the
-- password against auth.users' bcrypt hash first (pgcrypto's crypt, the
-- same algorithm GoTrue wrote it with) and returns the e-mail only when it
-- matches; five wrong passwords on a number lock it for fifteen minutes.
-- Wrong number, wrong password and a locked number all read the same: null.
-- The client then signs in with the e-mail it got — the normal path, the
-- normal session, nothing else learns about numbers.
--
-- Every existing account is numbered here; new accounts are numbered by a
-- trigger on auth.users the moment they exist (a failure there never
-- blocks a sign-up — the number is minted on the profile's next read).
-- Staff of an establishment may read a guardian's number
-- (kg_guardian_login_number) — the director is who a parent asks when they
-- have lost it.
--
-- Rehearsed on production (qekibejzwpphzzyqigzo) on 2026-09-14 through
-- execute_sql — see the pass mark at the end of §6. Not applied.
begin;
set local lock_timeout = '5s';

-- ── 1. The numbers ────────────────────────────────────────────────────────
create table if not exists public.kg_login_numbers (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  number     text not null unique check (number ~ '^[1-9][0-9]{7}$'),
  created_at timestamptz not null default now()
);
alter table public.kg_login_numbers enable row level security;
drop policy if exists ln_sel on public.kg_login_numbers;
create policy ln_sel on public.kg_login_numbers for select using (user_id = auth.uid());

-- The throttle: wrong passwords per number, the kiosk exit's shape (0038).
create table if not exists public.kg_login_number_attempts (
  number            text primary key,
  failures          int not null default 0,
  window_started_at timestamptz not null default now()
);
alter table public.kg_login_number_attempts enable row level security;

-- ── 2. Minting ────────────────────────────────────────────────────────────
-- Eight digits from pgcrypto's random bytes, the first 1–9, unique across
-- the platform (the sign-in field has no establishment yet). Internal.
create or replace function public.kg_mint_login_number(p_user uuid) returns text
language plpgsql security definer set search_path = public as $$
declare v_number text; v_bytes bytea; v_i int;
begin
  if p_user is null then raise exception 'invalid_user'; end if;
  select number into v_number from kg_login_numbers where user_id = p_user;
  if v_number is not null then return v_number; end if;
  loop
    v_bytes := extensions.gen_random_bytes(8);
    v_number := (1 + get_byte(v_bytes, 0) % 9)::text;
    for v_i in 1..7 loop
      v_number := v_number || (get_byte(v_bytes, v_i) % 10)::text;
    end loop;
    begin
      insert into kg_login_numbers (user_id, number) values (p_user, v_number);
      return v_number;
    exception when unique_violation then
      -- The user got one meanwhile, or the number is taken: read, or retry.
      select number into v_number from kg_login_numbers where user_id = p_user;
      if v_number is not null then return v_number; end if;
    end;
  end loop;
end $$;

-- Everyone who already has an account.
insert into public.kg_login_numbers (user_id, number)
select u.id, public.kg_mint_login_number(u.id) from auth.users u
 where not exists (select 1 from public.kg_login_numbers n where n.user_id = u.id)
on conflict do nothing;

-- New accounts, the moment they exist. Never in the way of a sign-up.
create or replace function public.kg_on_auth_user_created() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.kg_mint_login_number(new.id);
  return new;
exception when others then
  raise warning 'kg_on_auth_user_created: % (%)', sqlerrm, new.id;
  return new;
end $$;
drop trigger if exists kg_on_auth_user_created on auth.users;
create trigger kg_on_auth_user_created after insert on auth.users
  for each row execute function public.kg_on_auth_user_created();

-- ── 3. Reading one's own number ───────────────────────────────────────────
create or replace function public.kg_my_login_number() returns text
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'forbidden' using errcode = '42501'; end if;
  return public.kg_mint_login_number(auth.uid());
end $$;

-- A guardian's number, for the staff who help them: staff of the tenant the
-- guardian belongs to. Null when the guardian has no account.
create or replace function public.kg_guardian_login_number(p_guardian uuid) returns text
language plpgsql security definer set search_path = public as $$
declare v_tenant uuid; v_user uuid;
begin
  select g.tenant_id, g.user_id into v_tenant, v_user from kg_guardians g where g.id = p_guardian;
  if v_tenant is null or not kg_is_staff(v_tenant) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_user is null then return null; end if;
  return public.kg_mint_login_number(v_user);
end $$;

-- ── 4. The sign-in lookup ─────────────────────────────────────────────────
-- Number and password in, the account's e-mail out — or null. The password
-- is checked HERE, against the hash GoTrue keeps, so the e-mail never
-- leaves for a caller who does not hold the password; then the client
-- signs in with the e-mail the ordinary way, and GoTrue checks the same
-- password again. Five wrong passwords in fifteen minutes lock the number
-- for the rest of the window; a right one clears the count. Callable by
-- anon — the person is not signed in yet — and answering one shape only.
create or replace function public.kg_login_email_for_number(p_number text, p_password text) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_number text := regexp_replace(coalesce(p_number, ''), '[^0-9]', '', 'g');
  v_user uuid; v_email text; v_hash text; v_attempt kg_login_number_attempts;
  v_window interval := interval '15 minutes'; v_limit int := 5;
begin
  if v_number !~ '^[1-9][0-9]{7}$' or coalesce(p_password, '') = '' then return null; end if;

  select * into v_attempt from kg_login_number_attempts where number = v_number for update;
  if v_attempt.number is not null and v_attempt.window_started_at > now() - v_window
     and v_attempt.failures >= v_limit then
    return null;
  end if;

  select n.user_id, u.email, u.encrypted_password into v_user, v_email, v_hash
    from kg_login_numbers n join auth.users u on u.id = n.user_id
   where n.number = v_number and u.deleted_at is null and u.banned_until is null;

  if v_user is not null and v_hash is not null and v_hash <> ''
     and extensions.crypt(p_password, v_hash) = v_hash then
    delete from kg_login_number_attempts where number = v_number;
    return v_email;
  end if;

  -- A miss — an unknown number counts too, so the two are not told apart.
  insert into kg_login_number_attempts (number, failures, window_started_at)
  values (v_number, 1, now())
  on conflict (number) do update
    set failures = case when kg_login_number_attempts.window_started_at > now() - v_window
                        then kg_login_number_attempts.failures + 1 else 1 end,
        window_started_at = case when kg_login_number_attempts.window_started_at > now() - v_window
                        then kg_login_number_attempts.window_started_at else now() end;
  return null;
end $$;

-- ── 5. The catalogue, and who may call what ───────────────────────────────
comment on table public.kg_login_numbers is
  'One 8-digit profile number per account (first digit 1–9), a third way to sign in beside the e-mail and the phone. Minted for every account by kg_mint_login_number; read by its owner (kg_my_login_number) and, for a guardian, by the staff of their establishment (kg_guardian_login_number). See 0171.';
comment on table public.kg_login_number_attempts is
  'Wrong passwords per profile number: five in fifteen minutes lock the number for the window. Written by kg_login_email_for_number only.';
comment on function public.kg_login_email_for_number(text, text) is
  'The sign-in lookup: the account e-mail for a profile number, ONLY when the password matches the account''s hash; null for a wrong number, a wrong password or a locked number, all alike. Callable before signing in.';
comment on function public.kg_my_login_number() is 'The caller''s profile number, minted on first read.';
comment on function public.kg_guardian_login_number(uuid) is 'A guardian''s profile number for the staff of their establishment; null without an account.';
revoke all on function public.kg_mint_login_number(uuid) from public, anon, authenticated;
revoke all on function public.kg_on_auth_user_created() from public, anon, authenticated;
revoke all on function public.kg_my_login_number() from public, anon;
grant execute on function public.kg_my_login_number() to authenticated;
revoke all on function public.kg_guardian_login_number(uuid) from public, anon;
grant execute on function public.kg_guardian_login_number(uuid) to authenticated;
revoke all on function public.kg_login_email_for_number(text, text) from public;
grant execute on function public.kg_login_email_for_number(text, text) to anon, authenticated;

-- ── 6. Rehearsal, always rolled back ─────────────────────────────────────
-- The 0168 shape: an inner block whose writes end in P0171 → the pass mark.
-- The demo educator's password is REPLACED for the rehearsal (a hash of a
-- known word, written with the same crypt GoTrue uses) and rolled back with
-- everything else; no real credential is read as clear text anywhere.
do $$
declare
  t uuid := '732bdf7d-775a-4ed7-875f-8c04ea4e4778';
  u_educator uuid; u_owner uuid; u_parent uuid; g_id uuid; v text; v2 text; n int; i int; v_email text;
begin
  select user_id into u_educator from public.kg_memberships where tenant_id = t and role = 'educator' and status = 'active' and user_id is not null limit 1;
  select user_id into u_owner from public.kg_memberships where tenant_id = t and role = 'owner' and status = 'active' and user_id is not null limit 1;
  select g.user_id, g.id into u_parent, g_id from public.kg_guardians g
    join public.kg_memberships m on m.user_id = g.user_id and m.tenant_id = t and m.role = 'parent' and m.status = 'active'
   where g.tenant_id = t and g.user_id is not null limit 1;
  if u_educator is null or u_owner is null or u_parent is null then
    raise exception 'rehearsal: the demo tenant lacks an educator, an owner or a parent with an account';
  end if;

  begin
    -- a) Everyone is numbered, once, in the right shape; a second mint is
    --    the same number.
    select count(*) into n from auth.users u where not exists (select 1 from public.kg_login_numbers l where l.user_id = u.id);
    if n <> 0 then raise exception 'a) % accounts without a number', n; end if;
    if exists (select 1 from public.kg_login_numbers where number !~ '^[1-9][0-9]{7}$') then raise exception 'a) a number in the wrong shape'; end if;
    v := public.kg_mint_login_number(u_educator); v2 := public.kg_mint_login_number(u_educator);
    if v <> v2 then raise exception 'a) minting twice gave two numbers'; end if;

    -- b) One's own number, and the staff's read of a guardian's; a parent
    --    may not read a guardian's, nor anyone a number by table.
    perform set_config('request.jwt.claims', json_build_object('sub', u_educator, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    if public.kg_my_login_number() <> v then raise exception 'b) my number is not mine'; end if;
    if (select count(*) from public.kg_login_numbers) <> 1 then raise exception 'b) the table shows more than my row'; end if;
    v2 := public.kg_guardian_login_number(g_id);
    if v2 !~ '^[1-9][0-9]{7}$' then raise exception 'b) the guardian''s number: %', v2; end if;
    execute 'reset role';
    perform set_config('request.jwt.claims', json_build_object('sub', u_parent, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    begin
      perform public.kg_guardian_login_number(g_id);
      raise exception 'b) a parent read a guardian''s number';
    exception when insufficient_privilege then null;
    end;
    if public.kg_my_login_number() <> v2 then raise exception 'b) the parent''s own number differs from what staff read'; end if;
    execute 'reset role';

    -- c) The lookup: a known password on the educator's account (replaced
    --    for the rehearsal), then the wrong one five times, then the right
    --    one refused because the number is locked; an unknown number and a
    --    blank password answer null; formatting is forgiven.
    update auth.users set encrypted_password = extensions.crypt('rehearsal-0171', extensions.gen_salt('bf')) where id = u_educator;
    select email into v_email from auth.users where id = u_educator;
    perform set_config('request.jwt.claims', '', true);
    execute 'set local role anon';
    if public.kg_login_email_for_number(v, 'rehearsal-0171') is distinct from v_email then raise exception 'c) the right password did not answer the e-mail'; end if;
    if public.kg_login_email_for_number(' ' || left(v, 4) || ' ' || right(v, 4) || ' ', 'rehearsal-0171') is distinct from v_email then raise exception 'c) blanks were not forgiven'; end if;
    if public.kg_login_email_for_number(v, 'wrong') is not null then raise exception 'c) a wrong password answered'; end if;
    if public.kg_login_email_for_number('99999999', 'rehearsal-0171') is not null then raise exception 'c) an unknown number answered'; end if;
    if public.kg_login_email_for_number(v, '') is not null then raise exception 'c) a blank password answered'; end if;
    if public.kg_login_email_for_number('0' || left(v, 7), 'rehearsal-0171') is not null then raise exception 'c) a phone-shaped value answered'; end if;
    for i in 1..4 loop perform public.kg_login_email_for_number(v, 'wrong'); end loop;
    if public.kg_login_email_for_number(v, 'rehearsal-0171') is not null then raise exception 'c) the number was not locked after five misses'; end if;
    execute 'reset role';
    if (select failures from public.kg_login_number_attempts where number = v) < 5 then raise exception 'c) the misses were not counted'; end if;
    -- The window is over: the right password answers again and clears the count.
    update public.kg_login_number_attempts set window_started_at = now() - interval '16 minutes' where number = v;
    execute 'set local role anon';
    if public.kg_login_email_for_number(v, 'rehearsal-0171') is distinct from v_email then raise exception 'c) the lock did not lift with the window'; end if;
    execute 'reset role';
    if exists (select 1 from public.kg_login_number_attempts where number = v) then raise exception 'c) a right password did not clear the count'; end if;
    -- The anonymous caller reads nothing by table.
    execute 'set local role anon';
    if (select count(*) from public.kg_login_numbers) <> 0 then raise exception 'c) anon reads the numbers'; end if;
    execute 'reset role';

    -- d) Who may call what.
    if has_function_privilege('anon', 'public.kg_mint_login_number(uuid)', 'execute')
       or has_function_privilege('authenticated', 'public.kg_mint_login_number(uuid)', 'execute')
       or not has_function_privilege('anon', 'public.kg_login_email_for_number(text,text)', 'execute')
       or has_function_privilege('anon', 'public.kg_my_login_number()', 'execute')
       or not has_function_privilege('authenticated', 'public.kg_my_login_number()', 'execute') then
      raise exception 'd) the grants are off';
    end if;

    raise exception using errcode = 'P0171', message = 'rehearsal done';
  exception when sqlstate 'P0171' then
    raise exception '0171 rehearsal ok — rolled back';
  end;
end $$;

notify pgrst, 'reload schema';
commit;
