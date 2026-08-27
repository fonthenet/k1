-- 0058 — The admissions pipeline is the crèche's kitchen, not the family's.
--
-- Owner's decision (2026-08-27): a parent must not see where their dossier
-- sits in the pipeline. "En examen", "entretien", "offre", waitlist position —
-- these are internal deliberations, and announcing each move invites a phone
-- call the office is not ready for, or worse, tells one family they are
-- "offered" before the crèche has decided how many places it really has. The
-- family hears the OUTCOME (their child appears, the portal opens), and until
-- then exactly one thing: "your file is being processed".
--
-- This reverses the per-status notifications half of 0057 — deliberately, on
-- instruction, hours after shipping it. The fee_plan_id half of 0057 stands.
--
-- Hiding the badge is not enough: app_sel granted the applicant the WHOLE row
-- over the API, status included. Anyone curious with devtools could read it.
-- So the row goes staff-only, and the family's list view goes through an RPC
-- that returns only what they may see.

-- ── The row itself: staff only ────────────────────────────────────────────
drop policy if exists app_sel on kg_applications;
create policy app_sel on kg_applications for select
  using (kg_is_staff(tenant_id));

-- ── What the family gets instead ──────────────────────────────────────────
-- Their own dossiers, minus every internal field. `closed` says "this file is
-- no longer moving — contact the crèche", without naming the outcome: a
-- refusal is delivered by a person, in words the crèche chooses, not by a
-- badge. Approved dossiers are excluded outright — approval creates the child,
-- and the child card is the good news.
create or replace function kg_my_applications()
returns table (
  id uuid,
  tenant_name text,
  child_first_name text,
  child_last_name text,
  created_at timestamptz,
  closed boolean
) language sql stable security definer set search_path = public as $$
  select a.id, t.name,
         a.child->>'first_name', a.child->>'last_name',
         a.created_at,
         (a.status = 'rejected') as closed
    from kg_applications a
    join kg_tenants t on t.id = a.tenant_id
   where a.applicant_user_id = auth.uid()
     and a.status <> 'approved'
   order by a.created_at desc
$$;
revoke execute on function kg_my_applications() from anon;
grant execute on function kg_my_applications() to authenticated;

-- ── Notifications: outcome only ───────────────────────────────────────────
-- The 0057 trigger announced every stage. Now it speaks once, when the answer
-- is yes — the one status that is already public by its consequences.
create or replace function kg_notify_application_status() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status is not distinct from old.status then return new; end if;
  if new.applicant_user_id is null then return new; end if;
  if new.status <> 'approved' then return new; end if;

  perform kg_notify(
    new.tenant_id, array[new.applicant_user_id], 'application_status',
    coalesce(new.child->>'first_name','') || ' ' || coalesce(new.child->>'last_name',''),
    null,
    jsonb_build_object(
      'applicationId', new.id,
      'childName', coalesce(new.child->>'first_name','') || ' ' || coalesce(new.child->>'last_name',''),
      'status', new.status::text,
      'audience', 'parent'),
    auth.uid());
  return new;
end $$;
