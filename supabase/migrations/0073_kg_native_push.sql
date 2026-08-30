-- Native push devices (iOS + Android), alongside the existing web push table.
--
-- Applied 2026-08-28. See 0074, which closes the grant this one left open.
--
-- Why a second table rather than columns on kg_push_subscriptions: that table
-- is Web Push, and every row in it is a triple of endpoint + p256dh + auth that
-- `dispatchPendingPush()` feeds to the web-push library. A native token has no
-- key pair and is delivered by a different transport entirely. Widening the
-- table would mean every reader learning to skip half its rows, and the first
-- reader to forget would spend a delivery attempt failing.

create table if not exists kg_push_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- An Expo push token: ExponentPushToken[…] or a raw APNs/FCM token later.
  token text not null,
  platform text not null check (platform in ('ios', 'android')),
  failure_count integer not null default 0,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  -- One row per device, not per sign-in: reinstalling gives a new token, and
  -- signing in again on the same device must not create a duplicate.
  unique (token)
);

create index if not exists kg_push_devices_user on kg_push_devices (user_id);

alter table kg_push_devices enable row level security;

-- A person may see and delete their own devices, and nothing else. Inserts go
-- through the RPC below rather than a policy, so the token is always bound to
-- the caller and can never be attached to somebody else's user_id.
create policy pd_sel on kg_push_devices for select using (user_id = auth.uid());
create policy pd_del on kg_push_devices for delete using (user_id = auth.uid());

/**
 * Register (or refresh) this device against the signed-in user.
 *
 * SECURITY DEFINER because the insert policy is deliberately absent, but it
 * takes user_id from auth.uid() and never from the caller — the pattern the
 * salary-advance and credential RPCs already use.
 */
create or replace function kg_register_push_device(p_token text, p_platform text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  if p_platform not in ('ios', 'android') then
    raise exception 'unknown platform %', p_platform;
  end if;

  insert into kg_push_devices (user_id, token, platform, last_used_at)
    values (auth.uid(), p_token, p_platform, now())
  on conflict (token) do update
    -- A handset handed down to another parent keeps its token; re-pointing it
    -- at whoever is signed in now is what stops the previous owner receiving
    -- the new one's alerts.
    set user_id = auth.uid(),
        platform = excluded.platform,
        failure_count = 0,
        last_used_at = now();
end $$;

-- Revoked from PUBLIC, not just from anon/authenticated: Postgres grants
-- EXECUTE to PUBLIC by default, and revoking from a role leaves that default
-- in place. This is the mistake 0006 made across the board — see the audit.
revoke execute on function kg_register_push_device(text, text) from public;
grant execute on function kg_register_push_device(text, text) to authenticated;
