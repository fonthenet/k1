-- Push dispatch access.
--
-- The dispatcher must read notifications and subscriptions belonging to OTHER
-- users, which RLS forbids. The usual answer is to hand the app a service-role
-- key, but that key can do anything in the database and would sit in the same
-- process as user-facing code. Instead we expose three narrow security-definer
-- functions gated on a shared secret held only in server env. Their blast
-- radius is exactly "send pending pushes" — nothing more.

create table if not exists kg_push_config (
  id boolean primary key default true check (id),
  secret text not null,
  updated_at timestamptz not null default now()
);
-- RLS on with NO policy: unreachable via anon/authenticated. Only the
-- security-definer functions below (which bypass RLS) can read it.
alter table kg_push_config enable row level security;

create or replace function kg_push_secret_ok(p_secret text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from kg_push_config where secret = p_secret)
$$;
revoke execute on function kg_push_secret_ok(text) from anon, authenticated;

-- Pending notifications joined to every device the recipient has registered.
create or replace function kg_pending_push(p_secret text, p_limit int default 200)
returns table (
  notification_id uuid, user_id uuid, locale text, type text,
  title text, body text, data jsonb, created_at timestamptz,
  endpoint text, p256dh text, auth text
) language plpgsql stable security definer set search_path = public as $$
begin
  if not kg_push_secret_ok(p_secret) then raise exception 'forbidden'; end if;
  return query
    select n.id, n.user_id, coalesce(pr.locale, 'ar'), n.type,
           n.title, n.body, n.data, n.created_at,
           s.endpoint, s.p256dh, s.auth
      from kg_notifications n
      join kg_push_subscriptions s on s.user_id = n.user_id
      left join kg_profiles pr on pr.id = n.user_id
     where n.pushed_at is null
       -- A notification older than a day is stale news; don't wake a phone for it.
       and n.created_at > now() - interval '1 day'
     order by n.created_at
     limit p_limit;
end $$;
revoke execute on function kg_pending_push(text, int) from anon, authenticated;

create or replace function kg_mark_pushed(p_secret text, p_ids uuid[])
returns int language plpgsql security definer set search_path = public as $$
declare v int;
begin
  if not kg_push_secret_ok(p_secret) then raise exception 'forbidden'; end if;
  update kg_notifications set pushed_at = now()
   where id = any(p_ids) and pushed_at is null;
  get diagnostics v = row_count;
  return v;
end $$;
revoke execute on function kg_mark_pushed(text, uuid[]) from anon, authenticated;

-- A push endpoint that returns 404/410 is permanently gone (browser data
-- cleared, app uninstalled). Drop it so we stop paying to retry it forever.
create or replace function kg_drop_push_subscription(p_secret text, p_endpoint text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not kg_push_secret_ok(p_secret) then raise exception 'forbidden'; end if;
  delete from kg_push_subscriptions where endpoint = p_endpoint;
end $$;
revoke execute on function kg_drop_push_subscription(text, text) from anon, authenticated;

-- Mark everything that exists today as already pushed, so switching this on
-- does not blast every historical row at every device at once.
update kg_notifications set pushed_at = now() where pushed_at is null;
