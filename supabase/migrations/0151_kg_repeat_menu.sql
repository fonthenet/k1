-- 0151 — a menu that repeats every week.
--
-- The cook plans "chorba on Sundays" once, not fifteen times. The day
-- dialog saves the day as before, then asks for that day to be copied onto
-- the same weekday until a chosen date. Every copy is an ordinary kg_menus
-- row: the week on screen, the family portal and the daily report keep
-- reading one table, and editing one Sunday later never touches the others
-- — the rule the timetable already follows for repeated lessons.
--
-- Closed days are skipped, weekly hours and closure holidays alike, and a
-- day already filled in is kept unless the caller asks to replace it: a
-- cook who wrote something special for one Sunday must not lose it to a
-- routine she set up afterwards.
--
-- SECURITY INVOKER on purpose: the row-level policies on kg_menus stay the
-- only permission layer (mn_all = educators and above). The explicit
-- kg_is_educator check only turns a silent zero-row read into a clear error.

create or replace function kg_repeat_menu(
  p_date date,
  p_structure uuid,
  p_until date,
  p_replace boolean default false
) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  src kg_menus;
  hours jsonb;
  day_key text;
  d date;
  existing_id uuid;
  written int := 0;
  kept int := 0;
  last_written date;
begin
  select * into src from kg_menus m
   where m.date = p_date and m.structure_id is not distinct from p_structure
   limit 1;
  if src.id is null then
    raise exception 'menu_not_found' using errcode = 'P0002';
  end if;
  if not kg_is_educator(src.tenant_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  -- A year at most: past that the cook is not planning, she is guessing.
  if p_until is null or p_until <= p_date or p_until > p_date + 371 then
    raise exception 'invalid_until' using errcode = '23514';
  end if;

  hours := kg_structure_hours(p_structure, src.tenant_id);
  day_key := (array['sun','mon','tue','wed','thu','fri','sat'])[extract(dow from p_date)::int + 1];

  d := p_date + 7;
  while d <= p_until loop
    if hours ? day_key and (hours -> day_key) <> 'null'::jsonb
       and not kg_structure_closed_on(p_structure, src.tenant_id, d) then
      select id into existing_id from kg_menus m
       where m.tenant_id = src.tenant_id and m.date = d
         and m.structure_id is not distinct from p_structure;
      if existing_id is null then
        insert into kg_menus (tenant_id, structure_id, date, breakfast, lunch, snack, allergens, notes, published)
        values (src.tenant_id, p_structure, d, src.breakfast, src.lunch, src.snack, src.allergens, src.notes, src.published);
        written := written + 1; last_written := d;
      elsif p_replace then
        update kg_menus
           set breakfast = src.breakfast, lunch = src.lunch, snack = src.snack,
               allergens = src.allergens, notes = src.notes, published = src.published
         where id = existing_id;
        written := written + 1; last_written := d;
      else
        kept := kept + 1;
      end if;
    end if;
    d := d + 7;
  end loop;

  return jsonb_build_object('written', written, 'kept', kept, 'last', last_written);
end $$;

revoke all on function kg_repeat_menu(date, uuid, date, boolean) from public, anon;
grant execute on function kg_repeat_menu(date, uuid, date, boolean) to authenticated;
