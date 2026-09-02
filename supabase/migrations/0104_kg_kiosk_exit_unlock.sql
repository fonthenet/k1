-- 0104 — leaving the door kiosk takes a secret.
--
-- ---------------------------------------------------------------------------
-- What is wrong
-- ---------------------------------------------------------------------------
--
-- The kiosk header carried a plain link to /dashboard. The tablet on the wall
-- is signed in as a staff account — in a one-owner crèche, most plausibly
-- the owner's own — and the hall it hangs in is walked through by every
-- parent, grandparent and older sibling of the day. On an OS-pinned tablet
-- (Guided Access, screen pinning) that X was precisely the control that
-- defeated the pinning: one tap and the visitor was reading the roster,
-- the health files and the ledger under the office's session.
--
-- ---------------------------------------------------------------------------
-- The fix
-- ---------------------------------------------------------------------------
--
-- The link is gone. The X now opens a prompt, and the server action behind
-- it (exitKiosk in attendance/actions.ts) verifies the secret here, signs
-- the device out and lands on /login — it never navigates into the
-- dashboard under the kiosk's session. Whoever wants the office signs in
-- as themselves.
--
-- The secret accepted here is the PIN of an owner or admin membership of
-- the tenant, compared on the server and never sent to the browser. The
-- action also accepts the signed-in account's own password, re-verified
-- through Supabase Auth, which brings its own rate limit; this function
-- brings one for the PIN path: five wrong PINs in ten minutes lock the
-- attempt for that session, so a four-digit PIN cannot be walked through
-- at the door. Attempts are per (user, tenant) — the tablet's own session —
-- and the row is dropped on success.
--
-- Longer term the door device wants a dedicated 'kiosk' role that
-- requireStaff admits only for /kiosk and that kg_is_staff / kg_is_educator
-- exclude, so that even a stolen session cannot read kg_children. That is a
-- role model change and is not attempted here.

begin;

/* --------------------------------------------------------- attempts */

create table if not exists kg_kiosk_exit_attempts (
  user_id           uuid not null references auth.users(id) on delete cascade,
  tenant_id         uuid not null references kg_tenants(id) on delete cascade,
  failures          int  not null default 0,
  window_started_at timestamptz not null default now(),
  primary key (user_id, tenant_id)
);

comment on table kg_kiosk_exit_attempts is
  'Wrong-PIN counter for leaving the door kiosk, per signed-in session and tenant. '
  'Written only by kg_kiosk_exit_unlock; five failures in ten minutes lock the prompt.';

-- No policies on purpose: only the definer function below reads or writes it.
alter table kg_kiosk_exit_attempts enable row level security;

/* ----------------------------------------------------------- unlock */

create or replace function kg_kiosk_exit_unlock(p_tenant uuid, p_pin text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_pin     text := btrim(coalesce(p_pin, ''));
  v_attempt kg_kiosk_exit_attempts;
  v_window  interval := interval '10 minutes';
  v_limit   int := 5;
begin
  -- The kiosk itself is signed in as staff; anyone else has no business here.
  if not kg_is_staff(p_tenant) then raise exception 'forbidden'; end if;

  -- A PIN is digits. Anything else is refused without counting: the action
  -- only sends digit strings down this path.
  if v_pin !~ '^[0-9]{4,8}$' then return 'wrong'; end if;

  select * into v_attempt
    from kg_kiosk_exit_attempts
   where user_id = auth.uid() and tenant_id = p_tenant
   for update;

  if v_attempt.user_id is not null
     and v_attempt.window_started_at > now() - v_window
     and v_attempt.failures >= v_limit then
    return 'locked';
  end if;

  -- Say so when there is nothing to match against, so the person at the
  -- door is told to use the account password instead of guessing forever.
  if not exists (
    select 1 from kg_memberships m
     where m.tenant_id = p_tenant and m.status = 'active'
       and m.role in ('owner', 'admin') and m.pin_code is not null
  ) then
    return 'no_pin';
  end if;

  if exists (
    select 1 from kg_memberships m
     where m.tenant_id = p_tenant and m.status = 'active'
       and m.role in ('owner', 'admin') and m.pin_code = v_pin
  ) then
    delete from kg_kiosk_exit_attempts where user_id = auth.uid() and tenant_id = p_tenant;
    return 'ok';
  end if;

  -- Wrong: count it, in the current ten-minute window or a fresh one.
  insert into kg_kiosk_exit_attempts (user_id, tenant_id, failures, window_started_at)
  values (auth.uid(), p_tenant, 1, now())
  on conflict (user_id, tenant_id) do update
    set failures = case
          when kg_kiosk_exit_attempts.window_started_at > now() - v_window
            then kg_kiosk_exit_attempts.failures + 1
          else 1 end,
        window_started_at = case
          when kg_kiosk_exit_attempts.window_started_at > now() - v_window
            then kg_kiosk_exit_attempts.window_started_at
          else now() end;
  return 'wrong';
end $$;

comment on function kg_kiosk_exit_unlock(uuid, text) is
  'Checks a director PIN for leaving the door kiosk. Returns ok | wrong | locked | no_pin. '
  'Rate-limited to five failures per ten minutes per session; the PIN never leaves the server.';

revoke all on function kg_kiosk_exit_unlock(uuid, text) from public, anon;
grant execute on function kg_kiosk_exit_unlock(uuid, text) to authenticated;

commit;
