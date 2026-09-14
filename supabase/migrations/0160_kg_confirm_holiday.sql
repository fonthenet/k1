-- 0160 — confirming a tentative date is one transaction.
--
-- confirmHoliday used to run three PostgREST calls: cancel the cours, cancel
-- the follow-ups, then write the announced dates on the holiday. Each call
-- is its own transaction, and the last one is the one that can be refused —
-- the announced date landing on a row the director had typed by hand raises
-- 23505 (tenant_id, date, name), the range check raises 23514 — so a refused
-- confirmation left eight cancelled cours and the families already told
-- "annulé" on a day that stayed open and tentative. Here the holiday row is
-- written FIRST, inside one function, so a refusal aborts before any cours is
-- touched, and a cours the database will not cancel rolls the confirmation
-- back with it. The row triggers of 0157 and 0159 fire unchanged: the
-- confirmed stamp, the closure notification, the session cancellation told to
-- each family.
--
-- SECURITY INVOKER: the director's own RLS decides what the function may
-- touch, exactly as the three separate calls did.
begin;
set local lock_timeout = '5s';

create or replace function public.kg_confirm_holiday(
  p_tenant uuid, p_id uuid, p_date date, p_end_date date, p_cancel_slots boolean
) returns void
language plpgsql security invoker set search_path = pg_catalog, public as $$
declare
  h public.kg_holidays%rowtype;
  v_impact jsonb;
begin
  if not public.kg_is_admin(p_tenant) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_end_date is not null and p_end_date < p_date then
    raise exception 'invalid_range' using errcode = '23514';
  end if;

  -- The holiday first: this is the write the database may refuse, and
  -- nothing below must survive its refusal. RETURNING keeps the row that
  -- was actually written (closure, structure) for the second step, and an
  -- id outside the tenant, or outside the director's RLS, finds nothing.
  update public.kg_holidays
     set date = p_date, end_date = p_end_date, tentative = false
   where id = p_id and tenant_id = p_tenant
   returning * into h;
  if not found then
    raise exception 'invalid_holiday' using errcode = '22023';
  end if;

  -- A feast the establishment works through closes nothing, so it cancels
  -- nothing, whatever the dialog sent: the checkbox is hidden for an open
  -- day, and this is the rule that holds when it is not.
  if not p_cancel_slots or not h.closure then
    return;
  end if;

  -- The same list the dialog printed before Save (0158): what is still ahead
  -- and still scheduled on the days that now shut.
  v_impact := public.kg_closure_impact(p_tenant, h.structure_id, h.date, coalesce(h.end_date, h.date));
  if v_impact is null then
    return;
  end if;

  update public.kg_learning_lessons l
     set status = 'cancelled'
   where l.tenant_id = p_tenant and l.status = 'scheduled'
     and l.id in (select (x->>'id')::uuid from jsonb_array_elements(coalesce(v_impact->'lessons', '[]'::jsonb)) x);

  -- trg_kg_sessions_touch bumps updated_at; the 0159 trigger tells the
  -- family on each row.
  update public.kg_sessions s
     set status = 'cancelled'
   where s.tenant_id = p_tenant and s.status = 'scheduled'
     and s.id in (select (x->>'id')::uuid from jsonb_array_elements(coalesce(v_impact->'sessions', '[]'::jsonb)) x);
end $$;
comment on function public.kg_confirm_holiday(uuid, uuid, date, date, boolean) is
  'Confirm a tentative holiday on its announced dates and, when asked and when the row is a closure, cancel the scheduled cours and follow-ups those days carry — one transaction, holiday first, so a refused date leaves nothing cancelled and a refused cancellation leaves the date tentative.';
revoke all on function public.kg_confirm_holiday(uuid, uuid, date, date, boolean) from public, anon;
grant execute on function public.kg_confirm_holiday(uuid, uuid, date, date, boolean) to authenticated;


