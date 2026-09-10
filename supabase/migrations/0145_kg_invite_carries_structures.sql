-- 0145 — the moment a person is hired is the moment they are placed.
--
-- The "Add a team member" dialog now asks which structure(s) the person
-- works in. A member created directly gets kg_membership_structures rows at
-- once (the app writes them). An INVITED member does not exist until they
-- accept the link, so the choice rides on the invite and is applied on
-- acceptance — one column, applied in the one function that turns an invite
-- into a membership.

alter table kg_staff_invites add column if not exists structure_ids uuid[];

create or replace function kg_accept_staff_invite(p_token text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v kg_staff_invites; v_uid uuid := auth.uid(); v_email text;
  v_existing kg_memberships; v_member kg_memberships;
  v_rank_invite int; v_rank_existing int; v_locale text; v_membership uuid;
begin
  if v_uid is null then raise exception 'auth required'; end if;
  select * into v from kg_staff_invites where token = btrim(coalesce(p_token, ''));
  if v.id is null or v.accepted_at is not null or v.expires_at <= now() then
    raise exception 'invalid_invite';
  end if;

  select default_locale into v_locale from kg_tenants where id = v.tenant_id;

  if v.email is not null then
    select lower(u.email) into v_email from auth.users u where u.id = v_uid;
    if v_email is distinct from lower(btrim(v.email)) then
      raise exception 'invite_email_mismatch';
    end if;
  end if;

  select * into v_existing from kg_memberships
   where tenant_id = v.tenant_id and user_id = v_uid;

  if v.membership_id is not null then
    if v_existing.id is not null then raise exception 'account_already_member'; end if;
    select * into v_member from kg_memberships where id = v.membership_id;
    if v_member.id is null or v_member.tenant_id <> v.tenant_id or v_member.user_id is not null then
      raise exception 'invite_member_taken';
    end if;
    update kg_memberships set user_id = v_uid, status = 'active', updated_at = now()
     where id = v_member.id;
    v_membership := v_member.id;
    perform kg_bootstrap_profile(v_uid, v_locale);
    update kg_profiles set full_name = v_member.full_name
     where id = v_uid and nullif(btrim(full_name), '') is null
       and nullif(btrim(v_member.full_name), '') is not null;

  elsif v_existing.id is null then
    insert into kg_memberships (tenant_id, user_id, role, job_title, status)
      values (v.tenant_id, v_uid, v.role, v.job_title, 'active')
      returning id into v_membership;
    perform kg_bootstrap_profile(v_uid, v_locale);

  else
    v_rank_invite := case v.role
      when 'owner' then 50 when 'admin' then 40 when 'accountant' then 30
      when 'educator' then 20 when 'staff' then 10 else 0 end;
    v_rank_existing := case v_existing.role
      when 'owner' then 50 when 'admin' then 40 when 'accountant' then 30
      when 'educator' then 20 when 'staff' then 10 else 0 end;
    update kg_memberships
       set status = 'active',
           role = case when v_rank_invite > v_rank_existing then v.role else role end,
           job_title = coalesce(job_title, v.job_title), updated_at = now()
     where id = v_existing.id;
    v_membership := v_existing.id;
    perform kg_bootstrap_profile(v_uid, v_locale);
  end if;

  -- The structures chosen at invitation, applied now that there is someone
  -- to apply them to. Only this establishment's active structures count; the
  -- table's own trigger refuses anything else anyway.
  if v.structure_ids is not null and v_membership is not null then
    insert into kg_membership_structures (membership_id, structure_id)
    select v_membership, s.id
      from kg_structures s
     where s.tenant_id = v.tenant_id and s.active and s.id = any (v.structure_ids)
    on conflict do nothing;
  end if;

  update kg_staff_invites set accepted_at = now() where id = v.id;
  return v.tenant_id;
end $$;
