-- 0046 — Algerian phone numbers, written the way Algerians write them.
--
-- Seed and form data arrived as "+213 510666666". Nobody in Jijel reads a
-- number that way, dials it that way, or writes it on a form that way — and in
-- an RTL page the "+" prefix is one more neutral character for the bidi
-- algorithm to move around. Local form only: 0550 12 34 56.
--
-- Normalising in a trigger rather than in each server action, for the same
-- reason credentials resolve in one place: there are five tables holding phone
-- numbers and more paths writing them than any one of us will remember.

create or replace function kg_normalize_phone(p_raw text)
returns text language plpgsql immutable set search_path = public as $$
declare v_digits text;
begin
  if p_raw is null then return null; end if;
  v_digits := regexp_replace(p_raw, '\D', '', 'g');
  if v_digits = '' then return null; end if;

  -- International forms collapse to the national one: +213 / 00213 replace the
  -- trunk "0", so putting it back is the whole conversion.
  if left(v_digits, 5) = '00213' then
    v_digits := substring(v_digits from 6);
  elsif left(v_digits, 3) = '213' and length(v_digits) > 9 then
    v_digits := substring(v_digits from 4);
  end if;

  if left(v_digits, 1) <> '0' then
    v_digits := '0' || v_digits;
  end if;
  return v_digits;
end $$;
grant execute on function kg_normalize_phone(text) to authenticated, anon;

create or replace function kg_normalize_phone_cols() returns trigger
language plpgsql set search_path = public as $$
begin
  -- tg_argv lists the phone columns on whichever table fired this.
  if tg_argv[0] is not null then
    new := jsonb_populate_record(new, to_jsonb(new) || jsonb_build_object(
      tg_argv[0], kg_normalize_phone(to_jsonb(new) ->> tg_argv[0])));
  end if;
  if tg_argv[1] is not null then
    new := jsonb_populate_record(new, to_jsonb(new) || jsonb_build_object(
      tg_argv[1], kg_normalize_phone(to_jsonb(new) ->> tg_argv[1])));
  end if;
  return new;
end $$;

drop trigger if exists trg_kg_guardians_phone on kg_guardians;
create trigger trg_kg_guardians_phone before insert or update of phone, phone_alt on kg_guardians
  for each row execute function kg_normalize_phone_cols('phone', 'phone_alt');

drop trigger if exists trg_kg_profiles_phone on kg_profiles;
create trigger trg_kg_profiles_phone before insert or update of phone on kg_profiles
  for each row execute function kg_normalize_phone_cols('phone');

drop trigger if exists trg_kg_tenants_phone on kg_tenants;
create trigger trg_kg_tenants_phone before insert or update of phone on kg_tenants
  for each row execute function kg_normalize_phone_cols('phone');

drop trigger if exists trg_kg_pickups_phone on kg_authorized_pickups;
create trigger trg_kg_pickups_phone before insert or update of phone on kg_authorized_pickups
  for each row execute function kg_normalize_phone_cols('phone');

drop trigger if exists trg_kg_leads_phone on kg_leads;
create trigger trg_kg_leads_phone before insert or update of phone on kg_leads
  for each row execute function kg_normalize_phone_cols('phone');

-- Backfill everything already stored in international form.
update kg_guardians set phone = kg_normalize_phone(phone) where phone is not null;
update kg_guardians set phone_alt = kg_normalize_phone(phone_alt) where phone_alt is not null;
update kg_profiles set phone = kg_normalize_phone(phone) where phone is not null;
update kg_tenants set phone = kg_normalize_phone(phone) where phone is not null;
update kg_authorized_pickups set phone = kg_normalize_phone(phone) where phone is not null;
update kg_leads set phone = kg_normalize_phone(phone) where phone is not null;
