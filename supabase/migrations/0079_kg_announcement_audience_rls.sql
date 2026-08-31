-- Announcements: let the database decide who may read one.
--
-- APPLIED 2026-08-30. Verified afterwards with a staff-only notice inserted
-- and rolled back: the parent saw `all` + `parents` only, the owner saw all
-- three including `staff`.
--
-- ---------------------------------------------------------------------------
-- What is wrong
-- ---------------------------------------------------------------------------
--
-- kg_announcements has an `audience` column — all / parents / staff / class —
-- and a `class_id`. Neither is in the read policy:
--
--     ann_sel  SELECT  USING (kg_is_member(tenant_id))
--
-- So the database hands EVERY announcement to every active member of the
-- tenant, parents included, whatever the audience says. Both clients then
-- filter in the page and hope. The web has always done that
-- ((portal)/portal/announcements/page.tsx:54-57); the phone was not doing it at
-- all until today, and the fix there is the same stopgap.
--
-- Nothing has leaked yet only because the crèche has not written a staff-only
-- notice: the two live rows are `all` and `parents`. The first one they write
-- goes to every family, and it will look like the app worked correctly.
--
-- A filter in the client is not a permission. Anyone with the publishable anon
-- key and a parent login can read the table directly.
--
-- ---------------------------------------------------------------------------
-- The fix
-- ---------------------------------------------------------------------------
--
-- Staff keep the full view — they are the audience for `staff`, and they write
-- the things. A parent gets exactly what the web already tries to show them:
-- `all`, `parents`, and `class` where the class is one of their own children's.
--
-- After this, the client-side filter in lib/portal.ts becomes belt-and-braces
-- rather than the only thing standing between a family and an internal notice.

begin;

drop policy if exists ann_sel on kg_announcements;

create policy ann_sel on kg_announcements for select
  using (
    kg_is_staff(tenant_id)
    or (
      kg_is_member(tenant_id)
      and (
        audience = 'all'
        or audience = 'parents'
        or (
          audience = 'class'
          and class_id is not null
          and exists (
            select 1
              from kg_children c
             where c.class_id = kg_announcements.class_id
               and kg_is_parent_of(c.id)
          )
        )
      )
    )
  );

commit;

-- ---------------------------------------------------------------------------
-- Check afterwards. As a parent, this must return only their own notices:
--
--   begin;
--   select set_config('request.jwt.claims',
--     json_build_object('sub','<a parent user_id>','role','authenticated')::text, true);
--   set local role authenticated;
--   select audience, count(*) from kg_announcements group by 1;
--   rollback;
--
-- And as staff it must still return every row.
-- ---------------------------------------------------------------------------
