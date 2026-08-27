-- 0042 — A credential is only live while its owner is.
--
-- Two gaps found reviewing 0040/0041:
--
-- 1. kg_resolve_credential checked that the CARD was active, never that its
--    OWNER still was. A staff member set to 'disabled' or a child withdrawn
--    mid-year kept resolving. No access was actually granted — the staff clock
--    re-checks the membership (0041) and the kiosk only queries enrolled
--    children — but the door said "found", stamped last_used_at, and told the
--    holder their badge was recognised. A revoked person's card should read as
--    unknown, because that is what it now is.
--
-- 2. kg_issue_credential trusted p_subject_id. kg_credentials.subject_id is
--    deliberately not a foreign key (it points at one of three tables), so
--    nothing stopped an admin from issuing a card against an id belonging to
--    another crèche, or to nothing at all. The door fails safe on those — every
--    follow-up query is tenant-filtered — but the value is consumed in this
--    tenant's namespace and the row is unauditable. Validate it up front.

-- Is this subject someone the door should still open for?
create or replace function kg_credential_subject_live(
  p_tenant uuid, p_subject kg_credential_subject, p_subject_id uuid
) returns boolean language sql stable security definer set search_path = public as $$
  select case p_subject
    when 'child' then exists (
      select 1 from kg_children
       where id = p_subject_id and tenant_id = p_tenant and status = 'enrolled')
    when 'guardian' then exists (
      select 1 from kg_guardians
       where id = p_subject_id and tenant_id = p_tenant)
    when 'staff' then exists (
      select 1 from kg_memberships
       where id = p_subject_id and tenant_id = p_tenant and status = 'active'
         and role in ('owner','admin','educator','staff','accountant'))
    else false
  end
$$;
grant execute on function kg_credential_subject_live(uuid, kg_credential_subject, uuid) to authenticated;

create or replace function kg_resolve_credential(p_tenant uuid, p_value text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_c kg_credentials; v_value text := kg_normalize_credential(p_value);
begin
  if not kg_is_educator(p_tenant) then raise exception 'forbidden'; end if;
  if v_value is null then return jsonb_build_object('found', false); end if;

  select * into v_c from kg_credentials
   where tenant_id = p_tenant and value = v_value and active;
  if v_c.id is null then return jsonb_build_object('found', false); end if;

  -- The card is live; is the person? A disabled account or a withdrawn child
  -- reads as unknown at the door, and nothing is stamped: last_used_at is for
  -- tracing keys that actually worked.
  if not kg_credential_subject_live(p_tenant, v_c.subject_type, v_c.subject_id) then
    return jsonb_build_object('found', false);
  end if;

  update kg_credentials set last_used_at = now() where id = v_c.id;

  return jsonb_build_object(
    'found', true, 'subject_type', v_c.subject_type,
    'subject_id', v_c.subject_id, 'kind', v_c.kind,
    'credential_id', v_c.id, 'label', v_c.label
  );
end $$;
grant execute on function kg_resolve_credential(uuid, text) to authenticated;

create or replace function kg_issue_credential(
  p_tenant uuid, p_subject kg_credential_subject, p_subject_id uuid,
  p_kind kg_credential_kind, p_value text, p_label text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_value text := kg_normalize_credential(p_value); v_id uuid; v_owner kg_credentials;
begin
  if not kg_is_admin(p_tenant) then raise exception 'forbidden'; end if;
  if v_value is null then raise exception 'empty_value'; end if;
  if length(v_value) > 64 then raise exception 'value_too_long'; end if;

  -- subject_id is not a foreign key, so this is the only thing standing
  -- between a typo (or another crèche's id) and an unauditable door key.
  if not kg_credential_subject_live(p_tenant, p_subject, p_subject_id) then
    raise exception 'unknown_subject';
  end if;

  select * into v_owner from kg_credentials
   where tenant_id = p_tenant and value = v_value and active;
  if v_owner.id is not null then
    if v_owner.subject_type = p_subject and v_owner.subject_id = p_subject_id then
      raise exception 'already_issued_to_this_person';
    end if;
    raise exception 'value_in_use';
  end if;

  insert into kg_credentials (tenant_id, subject_type, subject_id, kind, value, label, issued_by)
  values (p_tenant, p_subject, p_subject_id, p_kind, v_value, nullif(trim(p_label), ''), auth.uid())
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'value', v_value);
end $$;
grant execute on function kg_issue_credential(uuid, kg_credential_subject, uuid, kg_credential_kind, text, text) to authenticated;
