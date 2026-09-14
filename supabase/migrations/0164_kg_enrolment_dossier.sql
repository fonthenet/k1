-- 0164 — the dossier d'inscription.
--
-- Décret exécutif 19-253 (JORA n° 58, 2019), cahier des charges Art. 6 §1: the
-- establishment keeps, per child, a demande manuscrite, a copy of the contrat
-- établissement–tuteur, an extrait de naissance, a copy of the carnet de santé,
-- two photos and a certificat médical. Private schools (MEN) ask for the
-- extrait n° 12, the carnet de vaccination, a certificat médical, photos, the
-- tuteur's CNI and a certificat de résidence. Until now kg_child_documents was
-- a bare shelf (doc_type, title, file_path) that only staff filled, nothing
-- said what SHOULD be on it, and a family had nowhere to hand a paper in.
--
-- This migration:
--   1. kg_document_requirements — what the establishment asks for, one list per
--      KIND of structure ('early' = crèche/jardin/…, 'school' = école privée),
--      seeded from the law, editable, each row optionally carrying a blank
--      form (PDF) the family downloads, fills, signs and photographs back.
--      Tenants that exist today receive the lists INACTIVE (nothing changes on
--      their screens until the director activates them); tenants born later
--      get them active through the structures trigger.
--   2. kg_child_documents becomes the register: a row may belong to an
--      APPLICATION before the child exists (nullable child_id +
--      application_id), answers a requirement, carries a review state, a
--      source, an expiry. One table, one move at approval.
--   3. Storage: a file is readable by whoever may read the register row that
--      names it (the photo_path precedent, generalised); the family writes its
--      child's photo and its own papers in its child's folder and nothing
--      else there (0023 let it write — and delete — the whole subtree); a
--      registered file's bytes belong to the register once the office has
--      looked at it; blank forms are readable by anyone, like the logo.
--   4. kg_attach_document (family and staff), kg_review_document (staff),
--      kg_dossier_status / kg_dossier_summary (what is in, what is missing),
--      kg_my_application (the family's own file, no pipeline stage).
--   5. The public link publishes the list; both submit RPCs take the files;
--      approval carries the rows over to the child.
--   6. Two notifications: a paper arrived (office), a paper was refused or
--      the file is complete (family).
--
-- Verified 2026-09-12 on qekibejzwpphzzyqigzo: kg_storage_access is the 0023
-- text; storage.objects.owner_id is set on every kg-media object; the portal
-- child photo lands at t/{tenant}/children/{child}/photo-{uuid}.jpg (folder
-- root); kg_child_documents has 0 rows on the demo tenant, no UPDATE policy,
-- no triggers, FKs kg_child_documents_{child_id,tenant_id,uploaded_by}_fkey;
-- kg_applications' only SELECT policy is kg_is_staff (0058) — an applicant
-- never sees the row, so every applicant test below goes through a
-- security-definer helper; kg_approve_application has no EXECUTE for
-- authenticated since 0063 (the rehearsal approves through kg_approve_and_bill);
-- the demo tenant runs nursery + kindergarten + private_primary, 47 enrolled
-- children, one active admission fee, and has no open application with an
-- applicant account (the rehearsal creates its own).
begin;
set local lock_timeout = '5s';

-- ── 0. Which list a structure follows ──────────────────────────────────────
-- Two lists, not ten: the ministries differ (Solidarité vs Éducation), the
-- papers differ (extrait n° 12, certificat de résidence), the rest of the
-- types file with the crèche.
create or replace function public.kg_center_kind(p_type public.kg_center_type) returns text
language sql immutable set search_path = pg_catalog, public as $$
  select case when p_type in ('private_primary','private_middle','private_secondary')
              then 'school' else 'early' end
$$;

-- ── 1. What the establishment asks for ─────────────────────────────────────
create table if not exists public.kg_document_requirements (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.kg_tenants(id) on delete cascade,
  kind           text not null check (kind in ('early','school')),
  key            text not null,                      -- slug; seeded rows share it across tenants, custom rows get custom-xxxxxxxx
  name           text not null,                      -- French
  name_ar        text,
  description    text,                               -- "visé par un pédiatre, de moins de trois mois"
  description_ar text,
  required       boolean not null default true,      -- false = "if you have it"
  applies_to     text not null default 'child' check (applies_to in ('child','guardian')),
  accepts        text not null default 'any' check (accepts in ('any','image','pdf')),
  form_path      text,                               -- t/{tenant}/forms/{id}.pdf — the blank form
  form_name      text,                               -- the PDF's original file name, shown to the family
  valid_months   integer check (valid_months is null or valid_months between 1 and 120),
  sort_order     integer not null default 0,
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (tenant_id, kind, key),
  constraint kg_document_requirements_form_in_tenant
    check (form_path is null or form_path like 't/' || tenant_id::text || '/forms/%')
);
comment on table public.kg_document_requirements is
  'The dossier d''inscription: what a family must hand in, per kind of structure (décret 19-253 Art. 6 §1 / MEN), editable per establishment.';
create index if not exists kg_document_requirements_tenant_idx
  on public.kg_document_requirements (tenant_id, kind, active, sort_order);
drop trigger if exists trg_kg_document_requirements_touch on public.kg_document_requirements;
create trigger trg_kg_document_requirements_touch before update on public.kg_document_requirements
  for each row execute function public.kg_touch_updated_at();

alter table public.kg_document_requirements enable row level security;
drop policy if exists dr_sel on public.kg_document_requirements;
drop policy if exists dr_ins on public.kg_document_requirements;
drop policy if exists dr_upd on public.kg_document_requirements;
drop policy if exists dr_del on public.kg_document_requirements;
-- Every member reads the list (a parent adding a sibling); the anonymous
-- wizard reads it through kg_get_enroll_link below; admins edit it.
create policy dr_sel on public.kg_document_requirements for select using (public.kg_is_member(tenant_id));
create policy dr_ins on public.kg_document_requirements for insert with check (public.kg_is_admin(tenant_id));
create policy dr_upd on public.kg_document_requirements for update
  using (public.kg_is_admin(tenant_id)) with check (public.kg_is_admin(tenant_id));
create policy dr_del on public.kg_document_requirements for delete using (public.kg_is_admin(tenant_id));

-- The two legal lists. French and Arabic are seeded; English falls back to
-- French in the UI (requirementName) — the papers are French-named documents
-- in Algeria, and a director can rename any row. Western digits only.
create or replace function public.kg_default_document_requirements(p_kind text)
returns table (key text, name text, name_ar text, description text, description_ar text,
               required boolean, applies_to text, accepts text, valid_months integer, sort_order integer)
language sql immutable set search_path = pg_catalog, public as $$
  select v.key, v.name, v.name_ar, v.description, v.description_ar, v.required, v.applies_to, v.accepts, v.valid_months, v.sort_order
  from (values
    -- crèche / jardin d'enfants / multi-accueil — décret 19-253 Art. 6 §1, then market practice
    ('early','handwritten_request',  'Demande d''inscription manuscrite',       'طلب تسجيل بخط اليد',            'Rédigée et signée par le tuteur légal.',                             'يحرره ويوقعه الولي.',                             true,  'child',    'any',   null, 10),
    ('early','contract',             'Contrat établissement – tuteur signé',    'عقد المؤسسة والولي موقّع',        'Copie signée du contrat, règlement intérieur joint.',               'نسخة موقعة من العقد، النظام الداخلي مرفق.',        true,  'child',    'any',   null, 20),
    ('early','birth_certificate',    'Extrait de naissance',                    'شهادة الميلاد',                  null,                                                                 null,                                              true,  'child',    'any',   null, 30),
    ('early','health_booklet',       'Copie du carnet de santé',                'نسخة من الدفتر الصحي',           'Pages d''identité et de vaccination.',                              'صفحات الهوية والتلقيح.',                          true,  'child',    'any',   null, 40),
    ('early','id_photos',            'Deux photos d''identité',                 'صورتان شمسيتان',                 'À remettre sur place ou à photographier.',                          'تُسلَّم في المؤسسة أو تُصوَّر.',                    true,  'child',    'image', null, 50),
    ('early','medical_certificate',  'Certificat médical',                      'شهادة طبية',                     'Visé par un pédiatre, de moins de trois mois.',                    'مؤشّرة من طبيب أطفال، أقل من ثلاثة أشهر.',         true,  'child',    'any',   12,   60),
    ('early','information_sheet',    'Fiche de renseignements',                 'استمارة المعلومات',              'Formulaire de l''établissement, rempli et signé.',                  'استمارة المؤسسة، معبأة وموقعة.',                  true,  'child',    'any',   null, 70),
    ('early','commitment_sheet',     'Fiche d''engagement signée',              'استمارة الالتزام موقّعة',         'Formulaire de l''établissement, rempli et signé.',                  'استمارة المؤسسة، معبأة وموقعة.',                  false, 'child',    'any',   null, 80),
    ('early','legalised_authorisation','Autorisation d''inscription légalisée (APC)','رخصة التسجيل مصادق عليها (البلدية)','À faire légaliser à la mairie avant de la joindre.',            'تُصادق عليها في البلدية قبل إرفاقها.',              false, 'child',    'any',   null, 90),
    -- école privée — dossier usuel (MEN)
    ('school','birth_certificate',   'Extrait de naissance n° 12',              'شهادة الميلاد رقم 12',           null,                                                                 null,                                              true,  'child',    'any',   null, 10),
    ('school','information_sheet',   'Fiche de renseignements',                 'استمارة المعلومات',              'Formulaire de l''établissement, rempli et signé.',                  'استمارة المؤسسة، معبأة وموقعة.',                  true,  'child',    'any',   null, 20),
    ('school','contract',            'Contrat établissement – tuteur signé',    'عقد المؤسسة والولي موقّع',        'Copie signée du contrat, règlement intérieur joint.',               'نسخة موقعة من العقد، النظام الداخلي مرفق.',        true,  'child',    'any',   null, 30),
    ('school','id_photos',           'Deux photos d''identité',                 'صورتان شمسيتان',                 'À remettre sur place ou à photographier.',                          'تُسلَّم في المؤسسة أو تُصوَّر.',                    true,  'child',    'image', null, 40),
    ('school','vaccination_record',  'Carnet de vaccination (page vaccins)',    'دفتر التلقيح (صفحة اللقاحات)',   null,                                                                 null,                                              true,  'child',    'any',   null, 50),
    ('school','medical_certificate', 'Certificat médical',                      'شهادة طبية',                     null,                                                                 null,                                              true,  'child',    'any',   12,   60),
    ('school','guardian_id',         'Copie de la pièce d''identité du tuteur', 'نسخة من بطاقة تعريف الولي',      null,                                                                 null,                                              true,  'guardian', 'any',   null, 70),
    ('school','residence_certificate','Certificat de résidence',                'شهادة الإقامة',                  null,                                                                 null,                                              true,  'guardian', 'any',   null, 80),
    ('school','school_certificate',  'Certificat de scolarité ou bulletins',    'شهادة مدرسية أو كشوف النقاط',    'En cas de transfert : dernier bulletin et certificat de radiation.', 'في حالة التحويل: آخر كشف نقاط وشهادة الشطب.',      false, 'child',    'any',   null, 90)
  ) as v(kind, key, name, name_ar, description, description_ar, required, applies_to, accepts, valid_months, sort_order)
  where v.kind = p_kind
$$;

-- Seed one kind for one tenant. Idempotent on (tenant_id, kind, key): a row
-- the director renamed is never touched. Two switches:
--   p_active   the `active` of the rows this call INSERTS (the trigger and an
--              admin want true; the rollout below wants false);
--   p_restore  also re-activate the seeded keys the director archived — this
--              is the settings button "Rétablir la liste réglementaire", the
--              one place an archived seeded row comes back on its own.
-- Returns inserted + re-activated. Callable by an admin, by a trigger (a
-- structure being born), or by a migration (no session).
drop function if exists public.kg_seed_document_requirements(uuid, text);
create or replace function public.kg_seed_document_requirements(
  p_tenant uuid, p_kind text, p_active boolean default true, p_restore boolean default false
) returns integer language plpgsql security definer set search_path = pg_catalog, public as $$
declare n int; m int := 0;
begin
  if p_kind not in ('early','school') then raise exception 'invalid_kind' using errcode = '22023'; end if;
  if not (auth.uid() is null or pg_trigger_depth() > 0 or public.kg_is_admin(p_tenant)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  with ins as (
    insert into public.kg_document_requirements
      (tenant_id, kind, key, name, name_ar, description, description_ar, required, applies_to, accepts, valid_months, sort_order, active)
    select p_tenant, p_kind, d.key, d.name, d.name_ar, d.description, d.description_ar, d.required, d.applies_to, d.accepts, d.valid_months, d.sort_order, p_active
      from public.kg_default_document_requirements(p_kind) d
    on conflict (tenant_id, kind, key) do nothing
    returning 1
  ) select count(*) into n from ins;
  if p_restore then
    with upd as (
      update public.kg_document_requirements q set active = true
       where q.tenant_id = p_tenant and q.kind = p_kind and not q.active
         and q.key in (select d.key from public.kg_default_document_requirements(p_kind) d)
      returning 1
    ) select count(*) into m from upd;
  end if;
  return n + m;
end $$;
revoke all on function public.kg_seed_document_requirements(uuid, text, boolean, boolean) from public, anon;
grant execute on function public.kg_seed_document_requirements(uuid, text, boolean, boolean) to authenticated;

-- A structure being born brings its list, ACTIVE: signup (kg_create_tenant
-- inserts one structure per type), Paramètres › Structures, the private-school
-- types of 0146 added to a crèche later. Same idiom as trg_kg_structures_enroll_link.
create or replace function public.kg_structure_seed_dossier() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  perform public.kg_seed_document_requirements(new.tenant_id, public.kg_center_kind(new.center_type), true, false);
  return new;
end $$;
revoke all on function public.kg_structure_seed_dossier() from public, anon, authenticated;
drop trigger if exists trg_kg_structures_seed_dossier on public.kg_structures;
create trigger trg_kg_structures_seed_dossier after insert on public.kg_structures
  for each row execute function public.kg_structure_seed_dossier();

-- Every existing tenant, once, for every kind it runs (its tenant type when
-- it has no structure yet) — INACTIVE. An establishment that already runs 47
-- children must not wake up to "Dossier 0 / 7" on every roster row, "Dossier à
-- compléter" on every parent's home and "Dossier incomplet" on every child:
-- the expected state renders nothing until the director opens
-- Paramètres › Dossier d'inscription and activates the list (a switch per
-- row, or "Rétablir la liste réglementaire" for the whole kind). While the
-- list is inactive nothing else changes: no wizard step, no column, no pill.
do $$
declare r record;
begin
  for r in
    select distinct t.id as tenant_id,
           public.kg_center_kind(coalesce(s.center_type, t.center_type, 'nursery')) as kind
      from public.kg_tenants t
      left join public.kg_structures s on s.tenant_id = t.id and s.active
  loop
    perform public.kg_seed_document_requirements(r.tenant_id, r.kind, false, false);
  end loop;
end $$;

-- ── 2. The shelf becomes the register ──────────────────────────────────────
do $$ begin
  create type public.kg_document_status as enum ('received','accepted','rejected');
exception when duplicate_object then null; end $$;

alter table public.kg_child_documents
  alter column child_id drop not null,
  add column if not exists application_id uuid references public.kg_applications(id) on delete cascade,
  add column if not exists requirement_id uuid,
  add column if not exists status         public.kg_document_status not null default 'received',
  add column if not exists source         text not null default 'staff' check (source in ('family','staff')),
  add column if not exists file_name      text,
  add column if not exists mime_type      text,
  add column if not exists size_bytes     integer check (size_bytes is null or size_bytes between 1 and 10485760),
  add column if not exists reviewed_by    uuid references auth.users(id) on delete set null,
  add column if not exists reviewed_at    timestamptz,
  add column if not exists review_note    text,
  add column if not exists expires_at     date;
-- "The LATEST row is the requirement's state" needs an order between two
-- rows written in ONE transaction — a submit whose draft names a requirement
-- twice, a staff scan that replaces a paper in the same request, the
-- rehearsal below. now() is frozen at the transaction start, so two such rows
-- tie and the state is whichever the planner happened to read first;
-- clock_timestamp() is the moment of the insert itself.
alter table public.kg_child_documents alter column created_at set default clock_timestamp();
-- A requirement that received papers cannot be deleted: the settings action
-- gets 23503 and tells the director to deactivate it instead. "set null" would
-- silently turn forty answers into "Autres pièces".
alter table public.kg_child_documents drop constraint if exists kg_child_documents_requirement_id_fkey;
alter table public.kg_child_documents add constraint kg_child_documents_requirement_id_fkey
  foreign key (requirement_id) references public.kg_document_requirements(id) on delete restrict;
-- The uploader may vanish (a throwaway applicant deleted after a test, an
-- account closed); the paper stays, the register forgets who handed it in.
alter table public.kg_child_documents drop constraint if exists kg_child_documents_uploaded_by_fkey;
alter table public.kg_child_documents add constraint kg_child_documents_uploaded_by_fkey
  foreign key (uploaded_by) references auth.users(id) on delete set null;
-- Rows written before this migration were staff uploads on a child: accepted by construction.
update public.kg_child_documents set status = 'accepted', source = 'staff'
 where reviewed_at is null and status = 'received' and child_id is not null;
alter table public.kg_child_documents drop constraint if exists kg_child_documents_owner;
alter table public.kg_child_documents add constraint kg_child_documents_owner
  check (child_id is not null or application_id is not null);
-- One row per file: kg_storage_access looks a path up here. Say which path
-- collides instead of failing on the index (0 rows on the demo tenant; the
-- lead runs the same SELECT on the whole table before applying).
do $$
declare v_dup text;
begin
  select file_path into v_dup from public.kg_child_documents group by file_path having count(*) > 1 limit 1;
  if v_dup is not null then
    raise exception '0164: kg_child_documents.file_path is not unique (e.g. %) — resolve the duplicates before the register can key on it', v_dup;
  end if;
end $$;
create unique index if not exists kg_child_documents_file_path_key on public.kg_child_documents (file_path);
create index if not exists kg_child_documents_application_idx
  on public.kg_child_documents (application_id, requirement_id, created_at desc) where application_id is not null;
create index if not exists kg_child_documents_child_req_idx
  on public.kg_child_documents (child_id, requirement_id, created_at desc) where child_id is not null;
comment on column public.kg_child_documents.status is
  'received = handed in, not yet checked; accepted; rejected (review_note says why). "missing" and "expired" are derived, never stored.';

-- kg_applications is staff-only for SELECT (0058), and a policy's subquery
-- runs under the caller's own RLS — so "is this my application?" must be
-- answered by a definer, exactly as kg_is_parent_of answers "is this my
-- child?". Left PUBLIC-executable like kg_is_parent_of: it only ever speaks
-- about the caller.
create or replace function public.kg_is_applicant_of(a uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select exists (select 1 from public.kg_applications x where x.id = a and x.applicant_user_id = auth.uid())
$$;

drop policy if exists cd_sel on public.kg_child_documents;
drop policy if exists cd_ins on public.kg_child_documents;
drop policy if exists cd_upd on public.kg_child_documents;
drop policy if exists cd_del on public.kg_child_documents;
create policy cd_sel on public.kg_child_documents for select using (
  public.kg_is_staff(tenant_id)
  or (child_id is not null and public.kg_is_parent_of(child_id))
  or (application_id is not null and public.kg_is_applicant_of(application_id))
);
-- Staff insert directly (server action: paper handed at the gate). The family
-- never inserts through the table — kg_attach_document checks the file is
-- really theirs first. The row is a READ GRANT on the file it names
-- (kg_storage_access below trusts the register before the path), so what a
-- staff row may name is pinned: the subject's own folder in the row's own
-- tenant, and a subject that really lives in that tenant. Without this an
-- educator could register any path — another tenant's photo, another
-- family's paper under u/ — and mint a signed URL for it, and the child's
-- parents would inherit the same read. kg_attach_document is a definer and
-- bypasses this policy: the family's u/ rows are its business.
create policy cd_ins on public.kg_child_documents for insert with check (
  public.kg_is_educator(tenant_id) and source = 'staff'
  and ((child_id is not null
        and file_path like 't/' || tenant_id::text || '/children/' || child_id::text || '/%'
        and exists (select 1 from public.kg_children c where c.id = child_id and c.tenant_id = kg_child_documents.tenant_id))
       or (child_id is null and application_id is not null
        and file_path like 't/' || tenant_id::text || '/applications/' || application_id::text || '/%'
        and exists (select 1 from public.kg_applications a where a.id = application_id and a.tenant_id = kg_child_documents.tenant_id)))
);
-- No UPDATE from the API at all: the one legitimate change to a row is the
-- review, and kg_review_document below is a definer that checks the educator
-- itself; kg_approve_application (definer) binds rows to the child. A table
-- UPDATE would let an educator re-point file_path at a foreign object, or
-- turn a reviewed paper back to 'received' behind the trigger's back.
revoke update on public.kg_child_documents from anon, authenticated;
-- An admin may purge; a family may withdraw its own paper while nobody has
-- looked at it. A refused paper is never deleted by the family: the register
-- keeps the refusal, the family sends a new one.
create policy cd_del on public.kg_child_documents for delete using (
  public.kg_is_admin(tenant_id)
  or (uploaded_by = auth.uid() and source = 'family' and status = 'received')
);

-- ── 3. Storage ──────────────────────────────────────────────────────────────
-- Path conventions (+ = new in 0164):
--   u/{uid}/enroll/{uuid}.jpg                   wizard photo (unchanged); owner r/w
-- + u/{uid}/enroll/docs/{uuid}.{jpg|pdf}        wizard and add-child papers; owner r/w until registered and reviewed
--   t/{tenant}/children/{child}/photo-*.jpg     the child's photo (portal and office); family writes it
-- + t/{tenant}/children/{child}/documents/…     papers on an enrolled child; staff and family write
--   t/{tenant}/children/{child}/docs/…          pre-0164 staff scans; staff only (P5 writes documents/ from now on)
-- + t/{tenant}/applications/{app}/documents/…   papers staff add on a pending file; educator write
-- + t/{tenant}/forms/{requirement}.pdf          blank forms; public read (policy below), educator write
--   t/{tenant}/guardians/{guardian}/…             unchanged (0021)
--   everything else under t/                     educator write, staff read (unchanged)
-- READ RULE, first and for every path: whoever may read the register row
-- that names a file may read the file. This is the photo_path precedent of
-- 0023, generalised: the bytes never move, the row moves.
create or replace function public.kg_storage_access(p_path text, p_write boolean)
returns boolean language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare parts text[]; v_tenant uuid; v_child uuid; v_guardian uuid; n int;
begin
  parts := string_to_array(p_path, '/');
  n := coalesce(array_length(parts, 1), 0);
  if n < 2 then return false; end if;

  if not p_write then
    if exists (
      select 1 from public.kg_child_documents d
       where d.file_path = p_path
         and (public.kg_is_staff(d.tenant_id)
              or (d.child_id is not null and public.kg_is_parent_of(d.child_id))
              or (d.application_id is not null and public.kg_is_applicant_of(d.application_id)))
    ) then return true; end if;
  end if;

  if parts[1] = 'u' then
    if parts[2] = auth.uid()::text then return true; end if;
    if not p_write then
      return exists (
        select 1 from public.kg_applications a
         where a.child->>'photo_path' = p_path and public.kg_is_staff(a.tenant_id));
    end if;
    return false;
  end if;

  if parts[1] = 't' then
    begin
      v_tenant := parts[2]::uuid;
    exception when others then return false; end;

    if n >= 4 and parts[3] = 'guardians' then
      begin
        v_guardian := parts[4]::uuid;
      exception when others then return false; end;
      if public.kg_is_staff(v_tenant) then return true; end if;
      return exists (
        select 1 from public.kg_guardians g
         where g.id = v_guardian and g.tenant_id = v_tenant and g.user_id = auth.uid());
    end if;

    if n >= 4 and parts[3] = 'children' then
      begin
        v_child := parts[4]::uuid;
      exception when others then return false; end;
      if public.kg_is_staff(v_tenant) then return true; end if;
      if not public.kg_is_parent_of(v_child) then return false; end if;
      -- A parent's rights follow the child, not the path: the child must live
      -- in the tenant whose folder this is (0023 never checked, so a parent
      -- could write under another tenant's folder with their own child's id).
      if not exists (select 1 from public.kg_children c where c.id = v_child and c.tenant_id = v_tenant) then
        return false;
      end if;
      if not p_write then return true; end if;
      -- The family writes its child's photo (portal idiom: photo-{uuid}.jpg at
      -- the folder root, kg_set_child_photo accepts it) and its own papers
      -- under /documents/. Nothing else in the folder — 0023 let it write,
      -- overwrite and delete everything there, staff scans included.
      return (n = 5 and parts[5] like 'photo-%')
          or (n >= 6 and parts[5] = 'documents');
    end if;

    if p_write then return public.kg_is_educator(v_tenant); end if;
    return public.kg_is_staff(v_tenant);
  end if;
  return false;
end $$;

-- Update and delete additionally need ownership (or an educator's hands) —
-- and a REGISTERED file belongs to the register, not to its uploader: once
-- the office has looked at it (accepted, rejected), or when the office put
-- it there, only an educator may replace or remove the bytes; the family may
-- still withdraw its own paper while it is merely 'received' (mirrors
-- cd_del). Storage sets owner_id on every upload — verified on every prod
-- object — so the unregistered case is a column test, not a lookup. The
-- register is consulted FIRST, before the path rules: a family paper lives
-- under u/{uid}/, where the path rules know only its uploader, and the
-- office must still be able to remove its bytes when it retires the row
-- (D5: a registered file is the register's). Left PUBLIC-executable like
-- kg_storage_access: a policy evaluated as anon must be able to call it.
create or replace function public.kg_storage_may_alter(p_path text, p_owner_id text)
returns boolean language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare parts text[]; v_tenant uuid; d record;
begin
  select x.tenant_id, x.source, x.status, x.uploaded_by into d
    from public.kg_child_documents x where x.file_path = p_path;
  if found then
    if public.kg_is_educator(d.tenant_id) then return true; end if;
    return d.source = 'family' and d.status = 'received'
       and d.uploaded_by = auth.uid() and p_owner_id = auth.uid()::text
       and public.kg_storage_access(p_path, true);
  end if;
  if not public.kg_storage_access(p_path, true) then return false; end if;
  if p_owner_id is not null and p_owner_id = auth.uid()::text then return true; end if;
  parts := string_to_array(p_path, '/');
  if parts[1] <> 't' then return false; end if;
  begin v_tenant := parts[2]::uuid; exception when others then return false; end;
  return public.kg_is_educator(v_tenant);
end $$;
drop policy if exists kg_media_update on storage.objects;
drop policy if exists kg_media_delete on storage.objects;
create policy kg_media_update on storage.objects for update
  using (bucket_id = 'kg-media' and public.kg_storage_may_alter(name, owner_id))
  with check (bucket_id = 'kg-media' and public.kg_storage_may_alter(name, owner_id));
create policy kg_media_delete on storage.objects for delete
  using (bucket_id = 'kg-media' and public.kg_storage_may_alter(name, owner_id));

-- Blank forms carry no personal data: readable by anyone, exactly like the
-- logo (0059). Uploads stay educator-only through kg_media_insert.
drop policy if exists kg_media_branding_public on storage.objects;
create policy kg_media_branding_public on storage.objects for select
  using (
    bucket_id = 'kg-media'
    and (storage.foldername(name))[1] = 't'
    and (storage.foldername(name))[3] in ('branding', 'forms')
  );

-- ── 4. The family (or the office) attaches a paper ─────────────────────────
-- One write for both wizards and the portal. The file must exist, be the
-- caller's own upload, sit where the caller may write; the row it hangs on
-- must be the caller's application or the caller's child (or any, for an
-- educator). Mime and size come from Storage's metadata, never from the
-- client. A second file on the same requirement is a new row: the latest
-- row is the requirement's state, the older ones are history — but the
-- family only ever answers a line that asks for a paper: nothing yet,
-- refused, expired. While a paper is 'received' or accepted the line is the
-- office's (D5: an accepted paper is not swapped under the register's nose;
-- a received one is withdrawn or its bytes replaced, never doubled), so a
-- second family row there is refused as 42501 — the same states the family
-- list renders no "Ajouter" for. The requirement must also be of the
-- subject's KIND: a school paper on a crèche child would appear on no
-- screen, yet notify the office and lock the requirement behind the FK. A
-- closed application (approved: the child's page took over; rejected: the
-- file is read-only) takes nothing more.
create or replace function public.kg_attach_document(
  p_tenant uuid, p_requirement uuid, p_path text,
  p_child uuid default null, p_application uuid default null, p_file_name text default null
) returns uuid language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_uid uuid := auth.uid(); v_req public.kg_document_requirements; v_obj record; v_id uuid;
        v_mime text; v_size int; v_educator boolean; v_kind text; v_last record;
begin
  if v_uid is null then raise exception 'auth required' using errcode = '42501'; end if;
  if (p_child is null) = (p_application is null) then
    raise exception 'one_of_child_or_application' using errcode = '22023';
  end if;
  select * into v_req from public.kg_document_requirements
   where id = p_requirement and tenant_id = p_tenant and active;
  if v_req.id is null then raise exception 'invalid_requirement' using errcode = '22023'; end if;
  v_educator := public.kg_is_educator(p_tenant);

  if p_child is not null then
    if not (v_educator or public.kg_is_parent_of(p_child)) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    select public.kg_center_kind(coalesce(s.center_type, t.center_type, 'nursery')) into v_kind
      from public.kg_children c
      join public.kg_tenants t on t.id = c.tenant_id
      left join public.kg_structures s on s.id = c.structure_id
     where c.id = p_child and c.tenant_id = p_tenant;
    if v_kind is null then raise exception 'invalid_child' using errcode = '22023'; end if;
  else
    if not exists (select 1 from public.kg_applications a
                    where a.id = p_application and a.tenant_id = p_tenant
                      and a.status not in ('approved', 'rejected')
                      and (a.applicant_user_id = v_uid or v_educator)) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    select public.kg_center_kind(coalesce(s.center_type, t.center_type, 'nursery')) into v_kind
      from public.kg_applications a
      join public.kg_tenants t on t.id = a.tenant_id
      left join public.kg_structures s on s.id = a.structure_id
     where a.id = p_application;
  end if;
  -- the same kind kg_dossier_status will file the row under, or it is invisible
  if v_req.kind <> v_kind then raise exception 'invalid_requirement' using errcode = '22023'; end if;

  if not v_educator then
    select d.status, d.expires_at into v_last from public.kg_child_documents d
     where d.requirement_id = v_req.id
       and ((p_child is not null and d.child_id = p_child)
            or (p_application is not null and d.application_id = p_application))
     order by d.created_at desc limit 1;
    if found and (v_last.status = 'received'
                  or (v_last.status = 'accepted'
                      and (v_last.expires_at is null or v_last.expires_at >= public.kg_today()))) then
      raise exception 'already_on_file' using errcode = '42501';
    end if;
  end if;

  select o.owner_id, o.metadata into v_obj from storage.objects o
   where o.bucket_id = 'kg-media' and o.name = p_path;
  if not found or v_obj.owner_id is distinct from v_uid::text then
    raise exception 'invalid_path' using errcode = '22023';
  end if;
  if not public.kg_storage_access(p_path, true) then
    raise exception 'invalid_path' using errcode = '22023';
  end if;
  if p_child is not null
     and p_path not like ('t/' || p_tenant::text || '/children/' || p_child::text || '/documents/%')
     and p_path not like ('u/' || v_uid::text || '/%') then
    raise exception 'invalid_path' using errcode = '22023';
  end if;
  if p_application is not null
     and p_path not like ('t/' || p_tenant::text || '/applications/' || p_application::text || '/documents/%')
     and p_path not like ('u/' || v_uid::text || '/%') then
    raise exception 'invalid_path' using errcode = '22023';
  end if;
  v_mime := coalesce(v_obj.metadata->>'mimetype', '');
  v_size := nullif(v_obj.metadata->>'size', '')::int;
  -- An empty object (a camera that failed mid-write) is not a paper: say so
  -- as 'invalid' here rather than let the size CHECK abort the caller.
  if v_size is not null and (v_size < 1 or v_size > 10485760) then raise exception 'invalid_size' using errcode = '22023'; end if;
  if v_req.accepts = 'pdf'   and v_mime <> 'application/pdf' then raise exception 'invalid_type' using errcode = '22023'; end if;
  if v_req.accepts = 'image' and v_mime not like 'image/%'    then raise exception 'invalid_type' using errcode = '22023'; end if;

  insert into public.kg_child_documents
    (tenant_id, child_id, application_id, requirement_id, doc_type, title, file_path, uploaded_by,
     status, source, file_name, mime_type, size_bytes)
  values (p_tenant, p_child, p_application, v_req.id, v_req.key, v_req.name, p_path, v_uid,
     'received', case when v_educator then 'staff' else 'family' end,
     left(coalesce(nullif(btrim(p_file_name), ''), split_part(p_path, '/', array_length(string_to_array(p_path, '/'), 1))), 120),
     nullif(v_mime, ''), v_size)
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.kg_attach_document(uuid, uuid, text, uuid, uuid, text) from public, anon;
grant execute on function public.kg_attach_document(uuid, uuid, text, uuid, uuid, text) to authenticated;

-- ── 5. The office reviews ───────────────────────────────────────────────────
-- The only way a row changes after it is written (UPDATE is revoked from the
-- API above), so this is a definer that does the educator check itself. A
-- review is a verdict: accepted or rejected. 'received' is the state a paper
-- is BORN in, never one it goes back to — the trigger would not even tell
-- the family, and an accepted paper would silently read "à vérifier" again.
create or replace function public.kg_review_document(p_doc uuid, p_status public.kg_document_status, p_note text default null)
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
declare d public.kg_child_documents; v_months int;
begin
  if auth.uid() is null then raise exception 'auth required' using errcode = '42501'; end if;
  select * into d from public.kg_child_documents where id = p_doc;
  if d.id is null then raise exception 'not_found' using errcode = '22023'; end if;
  if not public.kg_is_educator(d.tenant_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_status not in ('accepted', 'rejected') then raise exception 'invalid_status' using errcode = '22023'; end if;
  if p_status = 'rejected' and coalesce(btrim(p_note), '') = '' then
    raise exception 'note_required' using errcode = '23514';                 -- the family must learn why
  end if;
  select valid_months into v_months from public.kg_document_requirements where id = d.requirement_id;
  update public.kg_child_documents
     set status = p_status, reviewed_by = auth.uid(), reviewed_at = now(),
         review_note = nullif(btrim(p_note), ''),
         expires_at = case when p_status = 'accepted' and v_months is not null
                           then (public.kg_today() + make_interval(months => v_months))::date end
   where id = p_doc;
end $$;
revoke all on function public.kg_review_document(uuid, public.kg_document_status, text) from public, anon;
grant execute on function public.kg_review_document(uuid, public.kg_document_status, text) to authenticated;

-- ── 6. What is in, what is missing ──────────────────────────────────────────
-- The requirement's state is its LATEST row: none → missing; received;
-- rejected; accepted past expires_at → expired; accepted. Expiry is read,
-- never written: no cron, no fourth enum value. Runs under the caller's RLS,
-- so a parent only ever computes their own children — and, kg_applications
-- being staff-only, kg_dossier_status(null, app) is STAFF-ONLY: an applicant
-- gets null and goes through kg_my_application / kg_my_applications below.
-- A requirement the director archived keeps its papers on screen: it stays a
-- line (active = false) as long as the subject has a row on it, but it is
-- not COUNTED — required, accepted, missing, complete and todo only look at
-- active required lines, the same set kg_dossier_summary scores.
create or replace function public.kg_dossier_status(p_child uuid default null, p_application uuid default null)
returns jsonb language plpgsql stable security invoker set search_path = pg_catalog, public as $$
declare v_tenant uuid; v_kind text; r jsonb;
begin
  if p_child is not null then
    select c.tenant_id, public.kg_center_kind(coalesce(s.center_type, t.center_type, 'nursery'))
      into v_tenant, v_kind
      from public.kg_children c
      join public.kg_tenants t on t.id = c.tenant_id
      left join public.kg_structures s on s.id = c.structure_id
     where c.id = p_child;
  elsif p_application is not null then
    select a.tenant_id, public.kg_center_kind(coalesce(s.center_type, t.center_type, 'nursery'))
      into v_tenant, v_kind
      from public.kg_applications a
      join public.kg_tenants t on t.id = a.tenant_id
      left join public.kg_structures s on s.id = a.structure_id
     where a.id = p_application;
  end if;
  if v_tenant is null then return null; end if;

  with mine as (
    select d.* from public.kg_child_documents d
     where d.requirement_id is not null
       and ((p_child is not null and d.child_id = p_child)
            or (p_application is not null and d.application_id = p_application))
  ), req as (
    select q.* from public.kg_document_requirements q
     where q.tenant_id = v_tenant and q.kind = v_kind
       and (q.active or exists (select 1 from mine m where m.requirement_id = q.id))
  ), latest as (
    select distinct on (m.requirement_id) m.*
      from mine m
     order by m.requirement_id, m.created_at desc
  ), line as (
    select req.id, req.key, req.name, req.name_ar, req.description, req.description_ar,
           req.required, req.applies_to, req.accepts, req.form_path, req.form_name, req.valid_months, req.sort_order,
           req.active, (req.required and req.active) as counted,
           case when l.id is null then 'missing'
                when l.status = 'received' then 'received'
                when l.status = 'rejected' then 'rejected'
                when l.expires_at is not null and l.expires_at < public.kg_today() then 'expired'
                else 'accepted' end as state,
           case when l.id is null then null else jsonb_build_object(
             'id', l.id, 'file_path', l.file_path, 'file_name', l.file_name, 'mime_type', l.mime_type,
             'status', l.status, 'source', l.source, 'review_note', l.review_note,
             'reviewed_at', l.reviewed_at, 'expires_at', l.expires_at, 'created_at', l.created_at,
             'uploaded_by', l.uploaded_by) end as document
      from req left join latest l on l.requirement_id = req.id
  ), extra as (
    select d.id, d.title, d.doc_type, d.file_path, d.file_name, d.status, d.created_at
      from public.kg_child_documents d
     where d.requirement_id is null
       and ((p_child is not null and d.child_id = p_child)
            or (p_application is not null and d.application_id = p_application))
  )
  select jsonb_build_object(
    'kind', v_kind,
    'required', count(*) filter (where counted),
    'accepted', count(*) filter (where counted and state = 'accepted'),
    'pending',  count(*) filter (where active and state = 'received'),
    'missing',  count(*) filter (where counted and state in ('missing','rejected','expired')),
    'complete', coalesce(bool_and(not counted or state = 'accepted'), true),
    'todo', coalesce(jsonb_agg(jsonb_build_object('id', id, 'key', key, 'name', name, 'name_ar', name_ar, 'state', state) order by sort_order)
                     filter (where counted and state in ('missing','rejected','expired')), '[]'::jsonb),
    'lines', coalesce(jsonb_agg(jsonb_build_object(
               'id', id, 'key', key, 'name', name, 'name_ar', name_ar,
               'description', description, 'description_ar', description_ar,
               'required', required, 'applies_to', applies_to, 'accepts', accepts,
               'form_path', form_path, 'form_name', form_name, 'valid_months', valid_months,
               'active', active, 'state', state, 'document', document) order by active desc, sort_order), '[]'::jsonb),
    'extra', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'doc_type', e.doc_type,
               'file_path', e.file_path, 'file_name', e.file_name, 'status', e.status, 'created_at', e.created_at)
               order by e.created_at desc) from extra e), '[]'::jsonb)
  ) into r from line;
  return r;
