-- Fixes surfaced during module build.
-- 1) Staff reviewing an application could not load the applicant-uploaded child photo:
--    enrollment photos live at u/{userId}/enroll/*.jpg, readable only by the uploader.
--    Allow tenant staff to READ a u/ object that is referenced by an application in their tenant.
-- 2) kg_create_tenant now accepts commune, so onboarding is a single atomic call.

create or replace function kg_storage_access(p_path text, p_write boolean)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare parts text[]; v_tenant uuid; v_child uuid;
begin
  parts := string_to_array(p_path, '/');
  if array_length(parts, 1) < 2 then return false; end if;

  if parts[1] = 'u' then
    -- owner always has full access to their own uploads
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

drop function if exists kg_create_tenant(text, text, text, text);

create or replace function kg_create_tenant(
  p_name text, p_slug text, p_phone text default null,
  p_wilaya text default 'Jijel', p_commune text default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_tenant uuid; v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'auth required'; end if;
  insert into kg_tenants (name, slug, phone, wilaya, commune, default_locale)
    values (p_name, p_slug, p_phone, p_wilaya, p_commune, 'ar') returning id into v_tenant;
  insert into kg_memberships (tenant_id, user_id, role) values (v_tenant, v_uid, 'owner');
  insert into kg_profiles (id, full_name)
    values (v_uid, coalesce((select raw_user_meta_data->>'full_name' from auth.users where id = v_uid), ''))
    on conflict (id) do nothing;
  insert into kg_txn_categories (tenant_id, name, kind, is_system, color) values
    (v_tenant, 'Scolarité', 'income', true, '#22c55e'),
    (v_tenant, 'Frais d''inscription', 'income', true, '#10b981'),
    (v_tenant, 'Activités', 'income', true, '#14b8a6'),
    (v_tenant, 'Autres revenus', 'income', true, '#84cc16'),
    (v_tenant, 'Salaires', 'expense', true, '#ef4444'),
    (v_tenant, 'Loyer', 'expense', true, '#f97316'),
    (v_tenant, 'Alimentation', 'expense', true, '#f59e0b'),
    (v_tenant, 'Fournitures', 'expense', true, '#eab308'),
    (v_tenant, 'Entretien', 'expense', true, '#a855f7'),
    (v_tenant, 'Transport', 'expense', true, '#8b5cf6'),
    (v_tenant, 'Autres dépenses', 'expense', true, '#64748b');
  insert into kg_holidays (tenant_id, date, name, name_ar, tentative) values
    (v_tenant, date '2027-01-01', 'Jour de l''an', 'رأس السنة الميلادية', false),
    (v_tenant, date '2027-01-12', 'Yennayer', 'يناير', false),
    (v_tenant, date '2026-11-01', 'Anniversaire de la Révolution', 'عيد الثورة', false),
    (v_tenant, date '2027-05-01', 'Fête du travail', 'عيد العمال', false),
    (v_tenant, date '2027-07-05', 'Fête de l''indépendance', 'عيد الاستقلال', false);
  return v_tenant;
end $$;

-- Re-apply the hardening revoke to the new signature (0006 revoked the dropped 4-arg one).
revoke execute on function kg_create_tenant(text, text, text, text, text) from anon;
