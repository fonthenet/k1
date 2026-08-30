-- The dispatcher's half of native push.
--
-- Mirrors 0013 exactly: secret-gated, SECURITY DEFINER, no service-role key, so
-- this path can still only ever do one thing — deliver pending pushes. The web
-- and native queues stay separate functions rather than one with a union,
-- because their rows carry different columns and a caller that has to branch on
-- shape is a caller that will eventually forget to.

create or replace function kg_pending_native_push(p_secret text, p_limit int default 200)
returns table (
  notification_id uuid, user_id uuid, locale text, type text,
  title text, body text, data jsonb, created_at timestamptz,
  token text, platform text
) language plpgsql stable security definer set search_path = public as $$
begin
  if not kg_push_secret_ok(p_secret) then raise exception 'forbidden'; end if;
  return query
    select n.id, n.user_id, coalesce(pr.locale, 'ar'), n.type,
           n.title, n.body, n.data, n.created_at,
           d.token, d.platform
      from kg_notifications n
      join kg_push_devices d on d.user_id = n.user_id
      left join kg_profiles pr on pr.id = n.user_id
     where n.pushed_at is null
       -- A notification older than a day is stale news; don't wake a phone for it.
       and n.created_at > now() - interval '1 day'
     order by n.created_at
     limit p_limit;
end $$;

/**
 * Forget a device the push service says is gone.
 *
 * Expo answers DeviceNotRegistered when an app is uninstalled or the token is
 * rotated. Without this the row stays and every future notification spends a
 * delivery attempt on a handset that will never answer.
 */
create or replace function kg_drop_push_device(p_secret text, p_token text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not kg_push_secret_ok(p_secret) then raise exception 'forbidden'; end if;
  delete from kg_push_devices where token = p_token;
end $$;

-- Reachable by anon ON PURPOSE — see 0076. The secret is the access control.
grant execute on function kg_pending_native_push(text, int) to anon, authenticated;
grant execute on function kg_drop_push_device(text, text) to anon, authenticated;
