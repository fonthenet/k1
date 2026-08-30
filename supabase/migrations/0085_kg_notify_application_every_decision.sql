-- 0085 — tell the family what was decided, not only when it was yes.
--
-- kg_notify_application_status carried one line that made every other outcome
-- invisible to the people it was about:
--
--     if new.status <> 'approved' then return new; end if;
--
-- So a family who was refused, offered a place, put on the waiting list, or
-- called to interview heard nothing at all. In this tenant that is not
-- hypothetical: `sms_logs` is empty, no email path exists, and every one of the
-- 110 notifications ever created has `pushed_at` null — the portal was the only
-- channel and it was switched off for five of the six outcomes.
--
-- It also made one string in the product a lie: moving a family to `offered`
-- displayed "Offer sent" to staff while sending nothing.
--
-- `submitted` stays silent: it is the state the form arrives in, and
-- kg_notify_application already tells the crèche about that. Everything a human
-- deliberately chose is now reported to the family.
--
-- CONSEQUENCE THE OWNER ACCEPTED: reopening a refusal stops being invisible.
-- The family is told "we cannot offer a place", and on reconsideration told
-- "we are looking at your application" — which is honest, and is why the
-- under_review copy reads as a review rather than a first receipt.
--
-- The payload gains nothing: `childName` and `status` were already there. What
-- changes is that the client copy now has a branch per status instead of
-- printing the raw enum value, which is what a refused parent would have read.

create or replace function public.kg_notify_application_status()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.status is not distinct from old.status then return new; end if;
  -- No account, no inbox. Nothing to do — and this is worth knowing about: an
  -- application can be approved and billed for a family that cannot be reached
  -- by any channel the product owns.
  if new.applicant_user_id is null then return new; end if;
  -- Every outcome a person chose. `submitted` is not one of them.
  if new.status not in ('approved', 'offered', 'interview',
                        'waitlist', 'rejected', 'under_review') then
    return new;
  end if;

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
end $function$;

-- ---------------------------------------------------------------------------
-- ROLLBACK — restore the approved-only guard:
--   replace the status test with:  if new.status <> 'approved' then return new; end if;
-- No rows are altered by this migration; it changes only what future
-- transitions announce.
-- ---------------------------------------------------------------------------
