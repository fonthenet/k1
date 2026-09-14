-- 0167 — the kiosk's floating scan button, an establishment's choice.
--
-- The door tablet locks itself to the kiosk; a staff phone and the office
-- PC do not. When the establishment wants every screen of the team's phones
-- and of the dashboard to carry a small floating button that opens the
-- kiosk's scan in a quick mode (camera first, a plain Close, no exit
-- secret), that is one more switch in kg_tenants.settings->'kiosk':
-- `floating_scan`, a boolean, absent by default so nothing appears until
-- somebody turns it on. Both clients read the key the way they read the
-- other kiosk settings (kiosk-settings.ts on the web, lib/kiosk.ts on the
-- phone); a missing key is false.
--
-- Only the shape changes: 0166's kg_valid_kiosk_settings learns the key.
-- The constraint kg_tenants_kiosk_shape keeps pointing at the replaced
-- function, and the writer kg_set_kiosk_settings merges whatever keys it is
-- given, so it needs nothing. Its comment is refreshed so the catalogue
-- lists the five keys.
--
-- Rehearsed on production (qekibejzwpphzzyqigzo) on 2026-09-13 through
-- execute_sql: every assertion of §2 held, the run ended on the pass mark
-- "0167 rehearsal ok — rolled back", and afterwards the function still had
-- 0166's body and the demo tenant still had no kiosk key. Not applied.
begin;
set local lock_timeout = '5s';

-- ── 1. The shape, with the new key ────────────────────────────────────────
-- 0166 §1 plus `floating_scan`: every key optional (the merge writes them
-- one at a time), unknown keys refused, no JSON null — a switch is on or
-- off, and a missing key means the default, which for this one is off.
create or replace function public.kg_valid_kiosk_settings(v jsonb) returns boolean
language sql immutable set search_path = public as $$
  select v -> 'kiosk' is null
      or (jsonb_typeof(v -> 'kiosk') = 'object'
          and coalesce((select bool_and(k in ('auto_confirm', 'auto_confirm_seconds', 'door_mode', 'sound', 'floating_scan'))
                          from jsonb_object_keys(v -> 'kiosk') k), true)
          and (v -> 'kiosk' -> 'auto_confirm' is null
               or jsonb_typeof(v -> 'kiosk' -> 'auto_confirm') = 'boolean')
          and (v -> 'kiosk' -> 'door_mode' is null
               or jsonb_typeof(v -> 'kiosk' -> 'door_mode') = 'boolean')
          and (v -> 'kiosk' -> 'sound' is null
               or jsonb_typeof(v -> 'kiosk' -> 'sound') = 'boolean')
          and (v -> 'kiosk' -> 'floating_scan' is null
               or jsonb_typeof(v -> 'kiosk' -> 'floating_scan') = 'boolean')
          and (v -> 'kiosk' -> 'auto_confirm_seconds' is null
               or (jsonb_typeof(v -> 'kiosk' -> 'auto_confirm_seconds') = 'number'
                   and (v -> 'kiosk' ->> 'auto_confirm_seconds') ~ '^[0-9]+$'
                   and (v -> 'kiosk' ->> 'auto_confirm_seconds')::int between 2 and 10)));
$$;

comment on function public.kg_set_kiosk_settings(uuid, jsonb) is
  'Merges p_kiosk into kg_tenants.settings->''kiosk'' (auto_confirm, auto_confirm_seconds, door_mode, sound, floating_scan). Admin-only; the shape is enforced by kg_tenants_kiosk_shape.';

-- ── 2. Rehearsal, always rolled back ─────────────────────────────────────
-- Demo tenant only. The writes live in an inner block that ends by raising
-- P0167; the handler turns it into the pass mark, so the demo tenant's
-- settings are undone as a subtransaction whatever happens to the DDL above
-- (the 0166 shape). Any failing assertion raises something else and aborts
-- the whole migration. As written the handler raises, so the file
-- REHEARSES: run through execute_sql, the DDL and the writes roll back
-- together and the error text "0167 rehearsal ok — rolled back" is the pass
-- mark. That is how it was rehearsed on production (qekibejzwpphzzyqigzo,
-- 2026-09-13: every assertion held, nothing persisted). To apply, flip that
-- one `raise exception` to `raise notice`.
do $$
declare
  t uuid := '732bdf7d-775a-4ed7-875f-8c04ea4e4778';
  u_owner uuid; u_educator uuid;
  before jsonb; after jsonb; v jsonb; bad text;
