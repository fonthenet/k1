-- 0121 — every Rawdatik user's name and phone is world-readable through the
--        legacy booking prototype that shares this database.
--
-- ⚠️  NOT APPLIED. This file touches `public.profiles`, which belongs to the
--     salon-booking prototype, not to Rawdatik. Read "The risk" at the bottom
--     and choose a variant before running it. Nothing here has been executed.
--
-- ---------------------------------------------------------------------------
-- What is wrong
-- ---------------------------------------------------------------------------
--
-- This Supabase project hosts two applications. Rawdatik owns the kg_ tables;
-- an older salon-booking prototype owns 49 others, including public.profiles.
-- They were said to "coexist untouched". They do not.
--
-- auth.users is shared, and the prototype put a trigger on it:
--
--     on_auth_user_created  →  handle_auth_user_created()
--
-- which fires on EVERY signup, whichever app produced it, and unconditionally
-- runs
--
--     INSERT INTO public.profiles (id, full_name, phone, role) VALUES (…)
--
-- So a crèche director, an educator or a PARENT creating a Rawdatik account
-- has their name and phone number written into the prototype's table as a
-- side effect. And that table's read policy is
--
--     profiles_select … USING (true)
--
-- with SELECT granted to `anon`. `true` is not "any logged-in user"; it is
-- everyone. The anon key ships in the browser bundle of every page we serve.
--
-- Measured on production, as the anon role, with no session:
--
--     rows readable ............ 24
--     carrying a phone number .. 13
--     who are Rawdatik users ... 20 of the 24
--
-- That is the roster of a crèche — the director, the staff, and the parents of
-- the children — with phone numbers, downloadable by anyone who opens the site
-- and reads one JavaScript file. For a product whose subject is small children
-- this is the most serious finding in the audit.
--
-- (Measuring this needs care: counting the overlap while SET ROLE anon returns
-- 0, because the kg_memberships half of the join is hidden by ITS policy and a
-- hidden row is indistinguishable from an absent one. The real figure comes
-- from a privileged context. The exposure itself was then re-confirmed as anon
-- against public.profiles alone, which is what an attacker actually holds.)
--
-- ---------------------------------------------------------------------------
-- The fix
-- ---------------------------------------------------------------------------
--
-- Two independent halves. A does not depend on B.

/* ── A. Stop the leak for everyone, existing and future ────────────────────
   Replace `USING (true)` with "yourself, or someone you actually share a shop
   with". A signed-out visitor sees nothing; the prototype's own users keep the
   reads its screens need (a client sees the shop owner they booked with, an
   owner sees their clients).

   This is the half that closes the hole. It is also the half that touches the
   other app — see "The risk". */

alter table public.profiles enable row level security;   -- already on; idempotent

drop policy if exists profiles_select on public.profiles;

create policy profiles_select on public.profiles
for select using (
      auth.uid() = id                                       -- yourself
   or exists (                                              -- your shop's owner
        select 1 from public.shops s
        where s.owner_id = public.profiles.id
          and exists (select 1 from public.bookings b
                       where b.shop_id = s.id and b.client_id = auth.uid())
      )
   or exists (                                              -- your own clients
        select 1 from public.shops s
        join public.bookings b on b.shop_id = s.id
        where s.owner_id = auth.uid() and b.client_id = public.profiles.id
      )
);

comment on policy profiles_select on public.profiles is
  'Was USING (true), which let any holder of the anon key read every name and '
  'phone in the database — including Rawdatik parents, who are copied here by '
  'the shared on_auth_user_created trigger. See migration 0121.';

/* ── B. Stop copying Rawdatik people into the prototype at all ─────────────
   Belt and braces: even with A in place, there is no reason for a crèche
   parent to have a row in a barbershop booking app. The trigger cannot ask
   kg_memberships at signup time (the membership does not exist yet), so it
   keys off the signup metadata Rawdatik sends instead.

   REQUIRES a one-line change in the web app: the signup call must pass
   `app: 'rawdatik'` in the auth metadata. Until that ships, this block is
   inert — which is why A is the half that matters today. */

create or replace function public.handle_auth_user_created()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- A Rawdatik signup has no business in the booking app's tables. Its own
  -- profile row is created by the Rawdatik side (kg_profiles).
  if coalesce(new.raw_user_meta_data->>'app', '') = 'rawdatik' then
    return new;
  end if;
  return public.handle_auth_user_created_legacy(new);
end $$;

/* ── The risk ──────────────────────────────────────────────────────────────

   Block A changes the behaviour of an application whose source I cannot see.
   If any prototype screen lists profiles it does not have a booking with — a
   public "our team" page, an admin user list, a search — that screen will go
   empty. The prototype currently holds 1 shop, 47 bookings and 24 users, so it
   looks abandoned, but abandoned is not the same as unused.

   Three ways forward, in order of how much I would recommend them:

   1. RUN BLOCK A. Correct for both apps. If the prototype is dead this costs
      nothing; if it is alive, the worst case is one broken listing.

   2. If the prototype must keep public reads, narrow the exposure instead:
        create policy profiles_select on public.profiles for select
        using (auth.uid() = id
               or not exists (select 1 from kg_memberships m
                               where m.user_id = public.profiles.id));
      Rawdatik people become invisible; the prototype's own users stay public.
      Weaker — it still publishes 4 people's phone numbers — but it cannot
      break the other app.

   3. Split the projects. The only real answer long term. Two products sharing
      one auth.users and one PUBLIC schema will keep producing this class of
      bug, and the next one may not be found by an audit.

   Whichever is chosen, block B plus the `app: 'rawdatik'` metadata should ship
   too, so the two populations stop mixing.

   NOTE: block B references handle_auth_user_created_legacy, which does not
   exist yet — the current body must be renamed to it first. Do that in the
   same transaction as running this file, or block B will break signup for the
   prototype. This is deliberate: the file must not be runnable by accident. */
