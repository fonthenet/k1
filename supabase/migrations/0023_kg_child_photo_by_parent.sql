-- Let a family set their own child's photo — and only the photo.
--
-- ch_upd on kg_children is educator-only, deliberately: name and date of birth
-- come from the birth certificate and feed the décret 19-253 registers. But a
-- photo is not a legal identity field, it is the face staff compare at the
-- door, and the family has the better picture. Widening ch_upd would hand them
-- every column, so expose exactly one write instead.

-- 1. Storage: a parent may write inside their own child's folder.
create or replace function kg_storage_access(p_path text, p_write boolean)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare parts text[]; v_tenant uuid; v_child uuid; v_guardian uuid;
begin
  parts := string_to_array(p_path, '/');
  if array_length(parts, 1) < 2 then return false; end if;

  if parts[1] = 'u' then
    if parts[2] = auth.uid()::text then return true; end if;
    if not p_write then
      return exists (
        select 1 from kg_applications a
        where a.child->>'photo_path' = p_path and kg_is_staff(a.tenant_id)
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

    -- Child media: staff read+write; the child's own family read AND write
    -- (checked before the blanket educator-only write rule below).
    if array_length(parts, 1) >= 4 and parts[3] = 'children' then
      begin
        v_child := parts[4]::uuid;
      exception when others then return false; end;
      if kg_is_staff(v_tenant) then return true; end if;
      return kg_is_parent_of(v_child);
    end if;

    if p_write then return kg_is_educator(v_tenant); end if;
    return kg_is_staff(v_tenant);
  end if;
  return false;
end $$;

-- 2. The single permitted write into kg_children.
create or replace function kg_set_child_photo(p_child uuid, p_path text)
returns void language plpgsql security definer set search_path = public as $$
declare v_child kg_children;
begin
  select * into v_child from kg_children where id = p_child;
  if v_child.id is null then raise exception 'not_found'; end if;

  if not (kg_is_educator(v_child.tenant_id) or kg_is_parent_of(p_child)) then
    raise exception 'forbidden';
  end if;

  -- The path must live in this child's own folder; a caller must not be able to
  -- point a child's record at some other family's file.
  if p_path is not null
     and p_path not like ('t/' || v_child.tenant_id::text || '/children/' || p_child::text || '/%') then
    raise exception 'invalid_path';
  end if;

  update kg_children set photo_path = p_path where id = p_child;

  -- Consistent with 0016: a parent's change reaches the office, never silently.
  perform kg_notify_parent_edit(v_child.tenant_id, p_child, 'photo',
    case when p_path is null then 'photo removed' else 'photo updated' end);
end $$;
grant execute on function kg_set_child_photo(uuid, text) to authenticated;