end $$;
revoke all on function public.kg_dossier_status(uuid, uuid) from public, anon;
grant execute on function public.kg_dossier_status(uuid, uuid) to authenticated;

-- The roster and the applications board: one grouped query for every child
-- and every open application of the tenant. As a parent, RLS narrows it to
-- their own children (the portal home reuses it). Only ACTIVE REQUIRED
-- requirements are scored — the set kg_dossier_status counts.
create or replace function public.kg_dossier_summary(p_tenant uuid)
returns table (child_id uuid, application_id uuid, required integer, accepted integer, pending integer, missing integer)
language sql stable security invoker set search_path = pg_catalog, public as $$
  with subject as (
    select c.id as child_id, null::uuid as application_id, c.tenant_id,
           public.kg_center_kind(coalesce(s.center_type, t.center_type, 'nursery')) as kind
      from public.kg_children c
      join public.kg_tenants t on t.id = c.tenant_id
      left join public.kg_structures s on s.id = c.structure_id
     where c.tenant_id = p_tenant
    union all
    select null::uuid, a.id, a.tenant_id,
           public.kg_center_kind(coalesce(s.center_type, t.center_type, 'nursery'))
      from public.kg_applications a
      join public.kg_tenants t on t.id = a.tenant_id
      left join public.kg_structures s on s.id = a.structure_id
     where a.tenant_id = p_tenant and a.status not in ('approved','rejected')
  ), req as (
    select sub.child_id, sub.application_id, coalesce(sub.child_id, sub.application_id) as subject_id, q.id as requirement_id
      from subject sub
      join public.kg_document_requirements q
        on q.tenant_id = sub.tenant_id and q.active and q.required and q.kind = sub.kind
  ), latest as (
    select distinct on (coalesce(d.child_id, d.application_id), d.requirement_id)
           coalesce(d.child_id, d.application_id) as subject_id, d.requirement_id, d.status, d.expires_at
      from public.kg_child_documents d
     where d.tenant_id = p_tenant and d.requirement_id is not null
     order by coalesce(d.child_id, d.application_id), d.requirement_id, d.created_at desc
  ), scored as (
    select req.child_id, req.application_id,
           (l.status = 'accepted' and (l.expires_at is null or l.expires_at >= public.kg_today())) as ok,
           (l.status = 'received') as pending
      from req left join latest l on l.subject_id = req.subject_id and l.requirement_id = req.requirement_id
  )
  select child_id, application_id,
         count(*)::int,
         count(*) filter (where ok)::int,
         count(*) filter (where pending)::int,
         count(*) filter (where not coalesce(ok, false) and not coalesce(pending, false))::int
    from scored
   group by child_id, application_id
