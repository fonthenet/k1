-- 0053 — Connecting a parent's new account to the record the crèche already holds.
--
-- kg_guardians.user_id was written in exactly two places, both inside the
-- enrolment-approval RPCs (0004, 0017). Every other route left it null: a crèche
-- that types a family in by hand ends up with guardian records nobody can sign
-- into. On this database that is 9 of 12 guardians — and all 9 have a phone on
-- file and none have an email, so there was never even a key to match them on.
--
-- The consequence was worse than "no portal": such a parent signing up got no
-- membership, so /onboarding showed them the CREATE-A-KINDERGARTEN wizard.
--
-- WHY NOT JUST MATCH THE PHONE NUMBER. Because a phone number is not a secret.
-- Anyone who signed up quoting a number that happened to be on file would be
-- handed that family's allergies, medications, incidents and invoices. Matching
-- on a known-but-not-secret identifier is not authentication. Once SMS
-- verification is switched on, a *verified* number becomes proof and this can be
-- revisited; today it is not.
--
-- So: the crèche issues a single-use code for one guardian record, hands it over
-- the way it already hands over kiosk PINs and badges, and the parent redeems it
-- once. Setting user_id then fires kg_ensure_parent_membership (0008), which
-- creates the membership and the profile — so this migration adds a door, not a
-- second copy of the linking logic.

create table if not exists kg_guardian_claims (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references kg_tenants(id) on delete cascade,
  guardian_id  uuid not null references kg_guardians(id) on delete cascade,
  -- 8 chars from an unambiguous alphabet ≈ 1.1e12 combinations: not brute
  -- forceable over a network, and still short enough to read down a phone line.
  code         text not null unique,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '14 days',
  claimed_at   timestamptz,
  claimed_by   uuid references auth.users(id) on delete set null
);

create index if not exists kg_guardian_claims_guardian on kg_guardian_claims (guardian_id);
-- One live code per guardian. Re-issuing supersedes rather than accumulating,
-- so an old slip of paper cannot be redeemed after a new one is handed out.
create unique index if not exists kg_guardian_claims_one_pending
  on kg_guardian_claims (guardian_id) where claimed_at is null;

alter table kg_guardian_claims enable row level security;

-- Staff of the tenant may see and manage codes. Parents never select this table
-- at all — redemption goes through a security-definer function, so a code can be
-- spent without ever being readable.
drop policy if exists gc_staff on kg_guardian_claims;
create policy gc_staff on kg_guardian_claims for all
  using (kg_is_admin(tenant_id)) with check (kg_is_admin(tenant_id));

-- No O/0/I/1/L: these get read aloud and written down.
create or replace function kg_claim_code() returns text
language plpgsql volatile set search_path = public as $$
declare
  alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  v_out text := '';
  i int;
begin
  for i in 1..8 loop
    v_out := v_out || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  return v_out;
end $$;

-- ── Issue ────────────────────────────────────────────────────────────────
create or replace function kg_issue_guardian_claim(p_tenant uuid, p_guardian uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_code text; v_user uuid; v_owner uuid; i int;
begin
  if not kg_is_admin(p_tenant) then raise exception 'forbidden'; end if;

  select user_id, tenant_id into v_user, v_owner
    from kg_guardians where id = p_guardian;
  if v_owner is null or v_owner <> p_tenant then raise exception 'unknown_guardian'; end if;
  -- Already has an account: there is nothing to claim, and issuing a code would
  -- imply the record could be handed to somebody else.
  if v_user is not null then raise exception 'already_linked'; end if;

  delete from kg_guardian_claims
   where guardian_id = p_guardian and claimed_at is null;

  -- Retry on the astronomically unlikely unique collision rather than failing.
  for i in 1..5 loop
    begin
      v_code := kg_claim_code();
      insert into kg_guardian_claims (tenant_id, guardian_id, code, created_by)
      values (p_tenant, p_guardian, v_code, auth.uid());
      return v_code;
    exception when unique_violation then
      if i = 5 then raise; end if;
    end;
  end loop;
  return null;
end $$;
revoke execute on function kg_issue_guardian_claim(uuid, uuid) from anon;
grant execute on function kg_issue_guardian_claim(uuid, uuid) to authenticated;

-- ── Redeem ───────────────────────────────────────────────────────────────
-- Callable by any signed-in user: the whole point is that the redeemer is not a
-- member of the tenant yet. Authorisation IS the code.
create or replace function kg_redeem_guardian_claim(p_code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_claim kg_guardian_claims; v_uid uuid := auth.uid(); v_linked uuid;
begin
  if v_uid is null then raise exception 'auth required'; end if;

  select * into v_claim from kg_guardian_claims
   where code = upper(btrim(p_code))
     and claimed_at is null
     and expires_at > now()
   for update;
  if v_claim.id is null then raise exception 'invalid_code'; end if;

  -- Re-check under the lock: the guardian may have been linked by another route
  -- between the code being issued and redeemed.
  select user_id into v_linked from kg_guardians where id = v_claim.guardian_id;
  if v_linked is not null then raise exception 'already_linked'; end if;

  -- This single write is what creates the parent. kg_ensure_parent_membership
  -- (0008) fires on it and builds the membership and the profile.
  update kg_guardians set user_id = v_uid where id = v_claim.guardian_id;

  update kg_guardian_claims
     set claimed_at = now(), claimed_by = v_uid
   where id = v_claim.id;

  insert into kg_audit_log (tenant_id, user_id, action, entity, entity_id, data)
  values (v_claim.tenant_id, v_uid, 'guardian.claimed', 'kg_guardians',
          v_claim.guardian_id::text,
          jsonb_build_object('claimId', v_claim.id));

  return v_claim.tenant_id;
end $$;
revoke execute on function kg_redeem_guardian_claim(text) from anon;
grant execute on function kg_redeem_guardian_claim(text) to authenticated;
