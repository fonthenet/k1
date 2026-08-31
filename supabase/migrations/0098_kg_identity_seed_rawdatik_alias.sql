-- The rebrand moved the phone-login alias; this function did not follow.
--
-- APPLIED 2026-08-31.
--
-- A phone signup carries its number as an internal alias address, and
-- kg_identity_seed recovers the number from it when the account has no phone in
-- its metadata. It tested for `phone.rawdati.app` literally (0051). After the
-- rename to phone.rawdatik.app that test stopped matching, so a future phone
-- signup would land with a null phone on their profile — silently, with nothing
-- failing and nothing to notice.
--
-- Both domains, deliberately: an account created before the rename still has
-- the old alias, and dropping it would break exactly the accounts that predate
-- the change. Same tolerance the mobile enrolment form carries.
--
-- 0051 is left as it was: it is the record of what was applied then, not a
-- description of what runs now.
create or replace function kg_identity_seed(p_user uuid)
returns table(full_name text, phone text)
language plpgsql stable security definer set search_path to 'public'
as $function$
declare v_meta jsonb; v_email text; v_phone text; v_domain text;
begin
  select raw_user_meta_data, u.email into v_meta, v_email
    from auth.users u where u.id = p_user;

  v_phone := nullif(btrim(coalesce(v_meta->>'phone', '')), '');

  v_domain := lower(split_part(coalesce(v_email, ''), '@', 2));
  if v_phone is null and v_domain in ('phone.rawdatik.app', 'phone.rawdati.app') then
    v_phone := split_part(v_email, '@', 1);
  end if;

  return query select
    coalesce(nullif(btrim(coalesce(v_meta->>'full_name', '')), ''), ''),
    kg_normalize_phone(v_phone);
end $function$;

-- Verified after applying, in a rolled-back transaction: the live account on
-- the new alias recovers 0561322400, and the same account rewritten onto the
-- old alias recovers it too.
