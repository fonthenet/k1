-- 0165 — the reader and the badges it reads, as a setting.
--
-- The badges page tells a director what her USB reader picked up and whose
-- card it is, but nothing in the database knew what the establishment had
-- bought. The same 125 kHz EM4100 fob reads as ten decimal digits on one
-- reader and eight hexadecimal ones on another; an NFC card reads as a
-- fourteen-character UID; a reader configured for the wrong output enrols
-- numbers the kiosk's reader will never type again, and the director only
-- finds out at the door. kg_tenants.settings->'badges' now records the kind
-- of tag the establishment uses, the length a card number is expected to
-- have, and when the reader test last read a card. The reader test warns in
-- gold when a read does not match the length; the settings card and the
-- printable setup guide read the same key.
--
-- Same shape as 0152's daily_journal: a shape CHECK on kg_tenants.settings
-- and one SECURITY DEFINER writer that appends with `||`, so the app never
-- read-modify-writes the row. The writer merges INSIDE the key as well — the
-- reader test stamps reader_tested_at without knowing the tag type, the
-- settings card writes the tag type without knowing when the reader was last
-- tested — so neither ever clobbers the other's field.
begin;
set local lock_timeout = '5s';

-- ── 1. The shape ──────────────────────────────────────────────────────────
-- Every key optional (the merge writes them one at a time), unknown keys
-- refused, JSON null allowed where "not set" is a valid answer. The tag type
-- is never null: "any" is the way to say the establishment has not chosen.
-- reader_tested_at is matched as ISO-8601 text rather than cast: a cast to
-- timestamptz is only STABLE, and a CHECK wants an IMMUTABLE function. The
-- writer receives it from the server action's clock (toISOString: "…Z") or
-- from to_jsonb(now()) ("…+00:00"); both forms pass.
create or replace function public.kg_valid_badge_settings(v jsonb) returns boolean
language sql immutable set search_path = public as $$
  select v -> 'badges' is null
      or (jsonb_typeof(v -> 'badges') = 'object'
          and coalesce((select bool_and(k in ('tag_type', 'code_length', 'reader_tested_at'))
                          from jsonb_object_keys(v -> 'badges') k), true)
          and (v -> 'badges' -> 'tag_type' is null
               or (jsonb_typeof(v -> 'badges' -> 'tag_type') = 'string'
                   and v -> 'badges' ->> 'tag_type' in ('em125', 'nfc', 'any')))
          and (v -> 'badges' -> 'code_length' is null
               or jsonb_typeof(v -> 'badges' -> 'code_length') = 'null'
               or (jsonb_typeof(v -> 'badges' -> 'code_length') = 'number'
                   and (v -> 'badges' ->> 'code_length') ~ '^[0-9]+$'
                   and (v -> 'badges' ->> 'code_length')::int between 4 and 32))
          and (v -> 'badges' -> 'reader_tested_at' is null
               or jsonb_typeof(v -> 'badges' -> 'reader_tested_at') = 'null'
               or (jsonb_typeof(v -> 'badges' -> 'reader_tested_at') = 'string'
                   and (v -> 'badges' ->> 'reader_tested_at')
                       ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?(Z|[+-][0-9]{2}:?[0-9]{2})$')));
$$;
alter table public.kg_tenants drop constraint if exists kg_tenants_badges_shape;
alter table public.kg_tenants add constraint kg_tenants_badges_shape
  check (public.kg_valid_badge_settings(settings));

-- ── 2. The only writer of the key ─────────────────────────────────────────
-- p_badges carries only the fields the caller means to change; the rest of
-- the key and the rest of settings survive the `||`. A shape the CHECK
-- refuses comes back as 23514 (the action's 'invalid'); a non-admin as 42501.
create or replace function public.kg_set_badge_settings(p_tenant uuid, p_badges jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_out jsonb;
begin
  if p_tenant is null or not kg_is_admin(p_tenant) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_badges is null or jsonb_typeof(p_badges) <> 'object' then
    raise exception 'invalid' using errcode = '22023';
  end if;
  update public.kg_tenants
     set settings = coalesce(settings, '{}'::jsonb)
                    || jsonb_build_object('badges', coalesce(settings -> 'badges', '{}'::jsonb) || p_badges)
   where id = p_tenant
   returning settings -> 'badges' into v_out;
  return v_out;
end $$;
revoke all on function public.kg_set_badge_settings(uuid, jsonb) from public, anon;
grant execute on function public.kg_set_badge_settings(uuid, jsonb) to authenticated;

comment on function public.kg_set_badge_settings(uuid, jsonb) is
  'Merges p_badges into kg_tenants.settings->''badges'' (tag_type, code_length, reader_tested_at). Admin-only; the shape is enforced by kg_tenants_badges_shape.';

-- ── 2b. A parent's PIN on its own ─────────────────────────────────────────
-- kg_issue_guardian_credentials (0024) draws the PIN and a NEW printed tag in
-- one stroke — right at enrolment, wrong from the badges register, where the
-- director wants to hand a PIN to a parent whose printed badge is already in
-- their wallet. These two touch pin_code only; the 0040 mirror trigger turns
-- it into the credential the kiosk resolves. Same admin gate, same audit
-- trail without the value.
create or replace function public.kg_issue_guardian_pin(p_guardian uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_g kg_guardians; v_pin text; v_try int := 0;
begin
  select * into v_g from kg_guardians where id = p_guardian;
  if v_g.id is null then raise exception 'not_found' using errcode = '22023'; end if;
  if not kg_is_admin(v_g.tenant_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  loop
    v_try := v_try + 1;
    if v_try > 50 then raise exception 'pin_space_exhausted'; end if;
    v_pin := lpad((floor(random() * 10000))::int::text, 4, '0');
    exit when not exists (
      select 1 from kg_guardians
       where tenant_id = v_g.tenant_id and pin_code = v_pin and id <> p_guardian)
      and not exists (
      select 1 from kg_credentials
       where tenant_id = v_g.tenant_id and value = v_pin and active
         and not (subject_type = 'guardian' and subject_id = p_guardian));
  end loop;
  update kg_guardians set pin_code = v_pin where id = p_guardian;
  insert into kg_audit_log (tenant_id, user_id, action, entity, entity_id, data)
  values (v_g.tenant_id, auth.uid(), 'issue_pin', 'guardian', p_guardian::text, '{}'::jsonb);
  return jsonb_build_object('pin_code', v_pin, 'tag_code', v_g.tag_code,
    'guardian_name', trim(coalesce(v_g.first_name,'') || ' ' || coalesce(v_g.last_name,'')));
end $$;
revoke all on function public.kg_issue_guardian_pin(uuid) from public, anon;
grant execute on function public.kg_issue_guardian_pin(uuid) to authenticated;

create or replace function public.kg_revoke_guardian_pin(p_guardian uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_g kg_guardians;
begin
  select * into v_g from kg_guardians where id = p_guardian;
  if v_g.id is null then raise exception 'not_found' using errcode = '22023'; end if;
  if not kg_is_admin(v_g.tenant_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  update kg_guardians set pin_code = null where id = p_guardian;
  insert into kg_audit_log (tenant_id, user_id, action, entity, entity_id, data)
  values (v_g.tenant_id, auth.uid(), 'revoke_pin', 'guardian', p_guardian::text, '{}'::jsonb);
end $$;
revoke all on function public.kg_revoke_guardian_pin(uuid) from public, anon;
grant execute on function public.kg_revoke_guardian_pin(uuid) to authenticated;

-- ── 3. Rehearsal, always rolled back ─────────────────────────────────────
-- Demo tenant only. The writes live in an inner block that ends by raising
-- P0165; the handler turns it into the pass mark, so the demo tenant's
-- settings are undone as a subtransaction whatever happens to the DDL above
-- (the 0164 shape). Any failing assertion raises something else and aborts
-- the whole migration. As written the handler raises, so the file REHEARSES:
-- run through execute_sql, the DDL and the writes roll back together and
-- the error text "0165 rehearsal ok — rolled back" is the pass mark. That is
-- how it was rehearsed on production (qekibejzwpphzzyqigzo, 2026-09-13:
-- every assertion held, nothing persisted — no function, no constraint, no
-- badges key on the demo tenant afterwards). To apply, flip that one
-- `raise exception` to `raise notice`.
do $$
declare
  t uuid := '732bdf7d-775a-4ed7-875f-8c04ea4e4778';
  u_owner uuid; u_educator uuid;
  before jsonb; after jsonb; v jsonb; bad text; g_id uuid; g_tag text; v_pin text;
begin
  if not exists (select 1 from public.kg_tenants where id = t) then
    raise notice '0165 rehearsal skipped: demo tenant absent'; return;
  end if;
  select user_id into u_owner from public.kg_memberships
   where tenant_id = t and role = 'owner' and status = 'active' and user_id is not null limit 1;
  select user_id into u_educator from public.kg_memberships
   where tenant_id = t and role = 'educator' and status = 'active' and user_id is not null limit 1;
  if u_owner is null or u_educator is null then
    raise exception 'rehearsal: the demo tenant lacks an owner or an educator with an account';
  end if;
  select settings into before from public.kg_tenants where id = t;
  if not public.kg_valid_badge_settings(before) then
    raise exception 'rehearsal: the demo tenant already fails the shape check';
  end if;

  begin
    -- a) The owner sets the tag type and the length; nothing else in
    --    settings moves.
    perform set_config('request.jwt.claims', json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v := public.kg_set_badge_settings(t, '{"tag_type": "em125", "code_length": 10}'::jsonb);
    if v ->> 'tag_type' <> 'em125' or (v ->> 'code_length')::int <> 10 then
      raise exception 'a) the writer returned %', v;
    end if;
    execute 'reset role';
    select settings into after from public.kg_tenants where id = t;
    if (after - 'badges') <> (before - 'badges') then
      raise exception 'a) another key of settings changed: % → %', before - 'badges', after - 'badges';
    end if;

    -- b) The reader test stamps the time; the tag type survives the merge.
    execute 'set local role authenticated';
    v := public.kg_set_badge_settings(t, jsonb_build_object('reader_tested_at', now()));
    if v ->> 'tag_type' <> 'em125' or (v ->> 'code_length')::int <> 10 or v ->> 'reader_tested_at' is null then
      raise exception 'b) the merge lost a field: %', v;
    end if;
    if (v ->> 'reader_tested_at')::timestamptz <> now() then
      raise exception 'b) reader_tested_at does not round-trip: %', v ->> 'reader_tested_at';
    end if;
    -- The server action's own form of the timestamp passes too.
    v := public.kg_set_badge_settings(t, '{"reader_tested_at": "2026-09-13T09:15:00.000Z"}'::jsonb);
    if (v ->> 'reader_tested_at')::timestamptz <> '2026-09-13T09:15:00Z'::timestamptz then
      raise exception 'b) the Z form was not stored: %', v;
    end if;

    -- c) Clearing the length keeps the key, at null.
    v := public.kg_set_badge_settings(t, '{"code_length": null}'::jsonb);
    if jsonb_typeof(v -> 'code_length') <> 'null' or v ->> 'tag_type' <> 'em125' then
      raise exception 'c) clearing the length: %', v;
    end if;

    -- d) Every wrong shape is refused by the CHECK (23514), never stored.
    foreach bad in array array[
      '{"tag_type": "hid"}', '{"tag_type": null}', '{"tag_type": 125}',
      '{"code_length": 3}', '{"code_length": 33}', '{"code_length": "10"}', '{"code_length": 10.5}',
      '{"reader_tested_at": "hier"}', '{"reader_tested_at": true}',
      '{"colour": "red"}'
    ] loop
      begin
        perform public.kg_set_badge_settings(t, bad::jsonb);
        raise exception 'd) % was accepted', bad;
      exception when check_violation then null;
      end;
    end loop;
    select settings -> 'badges' into v from public.kg_tenants where id = t;
    if v ->> 'tag_type' <> 'em125' or jsonb_typeof(v -> 'code_length') <> 'null' or v ? 'colour' then
      raise exception 'd) a refused write left a trace: %', v;
    end if;

    -- e) A scalar or an array is not a settings object.
    foreach bad in array array['"em125"', '[1, 2]', 'null'] loop
      begin
        perform public.kg_set_badge_settings(t, bad::jsonb);
        raise exception 'e) % was accepted', bad;
      exception when invalid_parameter_value then null;
      end;
    end loop;
    execute 'reset role';

    -- f) An educator is refused, and changes nothing.
    perform set_config('request.jwt.claims', json_build_object('sub', u_educator, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    begin
      perform public.kg_set_badge_settings(t, '{"tag_type": "nfc"}'::jsonb);
      raise exception 'f) an educator wrote the setting';
    exception when insufficient_privilege then null;
    end;
    execute 'reset role';
    select settings -> 'badges' ->> 'tag_type' into bad from public.kg_tenants where id = t;
    if bad <> 'em125' then raise exception 'f) the educator''s write landed: %', bad; end if;

    -- g) Nobody signed in: refused as well.
    perform set_config('request.jwt.claims', '', true);
    execute 'set local role authenticated';
    begin
      perform public.kg_set_badge_settings(t, '{"tag_type": "nfc"}'::jsonb);
      raise exception 'g) an anonymous session wrote the setting';
    exception when insufficient_privilege then null;
    end;
    execute 'reset role';

    -- h) A parent's PIN on its own: the printed tag does not move, the PIN
    --    is four digits, the mirror credential follows, revoking clears both.
    select id, tag_code into g_id, g_tag from public.kg_guardians
     where tenant_id = t and tag_code is not null order by created_at limit 1;
    if g_id is null then raise exception 'h) the demo tenant has no guardian with a printed tag'; end if;
    perform set_config('request.jwt.claims', json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v := public.kg_issue_guardian_pin(g_id);
    execute 'reset role';
    if v ->> 'pin_code' !~ '^[0-9]{4}$' then raise exception 'h) pin shape: %', v; end if;
    if v ->> 'tag_code' <> g_tag then raise exception 'h) the return names another tag: %', v; end if;
    select tag_code, pin_code into bad, v_pin from public.kg_guardians where id = g_id;
    if bad <> g_tag then raise exception 'h) issuing a PIN rotated the printed tag % → %', g_tag, bad; end if;
    if v_pin <> v ->> 'pin_code' then raise exception 'h) stored pin differs from the returned one'; end if;
    if not exists (select 1 from public.kg_credentials
                    where tenant_id = t and subject_type = 'guardian' and subject_id = g_id
                      and kind = 'pin' and value = v_pin and active) then
      raise exception 'h) the mirror credential did not follow';
    end if;
    perform set_config('request.jwt.claims', json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    perform public.kg_revoke_guardian_pin(g_id);
    execute 'reset role';
    select tag_code, pin_code into bad, v_pin from public.kg_guardians where id = g_id;
    if v_pin is not null then raise exception 'h) revoke left the pin'; end if;
    if bad <> g_tag then raise exception 'h) revoke touched the printed tag'; end if;
    if exists (select 1 from public.kg_credentials
                where tenant_id = t and subject_type = 'guardian' and subject_id = g_id
                  and kind = 'pin' and active) then
      raise exception 'h) revoke left the mirror credential live';
    end if;
    -- and an educator is refused on both
    perform set_config('request.jwt.claims', json_build_object('sub', u_educator, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    begin
      perform public.kg_issue_guardian_pin(g_id);
      raise exception 'h) an educator issued a PIN';
    exception when insufficient_privilege then null;
    end;
    begin
      perform public.kg_revoke_guardian_pin(g_id);
      raise exception 'h) an educator revoked a PIN';
    exception when insufficient_privilege then null;
    end;
    execute 'reset role';

    raise exception using errcode = 'P0165', message = 'rehearsal done';
  exception when sqlstate 'P0165' then
    raise exception '0165 rehearsal ok — rolled back';
  end;
  execute 'reset role';
end $$;

notify pgrst, 'reload schema';
commit;
