-- Guardian door credentials: make them unique, and make them issuable.
--
-- kg_guardians.pin_code / tag_code existed since 0002 and the kiosk has always
-- queried them, but nothing ever wrote one — 0 of 11 guardians had a tag and 2
-- had a PIN (both hand-seeded). Worse, neither column was unique while
-- kg_children.tag_code was: two guardians in the SAME kindergarten could hold
-- the same code, and the kiosk's lookup returns every match, so a collision
-- would put another family's children on the pick list.

-- Uniqueness per tenant. Partial, so the many guardians with no credential yet
-- do not all collide on NULL.
create unique index if not exists kg_guardians_pin_unique
  on kg_guardians (tenant_id, pin_code) where pin_code is not null;
create unique index if not exists kg_guardians_tag_unique
  on kg_guardians (tenant_id, tag_code) where tag_code is not null;
create unique index if not exists kg_memberships_pin_unique
  on kg_memberships (tenant_id, pin_code) where pin_code is not null;

-- Issue a credential without ever handing the caller someone else's.
-- Returns the new PIN so it can be shown once and printed onto a badge.
create or replace function kg_issue_guardian_credentials(p_guardian uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_g kg_guardians; v_pin text; v_tag text; v_try int := 0;
begin
  select * into v_g from kg_guardians where id = p_guardian;
  if v_g.id is null then raise exception 'not_found'; end if;
  -- Only the office issues door credentials; a parent must not mint their own.
  if not kg_is_admin(v_g.tenant_id) then raise exception 'forbidden'; end if;

  -- A 4-digit PIN is 10k combinations; retry on the unique index rather than
  -- trusting a single draw, and give up loudly instead of looping forever.
  loop
    v_try := v_try + 1;
    if v_try > 50 then raise exception 'pin_space_exhausted'; end if;
    v_pin := lpad((floor(random() * 10000))::int::text, 4, '0');
    exit when not exists (
      select 1 from kg_guardians
       where tenant_id = v_g.tenant_id and pin_code = v_pin and id <> p_guardian
    );
  end loop;

  -- Tag is long and random: it is printed on a card that can be lost.
  -- pgcrypto lives in the `extensions` schema on Supabase and this function
  -- pins search_path = public, so the call MUST be schema-qualified or it
  -- resolves to nothing and issuing a badge fails outright.
  v_tag := 'G-' || upper(encode(extensions.gen_random_bytes(5), 'hex'));

  update kg_guardians
     set pin_code = v_pin, tag_code = v_tag
   where id = p_guardian;

  insert into kg_audit_log (tenant_id, user_id, action, entity, entity_id, data)
  values (v_g.tenant_id, auth.uid(), 'issue_credentials', 'guardian', p_guardian::text,
          jsonb_build_object('tag', v_tag));

  return jsonb_build_object('pin_code', v_pin, 'tag_code', v_tag,
    'guardian_name', trim(coalesce(v_g.first_name,'') || ' ' || coalesce(v_g.last_name,'')));
end $$;
grant execute on function kg_issue_guardian_credentials(uuid) to authenticated;

create or replace function kg_revoke_guardian_credentials(p_guardian uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_tenant uuid;
begin
  select tenant_id into v_tenant from kg_guardians where id = p_guardian;
  if v_tenant is null then raise exception 'not_found'; end if;
  if not kg_is_admin(v_tenant) then raise exception 'forbidden'; end if;

  update kg_guardians set pin_code = null, tag_code = null where id = p_guardian;
  insert into kg_audit_log (tenant_id, user_id, action, entity, entity_id, data)
  values (v_tenant, auth.uid(), 'revoke_credentials', 'guardian', p_guardian::text, '{}'::jsonb);
end $$;
grant execute on function kg_revoke_guardian_credentials(uuid) to authenticated;
