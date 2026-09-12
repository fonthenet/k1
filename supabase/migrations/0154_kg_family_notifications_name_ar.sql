-- 0154 — a family notification carries the child's Arabic name too.
--
-- Every row a family receives is titled with the child's name, written by
-- the database at send time as `first_name || ' ' || last_name` — the Latin
-- spelling only. An Arabic reader therefore saw "يوميات Adam Amrani" while
-- the very page the row opens prints "آدم عمراني". The renderer already
-- prefers `data.childNameAr` under the Arabic locale (src/lib/notifications.ts);
-- this file makes the three writers supply it: kg_notify_family (every
-- family notification), the journal trigger and the staff preview of the
-- daily journal (0152), which build their data by hand. A child without an
-- Arabic name carries no key, so the renderer's fallback is the Latin name.
begin;

create or replace function public.kg_notify_family(p_tenant uuid, p_child uuid, p_type text, p_data jsonb default '{}'::jsonb, p_body text default null)
returns integer language plpgsql security definer set search_path = public as $$
declare v_recipients uuid[]; v_child kg_children; v_name text; v_name_ar text;
begin
  select array_agg(u) into v_recipients from kg_parent_user_ids(p_child) u;
  if v_recipients is null then return 0; end if;

  select * into v_child from kg_children where id = p_child;
  v_name := coalesce(v_child.first_name || ' ' || v_child.last_name, '');
  v_name_ar := nullif(btrim(coalesce(v_child.first_name_ar, '') || ' ' || coalesce(v_child.last_name_ar, '')), '');

  return kg_notify(p_tenant, v_recipients, p_type, v_name, p_body,
    coalesce(p_data, '{}'::jsonb)
      || jsonb_build_object('childId', p_child, 'childName', v_name, 'audience', 'parent')
      || case when v_name_ar is null then '{}'::jsonb else jsonb_build_object('childNameAr', v_name_ar) end,
    auth.uid());
end $$;

create or replace function public.kg_send_daily_journal_preview(p_child uuid, p_date date) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_child public.kg_children; v_data jsonb; v_id uuid; v_name text; v_name_ar text;
begin
  select * into v_child from public.kg_children where id = p_child;
  if v_child.id is null or not kg_is_admin(v_child.tenant_id) then raise exception 'forbidden'; end if;
  v_data := public.kg_daily_journal_data(
    public.kg_child_day_compose(p_child, p_date, p_date = (now() at time zone 'Africa/Algiers')::date)) - 'tellable';
  v_name := coalesce(v_child.first_name || ' ' || v_child.last_name, '');
  v_name_ar := nullif(btrim(coalesce(v_child.first_name_ar, '') || ' ' || coalesce(v_child.last_name_ar, '')), '');
  insert into public.kg_notifications (tenant_id, user_id, type, title, body, data, actor_id, read_at)
  values (v_child.tenant_id, auth.uid(), 'daily_report', v_name, null,
          v_data || jsonb_build_object('childId', p_child, 'childName', v_name, 'audience', 'staff', 'preview', true)
                 || case when v_name_ar is null then '{}'::jsonb else jsonb_build_object('childNameAr', v_name_ar) end,
          null, now())
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.kg_notify_daily_report() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_recipients uuid[]; v_child public.kg_children; v_dj jsonb; v_name_ar text;
  v_local timestamp; v_hours jsonb; v_due boolean := false;
begin
  if not new.published then return new; end if;
  if tg_op = 'UPDATE' and old.published then return new; end if;
  if coalesce(current_setting('kg.journal_sender', true), '') = 'on' then return new; end if;

  select * into v_child from public.kg_children where id = new.child_id;
  v_name_ar := nullif(btrim(coalesce(v_child.first_name_ar, '') || ' ' || coalesce(v_child.last_name_ar, '')), '');

  select t.settings -> 'daily_journal' into v_dj from public.kg_tenants t where t.id = new.tenant_id;
  v_local := now() at time zone 'Africa/Algiers';
  if coalesce(v_dj ->> 'enabled', 'false') = 'true'
     and new.date = v_local::date and v_local::time <= time '22:30' then
    v_hours := public.kg_structure_hours(v_child.structure_id, new.tenant_id) -> lower(to_char(new.date, 'Dy'));
    v_due := v_hours is not null and v_hours <> 'null'::jsonb
      and not exists (select 1 from public.kg_holidays h
                       where h.tenant_id = new.tenant_id and h.closure and not h.tentative
                         and new.date between h.date and coalesce(h.end_date, h.date)
                         and (h.structure_id is null or h.structure_id = v_child.structure_id))
      and not exists (select 1 from public.kg_daily_journal_ledger l
                       where l.child_id = new.child_id and l.day = new.date
                         and l.status not in ('failed','skipped_unmarked'));
  end if;
  if v_due then return new; end if;

  select array_agg(u) into v_recipients from public.kg_parent_user_ids(new.child_id) u;
  perform public.kg_notify(new.tenant_id, v_recipients, 'daily_report',
    coalesce(v_child.first_name || ' ' || v_child.last_name, ''), null,
    jsonb_build_object('childId', new.child_id, 'date', new.date::text, 'source', 'journal',
      'childName', coalesce(v_child.first_name || ' ' || v_child.last_name, ''),
      'audience', 'parent')
      || case when v_name_ar is null then '{}'::jsonb else jsonb_build_object('childNameAr', v_name_ar) end,
    new.created_by);
  return new;
end $$;

-- The rows already written on the demo tenant get the name too, so the
-- photographed bell reads the way tomorrow's will.
update public.kg_notifications n
   set data = n.data || jsonb_build_object('childNameAr', btrim(c.first_name_ar || ' ' || c.last_name_ar))
  from public.kg_children c
 where c.id = (n.data ->> 'childId')::uuid
   and n.data ? 'childName' and not (n.data ? 'childNameAr')
   and c.first_name_ar is not null and c.last_name_ar is not null;

notify pgrst, 'reload schema';
commit;
