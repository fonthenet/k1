-- 0126 — a word for "the crèche side of the building".
--
-- NOT YET APPLIED. Apply deliberately: this is the first client's live data.
--
-- kg_announcements and kg_events carry structure_id (0125), and the UI now
-- offers it, but kg_audience had four values — all / parents / staff / class —
-- and none of them can say "the crèche has a water cut tomorrow, the jardin
-- does not". Without this migration such a notice cannot be written at all:
-- the insert is refused as an invalid enum value.
--
-- Three things have to move together, and the order matters more than it looks:
--
--   1. the enum, so the row can exist;
--   2. the RLS policies, so the right parents can read it — a value no policy
--      mentions is a row every parent is hidden from, which reads as "the
--      announcement was never published";
--   3. the recipient functions, so the notification goes to the same people.
--      This is the dangerous half. Both functions end in an `else` branch that
--      means "every parent in the tenant". A new audience they do not name
--      falls into it, so the water-cut notice the policy shows to nobody would
--      have been PUSHED to every family in the building — the exact opposite of
--      what the author asked for, and louder.
--
-- Everything below is a no-op for existing rows: structure_id is null on all of
-- them, and null keeps meaning the whole building.

-- `if not exists` so re-running is safe; `alter type ... add value` cannot be
-- rolled back, so it is the one statement here that outlives a failed apply.
alter type kg_audience add value if not exists 'structure';

-- WHY EVERY COMPARISON BELOW IS `::text` RATHER THAN THE ENUM LITERAL.
-- A new enum value cannot be USED in the same transaction that adds it —
-- Postgres refuses with "unsafe use of new value of enum type", because the
-- pg_enum row is not committed yet and an index built against it could be
-- wrong. Casting the COLUMN to text never resolves the literal against the
-- enum, so policy and constraint expressions parse cleanly here instead of
-- forcing this migration to be split into two files applied minutes apart.

-- ---------------------------------------------------------------------------
-- An audience naming a structure must name WHICH structure
-- ---------------------------------------------------------------------------
-- The same guard 0089 put on audience='class', for the same reason: such a row
-- is invisible to every parent and, before the recipient fix below, was pushed
-- to all of them.
alter table kg_announcements drop constraint if exists kg_announcements_structure_audience;
alter table kg_announcements add constraint kg_announcements_structure_audience
  check (audience::text <> 'structure' or structure_id is not null);

alter table kg_events drop constraint if exists kg_events_structure_audience;
alter table kg_events add constraint kg_events_structure_audience
  check (audience::text <> 'structure' or structure_id is not null);

-- ---------------------------------------------------------------------------
-- Is the caller a parent of this structure?
-- ---------------------------------------------------------------------------
-- Shaped exactly like kg_is_parent_of_class: scoped to the caller through
-- kg_is_parent_of, so it answers about the person asking and can never be
-- turned into a directory of who else has a child in the crèche.
create or replace function kg_is_parent_of_structure(p_tenant uuid, p_structure uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from kg_children c
     where c.structure_id = p_structure
       and c.tenant_id = p_tenant
       and c.status = 'enrolled'
       and kg_is_parent_of(c.id)
  )
