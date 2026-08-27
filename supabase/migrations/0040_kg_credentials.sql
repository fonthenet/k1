-- 0040 — One namespace for everything scanned at the door.
--
-- Until now a scannable code lived in a column on whatever table owned the
-- person: kg_children.tag_code, kg_guardians.tag_code, kg_guardians.pin_code,
-- kg_memberships.staff_code, kg_memberships.pin_code. Five columns across
-- three tables, no uniqueness between them, and the kiosk querying them in a
-- fixed order — which is why 0037 needed a regex to stop a hand-typed child
-- tag from shadowing a guardian badge. That guard goes away here: one unique
-- index over one column makes the collision impossible to create.
--
-- It also unblocks RFID. A person is no longer limited to the single code
-- their row has space for: a mother can hold a printed QR and a proximity
-- card and a PIN, a lost card can be revoked without touching her identity,
-- and a grandmother with no smartphone can carry a card instead.
--
-- The legacy columns stay authoritative for the value PRINTED on a badge —
-- triggers mirror them in here. Cards exist only in this table.

create type kg_credential_kind as enum ('qr', 'rfid', 'pin');
create type kg_credential_subject as enum ('child', 'guardian', 'staff');

create table kg_credentials (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kg_tenants(id) on delete cascade,
  subject_type kg_credential_subject not null,
  -- kg_children.id | kg_guardians.id | kg_memberships.id. Deliberately not a
  -- foreign key: three possible parents. The sync triggers and the cascade
  -- cleanup below keep it honest.
  subject_id uuid not null,
  kind kg_credential_kind not null,
  value text not null,
  label text,
  active boolean not null default true,
  issued_at timestamptz not null default now(),
  issued_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete set null,
  last_used_at timestamptz
);

-- The whole point: one live value cannot mean two people, whatever kind it is
-- or whichever table its owner lives in.
create unique index kg_credentials_value_unique
  on kg_credentials (tenant_id, value) where active;
create index kg_credentials_subject on kg_credentials (tenant_id, subject_type, subject_id);
-- One mirrored credential per (subject, kind); cards are exempt so a person
-- can carry several.
create unique index kg_credentials_mirror_unique
  on kg_credentials (tenant_id, subject_type, subject_id, kind)
  where kind <> 'rfid' and active;

alter table kg_credentials enable row level security;

-- Reading these is reading door keys and PINs: admins only. The kiosk never
-- selects from this table — it calls kg_resolve_credential, which is security
-- definer, so an educator can open a door without being able to enumerate
-- every credential in the crèche.
create policy cred_sel on kg_credentials for select using (kg_is_admin(tenant_id));
create policy cred_ins on kg_credentials for insert with check (kg_is_admin(tenant_id));
create policy cred_upd on kg_credentials for update using (kg_is_admin(tenant_id))
  with check (kg_is_admin(tenant_id));
create policy cred_del on kg_credentials for delete using (kg_is_admin(tenant_id));

-- Readers, keypads and phone cameras all deliver slightly different whitespace
-- and case. Normalise once, here, so a card enrolled from one reader still
-- matches when read by another.
create or replace function kg_normalize_credential(p_value text)
returns text language sql immutable set search_path = public as $$
  select nullif(upper(trim(p_value)), '')
$$;

-- ── Mirror the legacy columns ────────────────────────────────────────────
create or replace function kg_sync_credential(
  p_tenant uuid, p_subject kg_credential_subject, p_subject_id uuid,
  p_kind kg_credential_kind, p_value text
) returns void language plpgsql security definer set search_path = public as $$
declare v_value text := kg_normalize_credential(p_value);
begin
  -- Cleared on the owning row → the credential stops working.
  if v_value is null then
    update kg_credentials set active = false, revoked_at = now()
     where tenant_id = p_tenant and subject_type = p_subject
       and subject_id = p_subject_id and kind = p_kind and active;
    return;
  end if;

  -- Already exactly this, for exactly this person: nothing to do.
  if exists (
    select 1 from kg_credentials
     where tenant_id = p_tenant and subject_type = p_subject and subject_id = p_subject_id
       and kind = p_kind and value = v_value and active
  ) then
    return;
  end if;

  -- Somebody else already opens a door with this value. Refuse loudly — a
  -- swallowed conflict here means a badge that silently stops working, or
  -- worse, one that starts working for the wrong person.
  if exists (
    select 1 from kg_credentials where tenant_id = p_tenant and value = v_value and active
  ) then
    raise exception 'credential_in_use';
  end if;

  -- Value changed → retire the old one rather than editing it, so the history
  -- of what was ever a live key survives.
  update kg_credentials set active = false, revoked_at = now()
   where tenant_id = p_tenant and subject_type = p_subject
     and subject_id = p_subject_id and kind = p_kind and active;

  insert into kg_credentials (tenant_id, subject_type, subject_id, kind, value)
  values (p_tenant, p_subject, p_subject_id, p_kind, v_value);
end $$;

create or replace function kg_on_child_credentials() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform kg_sync_credential(new.tenant_id, 'child', new.id, 'qr', new.tag_code);
  return new;