$$;
revoke all on function public.kg_dossier_summary(uuid) from public, anon;
grant execute on function public.kg_dossier_summary(uuid) to authenticated;

-- ── 7. The family's own pending file ────────────────────────────────────────
-- kg_applications is staff-only since 0058 and stays so. This hands the
-- applicant back their OWN words (child, guardians, health, structure) plus
-- the dossier — never a pipeline stage, never a reviewer, never a note. It
-- feeds /enroll/dossier/{id} (complete a paper, replace a refused one) and
-- its printable fiche de renseignements. An APPROVED file answers only
-- {approved: true, child_id}: approval created the child and gave the
-- applicant a membership, so the page sends them to the child's portal page
-- — the good news, as kg_my_applications has it since 0058 — and the
-- dossier lives on there.
create or replace function public.kg_my_application(p_id uuid)
returns jsonb language sql stable security definer set search_path = pg_catalog, public as $$
  select case when a.status = 'approved' then
    jsonb_build_object('id', a.id, 'approved', true, 'child_id', a.created_child_id)
  else
    jsonb_build_object(
      'id', a.id, 'approved', false, 'tenant_id', a.tenant_id, 'tenant_name', t.name,
      'tenant_address', t.address, 'tenant_commune', t.commune, 'tenant_wilaya', t.wilaya,
      'tenant_phone', t.phone, 'tenant_logo_url', t.logo_url,
      'child', a.child, 'guardians', a.guardians, 'health', a.health,
      'structure_id', a.structure_id,
      'structure_name', s.name, 'structure_name_ar', s.name_ar,
      'class_name', c.name, 'class_name_ar', c.name_ar,
      'created_at', a.created_at, 'closed', (a.status = 'rejected'),
      'dossier', public.kg_dossier_status(null, a.id)
    )
  end
  from public.kg_applications a
  join public.kg_tenants t on t.id = a.tenant_id
  left join public.kg_structures s on s.id = a.structure_id
  left join public.kg_classes c on c.id = a.class_id
  where a.id = p_id and a.applicant_user_id = auth.uid()
