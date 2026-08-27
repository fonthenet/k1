-- Storage for guardian photos.
--
-- The door check depends on a human comparing the person in front of them with
-- a photo, so the photo must be (a) uploadable by the family and (b) readable
-- by staff. Neither was possible: there was no path convention for guardians,
-- and the `t/` branch only lets educators write, so a parent uploading their
-- own face was refused.
--
-- Convention: t/{tenant_id}/guardians/{guardian_id}/<file>
--   staff            → read + write (the office can photograph a parent at the desk)
--   that guardian    → read + write (a parent maintains their own photo)
--   anyone else      → nothing

create or replace function kg_storage_access(p_path text, p_write boolean)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare parts text[]; v_tenant uuid; v_child uuid; v_guardian uuid;
begin
  parts := string_to_array(p_path, '/');
  if array_length(parts, 1) < 2 then return false; end if;

  if parts[1] = 'u' then
    if parts[2] = auth.uid()::text then return true; end if;
    -- staff may READ (never write) a file attached to an application in their tenant
    if not p_write then
      return exists (
        select 1 from kg_applications a
        where a.child->>'photo_path' = p_path
          and kg_is_staff(a.tenant_id)
      );
    end if;
    return false;
  end if;

  if parts[1] = 't' then
    begin
      v_tenant := parts[2]::uuid;
    exception when others then return false; end;

    -- Guardian photos: the family owns its own face.
    if array_length(parts, 1) >= 4 and parts[3] = 'guardians' then
      begin
        v_guardian := parts[4]::uuid;
      exception when others then return false; end;
      if kg_is_staff(v_tenant) then return true; end if;
      return exists (
        select 1 from kg_guardians g
        where g.id = v_guardian and g.tenant_id = v_tenant and g.user_id = auth.uid()
      );
    end if;

    if p_write then
      return kg_is_educator(v_tenant);
    end if;
    if kg_is_staff(v_tenant) then return true; end if;
    if array_length(parts, 1) >= 4 and parts[3] = 'children' then
      begin
        v_child := parts[4]::uuid;
      exception when others then return false; end;
      return kg_is_parent_of(v_child);
    end if;
    return false;
  end if;
  return false;
end $$;