begin
  if not exists (select 1 from public.kg_tenants where id = t) then
    raise notice '0167 rehearsal skipped: demo tenant absent'; return;
  end if;
  select user_id into u_owner from public.kg_memberships
   where tenant_id = t and role = 'owner' and status = 'active' and user_id is not null limit 1;
  select user_id into u_educator from public.kg_memberships
   where tenant_id = t and role = 'educator' and status = 'active' and user_id is not null limit 1;
  if u_owner is null or u_educator is null then
    raise exception 'rehearsal: the demo tenant lacks an owner or an educator';
  end if;
  select settings into before from public.kg_tenants where id = t;
  if not public.kg_valid_kiosk_settings(before) then
    raise exception 'rehearsal: the demo tenant already fails the shape check';
  end if;
  -- A tenant born before 0167 — no floating_scan key, or no kiosk key at
  -- all — passes the new shape unchanged: the default is the absence.
  if not public.kg_valid_kiosk_settings('{}'::jsonb)
     or not public.kg_valid_kiosk_settings('{"kiosk": {"door_mode": true, "sound": false}}'::jsonb) then
    raise exception 'rehearsal: a settings document without the key fails the shape';
  end if;

  begin
    -- a) The owner turns the sound off first, so the merge has something to
    --    keep, then the floating button on; the sound survives and nothing
    --    else in settings moves.
    perform set_config('request.jwt.claims', json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v := public.kg_set_kiosk_settings(t, '{"sound": false}'::jsonb);
    v := public.kg_set_kiosk_settings(t, '{"floating_scan": true}'::jsonb);
    if (v ->> 'floating_scan')::boolean is distinct from true or (v ->> 'sound')::boolean is distinct from false then
      raise exception 'a) the writer returned %', v;
    end if;
    execute 'reset role';
    select settings into after from public.kg_tenants where id = t;
    if (after - 'kiosk') <> (before - 'kiosk') then
      raise exception 'a) another key of settings changed: % → %', before - 'kiosk', after - 'kiosk';
    end if;

    -- b) And off again: the value flips, the sound is still there.
    execute 'set local role authenticated';
    v := public.kg_set_kiosk_settings(t, '{"floating_scan": false}'::jsonb);
    if (v ->> 'floating_scan')::boolean is distinct from false or (v ->> 'sound')::boolean is distinct from false then
      raise exception 'b) the merge lost a field: %', v;
    end if;

    -- c) Every wrong shape is refused by the CHECK (23514), never stored: a
    --    string, a number, a JSON null, and a key the kiosk does not know.
    foreach bad in array array[
      '{"floating_scan": "yes"}', '{"floating_scan": 1}', '{"floating_scan": null}',
      '{"floating": true}', '{"floating_scan": true, "colour": "red"}'
    ] loop
      begin
        perform public.kg_set_kiosk_settings(t, bad::jsonb);
        raise exception 'c) % was accepted', bad;
      exception when check_violation then null;
      end;
    end loop;
    execute 'reset role';
    select settings -> 'kiosk' into v from public.kg_tenants where id = t;
    if (v ->> 'floating_scan')::boolean is distinct from false or (v ->> 'sound')::boolean is distinct from false
       or v ? 'floating' or v ? 'colour' then
      raise exception 'c) a refused write left a trace: %', v;
    end if;

    -- d) An educator is refused, and changes nothing.
    perform set_config('request.jwt.claims', json_build_object('sub', u_educator, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    begin
      perform public.kg_set_kiosk_settings(t, '{"floating_scan": true}'::jsonb);
      raise exception 'd) an educator wrote the setting';
    exception when insufficient_privilege then null;
    end;
    execute 'reset role';
    select settings -> 'kiosk' ->> 'floating_scan' into bad from public.kg_tenants where id = t;
    if bad is distinct from 'false' then raise exception 'd) the educator''s write landed: %', bad; end if;

    -- e) Nobody signed in: refused as well.
    perform set_config('request.jwt.claims', '', true);
    execute 'set local role authenticated';
    begin
      perform public.kg_set_kiosk_settings(t, '{"floating_scan": true}'::jsonb);
      raise exception 'e) an anonymous session wrote the setting';
    exception when insufficient_privilege then null;
    end;
    execute 'reset role';

    raise exception using errcode = 'P0167', message = 'rehearsal done';
  exception when sqlstate 'P0167' then
    raise exception '0167 rehearsal ok — rolled back';
  end;
  execute 'reset role';
end $$;

notify pgrst, 'reload schema';
commit;