$$;
revoke all on function public.kg_my_application(uuid) from public, anon;
grant execute on function public.kg_my_application(uuid) to authenticated;

-- kg_my_applications (0142 text) gains three counts so a pending row can say
-- "Dossier · 2 pièces à fournir" and become a door to /enroll/dossier/{id}.
drop function if exists public.kg_my_applications();
create or replace function public.kg_my_applications()
returns table (
  id uuid, tenant_name text, child_first_name text, child_last_name text,
  created_at timestamptz, closed boolean, source text, existing_child_id uuid,
  structure_id uuid, class_id uuid,
  dossier_required integer, dossier_missing integer, dossier_rejected integer
) language sql stable security definer set search_path = pg_catalog, public as $$
  select a.id, t.name,
         a.child->>'first_name', a.child->>'last_name',
         a.created_at, (a.status = 'rejected') as closed,
         a.source, a.existing_child_id, a.structure_id, a.class_id,
         coalesce((d.st->>'required')::int, 0),
         coalesce((d.st->>'missing')::int, 0),
         coalesce((select count(*) from jsonb_array_elements(d.st->'todo') x where x->>'state' = 'rejected'), 0)::int
    from public.kg_applications a
    join public.kg_tenants t on t.id = a.tenant_id
    cross join lateral (select public.kg_dossier_status(null, a.id) as st) d
   where a.applicant_user_id = auth.uid()
     and a.status <> 'approved'
   order by a.created_at desc
$$;
revoke all on function public.kg_my_applications() from public, anon;
grant execute on function public.kg_my_applications() to authenticated;

