-- What an invite link may say before anybody signs in.
--
-- The invite lands a parent on /invite/<code>, and that page has to name the
-- crèche — "You have been invited to Les Petits Génies de Jijel" — or it is
-- just a code on a blank screen, which is exactly the thing people do not act
-- on. But kg_guardian_claims is `kg_is_admin` for every command (correctly:
-- 0087 was a whole migration about not leaking helpers), so a signed-out
-- visitor can read nothing at all.
--
-- Hence one narrow function, and only this much:
--
--   status       'valid' | 'claimed' | 'expired' | 'unknown'
--   tenant_name  ONLY when valid
--   logo_url     ONLY when valid
--
-- Never the guardian's name, never the child, never who issued it, never the
-- tenant id. The name and logo of a crèche are already public on its enrolment
-- link and its QR poster, so a valid code reveals nothing new — and an invalid
-- one reveals nothing at all.
--
-- On brute force: kg_claim_code() draws 8 characters from a 31-character
-- unambiguous alphabet, so ~8.5e11 combinations, single use, 14-day life. This
-- is not the weak link. (The generator uses `random()` rather than a CSPRNG,
-- which is worth revisiting on its own — it is unrelated to this function.)
create or replace function kg_claim_preview(p_code text)
returns table (status text, tenant_name text, logo_url text)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare v kg_guardian_claims; v_name text; v_logo text;
begin
  select * into v from kg_guardian_claims
   where code = upper(btrim(coalesce(p_code, '')));

  if v.id is null then
    return query select 'unknown'::text, null::text, null::text;
    return;
  end if;
  if v.claimed_at is not null then
    return query select 'claimed'::text, null::text, null::text;
    return;
  end if;
  if v.expires_at <= now() then
    return query select 'expired'::text, null::text, null::text;
    return;
  end if;

  select t.name, t.logo_url into v_name, v_logo
    from kg_tenants t where t.id = v.tenant_id;
  return query select 'valid'::text, v_name, v_logo;
end $function$;

-- Public on purpose: the whole point is a page that works before sign-in.
revoke all on function kg_claim_preview(text) from public;
grant execute on function kg_claim_preview(text) to anon, authenticated;
