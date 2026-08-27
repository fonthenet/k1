-- 0057 — The two halves of enrolment finally meet in the middle.
--
-- Three structural gaps in the signup process, closed together because they are
-- one story:
--
-- (1) THE PARENT WAS NEVER ASKED WHICH SCHEDULE THEY WANT. kg_applications
--     stored the child, the guardians, the health record and the requested
--     activities — and not the one thing that decides the family's monthly
--     bill. Demi-journée and Temps plein are different services at different
--     prices, and the approval dialog asked STAFF to guess which one the
--     family meant. Now the enrolment form offers the tenant's monthly
--     tariffs, the application records the family's choice, and approval
--     pre-selects it — the reviewer confirms instead of deciding.
--
-- (2) A STATUS CHANGE TOLD THE FAMILY NOTHING. The only trigger on
--     kg_applications was AFTER INSERT, aimed at staff. Approved, rejected,
--     waitlisted, invited to interview — silence, in a product whose parents
--     are notified when their child's NAP is logged. The family learnt their
--     child's admission result by polling a list.
--
-- (3) These two feed the same moment: approval now knows the family's chosen
--     tariff AND tells them the outcome.

-- ── (1a) the application carries the family's requested tariff ────────────
alter table kg_applications
  add column if not exists fee_plan_id uuid references kg_fee_plans(id) on delete set null;

comment on column kg_applications.fee_plan_id is
  'The monthly tariff the FAMILY asked for on the enrolment form. Approval pre-selects it; staff can still override.';

-- ── (1b) the public enrolment page can show the tariffs ───────────────────
-- Same shape and same gate as the activities it already exposes: name and
-- price of active plans, keyed by a live link token, nothing else. Prices on
-- an enrolment page are not a leak — they are the first thing a family asks.
create or replace function kg_get_enroll_link(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  select jsonb_build_object(
    'tenant_id', t.id, 'tenant_name', t.name, 'logo_url', t.logo_url,
    'wilaya', t.wilaya, 'commune', t.commune, 'link_id', l.id, 'label', l.label,
    'activities', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'name_ar', a.name_ar,
        'category', a.category, 'fee_amount', a.fee_amount, 'fee_period', a.fee_period, 'description', a.description))
      from kg_activities a where a.tenant_id = t.id and a.active
    ), '[]'::jsonb),
    'fee_plans', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'name_ar', p.name_ar,
        'amount', p.amount, 'description', p.description) order by p.amount)
      from kg_fee_plans p where p.tenant_id = t.id and p.active and p.period = 'monthly'
    ), '[]'::jsonb),
    'admission_fees', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'name_ar', p.name_ar,
        'amount', p.amount) order by p.amount desc)
      from kg_fee_plans p where p.tenant_id = t.id and p.active and p.period = 'once' and p.amount > 0
    ), '[]'::jsonb)
  ) into r
  from kg_enroll_links l join kg_tenants t on t.id = l.tenant_id
  where l.token = p_token and l.active
    and (l.expires_at is null or l.expires_at > now())
    and (l.max_uses is null or l.use_count < l.max_uses);
  if r is null then raise exception 'invalid_link'; end if;
  return r;
end $$;

-- ── (1c) submission accepts the choice ────────────────────────────────────
-- Dropped, not replaced: CREATE OR REPLACE with a new parameter would create
-- an OVERLOAD beside the old signature, and PostgREST refuses ambiguous RPC
-- names (the 0028 lesson). The new default keeps every existing caller valid.
drop function if exists kg_submit_application(text, jsonb, jsonb, jsonb, jsonb);

create or replace function kg_submit_application(
  p_token text, p_child jsonb, p_guardians jsonb, p_health jsonb,
  p_activity_ids jsonb default '[]'::jsonb,
  p_fee_plan_id uuid default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_link kg_enroll_links; v_app uuid; v_uid uuid := auth.uid(); v_plan_ok boolean;
begin
  if v_uid is null then raise exception 'auth required'; end if;
  select * into v_link from kg_enroll_links
    where token = p_token and active
      and (expires_at is null or expires_at > now())
      and (max_uses is null or use_count < max_uses);
  if v_link.id is null then raise exception 'invalid_link'; end if;

  -- The chosen plan must be one this tenant actually offers on this form —
  -- a stray uuid from another crèche is dropped, not trusted.
  if p_fee_plan_id is not null then
    select exists (select 1 from kg_fee_plans
      where id = p_fee_plan_id and tenant_id = v_link.tenant_id
        and active and period = 'monthly') into v_plan_ok;
    if not v_plan_ok then p_fee_plan_id := null; end if;
  end if;

  insert into kg_applications (tenant_id, link_id, applicant_user_id, child, guardians, health, activity_ids, fee_plan_id)
    values (v_link.tenant_id, v_link.id, v_uid, p_child, p_guardians, p_health, p_activity_ids, p_fee_plan_id)
    returning id into v_app;
  update kg_enroll_links set use_count = use_count + 1 where id = v_link.id;
  insert into kg_profiles (id, full_name, phone)
    values (v_uid, coalesce(p_guardians->0->>'first_name','') || ' ' || coalesce(p_guardians->0->>'last_name',''), p_guardians->0->>'phone')
    on conflict (id) do update set phone = coalesce(excluded.phone, kg_profiles.phone);
  return v_app;
end $$;
revoke execute on function kg_submit_application(text, jsonb, jsonb, jsonb, jsonb, uuid) from anon;
grant execute on function kg_submit_application(text, jsonb, jsonb, jsonb, jsonb, uuid) to authenticated;

-- ── (2) the applicant hears every decision ────────────────────────────────
create or replace function kg_notify_application_status() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status is not distinct from old.status then return new; end if;
  if new.applicant_user_id is null then return new; end if;
  -- 'submitted' is the state they put it in themselves; announcing it back
  -- would be the product talking to hear its own voice.
  if new.status = 'submitted' then return new; end if;

  perform kg_notify(
    new.tenant_id, array[new.applicant_user_id], 'application_status',
    coalesce(new.child->>'first_name','') || ' ' || coalesce(new.child->>'last_name',''),
    -- review_note is the human sentence staff attached ("bring the carnet de
    -- santé"); worth carrying when present.
    nullif(left(coalesce(new.review_note, ''), 140), ''),
    jsonb_build_object(
      'applicationId', new.id,
      'childName', coalesce(new.child->>'first_name','') || ' ' || coalesce(new.child->>'last_name',''),
      'status', new.status::text,
      'interviewAt', new.interview_at,
      'audience', 'parent'),
    auth.uid());
  return new;
end $$;
drop trigger if exists trg_kg_notify_application_status on kg_applications;
create trigger trg_kg_notify_application_status after update of status on kg_applications
  for each row execute function kg_notify_application_status();