end $$;
drop trigger if exists trg_kg_child_credentials on kg_children;
create trigger trg_kg_child_credentials
  after insert or update of tag_code on kg_children
  for each row execute function kg_on_child_credentials();

create or replace function kg_on_guardian_credentials() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform kg_sync_credential(new.tenant_id, 'guardian', new.id, 'qr', new.tag_code);
  perform kg_sync_credential(new.tenant_id, 'guardian', new.id, 'pin', new.pin_code);
  return new;
end $$;
drop trigger if exists trg_kg_guardian_credentials on kg_guardians;
create trigger trg_kg_guardian_credentials
  after insert or update of tag_code, pin_code on kg_guardians
  for each row execute function kg_on_guardian_credentials();

create or replace function kg_on_membership_credentials() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform kg_sync_credential(new.tenant_id, 'staff', new.id, 'qr', new.staff_code);
  perform kg_sync_credential(new.tenant_id, 'staff', new.id, 'pin', new.pin_code);
  return new;
end $$;
drop trigger if exists trg_kg_membership_credentials on kg_memberships;
create trigger trg_kg_membership_credentials
  after insert or update of staff_code, pin_code on kg_memberships
  for each row execute function kg_on_membership_credentials();

-- A deleted person must not leave a live key behind.
create or replace function kg_cleanup_credentials() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from kg_credentials
   where tenant_id = old.tenant_id
     and subject_type = tg_argv[0]::kg_credential_subject
     and subject_id = old.id;
  return old;
end $$;
drop trigger if exists trg_kg_child_credentials_gone on kg_children;
create trigger trg_kg_child_credentials_gone after delete on kg_children
  for each row execute function kg_cleanup_credentials('child');
drop trigger if exists trg_kg_guardian_credentials_gone on kg_guardians;
create trigger trg_kg_guardian_credentials_gone after delete on kg_guardians
  for each row execute function kg_cleanup_credentials('guardian');
drop trigger if exists trg_kg_membership_credentials_gone on kg_memberships;
create trigger trg_kg_membership_credentials_gone after delete on kg_memberships
  for each row execute function kg_cleanup_credentials('staff');

-- ── The single door lookup ───────────────────────────────────────────────
create or replace function kg_resolve_credential(p_tenant uuid, p_value text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_c kg_credentials; v_value text := kg_normalize_credential(p_value);
begin
  if not kg_is_educator(p_tenant) then raise exception 'forbidden'; end if;
  if v_value is null then return jsonb_build_object('found', false); end if;

  select * into v_c from kg_credentials
   where tenant_id = p_tenant and value = v_value and active;
  if v_c.id is null then return jsonb_build_object('found', false); end if;

  -- Tells staff whether a card that "stopped working" is lost or was never
  -- used, and is what a stale-credential report would key off.
  update kg_credentials set last_used_at = now() where id = v_c.id;

  return jsonb_build_object(
    'found', true, 'subject_type', v_c.subject_type,
    'subject_id', v_c.subject_id, 'kind', v_c.kind,
    'credential_id', v_c.id, 'label', v_c.label
  );
end $$;
grant execute on function kg_resolve_credential(uuid, text) to authenticated;

-- ── Enrolling a card ─────────────────────────────────────────────────────
-- Admin-only, and it refuses rather than steals: a value already live for
-- somebody else is the one mistake that would open the wrong door.
create or replace function kg_issue_credential(
  p_tenant uuid, p_subject kg_credential_subject, p_subject_id uuid,
  p_kind kg_credential_kind, p_value text, p_label text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_value text := kg_normalize_credential(p_value); v_id uuid; v_owner kg_credentials;
begin
  if not kg_is_admin(p_tenant) then raise exception 'forbidden'; end if;
  if v_value is null then raise exception 'empty_value'; end if;
  if length(v_value) > 64 then raise exception 'value_too_long'; end if;

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

-- Revoking never deletes: a lost card has to stay in the history that says
-- which key opened which door on which day.
create or replace function kg_revoke_credential(p_tenant uuid, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not kg_is_admin(p_tenant) then raise exception 'forbidden'; end if;
  update kg_credentials
     set active = false, revoked_at = now(), revoked_by = auth.uid()
   where id = p_id and tenant_id = p_tenant and active;
end $$;
grant execute on function kg_revoke_credential(uuid, uuid) to authenticated;

-- ── Backfill every existing code ─────────────────────────────────────────
do $$
declare r record;
begin
  for r in select tenant_id, id, tag_code from kg_children where tag_code is not null loop
    perform kg_sync_credential(r.tenant_id, 'child', r.id, 'qr', r.tag_code);
  end loop;
  for r in select tenant_id, id, tag_code, pin_code from kg_guardians loop
    perform kg_sync_credential(r.tenant_id, 'guardian', r.id, 'qr', r.tag_code);
    perform kg_sync_credential(r.tenant_id, 'guardian', r.id, 'pin', r.pin_code);
  end loop;
  for r in select tenant_id, id, staff_code, pin_code from kg_memberships where role <> 'parent' loop
    perform kg_sync_credential(r.tenant_id, 'staff', r.id, 'qr', r.staff_code);
    perform kg_sync_credential(r.tenant_id, 'staff', r.id, 'pin', r.pin_code);
  end loop;
end $$;