-- ── 8. The public link publishes the list ───────────────────────────────────
-- 0140 §10 text plus one key. Every active requirement of the tenant, with
-- its kind; the wizard picks the kind from the structure the family chose
-- (EnrollStructure.center_type → centerKind) the way it narrows activities.
create or replace function public.kg_get_enroll_link(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  select jsonb_build_object(
    'tenant_id', t.id, 'tenant_name', t.name, 'logo_url', t.logo_url,
    'wilaya', t.wilaya, 'commune', t.commune,
    'address', t.address, 'latitude', t.latitude, 'longitude', t.longitude,
    'link_id', l.id, 'label', l.label,
    'structure_id', l.structure_id,
    'structure_name', (select s.name from kg_structures s where s.id = l.structure_id),
    'structure_name_ar', (select s.name_ar from kg_structures s where s.id = l.structure_id),
    'structures', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'name_ar', s.name_ar,
        'center_type', s.center_type, 'color', s.color) order by s.sort_order, s.name)
      from kg_structures s where s.tenant_id = t.id and s.active
    ), '[]'::jsonb),
    'activities', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'name_ar', a.name_ar,
        'category', a.category, 'fee_amount', a.fee_amount, 'fee_period', a.fee_period,
        'description', a.description, 'structure_id', a.structure_id))
      from kg_activities a where a.tenant_id = t.id and a.active
        and (l.structure_id is null or a.structure_id is null or a.structure_id = l.structure_id)
    ), '[]'::jsonb),
    'fee_plans', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'name_ar', p.name_ar,
        'amount', p.amount, 'description', p.description, 'structure_id', p.structure_id) order by p.amount)
      from kg_fee_plans p where p.tenant_id = t.id and p.active and p.period = 'monthly'
        and (l.structure_id is null or p.structure_id is null or p.structure_id = l.structure_id)
    ), '[]'::jsonb),
    'admission_fees', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'name_ar', p.name_ar,
        'amount', p.amount, 'structure_id', p.structure_id) order by p.amount desc)
      from kg_fee_plans p where p.tenant_id = t.id and p.active and p.period = 'once' and p.amount > 0
        and (l.structure_id is null or p.structure_id is null or p.structure_id = l.structure_id)
    ), '[]'::jsonb),
    'classes', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'name_ar', c.name_ar,
        'age_min_months', c.age_min_months, 'age_max_months', c.age_max_months,
        'structure_id', c.structure_id)
        order by c.age_min_months nulls last, c.name)
      from kg_classes c
      where c.tenant_id = t.id
        and (l.structure_id is null or c.structure_id is null or c.structure_id = l.structure_id)
    ), '[]'::jsonb),
    -- 0164: the dossier d'inscription, both kinds; the form narrows by the
    -- chosen structure's kind. Blank forms are public objects (policy above);
    -- the page mints signed URLs for them server-side like the logo.
    'documents', coalesce((
      select jsonb_agg(jsonb_build_object('id', q.id, 'kind', q.kind, 'key', q.key,
        'name', q.name, 'name_ar', q.name_ar, 'description', q.description, 'description_ar', q.description_ar,
        'required', q.required, 'applies_to', q.applies_to, 'accepts', q.accepts,
        'form_path', q.form_path, 'form_name', q.form_name, 'sort_order', q.sort_order)
        order by q.kind, q.sort_order)
      from kg_document_requirements q where q.tenant_id = t.id and q.active
    ), '[]'::jsonb)
  ) into r
  from kg_enroll_links l join kg_tenants t on t.id = l.tenant_id
  where l.token = p_token and l.active
    and (l.expires_at is null or l.expires_at > now())
    and (l.max_uses is null or l.use_count < l.max_uses);
  if r is null then raise exception 'invalid_link'; end if;
  return r;
end $$;

