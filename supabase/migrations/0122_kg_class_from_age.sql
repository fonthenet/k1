-- 0122 — the crèche bands its classes in months; nothing ever read the band.
--
-- kg_classes carries age_min_months/age_max_months, the enrolment form asks the
-- family for a date of birth, and the two were never joined. Every approval
-- therefore opened on "no class for now" and most were confirmed that way — and
-- a child with class_id null is absent from the attendance tabs, from the class
-- rosters and from every per-class report, silently, for the rest of the year.
--
-- Two halves, and the second is why this needs a migration at all:
--
--   1. the REVIEWER's proposal is computed in the app from the bands it already
--      loads (src/lib/class-fit.ts) — no schema needed;
--   2. the FAMILY should be able to say which room they are asking for, which
--      means the public form has to be told the bands exist, and the answer has
--      to survive to the review.
--
-- The proposal itself is never stored. A director who opens a preschool room in
-- January changes what is proposed for every pending application and every
-- unplaced child on the next render, with nothing to backfill and no snapshot
-- to go stale. Only the family's own answer is persisted, because that is a
-- fact about them rather than a derivation.

-- ── the family's requested room ──────────────────────────────────────────────
-- ON DELETE SET NULL: deleting a class must not block on old applications, and
-- a request for a room that no longer exists is simply no request.
alter table kg_applications
  add column if not exists class_id uuid references kg_classes(id) on delete set null;

comment on column kg_applications.class_id is
  'The class the FAMILY asked for on the enrolment form. A request, not a '
  'placement: the reviewer is shown it next to the age-based proposal and '
  'decides. kg_children.class_id is set at approval.';

-- ── the public form learns the rooms ─────────────────────────────────────────
-- Names and age bands only. Capacity and occupancy stay private: how full a
-- crèche is, is not something an anonymous link should publish.
create or replace function kg_get_enroll_link(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  select jsonb_build_object(
    'tenant_id', t.id, 'tenant_name', t.name, 'logo_url', t.logo_url,
    'wilaya', t.wilaya, 'commune', t.commune,
    'address', t.address, 'latitude', t.latitude, 'longitude', t.longitude,
    'link_id', l.id, 'label', l.label,
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
    ), '[]'::jsonb),
    -- Ordered by the band, so the form lists the rooms the way a crèche says
    -- them: youngest first. Unbanded classes fall to the end.
    'classes', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'name_ar', c.name_ar,
        'age_min_months', c.age_min_months, 'age_max_months', c.age_max_months)
        order by c.age_min_months nulls last, c.name)
      from kg_classes c where c.tenant_id = t.id
    ), '[]'::jsonb)
  ) into r
  from kg_enroll_links l join kg_tenants t on t.id = l.tenant_id
  where l.token = p_token and l.active
    and (l.expires_at is null or l.expires_at > now())
    and (l.max_uses is null or l.use_count < l.max_uses);
  if r is null then raise exception 'invalid_link'; end if;
  return r;
end $$;

-- ── the family's answer survives to the review ───────────────────────────────
-- The old six-argument signature is DROPPED rather than left beside the new
-- one. PostgREST resolves an RPC by the argument names in the body, and two
-- overloads that differ only by an argument with a default are ambiguous for
-- every call that omits it — the failure mode being that submission starts
-- returning PGRST203 for everyone, not just for the new field.
drop function if exists kg_submit_application(text, jsonb, jsonb, jsonb, jsonb, uuid);

create or replace function kg_submit_application(
  p_token text, p_child jsonb, p_guardians jsonb, p_health jsonb,
  p_activity_ids jsonb default '[]'::jsonb,
  p_fee_plan_id uuid default null,
  p_class_id uuid default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_link kg_enroll_links; v_app uuid; v_uid uuid := auth.uid(); v_ok boolean;
begin
  if v_uid is null then raise exception 'auth required'; end if;
  select * into v_link from kg_enroll_links
    where token = p_token and active
      and (expires_at is null or expires_at > now())
      and (max_uses is null or use_count < max_uses);
  if v_link.id is null then raise exception 'invalid_link'; end if;

  if p_fee_plan_id is not null then
    select exists (select 1 from kg_fee_plans
      where id = p_fee_plan_id and tenant_id = v_link.tenant_id
        and active and period = 'monthly') into v_ok;
    if not v_ok then p_fee_plan_id := null; end if;
  end if;

  -- Same treatment as the tariff: an id from another crèche, or one deleted
  -- between the form loading and the family pressing send, is dropped rather
  -- than raised. A rejected submission would cost the family the whole form;
  -- a missing preference costs the reviewer one dropdown.
  if p_class_id is not null then
    select exists (select 1 from kg_classes
      where id = p_class_id and tenant_id = v_link.tenant_id) into v_ok;
    if not v_ok then p_class_id := null; end if;
  end if;

  insert into kg_applications (tenant_id, link_id, applicant_user_id, child, guardians,
                               health, activity_ids, fee_plan_id, class_id)
    values (v_link.tenant_id, v_link.id, v_uid, p_child, p_guardians, p_health,
            p_activity_ids, p_fee_plan_id, p_class_id)
    returning id into v_app;
  update kg_enroll_links set use_count = use_count + 1 where id = v_link.id;
  insert into kg_profiles (id, full_name, phone)
    values (v_uid, coalesce(p_guardians->0->>'first_name','') || ' ' || coalesce(p_guardians->0->>'last_name',''), p_guardians->0->>'phone')
    on conflict (id) do update set phone = coalesce(excluded.phone, kg_profiles.phone);
  return v_app;
end $$;

-- Postgres grants EXECUTE to PUBLIC on a newly created function, and both
-- anon and authenticated inherit it. kg_get_enroll_link is deliberately public
-- (that is the point of an enrolment link); kg_submit_application must not be,
-- and its grant was lost the moment the function was dropped above.
revoke all on function kg_submit_application(text, jsonb, jsonb, jsonb, jsonb, uuid, uuid) from public, anon;
grant execute on function kg_submit_application(text, jsonb, jsonb, jsonb, jsonb, uuid, uuid) to authenticated;
