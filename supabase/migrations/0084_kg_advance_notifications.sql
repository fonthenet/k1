-- 0084 — an advance request that nobody is told about is a request nobody answers.
--
-- 0082 gave staff a way to ask for an advance and finance a way to decide it.
-- Neither end of that conversation notifies the other, so the whole exchange
-- depends on somebody opening the advances screen on the off-chance. The person
-- who asked is the one with a reason to keep checking, and they are exactly the
-- one who cannot see the finance screen.
--
-- Three notifications, one per turn in the conversation:
--
--   asked     -> everyone who could decide it   (owner, admin, accountant)
--   approved  -> the person who asked
--   rejected  -> the person who asked, carrying the reason if one was given
--
-- kg_notify already refuses to notify the actor, so an accountant who grants
-- their own advance is not told about it by themselves.
--
-- Deliberately NOT notified: a request withdrawn by the person who made it.
-- Finance never acted on it, and telling them something they had not yet
-- noticed has stopped existing is noise.

create or replace function kg_notify_advance()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user   uuid;
  v_name   text;
  v_admins uuid[];
begin
  -- Who the advance belongs to, and what to call them.
  select m.user_id, coalesce(p.full_name, '')
    into v_user, v_name
    from kg_memberships m
    left join kg_profiles p on p.id = m.user_id
   where m.id = new.membership_id;

  -- Asked for.
  if tg_op = 'INSERT' and new.status = 'requested' then
    select array_agg(m.user_id)
      into v_admins
      from kg_memberships m
     where m.tenant_id = new.tenant_id
       and m.status = 'active'
       and m.role in ('owner', 'admin', 'accountant')
       and m.user_id is not null;

    perform kg_notify(new.tenant_id, v_admins, 'advance_requested',
      v_name, left(coalesce(new.note, ''), 140),
      jsonb_build_object('advanceId', new.id, 'amount', new.amount,
                         'name', v_name, 'audience', 'staff'),
      coalesce(new.created_by, auth.uid()));
    return new;
  end if;

  -- Decided. Only on the transition out of `requested`: re-saving an approved
  -- row must not tell somebody twice that it was approved.
  if tg_op = 'UPDATE'
     and old.status = 'requested'
     and new.status in ('approved', 'rejected')
     and v_user is not null then
    perform kg_notify(new.tenant_id, array[v_user],
      'advance_' || new.status::text,
      v_name, left(coalesce(new.decision_note, ''), 140),
      jsonb_build_object('advanceId', new.id, 'amount', new.amount,
                         'note', new.decision_note, 'audience', 'staff'),
      coalesce(new.decided_by, auth.uid()));
  end if;

  return new;
end $function$;

drop trigger if exists trg_kg_notify_advance on kg_salary_advances;
create trigger trg_kg_notify_advance
  after insert or update on kg_salary_advances
  for each row execute function kg_notify_advance();

-- ---------------------------------------------------------------------------
-- ROLLBACK
--   drop trigger if exists trg_kg_notify_advance on kg_salary_advances;
--   drop function if exists kg_notify_advance();
-- Nothing else references either object; no rows are altered by this migration.
-- ---------------------------------------------------------------------------
