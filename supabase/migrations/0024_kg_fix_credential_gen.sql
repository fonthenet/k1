-- Hotfix applied to the live database on 2026-08-27.
--
-- kg_issue_guardian_credentials called gen_random_bytes() unqualified while
-- pinning `search_path = public`. pgcrypto lives in the `extensions` schema on
-- Supabase, so the call resolved to nothing and the FIRST attempt to issue a
-- badge failed with "function gen_random_bytes(integer) does not exist".
--
-- The correction is already folded into 0020 so a fresh deployment is correct
-- from the start. This file exists so the repo's migration history matches what
-- was actually applied to the running project; re-running it is a harmless
-- no-op because the body is identical to the corrected 0020.
create or replace function kg_issue_guardian_credentials(p_guardian uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_g kg_guardians; v_pin text; v_tag text; v_try int := 0;
begin
  select * into v_g from kg_guardians where id = p_guardian;
  if v_g.id is null then raise exception 'not_found'; end if;
  if not kg_is_admin(v_g.tenant_id) then raise exception 'forbidden'; end if;

  loop
    v_try := v_try + 1;
    if v_try > 50 then raise exception 'pin_space_exhausted'; end if;
    v_pin := lpad((floor(random() * 10000))::int::text, 4, '0');
    exit when not exists (
      select 1 from kg_guardians
       where tenant_id = v_g.tenant_id and pin_code = v_pin and id <> p_guardian
    );
  end loop;

  v_tag := 'G-' || upper(encode(extensions.gen_random_bytes(5), 'hex'));

  update kg_guardians set pin_code = v_pin, tag_code = v_tag where id = p_guardian;

  insert into kg_audit_log (tenant_id, user_id, action, entity, entity_id, data)
  values (v_g.tenant_id, auth.uid(), 'issue_credentials', 'guardian', p_guardian::text,
          jsonb_build_object('tag', v_tag));

  return jsonb_build_object('pin_code', v_pin, 'tag_code', v_tag,
    'guardian_name', trim(coalesce(v_g.first_name,'') || ' ' || coalesce(v_g.last_name,'')));
end $$;