-- ── Rehearsal, always rolled back ─────────────────────────────────────────
-- The block writes inside a sub-transaction it ends with its own exception,
-- so its rows never survive, dry run or apply: nothing to edit before
-- applying. pg_temp lives for this session only, as in 0158.
create or replace function pg_temp.as_user(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
do $$
declare
  t uuid := '732bdf7d-775a-4ed7-875f-8c04ea4e4778';
  u_owner uuid := 'd9485859-48e8-4aad-85e7-d09e1cd16f4d';
  v_h uuid;
  v_twin uuid;
  v_lesson uuid;
  v_class uuid;
  v_member uuid;
  -- A Wednesday five years out: no seed row, no closure, hours open.
  v_day date := '2031-03-12';
  n int;
begin
  if not exists (select 1 from public.kg_tenants where id = t) then
    raise notice '0160 rehearsal skipped: demo tenant absent'; return;
  end if;
  perform pg_temp.as_user(u_owner);
  begin
    -- a) a tentative closure
    insert into public.kg_holidays (tenant_id, date, name, tentative, closure, kind)
    values (t, v_day + 1, 'rehearsal feast', true, true, 'religious') returning id into v_h;

    -- b) a scheduled cours on the announced day, given by someone the class lists —
    --    inserted before the twin below shuts that day for the lesson guard
    select cs.class_id, cs.membership_id into v_class, v_member
      from public.kg_class_staff cs
      join public.kg_memberships m on m.id = cs.membership_id
      join public.kg_classes c on c.id = cs.class_id
     where m.tenant_id = t and m.status = 'active' and m.role in ('owner', 'admin', 'educator', 'staff')
       and c.tenant_id = t
       and (public.kg_structure_hours(c.structure_id, t) -> 'wed') is not null
       and (public.kg_structure_hours(c.structure_id, t) -> 'wed') <> 'null'::jsonb
     limit 1;
    if v_class is null then raise exception 'no staffed class open on wednesdays'; end if;
    insert into public.kg_learning_lessons (tenant_id, class_id, membership_id, kind, title, starts_at, ends_at, status)
    values (t, v_class, v_member, 'activity', 'rehearsal cours',
            (v_day::timestamp + time '09:30') at time zone 'Africa/Algiers',
            (v_day::timestamp + time '10:15') at time zone 'Africa/Algiers', 'scheduled')
    returning id into v_lesson;

    -- and a hand-typed twin on the announced date
    insert into public.kg_holidays (tenant_id, date, name, tentative, closure, kind)
    values (t, v_day, 'rehearsal feast', false, true, 'closure') returning id into v_twin;

    -- c) confirming onto the twin's date and name is refused, and the cours stays scheduled
    begin
      perform public.kg_confirm_holiday(t, v_h, v_day, null, true);
      raise exception 'the twin date was accepted';
    exception when unique_violation then
      null;
    end;
    select count(*) into n from public.kg_learning_lessons where id = v_lesson and status = 'scheduled';
    if n <> 1 then raise exception 'a refused confirmation cancelled the cours'; end if;
    if not exists (select 1 from public.kg_holidays where id = v_h and tentative) then
      raise exception 'a refused confirmation confirmed the row';
    end if;

    -- d) confirming onto a free date cancels the cours and stamps the row
    delete from public.kg_holidays where id = v_twin;
    perform public.kg_confirm_holiday(t, v_h, v_day, null, true);
    if not exists (select 1 from public.kg_holidays
                    where id = v_h and not tentative and confirmed_at is not null and date = v_day) then
      raise exception 'the confirmation did not land';
    end if;
    select count(*) into n from public.kg_learning_lessons where id = v_lesson and status = 'cancelled';
    if n <> 1 then raise exception 'the cours on the closed day was not cancelled'; end if;

    -- e) an open (non-closure) tentative row cancels nothing, even when asked
    -- The day opens again first: the lesson guard (0153) refuses a cours put
    -- back on a closed day.
    update public.kg_holidays set tentative = true, closure = false where id = v_h;
    update public.kg_learning_lessons set status = 'scheduled' where id = v_lesson;
    perform public.kg_confirm_holiday(t, v_h, v_day, null, true);
    select count(*) into n from public.kg_learning_lessons where id = v_lesson and status = 'scheduled';
    if n <> 1 then raise exception 'an open day cancelled a cours'; end if;

    raise exception using errcode = 'P0160', message = 'rehearsal done';
  exception when sqlstate 'P0160' then
    raise notice '0160 rehearsal ok — rolled back';
  end;
  execute 'reset role';
end $$;
notify pgrst, 'reload schema';
commit;