$$;
revoke all on function kg_is_parent_of_structure(uuid, uuid) from public, anon;
grant execute on function kg_is_parent_of_structure(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS — staff keep the full view; a parent sees their own structure's notices
-- ---------------------------------------------------------------------------
drop policy if exists ann_sel on kg_announcements;
create policy ann_sel on kg_announcements for select using (
  kg_is_staff(tenant_id)
  or (
    kg_is_member(tenant_id)
    and (
      audience = 'all'
      or audience = 'parents'
      or (audience = 'class' and class_id is not null
          and kg_is_parent_of_class(tenant_id, class_id))
      or (audience::text = 'structure' and structure_id is not null
          and kg_is_parent_of_structure(tenant_id, structure_id))
    )
  )
);

drop policy if exists ev_sel on kg_events;
create policy ev_sel on kg_events for select using (
  kg_is_staff(tenant_id)
  or (
    kg_is_member(tenant_id)
    and (
      audience = 'all'
      or audience = 'parents'
      or (audience = 'class' and class_id is not null
          and kg_is_parent_of_class(tenant_id, class_id))
      or (audience::text = 'structure' and structure_id is not null
          and kg_is_parent_of_structure(tenant_id, structure_id))
    )
  )
);

-- ---------------------------------------------------------------------------
-- Recipients — the branch that keeps the jardin's phones quiet
-- ---------------------------------------------------------------------------
-- Placed BEFORE the else, and returning empty rather than falling through when
-- the structure is missing: see the header. Staff are not included, exactly as
-- they are not for audience='class' — a structure names the FAMILIES of one
-- activity, and staff read every announcement in the dashboard anyway.
create or replace function kg_announcement_recipients(a kg_announcements)
returns uuid[] language plpgsql stable security definer set search_path = public as $$
declare v_recipients uuid[];
begin
  if a.audience = 'staff' then
    select array_agg(u) into v_recipients from kg_staff_user_ids(a.tenant_id) u;
  elsif a.audience = 'class' and a.class_id is not null then
    select array_agg(distinct p) into v_recipients
      from kg_children c, lateral kg_parent_user_ids(c.id) p
     where c.class_id = a.class_id and c.status = 'enrolled';
  elsif a.audience::text = 'structure' then
    if a.structure_id is null then
      return '{}'::uuid[];
    end if;
    select array_agg(distinct p) into v_recipients
      from kg_children c, lateral kg_parent_user_ids(c.id) p
     where c.structure_id = a.structure_id
       and c.tenant_id = a.tenant_id
       and c.status = 'enrolled';
  else
    select array_agg(distinct p) into v_recipients
      from kg_children c, lateral kg_parent_user_ids(c.id) p
     where c.tenant_id = a.tenant_id and c.status = 'enrolled';
    if a.audience = 'all' then
      v_recipients := v_recipients || coalesce(
        (select array_agg(u) from kg_staff_user_ids(a.tenant_id) u), '{}'::uuid[]);
    end if;
  end if;
  return v_recipients;
end $$;

create or replace function kg_event_recipients(e kg_events)
returns uuid[] language plpgsql stable security definer set search_path = public as $$
declare v uuid[];
begin
  if e.audience = 'staff' then
    select array_agg(distinct u) into v from kg_staff_user_ids(e.tenant_id) u;

  elsif e.audience = 'class' then
    -- Explicit branch, NOT `elsif ... and class_id is not null`: a null class
    -- must reach nobody rather than fall through to every parent (0089).
    if e.class_id is null then
      return '{}'::uuid[];
    end if;
    select array_agg(distinct p) into v
      from kg_class_parent_user_ids(e.tenant_id, e.class_id) p;

  elsif e.audience::text = 'structure' then
    if e.structure_id is null then
      return '{}'::uuid[];
    end if;
    select array_agg(distinct p) into v
      from kg_children c, lateral kg_parent_user_ids(c.id) p
     where c.structure_id = e.structure_id
       and c.tenant_id = e.tenant_id
       and c.status = 'enrolled';

  elsif e.audience = 'parents' then
    select array_agg(distinct p) into v
      from kg_children c, lateral kg_parent_user_ids(c.id) p
     where c.tenant_id = e.tenant_id and c.status = 'enrolled';

  else  -- 'all': parents AND staff, deduped ACROSS the two sets
    select array_agg(distinct everyone.u) into v
      from (
        select p as u from kg_children c, lateral kg_parent_user_ids(c.id) p
         where c.tenant_id = e.tenant_id and c.status = 'enrolled'
        union
        select s from kg_staff_user_ids(e.tenant_id) s
      ) everyone;
  end if;

  return coalesce(v, '{}'::uuid[]);
end $$;

-- ---------------------------------------------------------------------------
-- "How many people will this interrupt?" — now answerable for a structure
-- ---------------------------------------------------------------------------
-- p_structure is added LAST and defaults to null, so the four-argument call the
-- event dialog already makes keeps resolving unchanged; only the structure
-- audience sends the fifth.
drop function if exists kg_event_audience_count(uuid, kg_audience, uuid, timestamptz);

create or replace function kg_event_audience_count(
  p_tenant uuid, p_audience kg_audience, p_class uuid,
  p_start_at timestamptz default null, p_structure uuid default null
) returns int language plpgsql stable security definer set search_path = public as $$
declare v int;
begin
  if not kg_is_educator(p_tenant) then
    raise exception 'forbidden';
  end if;

  -- Same rule as the insert trigger: an event that has already started
  -- notifies nobody.
  if p_start_at is not null and p_start_at <= now() then
    return 0;
  end if;

  if p_audience = 'staff' then
    select count(*) into v from kg_staff_user_ids(p_tenant) u;
  elsif p_audience = 'class' then
    if p_class is null then return 0; end if;
    select count(*) into v from kg_class_parent_user_ids(p_tenant, p_class) p;
  elsif p_audience::text = 'structure' then
    if p_structure is null then return 0; end if;
    select count(distinct p) into v
      from kg_children c, lateral kg_parent_user_ids(c.id) p
     where c.structure_id = p_structure
       and c.tenant_id = p_tenant
       and c.status = 'enrolled';
  elsif p_audience = 'parents' then
    select count(distinct p) into v
      from kg_children c, lateral kg_parent_user_ids(c.id) p
     where c.tenant_id = p_tenant and c.status = 'enrolled';
  else
    select count(*) into v from (
      select p as u from kg_children c, lateral kg_parent_user_ids(c.id) p
       where c.tenant_id = p_tenant and c.status = 'enrolled'
      union
      select s from kg_staff_user_ids(p_tenant) s
    ) everyone;
  end if;

  return coalesce(v, 0);
end $$;

revoke all on function kg_event_audience_count(uuid, kg_audience, uuid, timestamptz, uuid)
  from public, anon;
grant execute on function kg_event_audience_count(uuid, kg_audience, uuid, timestamptz, uuid)
  to authenticated;

-- Verify after applying (a structure notice must reach only its own families):
--   select a.title, a.audience, cardinality(kg_announcement_recipients(a))
--     from kg_announcements a where a.structure_id is not null;
