-- One allergen, one row per child.
--
-- Nas Bit's file listed "Milk / Mild" twice. Both rows carried the SAME
-- created_at to the microsecond, so they were not two mistakes by a parent —
-- they arrived together, from one application payload that contained lactose
-- twice, and both kg_approve_application (0004) and kg_submit_sibling
-- approval (0017) loop that array and insert every element. The activity loop
-- three lines below each of them already says `on conflict do nothing`; the
-- allergy loop never got the same care.
--
-- A duplicate is not cosmetic here. The allergy list is what a member of staff
-- reads before serving food, and a list that repeats itself is one somebody
-- starts skimming. It also doubles the child in every menu alert.
--
-- ── (1) merge what is already there ────────────────────────────────────────
-- Severity first, because that is the safety-relevant field: if one copy says
-- severe and the other mild, the child keeps severe. Then whichever copy
-- actually carries a reaction or an action plan — an EpiPen instruction must
-- not lose to an empty row. Then the oldest, to keep the original record.
with ranked as (
  select id,
         row_number() over (
           partition by child_id, lower(btrim(allergen))
           order by severity desc,
                    (coalesce(nullif(btrim(reaction), ''), '') <> '')::int
                      + (coalesce(nullif(btrim(action_plan), ''), '') <> '')::int desc,
                    created_at asc
         ) as rn
    from kg_child_allergies
)
delete from kg_child_allergies a
 using ranked r
 where a.id = r.id and r.rn > 1;

-- ── (2) make it impossible from here on ────────────────────────────────────
-- Case- and whitespace-insensitive, so "Lactose" cannot sit beside "lactose".
-- Synonyms across languages ("Milk" beside "lactose") are deliberately NOT
-- merged: they are different strings a human chose, and collapsing them would
-- be the database guessing. src/lib/allergens.ts already makes both match the
-- same menu.
create unique index if not exists kg_child_allergies_unique
  on kg_child_allergies (child_id, lower(btrim(allergen)));

-- ── (3) stop the two approval paths creating them ──────────────────────────
-- A repeated payload is now silently collapsed rather than raising and
-- aborting an approval, which is the behaviour the activity loop already had.
create or replace function kg_copy_application_allergies(
  p_tenant uuid, p_child uuid, p_health jsonb
) returns void language plpgsql security definer set search_path = public as $$
declare al jsonb;
begin
  for al in select * from jsonb_array_elements(coalesce(p_health->'allergies','[]'::jsonb)) loop
    if coalesce(btrim(al->>'allergen'), '') = '' then continue; end if;
    insert into kg_child_allergies (tenant_id, child_id, allergen, severity, reaction, action_plan)
      values (p_tenant, p_child, btrim(al->>'allergen'),
        coalesce((al->>'severity')::kg_allergy_severity,'mild'),
        al->>'reaction', al->>'action_plan')
      on conflict (child_id, lower(btrim(allergen))) do nothing;
  end loop;
end $$;
revoke execute on function kg_copy_application_allergies(uuid, uuid, jsonb) from anon, authenticated;
