-- The public enrolment page shows the crèche as itself.
--
-- Two things were missing for that. The welcome screen had a 🏫 emoji where
-- the establishment's own logo belongs, and its address was plain text, so a
-- parent on a phone had to retype it into a map to find the place.
--
-- ── (1) the logo bytes ──────────────────────────────────────────────────────
-- kg-media is private, and kg_storage_access denies a signed-out visitor every
-- path under t/{tenant}/. That is right for children's photos and wrong for a
-- logo: the enrolment link is public by design, kg_get_enroll_link already
-- hands its logo_url to anonymous callers, and the same logo is on the crèche's
-- door and on the poster they print from this app.
--
-- So: one folder, t/{tenant}/branding/, is readable by anyone. Uploads still
-- go through kg_media_insert (educator-only), and nothing else under the
-- tenant's prefix is touched — this is a read grant on a folder that holds
-- public branding by construction (see settings/actions.ts, which writes
-- exactly t/{tenant}/branding/logo.png).
drop policy if exists kg_media_branding_public on storage.objects;
create policy kg_media_branding_public on storage.objects for select
  using (
    bucket_id = 'kg-media'
    and (storage.foldername(name))[1] = 't'
    and (storage.foldername(name))[3] = 'branding'
  );

-- ── (2) enough location to open a map ──────────────────────────────────────
-- wilaya and commune name a town, not a place. The pin (0050) and the street
-- address are what turn the line into directions. Both are already shown to
-- parents in the portal; this exposes them on the public page too, which is
-- the same information a crèche puts on its own flyer.
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
    ), '[]'::jsonb)
  ) into r
  from kg_enroll_links l join kg_tenants t on t.id = l.tenant_id
  where l.token = p_token and l.active
    and (l.expires_at is null or l.expires_at > now())
    and (l.max_uses is null or l.use_count < l.max_uses);
  if r is null then raise exception 'invalid_link'; end if;
  return r;
end $$;
