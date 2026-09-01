-- 0101 — the ledger loses the name of anyone who has no login.
--
-- ---------------------------------------------------------------------------
-- What is wrong
-- ---------------------------------------------------------------------------
--
-- Both ledger triggers write the person's name into the transaction
-- description, and both resolve it the same wrong way:
--
--   select p.full_name into v_name
--     from kg_memberships m left join kg_profiles p on p.id = m.user_id
--    where m.id = new.membership_id;
--
-- kg_profiles is keyed on auth.users. A membership only has a user_id once
-- that person has ACCEPTED an invitation and created an account — and most
-- crèche staff never will. The cook, the cleaner, the assistant are typed into
-- the team list by the director and paid in cash; they have no email, no
-- phone app and no reason for a login. Their membership carries the name in
-- kg_memberships.full_name, which the join above never reads.
--
-- So v_name comes back null, coalesce turns it into '', and the ledger records
--
--   'Salaire 04/2026 — '
--
-- Six identical rows a month in the demo tenant alone, one per accountless
-- member, differing only by amount. An accountant reading the journal cannot
-- tell whose salary that was, and the description is the only place the
-- payroll item's owner appears in the ledger — kg_transactions has no
-- membership_id, only related_payroll_item_id.
--
-- 36 rows are already wrong in production. Every one of them is recoverable:
-- the membership still holds the name.
--
-- This surfaced while seeding salary advances for the demo, which would have
-- multiplied the same broken line into the advances category.
--
-- ---------------------------------------------------------------------------
-- The fix
-- ---------------------------------------------------------------------------
--
-- Read both names and prefer the profile, matching how the advances page
-- already resolves them (see allMembers in accounting/advances/page.tsx): a
-- person who has an account may have corrected their own name there, and that
-- is the more current of the two.
--
-- The separator moves inside the conditional. 'Salaire 04/2026' with no name
-- is a truthful, if incomplete, line; 'Salaire 04/2026 — ' reads as a bug and
-- sorts oddly. nullif(btrim(...), '') collapses both null and a whitespace-only
-- name to the same nothing.

begin;

/* ------------------------------------------------------------ shared bit */

-- Both triggers need the same answer, and having asked it twice in two
-- slightly different ways is what produced the divergence in the first place.
create or replace function kg_member_display_name(p_membership uuid)
returns text language sql stable security definer set search_path = public as $$
  select nullif(btrim(coalesce(p.full_name, m.full_name, '')), '')
    from kg_memberships m
    left join kg_profiles p on p.id = m.user_id
   where m.id = p_membership
$$;

comment on function kg_member_display_name(uuid) is
  'Name to show for a membership. Prefers the profile (the person may have '
  'corrected it themselves) and falls back to the name the director typed. '
  'NULL only when neither exists — callers must not append a separator blindly.';

revoke all on function kg_member_display_name(uuid) from public, anon;
grant execute on function kg_member_display_name(uuid) to authenticated;

/* -------------------------------------------------------------- payroll */

create or replace function kg_on_payroll_item_paid() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_name text; v_month date;
begin
  if tg_op = 'DELETE' then
    delete from kg_transactions where related_payroll_item_id = old.id;
    return old;
  end if;

  if new.paid_at is null then
    delete from kg_transactions where related_payroll_item_id = new.id;
    return new;
  end if;

  v_name := kg_member_display_name(new.membership_id);
  select month into v_month from kg_payroll_runs where id = new.run_id;

  insert into kg_transactions (tenant_id, kind, category_id, amount, date, method,
                               description, related_payroll_item_id)
  values (new.tenant_id, 'expense',
          kg_category_id(new.tenant_id, 'Salaires', 'expense'),
          new.net_amount, new.paid_at::date, coalesce(new.method, 'cash'),
          'Salaire ' || to_char(coalesce(v_month, new.paid_at::date), 'MM/YYYY')
            || coalesce(' — ' || v_name, ''),
          new.id)
  on conflict (related_payroll_item_id) where related_payroll_item_id is not null
  do update set amount = excluded.amount, date = excluded.date,
                method = excluded.method, description = excluded.description;
  return new;
end $$;

/* ------------------------------------------------------------- advances */

create or replace function kg_on_advance_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  if tg_op = 'DELETE' then
    delete from kg_transactions where related_advance_id = old.id;
    return old;
  end if;
  -- A request has not moved any money, and a rejection never did. Only an
  -- approved advance belongs in the cash box. (Unchanged from 0082.)
  if new.status <> 'approved' then
    delete from kg_transactions where related_advance_id = new.id;
    return new;
  end if;

  v_name := kg_member_display_name(new.membership_id);

  insert into kg_transactions (tenant_id, kind, category_id, amount, date, method,
                               description, related_advance_id, created_by)
  values (new.tenant_id, 'expense',
          kg_category_id(new.tenant_id, 'Salaires', 'expense'),
          new.amount, new.date, 'cash',
          'Avance sur salaire' || coalesce(' — ' || v_name, ''),
          new.id, new.created_by)
  on conflict (related_advance_id) where related_advance_id is not null
  do update set amount = excluded.amount, date = excluded.date;
  return new;
end $$;

/* ------------------------------------------------------------- backfill */

-- Rewrite the descriptions already in the ledger rather than re-saving the
-- payroll items to make the trigger fire: touching kg_payroll_items would
-- move updated_at on rows nobody edited, and a paid item in a locked run is
-- not something a data fix should be writing to.
--
-- Scoped to rows that actually end in the dangling separator, so re-running
-- this file is a no-op and a description an accountant has since edited by
-- hand is left alone.
update kg_transactions t
   set description = 'Salaire '
                     || to_char(coalesce(r.month, pi.paid_at::date), 'MM/YYYY')
                     || coalesce(' — ' || kg_member_display_name(pi.membership_id), '')
  from kg_payroll_items pi
  join kg_payroll_runs r on r.id = pi.run_id
 where pi.id = t.related_payroll_item_id
   and t.description like '%— '
   and kg_member_display_name(pi.membership_id) is not null;

update kg_transactions t
   set description = 'Avance sur salaire'
                     || coalesce(' — ' || kg_member_display_name(a.membership_id), '')
  from kg_salary_advances a
 where a.id = t.related_advance_id
   and t.description like '%— '
   and kg_member_display_name(a.membership_id) is not null;

commit;