-- ── 9. Both submit RPCs take the papers ─────────────────────────────────────
-- Old signatures DROPPED, not kept beside the new ones (0140 §8: PostgREST
-- refuses two overloads that both match a call with defaulted arguments).
-- The deployed build's 8- and 7-argument calls still resolve.
-- p_documents = [{requirement_id, path, file_name}]. A file that fails
-- kg_attach_document's checks is DROPPED, not raised: a stale draft must
-- never cost the family the ten minutes they just spent (0140's own rule).
-- The same file named twice (a double tap, one scan for two pièces) is a
-- unique_violation on file_path, an empty object a check_violation on
-- size_bytes — dropped like the others, never fatal.
drop function if exists public.kg_submit_application(text, jsonb, jsonb, jsonb, jsonb, uuid, uuid, uuid);
create or replace function public.kg_submit_application(
  p_token text, p_child jsonb, p_guardians jsonb, p_health jsonb,
  p_activity_ids jsonb default '[]'::jsonb,
  p_fee_plan_id uuid default null,
  p_class_id uuid default null,
  p_structure_id uuid default null,
  p_documents jsonb default '[]'::jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_link kg_enroll_links; v_app uuid; v_uid uuid := auth.uid(); v_ok boolean;
  v_activities jsonb; v_structure uuid; v_class_structure uuid; v_paper jsonb;
begin
  if v_uid is null then raise exception 'auth required'; end if;
  select * into v_link from kg_enroll_links
    where token = p_token and active
      and (expires_at is null or expires_at > now())
      and (max_uses is null or use_count < max_uses);
  if v_link.id is null then raise exception 'invalid_link'; end if;

  v_structure := v_link.structure_id;
  if v_structure is null and p_structure_id is not null then
    if exists (select 1 from kg_structures
                where id = p_structure_id and tenant_id = v_link.tenant_id and active) then
      v_structure := p_structure_id;
    end if;
  end if;

  if p_fee_plan_id is not null then
    select exists (select 1 from kg_fee_plans
      where id = p_fee_plan_id and tenant_id = v_link.tenant_id
        and active and period = 'monthly'
        and (structure_id is null or v_structure is null or structure_id = v_structure)) into v_ok;
    if not v_ok then p_fee_plan_id := null; end if;
  end if;

  if p_class_id is not null then
    select c.structure_id into v_class_structure from kg_classes c
     where c.id = p_class_id and c.tenant_id = v_link.tenant_id
       and (v_structure is null or c.structure_id is null or c.structure_id = v_structure);
    if not found then
      p_class_id := null;
    elsif v_structure is null then
      v_structure := v_class_structure;
    end if;
  end if;

  select coalesce(jsonb_agg(to_jsonb(a.id)), '[]'::jsonb) into v_activities
    from kg_activities a
   where a.tenant_id = v_link.tenant_id and a.active
     and (a.structure_id is null or v_structure is null or a.structure_id = v_structure)
     and a.id::text in (
       select x from jsonb_array_elements_text(coalesce(p_activity_ids, '[]'::jsonb)) x
        where x ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     );

  insert into kg_applications (tenant_id, link_id, applicant_user_id, child, guardians,
                               health, activity_ids, fee_plan_id, class_id, structure_id)
    values (v_link.tenant_id, v_link.id, v_uid, p_child, p_guardians, p_health,
            v_activities, p_fee_plan_id, p_class_id, v_structure)
    returning id into v_app;
  update kg_enroll_links set use_count = use_count + 1 where id = v_link.id;
  insert into kg_profiles (id, full_name, phone)
    values (v_uid, coalesce(p_guardians->0->>'first_name','') || ' ' ||
                   coalesce(p_guardians->0->>'last_name',''), p_guardians->0->>'phone')
    on conflict (id) do update set phone = coalesce(excluded.phone, kg_profiles.phone);

  -- 0164: the papers, registered in the same transaction as the application.
  for v_paper in select * from jsonb_array_elements(coalesce(p_documents, '[]'::jsonb)) loop
    begin
      perform kg_attach_document(v_link.tenant_id, (v_paper->>'requirement_id')::uuid, v_paper->>'path',
                                 null, v_app, v_paper->>'file_name');
    exception when invalid_parameter_value or insufficient_privilege
                or invalid_text_representation or unique_violation or check_violation then
      null;   -- a file that is not theirs, not there, empty, of the wrong type or named twice is simply not registered
    end;
  end loop;
  return v_app;
end $$;
revoke all on function public.kg_submit_application(text, jsonb, jsonb, jsonb, jsonb, uuid, uuid, uuid, jsonb) from public, anon;
grant execute on function public.kg_submit_application(text, jsonb, jsonb, jsonb, jsonb, uuid, uuid, uuid, jsonb) to authenticated;

drop function if exists public.kg_submit_sibling_application(uuid, jsonb, jsonb, jsonb, uuid, uuid, uuid);
create or replace function public.kg_submit_sibling_application(
  p_tenant uuid, p_child jsonb, p_health jsonb, p_activity_ids jsonb,
  p_structure_id uuid default null, p_class_id uuid default null, p_fee_plan_id uuid default null,
  p_documents jsonb default '[]'::jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_g kg_guardians; v_app uuid; v_guardians jsonb;
        v_structure uuid; v_class_structure uuid; v_activities jsonb; v_paper jsonb;
begin
  if v_uid is null then raise exception 'auth required'; end if;

  if not exists (
    select 1 from kg_memberships m
    where m.tenant_id = p_tenant and m.user_id = v_uid and m.status = 'active'
  ) then
    raise exception 'forbidden';
  end if;

  select * into v_g from kg_guardians
   where tenant_id = p_tenant and user_id = v_uid limit 1;
  if v_g.id is null then raise exception 'no_guardian_record'; end if;

  if p_structure_id is not null and exists (
    select 1 from kg_structures where id = p_structure_id and tenant_id = p_tenant and active) then
    v_structure := p_structure_id;
  end if;

  if p_class_id is not null then
    select c.structure_id into v_class_structure from kg_classes c
     where c.id = p_class_id and c.tenant_id = p_tenant
       and (v_structure is null or c.structure_id is null or c.structure_id = v_structure);
    if not found then p_class_id := null;
    elsif v_structure is null then v_structure := v_class_structure; end if;
  end if;

  if p_fee_plan_id is not null and not exists (
    select 1 from kg_fee_plans
     where id = p_fee_plan_id and tenant_id = p_tenant and active and period = 'monthly'
       and (structure_id is null or v_structure is null or structure_id = v_structure)) then
    p_fee_plan_id := null;
  end if;

  select coalesce(jsonb_agg(to_jsonb(a.id)), '[]'::jsonb) into v_activities
    from kg_activities a
   where a.tenant_id = p_tenant and a.active
     and (a.structure_id is null or v_structure is null or a.structure_id = v_structure)
     and a.id::text in (
       select x from jsonb_array_elements_text(coalesce(p_activity_ids, '[]'::jsonb)) x
        where x ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     );

  v_guardians := jsonb_build_array(jsonb_build_object(
    'first_name', v_g.first_name, 'last_name', v_g.last_name,
    'first_name_ar', v_g.first_name_ar, 'last_name_ar', v_g.last_name_ar,
    'relationship', v_g.relationship, 'phone', v_g.phone, 'phone_alt', v_g.phone_alt,
    'email', v_g.email, 'national_id', v_g.national_id, 'address', v_g.address,
    'workplace', v_g.workplace,
    'is_applicant', true, 'is_primary', true, 'is_financial', true, 'can_pickup', true
  ));

  insert into kg_applications (tenant_id, applicant_user_id, status, child, guardians, health,
                               activity_ids, source, structure_id, class_id, fee_plan_id)
    values (p_tenant, v_uid, 'submitted', p_child, v_guardians,
            coalesce(p_health,'{}'::jsonb), v_activities, 'sibling',
            v_structure, p_class_id, p_fee_plan_id)
    returning id into v_app;

  for v_paper in select * from jsonb_array_elements(coalesce(p_documents, '[]'::jsonb)) loop
    begin
      perform kg_attach_document(p_tenant, (v_paper->>'requirement_id')::uuid, v_paper->>'path',
                                 null, v_app, v_paper->>'file_name');
    exception when invalid_parameter_value or insufficient_privilege
                or invalid_text_representation or unique_violation or check_violation then
      null;
    end;
  end loop;
  return v_app;
end $$;
revoke all on function public.kg_submit_sibling_application(uuid, jsonb, jsonb, jsonb, uuid, uuid, uuid, jsonb) from public, anon;
grant execute on function public.kg_submit_sibling_application(uuid, jsonb, jsonb, jsonb, uuid, uuid, uuid, jsonb) to authenticated;

-- ── 10. Approval carries the papers over ────────────────────────────────────
-- 0140 §5 text plus the one line that binds the application's rows to the
-- child (both branches). The bytes stay where they are — under u/{uid}/ or
-- t/{tenant}/applications/{app}/ — and the read rule of §3 follows the row.
-- EXECUTE stays with postgres/service_role (0063): callers go through
-- kg_approve_and_bill, which is why the rehearsal does too.
create or replace function public.kg_approve_application(
  p_app uuid, p_class uuid default null, p_tag_code text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare a kg_applications; v_child uuid; v_guardian uuid; g jsonb; al jsonb; act text;
begin
  select * into a from kg_applications where id = p_app;
  if a.id is null then raise exception 'not_found'; end if;
  if not kg_is_admin(a.tenant_id) then raise exception 'forbidden'; end if;
  if a.status = 'approved' then raise exception 'already_approved'; end if;

  if a.existing_child_id is not null then
    perform kg_move_child(a.existing_child_id, a.structure_id,
                          coalesce(p_class, a.class_id), kg_today(), null,
                          a.note, 'parent_request');
    update kg_child_documents set child_id = a.existing_child_id
     where application_id = p_app and child_id is null;
    update kg_applications
       set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(),
           created_child_id = a.existing_child_id
     where id = p_app;
    return a.existing_child_id;
  end if;

  insert into kg_children (tenant_id, class_id, structure_id, first_name, last_name,
      first_name_ar, last_name_ar, dob, gender, photo_path, blood_type, status, tag_code, notes)
    values (a.tenant_id, p_class, a.structure_id,
      a.child->>'first_name', a.child->>'last_name', a.child->>'first_name_ar', a.child->>'last_name_ar',
      (a.child->>'dob')::date, (a.child->>'gender')::kg_gender, a.child->>'photo_path',
      a.child->>'blood_type', 'enrolled', p_tag_code, a.child->>'notes')
    returning id into v_child;

  -- 0164: the dossier follows the child; the rows keep application_id as provenance.
  update kg_child_documents set child_id = v_child
   where application_id = p_app and child_id is null;

  for g in select * from jsonb_array_elements(a.guardians) loop
    v_guardian := null;
    if coalesce((g->>'is_applicant')::boolean, false) and a.applicant_user_id is not null then
      select id into v_guardian from kg_guardians
       where tenant_id = a.tenant_id and user_id = a.applicant_user_id limit 1;
    end if;
    if v_guardian is null and coalesce(g->>'phone','') <> '' then
      select id into v_guardian from kg_guardians
       where tenant_id = a.tenant_id
         and regexp_replace(coalesce(phone,''), '[^0-9]', '', 'g')
           = regexp_replace(g->>'phone', '[^0-9]', '', 'g') limit 1;
    end if;
    if v_guardian is null then
      insert into kg_guardians (tenant_id, user_id, first_name, last_name, first_name_ar,
          last_name_ar, relationship, phone, phone_alt, email, national_id, address,
          workplace, photo_path)
        values (a.tenant_id,
          case when coalesce((g->>'is_applicant')::boolean, false) then a.applicant_user_id else null end,
          g->>'first_name', g->>'last_name', g->>'first_name_ar', g->>'last_name_ar',
          coalesce((g->>'relationship')::kg_relationship, 'guardian'),
          coalesce(g->>'phone',''), g->>'phone_alt', g->>'email', g->>'national_id',
          g->>'address', g->>'workplace', g->>'photo_path')
        returning id into v_guardian;
    else
      update kg_guardians
         set user_id = coalesce(user_id,
               case when coalesce((g->>'is_applicant')::boolean, false) then a.applicant_user_id end)
       where id = v_guardian;
    end if;
    insert into kg_child_guardians (child_id, guardian_id, is_primary, can_pickup, is_financial)
      values (v_child, v_guardian,
        coalesce((g->>'is_primary')::boolean, false),
        coalesce((g->>'can_pickup')::boolean, true),
        coalesce((g->>'is_financial')::boolean, false))
      on conflict do nothing;
  end loop;

  insert into kg_child_health (child_id, medical_conditions, medications, vaccinations,
      dietary_restrictions, special_needs, doctor_name, doctor_phone, emergency_notes)
    values (v_child,
      coalesce(a.health->'medical_conditions','[]'::jsonb), coalesce(a.health->'medications','[]'::jsonb),
      coalesce(a.health->'vaccinations','[]'::jsonb), a.health->>'dietary_restrictions',
      a.health->>'special_needs', a.health->>'doctor_name', a.health->>'doctor_phone',
      a.health->>'emergency_notes');

  for al in select * from jsonb_array_elements(coalesce(a.health->'allergies','[]'::jsonb)) loop
    insert into kg_child_allergies (tenant_id, child_id, allergen, severity, reaction, action_plan)
      values (a.tenant_id, v_child, al->>'allergen',
        coalesce((al->>'severity')::kg_allergy_severity,'mild'), al->>'reaction', al->>'action_plan')
      on conflict (child_id, lower(btrim(allergen))) do nothing;
  end loop;

  for act in select jsonb_array_elements_text(a.activity_ids) loop
    insert into kg_activity_enrollments (tenant_id, activity_id, child_id, status)
      values (a.tenant_id, act::uuid, v_child, 'active')
      on conflict do nothing;
  end loop;

  if a.applicant_user_id is not null then
    insert into kg_memberships (tenant_id, user_id, role)
      values (a.tenant_id, a.applicant_user_id, 'parent')
      on conflict (tenant_id, user_id) do nothing;
  end if;

  update kg_applications set status = 'approved', reviewed_by = auth.uid(),
         reviewed_at = now(), created_child_id = v_child
    where id = p_app;
  return v_child;
end $$;

-- ── 11. Notifications ───────────────────────────────────────────────────────
-- Two types. 'document_received' tells the office a family sent a paper.
-- 'document_reviewed' tells the family, and only twice per file: when a paper
-- is refused (kind 'rejected', the note travels in the body — the one place
-- the family learns why) and when the last required paper is accepted (kind
-- 'complete') — whether it was accepted by review (UPDATE) or handed in at
-- the desk and scanned by staff, which inserts it accepted (D15, INSERT).
-- Never one push per accepted paper: six stamps on one file is noise.
-- 'complete' fires only from a REQUIRED active line, so an optional paper
-- accepted after completion does not repeat it. Wrapped as 0092 taught: a
-- notification never aborts the write.
alter table public.kg_notifications drop constraint if exists kg_notifications_type_known;
alter table public.kg_notifications add constraint kg_notifications_type_known check (type = any (array[
  'message','incident','announcement','application','checkin','checkout','daily_report','task',
  'activity_request','parent_update','payment_overdue','consent_changed','pickup_changed',
  'guardian_access_changed','allergy_changed','health_changed','incident_updated',
  'enrollment_changed','invoice_issued','payment_recorded','payment_reversed','fee_changed',
  'attendance_flagged','activity_decision','session_published','application_status','event',
  'advance_requested','advance_approved','advance_rejected',
  'structure_changed',
  'closure','session_scheduled','assessment_scheduled','leave',
  'document_received','document_reviewed'
])) not valid;
alter table public.kg_notifications validate constraint kg_notifications_type_known;

create or replace function public.kg_on_child_document_change() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_req public.kg_document_requirements; v_app public.kg_applications;
        v_child_name text; v_child_name_ar text; v_recipients uuid[]; v_kind text; st jsonb; v_data jsonb;
begin
  begin
    select * into v_req from public.kg_document_requirements where id = new.requirement_id;
    if new.child_id is not null then
      select c.first_name || ' ' || c.last_name,
             nullif(btrim(coalesce(c.first_name_ar,'') || ' ' || coalesce(c.last_name_ar,'')), '')
        into v_child_name, v_child_name_ar
        from public.kg_children c where c.id = new.child_id;
    end if;
    if new.application_id is not null then
      select * into v_app from public.kg_applications where id = new.application_id;
      if v_child_name is null then
        v_child_name := coalesce(v_app.child->>'first_name','') || ' ' || coalesce(v_app.child->>'last_name','');
        v_child_name_ar := nullif(btrim(coalesce(v_app.child->>'first_name_ar','') || ' ' || coalesce(v_app.child->>'last_name_ar','')), '');
      end if;
    end if;
    v_data := jsonb_build_object(
      'childId', new.child_id, 'applicationId', new.application_id, 'documentId', new.id,
      'requirementKey', v_req.key, 'name', coalesce(v_req.name, new.title), 'nameAr', v_req.name_ar,
      'childName', v_child_name, 'childNameAr', v_child_name_ar);

    if tg_op = 'INSERT' then
      if new.source = 'family' then
        select array_agg(u) into v_recipients
          from public.kg_staff_user_ids(new.tenant_id, array['owner','admin','educator']::public.kg_role[]) u;
        if v_recipients is null then return new; end if;
        perform public.kg_notify(new.tenant_id, v_recipients, 'document_received',
          coalesce(v_req.name, new.title), null, v_data || jsonb_build_object('audience', 'staff'), new.uploaded_by);
        return new;
      end if;
      -- a staff scan is born accepted: it may be the paper that completes the file
      if new.status <> 'accepted' then return new; end if;
    end if;

    if new.status = 'rejected' then
      v_kind := 'rejected';
    elsif new.status = 'accepted' then
      if not coalesce(v_req.required and v_req.active, false) then return new; end if;
      st := public.kg_dossier_status(new.child_id, new.application_id);
      if not coalesce((st->>'complete')::boolean, false) then return new; end if;
      v_kind := 'complete';
    else
      return new;
    end if;
    if new.child_id is not null then
      select array_agg(u) into v_recipients from public.kg_parent_user_ids(new.child_id) u;
    elsif v_app.applicant_user_id is not null then
      v_recipients := array[v_app.applicant_user_id];
    end if;
    if v_recipients is null then return new; end if;
    perform public.kg_notify(new.tenant_id, v_recipients, 'document_reviewed',
      coalesce(v_req.name, new.title),
      case when v_kind = 'rejected' then new.review_note end,
      v_data || jsonb_build_object('kind', v_kind, 'audience', 'parent'), auth.uid());
  exception when others then
    raise warning 'kg_on_child_document_change: % (%)', sqlerrm, sqlstate;
  end;
  return new;
end $$;
revoke all on function public.kg_on_child_document_change() from public, anon, authenticated;
drop trigger if exists trg_kg_child_documents_received on public.kg_child_documents;
drop trigger if exists trg_kg_child_documents_reviewed on public.kg_child_documents;
create trigger trg_kg_child_documents_received after insert on public.kg_child_documents
  for each row execute function public.kg_on_child_document_change();
create trigger trg_kg_child_documents_reviewed after update of status on public.kg_child_documents
  for each row when (old.status is distinct from new.status)
  execute function public.kg_on_child_document_change();

-- ── Rehearsal, always rolled back ─────────────────────────────────────────
-- Demo tenant only. The writes live in an inner block that ends by raising
-- P0164; the handler turns it into a notice, so the block's rows are undone
-- as a subtransaction while the DDL above commits (the 0160 shape). Any
-- failing assertion raises something else and aborts the whole migration.
-- To rehearse WITHOUT applying, run this file through execute_sql with that
-- final `raise notice` flipped to `raise exception`: the DDL, the inactive
-- seed and the rehearsal then roll back together, and the error text
-- "0164 rehearsal ok — rolled back" is the pass mark. That is how it was
-- rehearsed on production (2026-09-13, every assertion held, nothing
-- persisted) before being applied.
-- Roles: pg_temp.as_user(u) = a signed-in person (claims + role authenticated),
-- pg_temp.as_anon() = the public wizard before sign-in, pg_temp.as_migration()
-- = no session (RLS bypassed, as apply_migration runs).
create or replace function pg_temp.as_user(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create or replace function pg_temp.as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  execute 'set local role anon';
end $$;
create or replace function pg_temp.as_migration() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end $$;
do $$
declare
  t uuid := '732bdf7d-775a-4ed7-875f-8c04ea4e4778';
  s_creche uuid := '515ecf42-3a67-4304-86c6-66fafd6f7229';
  u_owner uuid := 'd9485859-48e8-4aad-85e7-d09e1cd16f4d';
  u_parent uuid; v_child uuid; u_parent2 uuid; v_child2 uuid;
  v_req uuid; v_req_contract uuid; v_req_health uuid;
  v_doc uuid; v_doc2 uuid; v_doc3 uuid; v_app uuid; v_new_child uuid;
  v_req_school uuid;
  n int; m int; st jsonb; p1 text; p2 text; p4 text; p5 text; p_empty text; p_foreign text; p_form text; p_staff1 text; p_staff2 text;
begin
  if not exists (select 1 from public.kg_tenants where id = t) then
    raise notice '0164 rehearsal skipped: demo tenant absent'; return;
  end if;
  begin
    -- a) the mixed demo building got both lists, each once, INACTIVE (it existed
    --    before 0164); the seed is idempotent; "Rétablir" activates one kind and
    --    leaves the other alone
    select count(*) into n from public.kg_document_requirements where tenant_id = t and kind = 'early';
    if n <> 9 then raise exception 'seed: expected 9 early rows, got %', n; end if;
    select count(*) into n from public.kg_document_requirements where tenant_id = t and kind = 'school';
    if n <> 9 then raise exception 'seed: expected 9 school rows, got %', n; end if;
    select count(*) into n from public.kg_document_requirements where tenant_id = t and active;
    if n <> 0 then raise exception 'seed: an existing tenant must receive the lists inactive, % active', n; end if;
    if exists (select 1 from public.kg_document_requirements where tenant_id = t and key = 'residence_certificate' and kind <> 'school') then
      raise exception 'seed: residence_certificate must be école-only';
    end if;
    select public.kg_seed_document_requirements(t, 'early', false, false) into n;
    if n <> 0 then raise exception 'seed: second run inserted % rows', n; end if;
    perform pg_temp.as_user(u_owner);
    select public.kg_seed_document_requirements(t, 'early', true, true) into n;
    if n <> 9 then raise exception 'restore: expected 9 rows re-activated, got %', n; end if;
    select public.kg_seed_document_requirements(t, 'early', true, true) into n;
    if n <> 0 then raise exception 'restore: second run changed % rows', n; end if;
    perform pg_temp.as_migration();
    select count(*) into n from public.kg_document_requirements where tenant_id = t and kind = 'early' and active;
    if n <> 9 then raise exception 'restore: early list should be active, % rows are', n; end if;
    select count(*) into n from public.kg_document_requirements where tenant_id = t and kind = 'school' and active;
    if n <> 0 then raise exception 'restore: the school list must stay inactive, % rows active', n; end if;
    select id into v_req          from public.kg_document_requirements where tenant_id = t and kind = 'early' and key = 'birth_certificate';
    select id into v_req_contract from public.kg_document_requirements where tenant_id = t and kind = 'early' and key = 'contract';
    select id into v_req_health   from public.kg_document_requirements where tenant_id = t and kind = 'early' and key = 'health_booklet';

    -- b) a signed-in parent of one enrolled crèche child (the early list is
    --    the one activated above), with an active membership and a guardian
    --    row; a second parent of another child when there is one; a child that
    --    is not the first parent's
    select g.user_id, cg.child_id into u_parent, v_child
      from public.kg_guardians g
      join public.kg_child_guardians cg on cg.guardian_id = g.id
      join public.kg_children c on c.id = cg.child_id
      left join public.kg_structures s on s.id = c.structure_id
     where g.tenant_id = t and g.user_id is not null and c.status = 'enrolled'
       and public.kg_center_kind(coalesce(s.center_type, 'nursery')) = 'early'
       and exists (select 1 from public.kg_memberships mb where mb.tenant_id = t and mb.user_id = g.user_id and mb.status = 'active')
     limit 1;
    if u_parent is null then raise exception 'rehearsal: no parent with an account on the demo tenant'; end if;
    select c.id into v_child2 from public.kg_children c
     where c.tenant_id = t and c.status = 'enrolled' and c.id <> v_child
       and not exists (select 1 from public.kg_child_guardians cg join public.kg_guardians g on g.id = cg.guardian_id
                        where cg.child_id = c.id and g.user_id = u_parent)
     limit 1;
    if v_child2 is null then raise exception 'rehearsal: every demo child belongs to the same parent'; end if;
    select g.user_id into u_parent2
      from public.kg_guardians g
     where g.tenant_id = t and g.user_id is not null and g.user_id <> u_parent
       and exists (select 1 from public.kg_memberships mb where mb.tenant_id = t and mb.user_id = g.user_id and mb.status = 'active')
     limit 1;

    -- three "uploads" of that parent, one empty one (a camera that failed
    -- mid-write) and one blank form: rows in storage.objects, no bytes
    -- (rolled back with the block)
    p1 := 'u/' || u_parent || '/enroll/docs/' || gen_random_uuid() || '.pdf';
    p2 := 'u/' || u_parent || '/enroll/docs/' || gen_random_uuid() || '.jpg';
    p4 := 'u/' || u_parent || '/enroll/docs/' || gen_random_uuid() || '.jpg';
    p_empty := 'u/' || u_parent || '/enroll/docs/' || gen_random_uuid() || '.jpg';
    p_form := 't/' || t || '/forms/' || v_req || '.pdf';
    insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
      values ('kg-media', p1, u_parent, u_parent::text, '{"mimetype":"application/pdf","size":2048}'::jsonb),
             ('kg-media', p2, u_parent, u_parent::text, '{"mimetype":"image/jpeg","size":4096}'::jsonb),
             ('kg-media', p4, u_parent, u_parent::text, '{"mimetype":"image/jpeg","size":4096}'::jsonb),
             ('kg-media', p_empty, u_parent, u_parent::text, '{"mimetype":"image/jpeg","size":0}'::jsonb),
             ('kg-media', p_form, u_owner, u_owner::text, '{"mimetype":"application/pdf","size":1024}'::jsonb);
    -- one école paper switched on, to prove a requirement of the other kind
    -- never lands on a crèche child
    update public.kg_document_requirements set active = true
     where tenant_id = t and kind = 'school' and key = 'residence_certificate'
     returning id into v_req_school;

    perform pg_temp.as_user(u_parent);

    -- c) the register says everything is missing on a fresh child
    st := public.kg_dossier_status(v_child, null);
    if (st->>'accepted')::int <> 0 or not (st->'todo' @> jsonb_build_array(jsonb_build_object('key', 'birth_certificate', 'state', 'missing'))) then
      raise exception 'status: fresh child should miss birth_certificate, got %', st;
    end if;
    -- another family's child is not a file, not even an empty one
    if public.kg_dossier_status(v_child2, null) is not null then
      raise exception 'status: a parent read another family''s child'; end if;

    -- d) the family may not insert into the table directly
    begin
      insert into public.kg_child_documents (tenant_id, child_id, doc_type, title, file_path)
        values (t, v_child, 'x', 'x', 't/' || t || '/children/' || v_child || '/documents/x.pdf');
      raise exception 'rls: parent inserted a document row directly';
    exception when insufficient_privilege then null; end;

    -- e) attach refuses a path with no object, an empty object, a paper of the
    --    other kind, and another family's child
    begin
      perform public.kg_attach_document(t, v_req, 't/' || t || '/children/' || v_child || '/documents/none.pdf', v_child);
      raise exception 'attach: accepted a path with no object';
    exception when invalid_parameter_value then null; end;
    begin
      perform public.kg_attach_document(t, v_req, p_empty, v_child, null, 'vide.jpg');
      raise exception 'attach: accepted an empty object';
    exception when invalid_parameter_value then null; end;
    begin
      perform public.kg_attach_document(t, v_req_school, p4, v_child, null, 'residence.jpg');
      raise exception 'attach: an école paper landed on a crèche child';
    exception when invalid_parameter_value then null; end;
    begin
      perform public.kg_attach_document(t, v_req, p4, v_child2);
      raise exception 'attach: a parent attached to another family''s child';
    exception when insufficient_privilege then null; end;

    -- f) storage: the family writes its photo and /documents/, nothing else,
    --    only in its own tenant's folder; reads the folder; alters only its own
    --    unregistered files
    if not public.kg_storage_access('t/' || t || '/children/' || v_child || '/documents/a.pdf', true) then
      raise exception 'storage: family should write under /documents/'; end if;
    if not public.kg_storage_access('t/' || t || '/children/' || v_child || '/photo-' || gen_random_uuid() || '.jpg', true) then
      raise exception 'storage: family should still write its child photo'; end if;
    if public.kg_storage_access('t/' || t || '/children/' || v_child || '/staff-note.pdf', true) then
      raise exception 'storage: family must not write at the folder root'; end if;
    if public.kg_storage_access('t/' || t || '/children/' || v_child || '/journal/2026-09-12/x.jpg', true) then
      raise exception 'storage: family must not write journal photos'; end if;
    if public.kg_storage_access('t/' || gen_random_uuid() || '/children/' || v_child || '/documents/a.pdf', true) then
      raise exception 'storage: family must not write its child under another tenant''s folder'; end if;
    if not public.kg_storage_access('t/' || t || '/children/' || v_child || '/staff-note.pdf', false) then
      raise exception 'storage: family should still read the folder'; end if;
    if public.kg_storage_may_alter('t/' || t || '/children/' || v_child || '/documents/a.pdf', u_owner::text) then
      raise exception 'storage: family must not alter a file it does not own'; end if;
    if not public.kg_storage_may_alter('t/' || t || '/children/' || v_child || '/documents/a.pdf', u_parent::text) then
      raise exception 'storage: family should alter its own unregistered file'; end if;

    -- g) a sibling application with one paper — named twice, a double tap —
    --    registered once in the same transaction; the applicant reads the row
    --    through kg_is_applicant_of and the file through kg_my_application;
    --    kg_dossier_status(null, app) is staff-only
    select public.kg_submit_sibling_application(t,
      jsonb_build_object('first_name', 'Rehearsal', 'last_name', 'Dossier', 'dob', '2024-03-01', 'gender', 'male'),
      '{}'::jsonb, '[]'::jsonb, s_creche, null, null,
      jsonb_build_array(jsonb_build_object('requirement_id', v_req, 'path', p1, 'file_name', 'extrait.pdf'),
                        jsonb_build_object('requirement_id', v_req_contract, 'path', p1, 'file_name', 'extrait.pdf')))
      into v_app;
    select id into v_doc from public.kg_child_documents where application_id = v_app and requirement_id = v_req;
    if v_doc is null then raise exception 'submit: the paper was not registered'; end if;
    if (select count(*) from public.kg_child_documents where application_id = v_app) <> 1 then
      raise exception 'submit: a duplicate path must be dropped, not registered twice (or the applicant cannot read their own rows)'; end if;
    if (select source || '/' || status from public.kg_child_documents where id = v_doc) <> 'family/received' then
      raise exception 'submit: expected family/received'; end if;
    select dossier_required, dossier_missing into n, m from public.kg_my_applications() where id = v_app;
    if n <> 7 or m <> 6 then raise exception 'my_applications: expected 7 required / 6 missing on the early list, got % / %', n, m; end if;
    if (public.kg_my_application(v_app)->'dossier'->>'pending')::int <> 1 then
      raise exception 'my_application: expected 1 pending paper'; end if;
    if public.kg_dossier_status(null, v_app) is not null then
      raise exception 'status: kg_dossier_status(null, app) must be staff-only'; end if;

    -- h) the office reads the file through the register row — and may remove
    --    its bytes when it retires the row, but not an unregistered one; a
    --    staff row names nothing outside its subject's own folder, and no
    --    row is UPDATEd through the table; the office was told; another
    --    applicant does not read it
    perform pg_temp.as_user(u_owner);
    if not public.kg_storage_access(p1, false) then raise exception 'storage: staff should read a registered u/ file'; end if;
    if public.kg_storage_access('u/' || u_parent || '/enroll/docs/other.pdf', false) then
      raise exception 'storage: staff must not read an unregistered u/ file'; end if;
    if not public.kg_storage_may_alter(p1, u_parent::text) then
      raise exception 'storage: staff should alter a registered u/ file'; end if;
    if public.kg_storage_may_alter('u/' || u_parent || '/enroll/docs/other.pdf', u_parent::text) then
      raise exception 'storage: staff must not alter an unregistered u/ file'; end if;
    p_foreign := 't/' || gen_random_uuid() || '/children/' || v_child || '/documents/a.pdf';
    begin
      insert into public.kg_child_documents (tenant_id, child_id, doc_type, title, file_path, uploaded_by, status, source)
        values (t, v_child, 'other', 'Autre', p_foreign, u_owner, 'accepted', 'staff');
      raise exception 'rls: staff registered a path under another tenant''s folder';
    exception when insufficient_privilege then null; end;
    if public.kg_storage_access(p_foreign, false) then
      raise exception 'storage: staff read another tenant''s folder'; end if;
    begin
      insert into public.kg_child_documents (tenant_id, child_id, doc_type, title, file_path, uploaded_by, status, source)
        values (t, v_child, 'other', 'Autre', 't/' || t || '/children/' || v_child2 || '/documents/a.pdf', u_owner, 'accepted', 'staff');
      raise exception 'rls: staff registered a path under another child''s folder';
    exception when insufficient_privilege then null; end;
    begin
      insert into public.kg_child_documents (tenant_id, child_id, doc_type, title, file_path, uploaded_by, status, source)
        values (t, v_child, 'other', 'Autre', p1, u_owner, 'accepted', 'staff');
      raise exception 'rls: staff registered a family''s u/ path';
    exception when insufficient_privilege or unique_violation then
      if sqlstate = '23505' then raise exception 'rls: the policy let a u/ path through to the index'; end if;
    end;
    begin
      update public.kg_child_documents set file_path = p_foreign where id = v_doc;
      raise exception 'rls: staff updated a register row through the table';
    exception when insufficient_privilege then null; end;
    if u_parent2 is not null then
      perform pg_temp.as_user(u_parent2);
      if public.kg_storage_access(p1, false) then raise exception 'storage: another applicant read a registered u/ file'; end if;
      if (select count(*) from public.kg_child_documents where application_id = v_app) <> 0 then
        raise exception 'rls: another applicant read the row'; end if;
    end if;
    -- kg_notifications is read as its recipient (RLS): the checks below run as the migration
    perform pg_temp.as_migration();
    if not exists (select 1 from public.kg_notifications where type = 'document_received' and user_id = u_owner and data->>'applicationId' = v_app::text) then
      raise exception 'notify: office was not told about the paper'; end if;
    perform pg_temp.as_user(u_owner);

    -- i) a review is a verdict; a refusal needs a note, and the family hears
    --    it with the note
    begin
      perform public.kg_review_document(v_doc, 'received', null);
      raise exception 'review: un-reviewed a paper';
    exception when invalid_parameter_value then null; end;
    begin
      perform public.kg_review_document(v_doc, 'rejected', '');
      raise exception 'review: rejected without a note';
    exception when check_violation then null; end;
    perform public.kg_review_document(v_doc, 'rejected', 'Photo floue — merci de la reprendre à la lumière du jour');
    perform pg_temp.as_migration();
    if not exists (select 1 from public.kg_notifications
                    where type = 'document_reviewed' and data->>'kind' = 'rejected'
                      and user_id = u_parent and body like 'Photo floue%') then
      raise exception 'notify: family was not told why'; end if;
    perform pg_temp.as_user(u_owner);
    st := public.kg_dossier_status(null, v_app);
    if not (st->'todo' @> jsonb_build_array(jsonb_build_object('key', 'birth_certificate', 'state', 'rejected'))) then
      raise exception 'status: a refused paper should read rejected, got %', st->'todo'; end if;

    -- j) the family sends a new one; the latest row is the state; a refused
    --    file's bytes and row are no longer the family's to touch; a merely
    --    received paper is theirs to withdraw or overwrite — not to double;
    --    the office accepts; then the accepted one is locked too, a second
    --    paper on it refused; no 'complete' while papers miss
    perform pg_temp.as_user(u_parent);
    select public.kg_attach_document(t, v_req, p2, null, v_app, 'extrait.jpg') into v_doc2;
    if (select x->>'state' from jsonb_array_elements(public.kg_my_application(v_app)->'dossier'->'lines') x where x->>'key' = 'birth_certificate') <> 'received' then
      raise exception 'status: the new paper should be the state'; end if;
    if public.kg_storage_may_alter(p1, u_parent::text) then
      raise exception 'storage: family altered a refused file'; end if;
    delete from public.kg_child_documents where id = v_doc;
    if not exists (select 1 from public.kg_child_documents where id = v_doc) then
      raise exception 'rls: family deleted a refused row'; end if;
    begin
      perform public.kg_attach_document(t, v_req, p4, null, v_app, 'extrait-2.jpg');
      raise exception 'attach: family doubled a paper the office has not looked at yet';
    exception when insufficient_privilege then null; end;
    if not public.kg_storage_may_alter(p2, u_parent::text) then
      raise exception 'storage: family should alter its own received file'; end if;
    delete from public.kg_child_documents where id = v_doc2;
    if exists (select 1 from public.kg_child_documents where id = v_doc2) then
      raise exception 'rls: family could not withdraw its own received row'; end if;
    -- the line reads rejected again (the refused row is the latest): a new paper is welcome
    select public.kg_attach_document(t, v_req, p4, null, v_app, 'extrait-2.jpg') into v_doc3;
    perform pg_temp.as_user(u_owner);
    perform public.kg_review_document(v_doc3, 'accepted', null);
    st := public.kg_dossier_status(null, v_app);
    if (st->>'accepted')::int <> 1 then raise exception 'status: expected 1 accepted, got %', st; end if;
    perform pg_temp.as_user(u_parent);
    if public.kg_storage_may_alter(p4, u_parent::text) then
      raise exception 'storage: family altered an accepted file'; end if;
    delete from public.kg_child_documents where id = v_doc3;
    if not exists (select 1 from public.kg_child_documents where id = v_doc3) then
      raise exception 'rls: family deleted an accepted row'; end if;
    begin
      perform public.kg_attach_document(t, v_req, p2, null, v_app, 'extrait-3.jpg');
      raise exception 'attach: family swapped an accepted paper';
    exception when insufficient_privilege then null; end;
    perform pg_temp.as_migration();
    if exists (select 1 from public.kg_notifications where type = 'document_reviewed' and data->>'kind' = 'complete' and data->>'applicationId' = v_app::text) then
      raise exception 'notify: complete fired with papers still missing'; end if;

    -- k) the director archives every early paper but two; the accepted extrait
    --    stays on screen as an inactive line and stops counting; staff cannot
    --    insert a 'family' row; a staff scan is born accepted and the last one
    --    completes the file
    update public.kg_document_requirements set active = false
     where tenant_id = t and kind = 'early' and key not in ('contract', 'health_booklet');
    perform pg_temp.as_user(u_owner);
    st := public.kg_dossier_status(null, v_app);
    if (st->>'required')::int <> 2 or (st->>'accepted')::int <> 0 then
      raise exception 'status: archived requirements must not count, got %', st; end if;
    if (select (x->>'state') || '/' || (x->>'active') from jsonb_array_elements(st->'lines') x where x->>'key' = 'birth_certificate') <> 'accepted/false' then
      raise exception 'status: a paper on an archived requirement must stay visible, got %', st->'lines'; end if;
    p_staff1 := 't/' || t || '/applications/' || v_app || '/documents/1-contrat.pdf';
    p_staff2 := 't/' || t || '/applications/' || v_app || '/documents/2-carnet.pdf';
    begin
      insert into public.kg_child_documents (tenant_id, application_id, requirement_id, doc_type, title, file_path, uploaded_by, status, source)
        values (t, v_app, v_req_contract, 'contract', 'Contrat', p_staff1, u_owner, 'received', 'family');
      raise exception 'rls: staff inserted a row as the family';
    exception when insufficient_privilege then null; end;
    insert into public.kg_child_documents (tenant_id, application_id, requirement_id, doc_type, title, file_path, uploaded_by, status, source, reviewed_by, reviewed_at)
      values (t, v_app, v_req_contract, 'contract', 'Contrat', p_staff1, u_owner, 'accepted', 'staff', u_owner, now());
    perform pg_temp.as_migration();
    if exists (select 1 from public.kg_notifications where type = 'document_received' and data->>'documentId' in
                (select id::text from public.kg_child_documents where file_path = p_staff1)) then
      raise exception 'notify: a staff scan must not notify the office'; end if;
    if exists (select 1 from public.kg_notifications where type = 'document_reviewed' and data->>'kind' = 'complete' and data->>'applicationId' = v_app::text) then
      raise exception 'notify: complete fired with the carnet still missing'; end if;
    perform pg_temp.as_user(u_owner);
    insert into public.kg_child_documents (tenant_id, application_id, requirement_id, doc_type, title, file_path, uploaded_by, status, source, reviewed_by, reviewed_at)
      values (t, v_app, v_req_health, 'health_booklet', 'Carnet', p_staff2, u_owner, 'accepted', 'staff', u_owner, now());
    perform pg_temp.as_migration();
    if not exists (select 1 from public.kg_notifications where type = 'document_reviewed' and data->>'kind' = 'complete'
                    and user_id = u_parent and data->>'applicationId' = v_app::text) then
      raise exception 'notify: the last staff scan did not complete the file'; end if;
    perform pg_temp.as_user(u_owner);

    -- l) approval carries the rows to the child (through the billing wrapper:
    --    kg_approve_application has no EXECUTE for authenticated since 0063);
    --    the parent still reads them; the approved file answers child_id
    select public.kg_approve_and_bill(v_app, null, null) into v_new_child;
    if (select count(*) from public.kg_child_documents where child_id = v_new_child and application_id = v_app) <> 4 then
      raise exception 'approve: the papers did not follow the child'; end if;
    perform pg_temp.as_user(u_parent);
    if not public.kg_storage_access(p4, false) then raise exception 'storage: parent should read the child''s registered file'; end if;
    st := public.kg_dossier_status(v_new_child, null);
    if (st->>'accepted')::int <> 2 then raise exception 'status(child): expected 2 accepted, got %', st; end if;
    if (public.kg_my_application(v_app)->>'child_id') <> v_new_child::text then
      raise exception 'my_application: an approved file should answer the child'; end if;
    begin
      perform public.kg_attach_document(t, v_req_contract, p2, null, v_app, 'late.jpg');
      raise exception 'attach: accepted a paper on an approved application';
    exception when insufficient_privilege then null; end;

    -- m) expiry reads as missing; the summary agrees with the status; an
    --    expired line takes a new paper from the family, in the child's folder
    perform pg_temp.as_migration();
    update public.kg_child_documents set expires_at = public.kg_today() - 1 where file_path = p_staff2;
    perform pg_temp.as_user(u_owner);
    st := public.kg_dossier_status(v_new_child, null);
    if (st->>'accepted')::int <> 1 or not (st->'todo' @> jsonb_build_array(jsonb_build_object('key', 'health_booklet', 'state', 'expired'))) then
      raise exception 'status: an expired paper should read expired, got %', st; end if;
    select missing into n from public.kg_dossier_summary(t) where child_id = v_new_child;
    if n <> (st->>'missing')::int then raise exception 'summary: missing % vs status %', n, st->>'missing'; end if;
    perform pg_temp.as_migration();
    p5 := 't/' || t || '/children/' || v_new_child || '/documents/' || gen_random_uuid() || '.jpg';
    insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
      values ('kg-media', p5, u_parent, u_parent::text, '{"mimetype":"image/jpeg","size":4096}'::jsonb);
    perform pg_temp.as_user(u_parent);
    perform public.kg_attach_document(t, v_req_health, p5, v_new_child, null, 'carnet-2026.jpg');
    st := public.kg_dossier_status(v_new_child, null);
    if (st->>'pending')::int <> 1 then raise exception 'status: the renewed carnet should be pending, got %', st; end if;

    -- n) a requirement with papers cannot be deleted; the forms folder is
    --    public, like branding, and the public wizard cannot attach
    perform pg_temp.as_migration();
    begin
      delete from public.kg_document_requirements where id = v_req;
      raise exception 'fk: deleted a requirement that received papers';
    exception when foreign_key_violation then null; end;
    if not exists (select 1 from pg_policies where schemaname = 'storage' and policyname = 'kg_media_branding_public' and qual like '%forms%') then
      raise exception 'storage: forms are not public'; end if;
    perform pg_temp.as_anon();
    if (select count(*) from storage.objects where bucket_id = 'kg-media' and name = p_form) <> 1 then
      raise exception 'storage: the public wizard cannot read a blank form'; end if;
    if (select count(*) from storage.objects where bucket_id = 'kg-media' and name = p1) <> 0 then
      raise exception 'storage: the public wizard read a family paper'; end if;
    begin
      perform public.kg_attach_document(t, v_req, p1, null, v_app, 'x');
      raise exception 'attach: anon executed kg_attach_document';
    exception when insufficient_privilege then null; end;
    perform pg_temp.as_migration();

    raise exception using errcode = 'P0164', message = 'rehearsal done';
  exception when sqlstate 'P0164' then
    raise notice '0164 rehearsal ok — rolled back';
  end;
  execute 'reset role';
end $$;

notify pgrst, 'reload schema';
commit;
