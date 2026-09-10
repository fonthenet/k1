-- 0132 — every establishment that predates billing goes on a trial.
--
-- Dated from the day this runs, not from their signup: back-dating would
-- invoice a working crèche for months nobody agreed to.
insert into kg_subscriptions (tenant_id, plan_id, status, trial_ends_at,
                              current_period_start, current_period_end, note)
select t.id,
       (select id from kg_plans where code = 'pro'),
       'trialing', current_date + 14, current_date, current_date + 14,
       'Backfilled — predates platform billing.'
  from kg_tenants t
 where not exists (select 1 from kg_subscriptions s where s.tenant_id = t.id);
