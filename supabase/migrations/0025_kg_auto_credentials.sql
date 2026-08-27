-- Every child and every guardian gets a scannable code the moment they exist.
--
-- Until now a child's tag was typed by staff and a guardian's badge had to be
-- issued by hand, so records routinely existed with no way to use the door.
-- Generation belongs in the database, not in one form: children arrive through
-- the add dialog, application approval AND sibling enrolment, and guardians
-- arrive through approval and manual linking. A trigger covers every path,
-- including future ones and bulk imports.
--
-- Only the tag is auto-issued for guardians. The PIN stays a deliberate act:
-- it is revealed exactly once when staff hand it over, and a PIN nobody has
-- ever seen is not a second factor, just a value in a column.

-- ── Children: keep the human-readable K-001 convention, per tenant ───────
create or replace function kg_next_child_tag(p_tenant uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare v_max int;
begin
  select coalesce(max((substring(tag_code from '^K-([0-9]+)$'))::int), 0)
    into v_max
    from kg_children
   where tenant_id = p_tenant and tag_code ~ '^K-[0-9]+$';
  return 'K-' || lpad((v_max + 1)::text, 3, '0');
end $$;

create or replace function kg_assign_child_tag() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_tag text; v_try int := 0;
begin
  if new.tag_code is not null and new.tag_code <> '' then
    -- Staff may still choose one; normalise it so a lower-case entry cannot
    -- print a QR that scans perfectly and then matches nothing at the door.
    new.tag_code := upper(trim(new.tag_code));
    return new;
  end if;

  loop
    v_try := v_try + 1;
    v_tag := kg_next_child_tag(new.tenant_id);
    exit when not exists (
      select 1 from kg_children
       where tenant_id = new.tenant_id and tag_code = v_tag
    );
    -- Two enrolments in the same instant: fall back to a random suffix rather
    -- than failing the insert. The unique index remains the real guarantee.
    if v_try >= 5 then
      v_tag := 'K-' || upper(encode(extensions.gen_random_bytes(4), 'hex'));
      exit;
    end if;
  end loop;

  new.tag_code := v_tag;
  return new;
end $$;

drop trigger if exists trg_kg_children_auto_tag on kg_children;
create trigger trg_kg_children_auto_tag
  before insert on kg_children
  for each row execute function kg_assign_child_tag();

-- ── Guardians: a random, non-sequential badge ───────────────────────────
-- Not sequential: a guardian tag is the whole credential a QR carries, so it
-- must not be guessable from a neighbour's card.
create or replace function kg_assign_guardian_tag() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_tag text; v_try int := 0;
begin
  if new.tag_code is not null and new.tag_code <> '' then
    new.tag_code := upper(trim(new.tag_code));
    return new;
  end if;

  loop
    v_try := v_try + 1;
    if v_try > 20 then raise exception 'tag_space_exhausted'; end if;
    v_tag := 'G-' || upper(encode(extensions.gen_random_bytes(5), 'hex'));
    exit when not exists (
      select 1 from kg_guardians
       where tenant_id = new.tenant_id and tag_code = v_tag
    );
  end loop;

  new.tag_code := v_tag;
  return new;
end $$;

drop trigger if exists trg_kg_guardians_auto_tag on kg_guardians;
create trigger trg_kg_guardians_auto_tag
  before insert on kg_guardians
  for each row execute function kg_assign_guardian_tag();

-- ── Backfill everyone who predates the triggers ─────────────────────────
do $$
declare r record; v_tag text; v_try int;
begin
  for r in select id, tenant_id from kg_guardians where tag_code is null loop
    v_try := 0;
    loop
      v_try := v_try + 1;
      exit when v_try > 20;
      v_tag := 'G-' || upper(encode(extensions.gen_random_bytes(5), 'hex'));
      exit when not exists (
        select 1 from kg_guardians where tenant_id = r.tenant_id and tag_code = v_tag
      );
    end loop;
    update kg_guardians set tag_code = v_tag where id = r.id;
  end loop;

  for r in select id, tenant_id from kg_children where tag_code is null loop
    update kg_children set tag_code = kg_next_child_tag(r.tenant_id) where id = r.id;
  end loop;
end $$;

-- Any tag stored before normalisation existed could scan but never match.
update kg_children  set tag_code = upper(tag_code) where tag_code <> upper(tag_code);
update kg_guardians set tag_code = upper(tag_code) where tag_code <> upper(tag_code);
