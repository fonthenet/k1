-- 0126 — close the legacy-profiles leak for every Rawdatik person, without
--        touching how the old booking prototype sees its OWN users.
--
-- public.profiles belongs to a salon-booking prototype sharing this database.
-- Its trigger on auth.users copies EVERY signup into that table — so crèche
-- directors, educators and parents land there — and its read policy was
-- `USING (true)` with SELECT granted to anon. The anon key ships in the
-- browser bundle. Measured before this ran: 25 rows, 13 with phone numbers,
-- 21 of them Rawdatik people. It grew by one on every signup.
--
-- WHY A FUNCTION AND NOT A PLAIN SUBQUERY: a policy predicate that reads
-- kg_memberships directly is evaluated as the CALLER. anon cannot see any
-- membership row, so `not exists (...)` is true for everyone and the policy
-- silently collapses back to `USING (true)` — a leak that now looks fixed.
-- SECURITY DEFINER makes the question answerable regardless of who asks.
--
-- Scope: membership, guardian record, or a submitted application. A family
-- whose application is still pending has no membership yet and must not be
-- exposed in the gap.
create or replace function public.kg_is_rawdatik_person(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_user is not null and (
       exists (select 1 from kg_memberships m where m.user_id = p_user)
    or exists (select 1 from kg_guardians g where g.user_id = p_user)
    or exists (select 1 from kg_applications a where a.applicant_user_id = p_user)
  )
$$;

revoke all on function public.kg_is_rawdatik_person(uuid) from public;
grant execute on function public.kg_is_rawdatik_person(uuid) to anon, authenticated;

alter table public.profiles enable row level security;
drop policy if exists profiles_select on public.profiles;

create policy profiles_select on public.profiles
for select using (
  auth.uid() = id or not public.kg_is_rawdatik_person(public.profiles.id)
);

comment on policy profiles_select on public.profiles is
  'Was USING (true), which let any holder of the anon key read every name and '
  'phone in this database — including Rawdatik parents, copied here by the '
  'shared on_auth_user_created trigger. Rawdatik people are now visible only '
  'to themselves; the prototype''s own users are unchanged, so no screen of '
  'that app can break. See migration 0121 for the fuller fix.';
