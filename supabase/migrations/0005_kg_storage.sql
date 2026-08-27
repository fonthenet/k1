-- Private media bucket. Path conventions:
--   u/{user_id}/...                       user-owned uploads (enrollment wizard)
--   t/{tenant_id}/children/{child_id}/... child media (staff write, that child's parents read)
--   t/{tenant_id}/...                     other tenant assets (staff)

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('kg-media', 'kg-media', false, 10485760,
  array['image/jpeg','image/png','image/webp','image/heic','application/pdf'])
on conflict (id) do nothing;

create or replace function kg_storage_access(p_path text, p_write boolean)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare parts text[]; v_tenant uuid; v_child uuid;
begin
  parts := string_to_array(p_path, '/');
  if array_length(parts, 1) < 2 then return false; end if;

  if parts[1] = 'u' then
    return parts[2] = auth.uid()::text;
  end if;

  if parts[1] = 't' then
    begin
      v_tenant := parts[2]::uuid;
    exception when others then return false; end;
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

create policy kg_media_select on storage.objects for select
  using (bucket_id = 'kg-media' and kg_storage_access(name, false));
create policy kg_media_insert on storage.objects for insert
  with check (bucket_id = 'kg-media' and kg_storage_access(name, true));
create policy kg_media_update on storage.objects for update
  using (bucket_id = 'kg-media' and kg_storage_access(name, true));
create policy kg_media_delete on storage.objects for delete
  using (bucket_id = 'kg-media' and kg_storage_access(name, true));
