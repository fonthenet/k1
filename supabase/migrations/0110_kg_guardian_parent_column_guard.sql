-- 0110 — a parent could mint their own door PIN.
--
-- ---------------------------------------------------------------------------
-- What is wrong
-- ---------------------------------------------------------------------------
--
-- 0016 let a parent maintain their own kg_guardians row — phone, address,
-- workplace — through the policy
--
--   g_upd  UPDATE  USING (kg_is_educator(tenant_id) OR user_id = auth.uid())
--
-- with no WITH CHECK. USING decides which rows may be updated; WITH CHECK
-- decides what they may become, and without one the row may become anything.
-- Over PostgREST a parent can PATCH their own row's pin_code, tag_code,
-- relationship and tenant_id along with their phone number.
--
-- pin_code is the part that bites. trg_kg_guardian_credentials (0040) is an
-- AFTER trigger that mirrors every pin_code change into kg_credentials as the
-- guardian's live PIN, and the kiosk's kg_resolve_credential matches on value
-- alone. So a parent-chosen PIN is honoured at the door, the PIN the office
-- printed on their badge is retired, and — because kg_sync_credential raises
-- 'credential_in_use' when the value is already live for someone else —
-- repeated PATCHes are a yes/no oracle over the 10 000-PIN space for every
-- other family's PIN in the crèche.
--
-- ---------------------------------------------------------------------------
-- The fix
-- ---------------------------------------------------------------------------
--
-- A BEFORE UPDATE trigger that refuses a parent's change to any credential or
-- identity column. BEFORE, so it fires ahead of the AFTER mirror trigger and
-- nothing reaches kg_credentials. kg_actor_is_parent (0016) is the same test
-- the notification triggers use to tell a parent's edit from staff's.
--
-- user_id is deliberately NOT in the trigger: kg_redeem_guardian_claim (0053)
-- sets it while running AS the parent who is redeeming the claim, and would be
-- blocked. It is pinned instead by the WITH CHECK below, which only the
-- PostgREST path goes through — definer functions bypass RLS — so the claim
-- flow keeps working and a parent can no longer point their row at another
-- account.
--
-- Office paths are unaffected: kg_issue_guardian_credentials and
-- kg_revoke_guardian_credentials are called by staff, for whom
-- kg_actor_is_parent is false. Re-run the claim flow after applying.

begin;

create or replace function kg_guardian_parent_column_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if kg_actor_is_parent(old.tenant_id) and (
       new.pin_code     is distinct from old.pin_code
    or new.tag_code     is distinct from old.tag_code
    or new.tenant_id    is distinct from old.tenant_id
    or new.relationship is distinct from old.relationship
  ) then
    raise exception 'forbidden' using hint = 'parents cannot change credential or identity columns';
  end if;
  return new;
end $$;
revoke all on function kg_guardian_parent_column_guard() from public, anon, authenticated;

drop trigger if exists trg_kg_guardian_parent_column_guard on kg_guardians;
create trigger trg_kg_guardian_parent_column_guard
  before update on kg_guardians
  for each row execute function kg_guardian_parent_column_guard();

-- The USING clause repeated as WITH CHECK: a row a parent may edit must still
-- be theirs afterwards.
drop policy if exists g_upd on kg_guardians;
create policy g_upd on kg_guardians for update
  using (kg_is_educator(tenant_id) or user_id = auth.uid())
  with check (kg_is_educator(tenant_id) or user_id = auth.uid());

commit;
