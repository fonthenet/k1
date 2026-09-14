-- 0162 — the calendar's hover cards read their counts in two round trips, not N.
--
-- /calendar fed two hover lines with one RPC per row: kg_event_rsvp_summary
-- for every event that asks an answer, kg_leave_conflicts for every leave of
-- the 42-day grid. A director's month with ten RSVP events and eight leaves
-- paid eighteen extra round trips on every render, in every view. kg_event_reach
-- was batched from the start (p_event_ids uuid[]) for exactly this reason;
-- these two are its siblings. The single-row functions stay: the dialog and
-- the leaves page still ask about one row at a time.
begin;
set local lock_timeout = '5s';

-- ── 1. RSVP answers for many events at once ────────────────────────────────
-- Same gate and same three numbers as kg_event_rsvp_summary (0159): the
-- tenant's educators read them, nobody else; `asked` resolves the recipients
-- now and leaves the staff out, NULL-safe. An event of another tenant in the
-- array is simply absent from the result.
create or replace function public.kg_event_rsvp_summaries(p_tenant uuid, p_event_ids uuid[])
returns table (event_id uuid, going int, not_going int, asked int)
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v_staff uuid[];
begin
  if p_tenant is null or not kg_is_educator(p_tenant) then return; end if;
  select coalesce(array_agg(u), '{}'::uuid[]) into v_staff from kg_staff_user_ids(p_tenant) u where u is not null;
  return query
    select e.id,
           (select count(*)::int from kg_event_responses r where r.event_id = e.id and r.response = 'going'),
           (select count(*)::int from kg_event_responses r where r.event_id = e.id and r.response = 'not_going'),
           (select count(*)::int from unnest(kg_event_recipients(e)) u where u is not null and u <> all (v_staff))
      from kg_events e
     where e.tenant_id = p_tenant and e.id = any(p_event_ids);
end $$;
revoke all on function public.kg_event_rsvp_summaries(uuid, uuid[]) from public, anon;
grant execute on function public.kg_event_rsvp_summaries(uuid, uuid[]) to authenticated;

-- ── 2. How many cours and suivis fall inside many leaves at once ───────────
-- Invoker like kg_leave_conflicts: the reader counts the lessons and sessions
-- their own RLS lets them see, over the leave's whole span (not the grid's
-- clipped part), so the hover's "8 cours pendant ce congé" matches the leaves
-- page. A leave the reader may not see (lr_sel) is absent from the result.
create or replace function public.kg_leave_conflict_counts(p_tenant uuid, p_leave_ids uuid[])
returns table (leave_id uuid, lessons int, sessions int)
language sql stable security invoker set search_path = pg_catalog, public as $$
  select l.id,
         (select count(*)::int from kg_learning_lessons x
           where x.tenant_id = p_tenant and x.membership_id = l.membership_id and x.status = 'scheduled'
             and (x.starts_at at time zone 'Africa/Algiers')::date between l.start_date and l.end_date),
         (select count(*)::int from kg_sessions s
           where s.tenant_id = p_tenant and s.therapist_id = l.membership_id and s.status = 'scheduled'
             and (s.scheduled_at at time zone 'Africa/Algiers')::date between l.start_date and l.end_date)
    from kg_leave_requests l
   where l.tenant_id = p_tenant and l.id = any(p_leave_ids)
$$;
revoke all on function public.kg_leave_conflict_counts(uuid, uuid[]) from public, anon;
grant execute on function public.kg_leave_conflict_counts(uuid, uuid[]) to authenticated;

-- ── 3. Rehearsal: the batch says what the singles say ──────────────────────
-- Dry run: keep the final `raise exception`. Apply: change it to `raise notice`.
-- Runs as the owner (every gate passes), on the demo tenant, and compares each
-- batched row with the single-row function it replaces on the page.
do $$
declare
  t uuid := '732bdf7d-775a-4ed7-875f-8c04ea4e4778';
  r record; s record; n int;
begin
  for r in select * from public.kg_event_rsvp_summaries(t, (select array_agg(id) from public.kg_events where tenant_id = t and rsvp)) loop
    select * into s from public.kg_event_rsvp_summary(r.event_id);
    if s.going is distinct from r.going or s.not_going is distinct from r.not_going or s.asked is distinct from r.asked then
      raise exception 'rsvp batch disagrees with the single for % (batch % % %, single % % %)',
        r.event_id, r.going, r.not_going, r.asked, s.going, s.not_going, s.asked;
    end if;
  end loop;
  for r in select * from public.kg_leave_conflict_counts(t, (select array_agg(id) from public.kg_leave_requests where tenant_id = t and status in ('approved', 'pending'))) loop
    select jsonb_array_length(j->'lessons') as lessons, jsonb_array_length(j->'sessions') as sessions into s
      from public.kg_leave_requests l
      cross join lateral public.kg_leave_conflicts(t, l.membership_id, l.start_date, l.end_date) j
     where l.id = r.leave_id;
    if s.lessons is distinct from r.lessons or s.sessions is distinct from r.sessions then
      raise exception 'leave batch disagrees with the single for % (batch % %, single % %)', r.leave_id, r.lessons, r.sessions, s.lessons, s.sessions;
    end if;
  end loop;
  select count(*) into n from public.kg_event_rsvp_summaries(t, array[gen_random_uuid()]);
  if n <> 0 then raise exception 'an unknown event id produced a row'; end if;
  raise exception '0162 rehearsal ok — rolled back';
end $$;
notify pgrst, 'reload schema';
commit;
